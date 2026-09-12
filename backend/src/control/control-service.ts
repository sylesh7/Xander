/**
 * The Remote Authority control plane — Xander V2 spec sections 19, 14.2, 27.
 *
 * "The mobile app is not a remote desktop client. It is a HUMAN AUTHORITY
 * PLANE." That framing drives every decision here: the phone does not drive a
 * UI, it issues signed, bound, single-use authority decisions that flow into
 * durable workflows.
 *
 * WHAT MAKES THIS SAFE, in the order section 19.2 lists it:
 *
 *   strong operator auth  -> a per-operator credential, never the API key
 *   device/session binding-> the token is useless from another device
 *   explicit action binding-> a decision names the exact action it answers
 *   short-lived tokens    -> a stolen phone stops being an authority plane
 *   replay protection     -> a unique nonce index, not a check-then-insert
 *   audit logging         -> written for REFUSALS too, not only successes
 *   rate limiting         -> applied at the router
 *   World step-up         -> demanded for REVOKE and FREEZE
 */
import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import {
  authorizeOperatorAction,
  checkSession,
  computeBindingHash,
  deriveSecretHash,
  generateSalt,
  generateToken,
  hashToken,
  isAllowedDecision,
  requiresStepUp,
  secretsMatch,
} from './operator-auth.js'
import type { OperatorCommand } from '../workflow/shared.js'

export class ControlError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ControlError'
  }
}

// --- enrolment --------------------------------------------------------------

/**
 * Creates an operator and returns its enrolment secret ONCE.
 *
 * The secret is shown exactly here and never again — only its hash is stored,
 * so a leaked operator table yields nothing usable.
 */
export async function enrolOperator(input: {
  externalId: string
  displayName: string
  actorScope?: string[]
  actionScope?: string[]
}): Promise<{ operatorId: string; externalId: string; secret: string }> {
  const secret = generateToken()
  const salt = generateSalt()
  const operator = await prisma.operator.create({
    data: {
      externalId: input.externalId,
      displayName: input.displayName,
      secretHash: deriveSecretHash(secret, salt),
      secretSalt: salt,
      actorScope: input.actorScope ?? [],
      actionScope: input.actionScope ?? [],
    },
  })
  logger.info({ operatorId: operator.id, externalId: input.externalId }, 'operator enrolled')
  return { operatorId: operator.id, externalId: operator.externalId, secret }
}

// --- sessions ---------------------------------------------------------------

export interface SessionGrant {
  token: string
  sessionId: string
  operatorId: string
  expiresAt: Date
}

/**
 * Exchanges an enrolment secret for a short-lived, device-bound session token.
 *
 * The token is returned once. Everything after this point presents the token
 * plus the SAME device id, and both must match.
 */
export async function openSession(input: {
  externalId: string
  secret: string
  deviceId: string
  userAgent?: string | null
  now?: Date
}): Promise<SessionGrant> {
  const now = input.now ?? new Date()
  const operator = await prisma.operator.findUnique({ where: { externalId: input.externalId } })

  // The same error and the same work either way, so a wrong external id cannot
  // be distinguished from a wrong secret by response or by timing.
  const salt = operator?.secretSalt ?? 'absent-operator-salt'
  const candidate = deriveSecretHash(input.secret, salt)
  const matches = operator ? secretsMatch(candidate, operator.secretHash) : false

  if (!operator || !matches || operator.status !== 'ACTIVE') {
    await audit({
      operatorId: operator?.id ?? null,
      deviceId: input.deviceId,
      action: 'OPEN_SESSION',
      subject: input.externalId,
      outcome: 'DENIED',
      reason: !operator
        ? 'no such operator'
        : !matches
          ? 'bad secret'
          : `operator is ${operator.status}`,
    })
    throw new ControlError('Invalid operator credentials.', 401)
  }

  const token = generateToken()
  const expiresAt = new Date(now.getTime() + env.OPERATOR_SESSION_TTL_SECONDS * 1000)
  const session = await prisma.operatorSession.create({
    data: {
      operatorId: operator.id,
      tokenHash: hashToken(token),
      deviceId: input.deviceId,
      userAgent: input.userAgent ?? null,
      expiresAt,
    },
  })

  await audit({
    operatorId: operator.id,
    sessionId: session.id,
    deviceId: input.deviceId,
    action: 'OPEN_SESSION',
    subject: operator.externalId,
    outcome: 'ALLOWED',
    reason: 'session opened',
  })

  return { token, sessionId: session.id, operatorId: operator.id, expiresAt }
}

