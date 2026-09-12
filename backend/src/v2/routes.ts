/**
 * The `/v2` API surface — Xander V2 spec section 24, Phase 1 subset.
 *
 * Mounted ALONGSIDE the V1 Claim Gate, never in place of it (section 1.1: the
 * Claim Gate stays as a compatibility surface). Nothing here writes a V1 table.
 *
 * Phase 1 ships four routes:
 *   POST /v2/actors        GET /v2/actors/:id
 *   POST /v2/intents       GET /v2/intents/:id
 *
 * Auth, rate limiting and zod validation are applied inside this router rather
 * than at the mount point, for the same reason the V1 router does it — a route
 * added later cannot quietly skip them.
 */
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { apiKeyAuth, asyncHandler, upstreamRateLimit, validateBody } from '../claim/middleware.js'
import { ACTOR_TYPES, EVM_ADDRESS_PATTERN } from '../actor/actor-types.js'
import { ActorError, createActor, getActor } from '../actor/actor-service.js'
import { ACTION_TYPES } from '../intent/intent-types.js'
import { createIntent, getIntent, IntentError } from '../intent/intent-service.js'
import { buildTrustContext } from '../trust/trust-context.js'
import { getLiveLease, listCapabilities } from '../capabilities/capability-service.js'
import {
  getLatestSnapshot,
  getTrustHistory,
  getTrustSignals,
  trustSignalBalance,
} from '../trust/trust-history.js'

export const v2Router: Router = Router()

v2Router.use('/v2', apiKeyAuth)

const evmAddress = z.string().regex(EVM_ADDRESS_PATTERN, 'Must be a 0x-prefixed 20-byte address.')

const createActorSchema = z.object({
  actorType: z.enum(ACTOR_TYPES),
  displayName: z.string().min(1).max(200).optional(),
  wallet: z.object({ address: evmAddress }).optional(),
})

/**
 * `wallet` XOR `actorId`. Amount is a string, never a number — a JSON number
 * cannot hold a uint256 without silently losing precision, and this is the same
 * rule EvidenceEvent.amount follows.
 */
const createIntentSchema = z
  .object({
    actorId: z.string().min(1).optional(),
    wallet: evmAddress.optional(),
    resourceType: z.string().min(1).max(120),
    resourceId: z.string().min(1).max(200),
    actionType: z.enum(ACTION_TYPES),
    chainId: z.number().int().positive().optional(),
    targetAddress: evmAddress.optional(),
    amount: z.string().regex(/^\d+$/, 'Amount must be an integer string in base units.').optional(),
    asset: z.string().min(1).max(64).optional(),
    protocol: z.string().min(1).max(120).optional(),
    expiresAt: z.coerce.date().optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.actorId) !== Boolean(v.wallet), {
    message: 'Provide exactly one of actorId or wallet.',
  })

v2Router.post(
  '/v2/actors',
  validateBody(createActorSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createActorSchema>
    const actor = await createActor(body)
    res.status(201).json(actor)
  }),
)

v2Router.get(
  '/v2/actors/:id',
  asyncHandler(async (req, res) => {
    const actor = await getActor(String(req.params.id))
    if (!actor) {
      res.status(404).json({ error: 'not_found', message: 'No such actor.' })
      return
    }
    res.json(actor)
  }),
)

// Rate limited: creating an intent can trigger a live Graph refresh, which is
// quota-bound upstream. Reading one back is a stored row and is not limited,
// because that is the endpoint an operator hits repeatedly while investigating.
v2Router.post(
  '/v2/intents',
  upstreamRateLimit,
  validateBody(createIntentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createIntentSchema>
    const intent = await createIntent(body)
    res.status(intent.replayed ? 200 : 201).json(intent)
  }),
)

/**
 * The actor's trust context (spec section 24).
 *
 * Rate limited alongside the intent route: building a context can trigger a
 * live Graph refresh. `?fresh=false` serves the latest stored snapshot instead,
 * which is the cheap read an operator wants while investigating.
 */
