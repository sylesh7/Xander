/**
 * The Remote Authority API — Xander V2 spec section 19.1.
 *
 * Mounted under `/v2/control` with its OWN authentication, deliberately not the
 * protocol API key. Section 27.1: "Do not reuse a static protocol API key as a
 * mobile-user credential." Every route here answers "which named human decided
 * this?", and a shared backend key cannot answer that.
 *
 * Section 19.2's checklist is applied here in the middleware rather than
 * per-route, so a route added later cannot quietly skip it — the same reasoning
 * the V1 claim gate and the /v2 router already follow.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler, validateBody } from '../claim/middleware.js'
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { OPERATOR_COMMANDS } from '../workflow/shared.js'
import {
  audit,
  authenticate,
  closeSession,
  ControlError,
  controlAgentEvidence,
  controlAgentView,
  createPendingAction,
  decidePendingAction,
  listPendingActions,
  openSession,
  readAuditLog,
  type AuthenticatedOperator,
} from './control-service.js'

export const controlRouter: Router = Router()

/** Section 19.2 — rate limiting, applied to the whole control plane. */
const controlRateLimit = rateLimit({
  windowMs: env.CONTROL_RATE_LIMIT_WINDOW_MS,
  max: env.CONTROL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many control-plane requests.' },
})

declare module 'express-serve-static-core' {
  interface Request {
    operator?: AuthenticatedOperator
  }
}

/**
 * Operator authentication — bearer token PLUS device id.
 *
 * Both are required. The device header is what makes an exfiltrated token
 * insufficient on its own, which is section 19.2's "device/session binding".
 */
const operatorAuth: RequestHandler = (req, res, next) => {
  const header = req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  const deviceId = req.header('x-device-id')

  if (!token || !deviceId) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'An Authorization: Bearer token and an X-Device-Id header are both required.',
    })
    return
  }

  // Written as a plain RequestHandler rather than through `asyncHandler`,
  // which only forwards (req, res) and so cannot call `next()`.
  authenticate({ token, deviceId })
    .then((operator) => {
      req.operator = operator
      next()
    })
    .catch(next)
}

// --- session lifecycle (unauthenticated by necessity) -----------------------

const openSessionSchema = z.object({
  externalId: z.string().min(1).max(200),
  secret: z.string().min(1).max(500),
  deviceId: z.string().min(8).max(200),
})

controlRouter.post(
  '/v2/control/sessions',
  controlRateLimit,
  validateBody(openSessionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof openSessionSchema>
    const grant = await openSession({
      externalId: body.externalId,
      secret: body.secret,
      deviceId: body.deviceId,
      userAgent: req.header('user-agent') ?? null,
    })
    // The token is returned ONCE and stored only as a hash.
    res.status(201).json({
      token: grant.token,
      sessionId: grant.sessionId,
      expiresAt: grant.expiresAt.toISOString(),
    })
  }),
)

controlRouter.delete(
  '/v2/control/sessions',
  controlRateLimit,
  operatorAuth,
  asyncHandler(async (req, res) => {
    await closeSession(req.operator!.sessionId)
    res.json({ closed: true })
  }),
)

// --- everything below requires an authenticated operator --------------------

controlRouter.use('/v2/control', controlRateLimit, operatorAuth)

/** Live agent state — section 19.1. */
controlRouter.get(
  '/v2/control/agents',
  asyncHandler(async (_req, res) => {
    const agents = await prisma.agent.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, name: true, status: true, ensName: true, actorId: true, updatedAt: true },
    })
    res.json({ agents })
  }),
)

controlRouter.get(
  '/v2/control/agents/:id',
  asyncHandler(async (req, res) => {
    const view = await controlAgentView(String(req.params.id))
    if (!view) {
      res.status(404).json({ error: 'not_found', message: 'No such agent.' })
      return
    }
    res.json(view)
  }),
)

/** "view evidence" — the acceptance condition names it explicitly. */
controlRouter.get(
  '/v2/control/agents/:id/evidence',
  asyncHandler(async (req, res) => {
    const evidence = await controlAgentEvidence(String(req.params.id))
    if (!evidence) {
      res.status(404).json({ error: 'not_found', message: 'No such agent.' })
      return
    }
    res.json(evidence)
  }),
)

controlRouter.get(
  '/v2/control/incidents',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const incidents = await prisma.incident.findMany({
      where: status ? { status } : { status: { in: ['OPEN', 'INVESTIGATING', 'MITIGATED'] } },
      orderBy: { openedAt: 'desc' },
      take: 50,
    })
    res.json({ incidents })
  }),
)

controlRouter.get(
  '/v2/control/pending-actions',
  asyncHandler(async (_req, res) => {
    const actions = await listPendingActions()
    res.json({
      actions: actions.map((a) => ({
        id: a.id,
        subjectType: a.subjectType,
        subjectId: a.subjectId,
        summary: a.summary,
        allowed: a.allowed,
        severity: a.severity,
        // The client MUST echo this back with its decision — section 19.2's
        // explicit action binding.
        bindingHash: a.bindingHash,
        requiresStepUp: a.requiresStepUp,
        expiresAt: a.expiresAt.toISOString(),
      })),
    })
  }),
)