export interface AuthenticatedOperator {
  operatorId: string
  sessionId: string
  deviceId: string
  displayName: string
  actorScope: string[]
  actionScope: string[]
}

/**
 * Resolves a bearer token plus device id to an operator, or throws 401.
 *
 * `lastUsedAt` is updated so an operator can see their own session activity —
 * and so a session that has silently gone unused is visible as such.
 */
export async function authenticate(args: {
  token: string
  deviceId: string
  now?: Date
}): Promise<AuthenticatedOperator> {
  const now = args.now ?? new Date()
  const session = await prisma.operatorSession.findUnique({
    where: { tokenHash: hashToken(args.token) },
    include: { operator: true },
  })

  const check = checkSession(session, args.deviceId, now)
  if (!check.valid || !session) {
    await audit({
      operatorId: session?.operatorId ?? null,
      sessionId: session?.id ?? null,
      deviceId: args.deviceId,
      action: 'AUTHENTICATE',
      outcome: 'DENIED',
      reason: check.reason,
    })
    throw new ControlError(`Not authenticated: ${check.reason}.`, 401)
  }

  // Expire it in the database too, so a stale session stops appearing ACTIVE.
  if (session.expiresAt.getTime() <= now.getTime()) {
    await prisma.operatorSession.update({
      where: { id: session.id },
      data: { status: 'EXPIRED' },
    })
    throw new ControlError('Not authenticated: session expired.', 401)
  }

  await prisma.operatorSession.update({
    where: { id: session.id },
    data: { lastUsedAt: now },
  })

  return {
    operatorId: session.operatorId,
    sessionId: session.id,
    deviceId: session.deviceId,
    displayName: session.operator.displayName,
    actorScope: session.operator.actorScope,
    actionScope: session.operator.actionScope,
  }
}

export async function closeSession(sessionId: string): Promise<void> {
  await prisma.operatorSession.updateMany({
    where: { id: sessionId, status: 'ACTIVE' },
    data: { status: 'REVOKED' },
  })
}

// --- pending actions --------------------------------------------------------

export interface CreatePendingActionInput {
  subjectType: 'INTENT' | 'INCIDENT' | 'AGENT'
  subjectId: string
  summary: string
  allowed: OperatorCommand[]
  actorId?: string | null | undefined
  agentId?: string | null | undefined
  incidentId?: string | null | undefined
  intentId?: string | null | undefined
  amount?: string | null | undefined
  severity?: string | undefined
  ttlSeconds?: number | undefined
}

/** Raises something for a human to decide. */
export async function createPendingAction(input: CreatePendingActionInput) {
  const ttl = input.ttlSeconds ?? env.PENDING_ACTION_TTL_SECONDS
  const bindingHash = computeBindingHash({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    summary: input.summary,
    amount: input.amount ?? null,
  })

  const action = await prisma.pendingAction.create({
    data: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      summary: input.summary,
      allowed: input.allowed,
      actorId: input.actorId ?? null,
      agentId: input.agentId ?? null,
      incidentId: input.incidentId ?? null,
      intentId: input.intentId ?? null,
      severity: input.severity ?? 'MEDIUM',
      bindingHash,
      expiresAt: new Date(Date.now() + ttl * 1000),
      requiresStepUp: input.allowed.some((c) => requiresStepUp(c, env.OPERATOR_STEP_UP_ENABLED)),
    },
  })
  logger.info({ actionId: action.id, subjectType: input.subjectType }, 'pending action raised')
  return action
}

/** Everything currently awaiting a human, newest first. */
export async function listPendingActions(args: { now?: Date; take?: number } = {}) {
  const now = args.now ?? new Date()
  // Expire in place rather than filtering them out, so the list and the
  // database agree about what is still answerable.
  await prisma.pendingAction.updateMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  })
  return prisma.pendingAction.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    take: args.take ?? 50,
  })
}