v2Router.get(
  '/v2/actors/:id/trust',
  upstreamRateLimit,
  asyncHandler(async (req, res) => {
    const actorId = String(req.params.id)
    const actor = await getActor(actorId)
    if (!actor) {
      res.status(404).json({ error: 'not_found', message: 'No such actor.' })
      return
    }

    if (req.query.fresh === 'false') {
      const latest = await getLatestSnapshot(actorId)
      if (!latest) {
        res.status(404).json({
          error: 'not_found',
          message: 'No trust snapshot yet for this actor. Omit ?fresh=false to build one.',
        })
        return
      }
      res.json({ actorId, band: latest.overallBand, snapshotId: latest.id, cached: true })
      return
    }

    const trust = await buildTrustContext(actorId)
    res.json({
      actorId,
      snapshotId: trust.snapshotId,
      band: trust.band,
      vector: trust.vector,
      drift: trust.drift,
      evidenceIds: trust.evidenceIds,
      engineVersion: trust.engineVersion,
      policyVersion: trust.policyVersion,
      cached: false,
    })
  }),
)

/** Append-only trust history — snapshots and signals (spec section 21). */
v2Router.get(
  '/v2/actors/:id/trust/history',
  asyncHandler(async (req, res) => {
    const actorId = String(req.params.id)
    const actor = await getActor(actorId)
    if (!actor) {
      res.status(404).json({ error: 'not_found', message: 'No such actor.' })
      return
    }
    const [snapshots, signals, balance] = await Promise.all([
      getTrustHistory(actorId),
      getTrustSignals(actorId),
      trustSignalBalance(actorId),
    ])
    res.json({
      actorId,
      snapshots: snapshots.map((s) => ({
        snapshotId: s.id,
        band: s.overallBand,
        engineVersion: s.engineVersion,
        policyVersion: s.policyVersion,
        createdAt: s.createdAt.toISOString(),
      })),
      signals: signals.map((s) => ({
        kind: s.kind,
        positive: s.positive,
        weight: s.weight,
        detail: s.detail,
        source: s.source,
        createdAt: s.createdAt.toISOString(),
      })),
      // Reported only — never fed back into the band. Section 3.1 keeps
      // deterministic evidence in charge, so a run of routine successes cannot
      // offset a live coordination signal.
      balance,
    })
  }),
)

/** The actor's capabilities — spec section 24. */
v2Router.get(
  '/v2/actors/:id/capabilities',
  asyncHandler(async (req, res) => {
    const actorId = String(req.params.id)
    const actor = await getActor(actorId)
    if (!actor) {
      res.status(404).json({ error: 'not_found', message: 'No such actor.' })
      return
    }
    const [capabilities, lease] = await Promise.all([
      listCapabilities(actorId),
      getLiveLease(actorId),
    ])
    res.json({
      actorId,
      assurance: lease
        ? { hasLiveLease: true, level: lease.level, expiresAt: lease.expiresAt.toISOString() }
        : { hasLiveLease: false, level: null, expiresAt: null },
      capabilities: capabilities.map((c) => ({
        id: c.id,
        capabilityType: c.capabilityType,
        actionType: c.actionType,
        resourceScope: c.resourceScope,
        chainScope: c.chainScope,
        amountLimit: c.amountLimit,
        frequencyLimit: c.frequencyLimit,
        frequencyWindowSeconds: c.frequencyWindowSeconds,
        allowedTargets: c.allowedTargets,
        status: c.status,
        live: c.live,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        sourceDecisionId: c.sourceDecisionId,
        createdAt: c.createdAt.toISOString(),
      })),
    })
  }),
)

v2Router.get(
  '/v2/intents/:id',
  asyncHandler(async (req, res) => {
    const intent = await getIntent(String(req.params.id))
    if (!intent) {
      res.status(404).json({ error: 'not_found', message: 'No such intent.' })
      return
    }
    res.json(intent)
  }),
)

/**
 * V2's own error middleware, scoped to this router.
 *
 * Deliberately here rather than in `claim/middleware.ts`: that file is the V1
 * track's, its handler knows `ClaimError`, and teaching it two more error types
 * would make a V1-owned file change every time V2 adds one. Router-level error
 * middleware catches everything thrown inside `/v2` and hands anything it does
 * not recognise onward to the app-level handler, so the 500 path stays shared.
 *
 * Must be registered AFTER the routes — Express selects error middleware by
 * arity and by position.
 */
v2Router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err)
    return
  }
  if (err instanceof ActorError || err instanceof IntentError) {
    res.status(err.status).json({ error: 'v2_error', message: err.message })
    return
  }
  next(err)
})