/** Raising a pending action, for the services that need a human. */
const createActionSchema = z.object({
  subjectType: z.enum(['INTENT', 'INCIDENT', 'AGENT']),
  subjectId: z.string().min(1),
  summary: z.string().min(1).max(500),
  allowed: z.array(z.enum(OPERATOR_COMMANDS)).min(1),
  actorId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  incidentId: z.string().min(1).optional(),
  intentId: z.string().min(1).optional(),
  amount: z.string().regex(/^\d+$/).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  ttlSeconds: z.number().int().positive().max(86_400).optional(),
})

controlRouter.post(
  '/v2/control/pending-actions',
  validateBody(createActionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createActionSchema>
    const action = await createPendingAction(body)
    res.status(201).json({ action })
  }),
)

// --- decisions ---------------------------------------------------------------

const decisionSchema = z.object({
  /** Echoed from the pending action. Section 19.2's explicit action binding. */
  bindingHash: z.string().length(64),
  /** Single-use. Replay protection. */
  nonce: z.string().min(16).max(200),
  reason: z.string().max(1000).optional(),
  limitAmount: z.string().regex(/^\d+$/).optional(),
  stepUpProofId: z.string().min(1).optional(),
})

/** One handler for approve / deny / limit — the command comes from the path. */
function decisionRoute(command: (typeof OPERATOR_COMMANDS)[number]) {
  return asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof decisionSchema>
    const result = await decidePendingAction(req.operator!, {
      actionId: String(req.params.id),
      command,
      bindingHash: body.bindingHash,
      nonce: body.nonce,
      reason: body.reason ?? null,
      limitAmount: body.limitAmount ?? null,
      stepUpProofId: body.stepUpProofId ?? null,
    })
    res.json(result)
  })
}

controlRouter.post(
  '/v2/control/actions/:id/approve',
  validateBody(decisionSchema),
  decisionRoute('APPROVE'),
)
controlRouter.post(
  '/v2/control/actions/:id/deny',
  validateBody(decisionSchema),
  decisionRoute('DENY'),
)
controlRouter.post(
  '/v2/control/actions/:id/limit',
  validateBody(decisionSchema.extend({ limitAmount: z.string().regex(/^\d+$/) })),
  decisionRoute('LIMIT'),
)

/**
 * Freeze and revoke an agent directly — section 19.1.
 *
 * These do not answer a queued action, so a pending action is created and
 * immediately decided in the same call. That keeps ONE path through the binding
 * check, the scope check, the nonce and the audit log; a direct shortcut would
 * be a second, less-guarded way to reach the most dangerous commands.
 */
const directSchema = z.object({
  nonce: z.string().min(16).max(200),
  reason: z.string().min(1).max(1000),
  stepUpProofId: z.string().min(1).optional(),
})

function directCommandRoute(command: 'FREEZE' | 'REVOKE') {
  return asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof directSchema>
    const agentId = String(req.params.id)
    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent) {
      res.status(404).json({ error: 'not_found', message: 'No such agent.' })
      return
    }

    const action = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: `${command} agent ${agent.name}`,
      allowed: [command],
      actorId: agent.actorId,
      agentId,
      severity: 'HIGH',
      ttlSeconds: 60,
    })

    const result = await decidePendingAction(req.operator!, {
      actionId: action.id,
      command,
      bindingHash: action.bindingHash,
      nonce: body.nonce,
      reason: body.reason,
      stepUpProofId: body.stepUpProofId ?? null,
    })
    res.json(result)
  })
}

controlRouter.post(
  '/v2/control/agents/:id/freeze',
  validateBody(directSchema),
  directCommandRoute('FREEZE'),
)
controlRouter.post(
  '/v2/control/agents/:id/revoke',
  validateBody(directSchema),
  directCommandRoute('REVOKE'),
)

/** The audit trail — section 19.2. */
controlRouter.get(
  '/v2/control/audit',
  asyncHandler(async (req, res) => {
    const mine = req.query.mine === 'true'
    const entries = await readAuditLog(mine ? { operatorId: req.operator!.operatorId } : {})
    res.json({ entries })
  }),
)

/**
 * Control-plane error middleware.
 *
 * Registered after the routes; Express selects error middleware by arity and
 * position. Anything it does not recognise goes on to the app-level handler.
 */
controlRouter.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err)
    return
  }
  if (err instanceof ControlError) {
    // A refused control-plane call is itself security-relevant. `decidePendingAction`
    // audits its own refusals with full context; this catches the rest.
    if (err.status === 401 || err.status === 403) {
      void audit({
        deviceId: req.header('x-device-id') ?? null,
        action: 'CONTROL_REQUEST',
        subject: req.path,
        outcome: 'DENIED',
        reason: err.message,
        ip: req.ip ?? null,
      })
    }
    res.status(err.status).json({ error: 'control_error', message: err.message })
    return
  }
  next(err)
})