export interface DecisionInput {
  actionId: string
  command: OperatorCommand
  /** Must equal the action's stored binding — section 19.2. */
  bindingHash: string
  /** Single-use. The unique index is the replay defence. */
  nonce: string
  reason?: string | null | undefined
  limitAmount?: string | null | undefined
  /** A PASSED VerificationChallenge id, when step-up is demanded. */
  stepUpProofId?: string | null | undefined
  now?: Date | undefined
}

export interface DecisionResult {
  actionId: string
  command: OperatorCommand
  applied: boolean
  workflowSignalled: boolean
  detail: string
}

/**
 * A human decides — the heart of the control plane.
 *
 * Order matters and is defensive throughout: authorise, then bind, then claim
 * the nonce, THEN act. Every refusal is audited before it is thrown.
 */
export async function decidePendingAction(
  operator: AuthenticatedOperator,
  input: DecisionInput,
): Promise<DecisionResult> {
  const now = input.now ?? new Date()

  const action = await prisma.pendingAction.findUnique({ where: { id: input.actionId } })
  if (!action) throw await deny(operator, input, 'no such action', 404)

  if (action.status !== 'PENDING') {
    throw await deny(operator, input, `action is ${action.status}`, 409)
  }
  if (action.expiresAt.getTime() <= now.getTime()) {
    await prisma.pendingAction.update({
      where: { id: action.id },
      data: { status: 'EXPIRED' },
    })
    throw await deny(operator, input, 'action expired before it was answered', 409)
  }

  // Section 27.2 — identity + actor scope + action scope.
  const authorized = authorizeOperatorAction(
    {
      status: 'ACTIVE',
      actorScope: operator.actorScope,
      actionScope: operator.actionScope,
    },
    { command: input.command, actorId: action.actorId },
  )
  if (!authorized.allowed) throw await deny(operator, input, authorized.reason, 403)

  if (!isAllowedDecision(action.allowed, input.command)) {
    throw await deny(
      operator,
      input,
      `${input.command} is not a legal answer to this action`,
      400,
    )
  }

  // EXPLICIT ACTION BINDING. A token captured answering one action cannot be
  // replayed against another, because the binding hash will not match.
  if (!secretsMatch(action.bindingHash, input.bindingHash)) {
    throw await deny(operator, input, 'action binding mismatch', 409)
  }

  if (action.requiresStepUp && requiresStepUp(input.command, env.OPERATOR_STEP_UP_ENABLED)) {
    const proof = input.stepUpProofId
      ? await prisma.verificationChallenge.findUnique({ where: { id: input.stepUpProofId } })
      : null
    if (!proof || proof.status !== 'PASSED') {
      throw await deny(operator, input, 'this command requires a passed World step-up', 403)
    }
  }

  // REPLAY PROTECTION. Claim the nonce first: the unique index means two
  // concurrent replays cannot both get past this point, which a
  // check-then-insert would allow.
  try {
    await audit({
      operatorId: operator.operatorId,
      sessionId: operator.sessionId,
      deviceId: operator.deviceId,
      action: input.command,
      subject: action.id,
      outcome: 'ALLOWED',
      reason: input.reason ?? 'operator decision',
      nonce: input.nonce,
    })
  } catch {
    throw new ControlError('This decision has already been submitted.', 409)
  }

  // --- apply ---------------------------------------------------------------
  const applied = await applyCommand(action, input.command, input.limitAmount ?? null)
  const workflowSignalled = await signalWorkflow(action, {
    command: input.command,
    operatorId: operator.operatorId,
    ...(input.limitAmount ? { limitAmount: input.limitAmount } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  })

  await prisma.pendingAction.update({
    where: { id: action.id },
    data: {
      status: 'DECIDED',
      decidedAt: now,
      decidedBy: operator.operatorId,
      decision: input.command,
      decisionReason: input.reason ?? null,
      limitAmount: input.limitAmount ?? null,
      workflowSignalled,
      stepUpProofId: input.stepUpProofId ?? null,
    },
  })

  logger.info(
    { actionId: action.id, command: input.command, operatorId: operator.operatorId, workflowSignalled },
    'operator decision applied',
  )

  return {
    actionId: action.id,
    command: input.command,
    applied,
    workflowSignalled,
    detail: applied
      ? `${input.command} applied`
      : `${input.command} recorded; nothing local to change`,
  }
}

/**
 * Turns a command into a real capability state change — section 19.3.
 *
 * "Freeze is a capability state transition, not merely a UI flag." So FREEZE
 * and REVOKE go through the same agent-service and enforcement paths the rest
 * of the backend uses, which for an ENS-backed agent means a real on-chain
 * transaction, not a column update.
 */
async function applyCommand(
  action: { actorId: string | null; agentId: string | null },
  command: OperatorCommand,
  limitAmount: string | null,
): Promise<boolean> {
  if (command === 'FREEZE' && action.agentId) {
    const { freezeAgent } = await import('../agents/agent-service.js')
    await freezeAgent(action.agentId, 'frozen by operator from the control plane')
    return true
  }
  if (command === 'UNFREEZE' && action.agentId) {
    const { unfreezeAgent } = await import('../agents/agent-service.js')
    await unfreezeAgent(action.agentId, 'unfrozen by operator from the control plane')
    return true
  }
  if (command === 'REVOKE' && action.actorId) {
    const { revokeEverywhere } = await import('../authorization/enforcement/enforcement-service.js')
    const capabilities = await prisma.capability.findMany({
      where: { actorId: action.actorId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      select: { id: true, actionType: true },
    })
    for (const capability of capabilities) {
      await revokeEverywhere({
        capabilityId: capability.id,
        actorId: action.actorId,
        actionType: capability.actionType,
      })
    }
    return capabilities.length > 0
  }
  if (command === 'LIMIT' && action.actorId && limitAmount) {
    const { count } = await prisma.capability.updateMany({
      where: { actorId: action.actorId, status: 'ACTIVE' },
      data: { amountLimit: limitAmount, capabilityType: 'ATTENUATED_GRANT' },
    })
    return count > 0
  }
  if (command === 'DENY' && action.actorId) {
    const { count } = await prisma.capability.updateMany({
      where: { actorId: action.actorId, status: 'ACTIVE' },
      data: { status: 'SUSPENDED' },
    })
    return count > 0
  }
  // APPROVE and EXTEND change nothing locally; their effect is on the workflow
  // that was waiting for them.
  return false
}

/**
 * Delivers the decision to whatever durable workflow is waiting — section 14.2.
 *
 * Best-effort and reported, never fatal. The local capability change above has
 * already happened and IS the enforcement; letting a Temporal outage throw here
 * would roll back a real freeze because a workflow engine was unreachable.
 */
async function signalWorkflow(
  action: { intentId: string | null; incidentId: string | null },
  decision: { command: OperatorCommand; operatorId: string; limitAmount?: string; reason?: string },
): Promise<boolean> {
  const { isTemporalEnabled, getTemporalClient } = await import('../workflow/temporal-client.js')
  if (!isTemporalEnabled()) return false

  const { authorizationWorkflowId, incidentWorkflowId, operatorDecisionSignal } = await import(
    '../workflow/shared.js'
  )
  const workflowId = action.intentId
    ? authorizationWorkflowId(action.intentId)
    : action.incidentId
      ? incidentWorkflowId(action.incidentId)
      : null
  if (!workflowId) return false

  try {
    const client = await getTemporalClient()
    await client.workflow.getHandle(workflowId).signal(operatorDecisionSignal, decision)
    return true
  } catch (err) {
    // Most pending actions have no running workflow, which is not an error.
    logger.debug({ workflowId, err }, 'no workflow to signal for this decision')
    return false
  }
}

/** Audits a refusal, then produces the error to throw. */
async function deny(
  operator: AuthenticatedOperator,
  input: DecisionInput,
  reason: string,
  status: number,
): Promise<ControlError> {
  await audit({
    operatorId: operator.operatorId,
    sessionId: operator.sessionId,
    deviceId: operator.deviceId,
    action: input.command,
    subject: input.actionId,
    outcome: 'DENIED',
    reason,
  })
  return new ControlError(reason, status)
}

/**
 * Appends to the audit log.
 *
 * Throws only on a nonce collision, which the caller uses as its replay check.
 * Every other failure is swallowed and logged: an audit write failing must not
 * take down the control plane, but it must be loud.
 */
export async function audit(entry: {
  operatorId?: string | null
  sessionId?: string | null
  deviceId?: string | null
  action: string
  subject?: string | null
  outcome: 'ALLOWED' | 'DENIED'
  reason: string
  nonce?: string | null
  ip?: string | null
}): Promise<void> {
  try {
    await prisma.operatorAuditLog.create({
      data: {
        operatorId: entry.operatorId ?? null,
        sessionId: entry.sessionId ?? null,
        deviceId: entry.deviceId ?? null,
        action: entry.action,
        subject: entry.subject ?? null,
        outcome: entry.outcome,
        reason: entry.reason,
        nonce: entry.nonce ?? null,
        ip: entry.ip ?? null,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A duplicate nonce is the replay defence firing, and the caller needs it.
    if (/unique|duplicate/i.test(message) && entry.nonce) throw err
    logger.error({ err, entry: entry.action }, 'AUDIT WRITE FAILED')
  }
}

/** The audit trail for an operator, or for everyone. */
export async function readAuditLog(args: { operatorId?: string; take?: number } = {}) {
  return prisma.operatorAuditLog.findMany({
    where: args.operatorId ? { operatorId: args.operatorId } : {},
    orderBy: { createdAt: 'desc' },
    take: args.take ?? 100,
  })
}

// --- live agent state -------------------------------------------------------

/** What the control plane shows for one agent — spec section 19.1. */
export async function controlAgentView(agentId: string) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) return null

  const [capabilities, incidents, lease, snapshot] = await Promise.all([
    prisma.capability.findMany({
      where: { actorId: agent.actorId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.incident.findMany({
      where: { actorId: agent.actorId, status: { in: ['OPEN', 'INVESTIGATING', 'MITIGATED'] } },
      orderBy: { openedAt: 'desc' },
      take: 10,
    }),
    prisma.assuranceLease.findFirst({
      where: { actorId: agent.actorId, status: 'ACTIVE' },
      orderBy: { expiresAt: 'desc' },
    }),
    prisma.trustSnapshot.findFirst({
      where: { actorId: agent.actorId },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      ensName: agent.ensName,
      erc8004AgentId: agent.erc8004AgentId,
    },
    trust: snapshot
      ? { band: snapshot.overallBand, snapshotId: snapshot.id, at: snapshot.createdAt.toISOString() }
      : null,
    assurance: lease
      ? { level: lease.level, expiresAt: lease.expiresAt.toISOString() }
      : null,
    capabilities: capabilities.map((c) => ({
      id: c.id,
      actionType: c.actionType,
      status: c.status,
      amountLimit: c.amountLimit,
      expiresAt: c.expiresAt?.toISOString() ?? null,
    })),
    openIncidents: incidents.map((i) => ({
      id: i.id,
      type: i.type,
      severity: i.severity,
      status: i.status,
      openedAt: i.openedAt.toISOString(),
    })),
  }
}

/** The evidence behind an agent's current standing — "view evidence". */
export async function controlAgentEvidence(agentId: string, take = 50) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) return null

  const identities = await prisma.actorIdentity.findMany({
    where: { actorId: agent.actorId, kind: 'WALLET' },
    select: { externalId: true },
  })
  const wallets = identities.map((i) => i.externalId.toLowerCase())

  const [events, signals] = await Promise.all([
    prisma.evidenceEvent.findMany({
      where: { wallet: { in: wallets } },
      orderBy: { timestamp: 'desc' },
      take,
    }),
    prisma.trustSignal.findMany({
      where: { actorId: agent.actorId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
  ])

  return {
    agentId,
    wallets,
    signals: signals.map((s) => ({
      kind: s.kind,
      positive: s.positive,
      weight: s.weight,
      detail: s.detail,
      source: s.source,
      at: s.createdAt.toISOString(),
    })),
    evidence: events.map((e) => ({
      id: e.id,
      chain: e.chain,
      eventType: e.eventType,
      protocol: e.protocol,
      counterparty: e.counterparty,
      amount: e.amount,
      // Provenance travels with every row — section 0.2 rule 3.
      sourceType: e.sourceType,
      blockNumber: e.blockNumber.toString(),
      at: e.timestamp.toISOString(),
    })),
  }
}

/** A stable id for a decision request, so a client can retry safely. */
export function decisionNonce(actionId: string, command: string, attempt: string): string {
  return createHash('sha256').update(`${actionId} ${command} ${attempt}`).digest('hex')
}
