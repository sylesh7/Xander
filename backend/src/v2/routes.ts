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
