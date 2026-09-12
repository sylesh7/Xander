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
import { resolveActorForWallet } from '../actor/actor-resolver.js'
import { AGENT_LABEL_PATTERN } from '../ens/ens-names.js'
import { readAgentEnsState } from '../agents/agent-ens.js'
import {
  AgentError,
  createAgentWithIdentity,
  establishAssurance,
  freezeAgent,
  getAgent,
  listAgents,
  revokeAgent,
  unfreezeAgent,
} from '../agents/agent-service.js'
import {
  completeLivenessChallenge,
  issueLivenessChallenge,
  LivenessError,
} from '../verification/liveness-service.js'
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


// --- Phase 5: agents and active liveness (spec sections 9, 10, 11) ---------

const createAgentSchema = z.object({
  actorId: z.string().min(1).optional(),
  wallet: evmAddress.optional(),
  name: z.string().min(1).max(120),
  agentUri: z.string().url().optional(),
  configuration: z.record(z.unknown()).optional(),
  /** Mints <ensLabel>.<parent>.eth. Opt-in — minting is a real transaction. */
  ensLabel: z
    .string()
    .regex(AGENT_LABEL_PATTERN, 'Lowercase a-z, 0-9 and hyphen; 3-63 chars.')
    .optional(),
})

const livenessStartSchema = z.object({
  actorId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  sessionBinding: z.string().min(8).max(200),
})

const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
})

const livenessCompleteSchema = z.object({
  challengeId: z.string().min(1),
  nonce: z.string().min(1),
  sessionBinding: z.string().min(8).max(200),
  cvVersion: z.string().max(64).optional(),
  // Landmarks, never imagery. Section 28 — the backend must not receive
  // anything from which a face could be reconstructed.
  frames: z
    .array(z.object({ tMs: z.number(), landmarks: z.array(pointSchema).length(21) }))
    .min(1)
    .max(600),
})

const assuranceSchema = z.object({
  worldChallengeId: z.string().min(1),
  livenessChallengeId: z.string().min(1).optional(),
})

const reasonSchema = z.object({ reason: z.string().min(1).max(500) })

v2Router.post(
  '/v2/agents',
  validateBody(createAgentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createAgentSchema>
    if (Boolean(body.actorId) === Boolean(body.wallet)) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'Provide exactly one of actorId or wallet.',
      })
      return
    }

    const actorId = body.actorId ?? (await resolveActorForWallet(body.wallet!)).id
    const { agent, ens } = await createAgentWithIdentity({
      actorId,
      name: body.name,
      ...(body.agentUri ? { agentUri: body.agentUri } : {}),
      ...(body.configuration ? { configuration: body.configuration } : {}),
      ...(body.ensLabel ? { ensLabel: body.ensLabel } : {}),
    })

    // Section 11.2's response shape: what still has to happen before this
    // agent can act — plus exactly what did or did not happen on-chain, so a
    // caller never has to assume a name exists.
    res.status(201).json({
      agentId: agent.id,
      actorId: agent.actorId,
      name: agent.name,
      status: agent.status,
      verification: { world: 'REQUIRED', activeLiveness: 'OPTIONAL' },
      ens: {
        name: agent.ensName,
        minted: ens.succeeded,
        skipReason: ens.skipReason,
        txHash: ens.txHash,
        detail: ens.detail,
      },
    })
  }),
)

v2Router.get(
  '/v2/agents',
  asyncHandler(async (req, res) => {
    const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : undefined
    res.json({ agents: await listAgents(actorId) })
  }),
)

v2Router.get(
  '/v2/agents/:id',
  asyncHandler(async (req, res) => {
    const agent = await getAgent(String(req.params.id))
    if (!agent) {
      res.status(404).json({ error: 'not_found', message: 'No such agent.' })
      return
    }
    // Read the chain rather than trusting the stored name: the on-chain roles
    // are the public record, and a divergence between it and the database is
    // exactly what an operator needs to see.
    const ens = await readAgentEnsState(agent.id).catch(() => null)
    res.json({ ...agent, ens })
  }),
)

/** Establishes the assurance lease and mints the initial capability envelope. */
v2Router.post(
  '/v2/agents/:id/verify',
  validateBody(assuranceSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof assuranceSchema>
    const result = await establishAssurance({
      agentId: String(req.params.id),
      worldChallengeId: body.worldChallengeId,
      livenessChallengeId: body.livenessChallengeId ?? null,
    })
    res.json({
      agentId: result.agent.id,
      status: result.agent.status,
      assurance: {
        leaseId: result.leaseId,
        level: result.level,
        expiresAt: result.expiresAt.toISOString(),
      },
      capabilityIds: result.capabilityIds,
      ens: {
        mirrored: result.ens.succeeded,
        skipReason: result.ens.skipReason,
        txHash: result.ens.txHash,
        detail: result.ens.detail,
      },
    })
  }),
)

v2Router.post(
  '/v2/agents/:id/freeze',
  validateBody(reasonSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reasonSchema>
    const { agent, suspended, ens } = await freezeAgent(String(req.params.id), body.reason)
    res.json({
      agentId: agent.id,
      status: agent.status,
      capabilitiesSuspended: suspended,
      // Reported separately and honestly: the local suspension IS the
      // enforcement, and the chain may lag or fail (section 18.2).
      ens: { revokedOnChain: ens.succeeded, skipReason: ens.skipReason, txHash: ens.txHash, detail: ens.detail },
    })
  }),
)

v2Router.post(
  '/v2/agents/:id/unfreeze',
  validateBody(reasonSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reasonSchema>
    const agent = await unfreezeAgent(String(req.params.id), body.reason)
    res.json({ agentId: agent.id, status: agent.status })
  }),
)

v2Router.post(
  '/v2/agents/:id/revoke',
  validateBody(reasonSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof reasonSchema>
    const { agent, ens } = await revokeAgent(String(req.params.id), body.reason)
    res.json({
      agentId: agent.id,
      status: agent.status,
      ens: { revokedOnChain: ens.succeeded, skipReason: ens.skipReason, txHash: ens.txHash, detail: ens.detail },
    })
  }),
)

v2Router.post(
  '/v2/verification/liveness/start',
  validateBody(livenessStartSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof livenessStartSchema>
    const challenge = await issueLivenessChallenge({
      actorId: body.actorId,
      agentId: body.agentId ?? null,
      sessionBinding: body.sessionBinding,
    })
    res.status(201).json(challenge)
  }),
)

v2Router.post(
  '/v2/verification/liveness/complete',
  validateBody(livenessCompleteSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof livenessCompleteSchema>
    const result = await completeLivenessChallenge({
      challengeId: body.challengeId,
      nonce: body.nonce,
      sessionBinding: body.sessionBinding,
      frames: body.frames,
      ...(body.cvVersion ? { cvVersion: body.cvVersion } : {}),
    })
    // 200 either way: a rejected proof is a valid answer to a valid request,
    // and a 4xx would make a legitimate failed attempt look like a client bug.
    res.json(result)
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
  if (err instanceof ActorError || err instanceof IntentError || err instanceof AgentError || err instanceof LivenessError) {
    res.status(err.status).json({ error: 'v2_error', message: err.message })
    return
  }
  next(err)
})
