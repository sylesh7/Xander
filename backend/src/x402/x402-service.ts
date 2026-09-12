/**
 * x402 agent commerce — Xander V2 spec sections 4.6 and 17, Phase 9.
 *
 * The point of this phase is stated in the spec as "prove Xander works outside
 * claims". x402 is not a payment feature bolted on; it is an AUTHORIZATION
 * TARGET. The money is the easy part — the facilitator does it. What Xander
 * contributes is deciding, per agent, per request, whether this purchase should
 * be possible at all and at what rate.
 *
 *   agent -> request -> Xander trust/policy -> permit/limit/deny -> service
 *
 * TWO DECISIONS THAT MATTER MOST HERE:
 *
 * 1. A DENIED AGENT GETS 403, NEVER 402. A 402 is an invitation to pay. Sending
 *    one to an agent we have already decided to refuse would be soliciting money
 *    for a service that will never be delivered, no matter how much it pays.
 *    Anomalous actors are turned away before any price is quoted.
 *
 * 2. VERIFY BEFORE SERVING, SETTLE AFTER. Serving first risks giving the
 *    resource away to an invalid signature; settling first risks charging for a
 *    response that then failed to produce. Verification is free and reversible,
 *    settlement is neither.
 */
import { randomUUID } from 'node:crypto'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { buildTrustContext } from '../trust/trust-context.js'
import { checkCapability, recordUsage } from '../capabilities/capability-service.js'
import { createIntent } from '../intent/intent-service.js'
import { verifyEnforcement } from '../authorization/enforcement/enforcement-service.js'
import { settlePayment, verifyPayment, FacilitatorError } from './x402-facilitator.js'
import {
  authorizationIsCurrent,
  paymentMatchesRequirements,
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettlementResponse,
} from './x402-types.js'

export class X402Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'X402Error'
  }
}

/** Whether the paid surface can operate at all. */
export function x402Availability(): string | null {
  if (!env.X402_ENABLED) return 'X402_DISABLED'
  if (!env.X402_PAY_TO) return 'NO_PAY_TO_ADDRESS'
  return null
}

/** What one request to this resource costs. */
export function requirementsFor(): PaymentRequirements {
  const payTo = env.X402_PAY_TO
  if (!payTo) throw new X402Error('X402_PAY_TO is not configured.', 503)
  return {
    scheme: env.X402_SCHEME,
    network: env.X402_NETWORK,
    amount: env.X402_PRICE_ATOMIC,
    asset: env.X402_ASSET,
    payTo,
    maxTimeoutSeconds: env.X402_MAX_TIMEOUT_SECONDS,
    // The token's EIP-712 domain, which the client needs to build a signature
    // the token contract will accept. Verified on-chain, not assumed.
    extra: { name: env.X402_ASSET_NAME, version: env.X402_ASSET_VERSION },
  }
}

export function resourceUrl(path: string): string {
  return `${env.X402_RESOURCE_BASE_URL.replace(/\/$/, '')}${path}`
}

export const X402_OUTCOMES = ['PAYMENT_REQUIRED', 'DENIED', 'INVALID', 'SETTLED'] as const
export type X402Outcome = (typeof X402_OUTCOMES)[number]

export interface X402Result {
  outcome: X402Outcome
  /** The HTTP status a transport should use. 402 invites payment; 403 does not. */
  status: number
  actorId: string
  trustBand: string
  reasonCode: string
  detail: string
  /** Present only when we are actually inviting payment. */
  paymentRequired: PaymentRequired | null
  settlement: SettlementResponse | null
  paymentId: string
  receiptId: string | null
  /** Remaining requests in the current window, when a limit applies. */
  allowanceRemaining: number | null
}

/**
 * Prices and authorizes one request for a paying agent.
 *
 * `wallet` is the agent's paying address, which is also its identity here —
 * x402 has no separate authentication step, and the address that signs the
 * EIP-3009 authorization is the only identity the protocol carries.
 */
export async function authorizePaidRequest(args: {
  wallet: string
  path: string
  paymentPayload: PaymentPayload | null
  now?: Date
}): Promise<X402Result> {
  const unavailable = x402Availability()
  if (unavailable) throw new X402Error(`x402 is unavailable: ${unavailable}`, 503)

  const now = args.now ?? new Date()
  const requirements = requirementsFor()
  const resource = resourceUrl(args.path)

  // --- 1. who is this, and what do we currently believe about them? --------
  const { resolveActorForWallet } = await import('../actor/actor-resolver.js')
  const actor = await resolveActorForWallet(args.wallet)
  const trust = await buildTrustContext(actor.id)

  const record = async (data: {
    status: string
    reasonCode: string
    nonce?: string | null
    payer?: string | null
    transaction?: string | null
    errorReason?: string | null
    intentId?: string | null
    receiptId?: string | null
    settledAt?: Date | null
  }): Promise<string> => {
    const row = await prisma.x402Payment.create({
      data: {
        actorId: actor.id,
        resource,
        scheme: requirements.scheme,
        network: requirements.network,
        asset: requirements.asset,
        payTo: requirements.payTo,
        amount: requirements.amount,
        trustBand: trust.band,
        ...data,
      },
    })
    return row.id
  }

  // --- 2. the authorization decision, through the real policy engine -------
  // A full Intent, not a side-channel: an x402 purchase must be as auditable as
  // a claim, and this is what puts it in AuthorizationDecision and ActionReceipt
  // alongside every other action.
  const intent = await createIntent({
    actorId: actor.id,
    resourceType: 'x402',
    resourceId: args.path,
    actionType: 'X402_PAYMENT',
    amount: requirements.amount,
    asset: env.X402_ASSET_NAME,
    idempotencyKey: `x402-${actor.id}-${randomUUID()}`,
  })

  const result = intent.decision?.result ?? 'REVIEW'
  const reasonCode = intent.decision?.reasonCode ?? 'NO_DECISION'

  if (result !== 'ALLOW' && result !== 'LIMIT') {
    // 403, not 402 — see the file header. We are not quoting a price to an
    // actor we have refused.
    const paymentId = await record({
      status: 'DENIED',
      reasonCode,
      intentId: intent.intentId,
      errorReason: `policy result ${result}`,
    })
    logger.warn(
      { actorId: actor.id, band: trust.band, result, reasonCode },
      'x402 request denied before pricing',
    )
    return {
      outcome: 'DENIED',
      status: 403,
      actorId: actor.id,
      trustBand: trust.band,
      reasonCode,
      detail: `Xander refused this request (${result}). No payment is being solicited.`,
      paymentRequired: null,
      settlement: null,
      paymentId,
      receiptId: null,
      allowanceRemaining: null,
    }
  }

  // --- 3. the allowance, enforced by Phase 3's capability machinery --------
  // The rate ladder in section 17 is a frequency limit on a capability, so the
  // counting, the window and the exhaustion check are the ones already built
  // and tested — not a second rate limiter that could disagree with the first.
  const capabilityCheck = await checkCapability({
    actorId: actor.id,
    actionType: 'X402_PAYMENT',
    amount: requirements.amount,
    now,
  })
  if (!capabilityCheck.allowed) {
    const paymentId = await record({
      status: 'DENIED',
      reasonCode: capabilityCheck.denial ?? 'ALLOWANCE_EXHAUSTED',
      intentId: intent.intentId,
      errorReason: capabilityCheck.detail,
    })
    // 429 for an exhausted allowance: the agent is legitimate and the answer
    // may differ later, which is exactly what 429 means and 403 does not.
    return {
      outcome: 'DENIED',
      status: capabilityCheck.denial === 'FREQUENCY_LIMIT_REACHED' ? 429 : 403,
      actorId: actor.id,
      trustBand: trust.band,
      reasonCode: capabilityCheck.denial ?? 'ALLOWANCE_EXHAUSTED',
      detail: capabilityCheck.detail,
      paymentRequired: null,
      settlement: null,
      paymentId,
      receiptId: null,
      allowanceRemaining: 0,
    }
  }

  const capability = capabilityCheck.capability!
  const remaining = await allowanceRemaining(capability.id, capability.frequencyLimit, capability.frequencyWindowSeconds, now)

  // --- 4. no payment yet? quote a price ------------------------------------
  if (!args.paymentPayload) {
    const paymentId = await record({
      status: 'REQUIRED',
      reasonCode,
      intentId: intent.intentId,
    })
    return {
      outcome: 'PAYMENT_REQUIRED',
      status: 402,
      actorId: actor.id,
      trustBand: trust.band,
      reasonCode,
      detail: 'Payment required.',
      paymentRequired: {
        x402Version: X402_VERSION,
        error: `${X402_HEADER_HINT} header is required`,
        resource: { url: resource, description: 'Xander-protected resource', mimeType: 'application/json' },
        accepts: [requirements],
        extensions: {},
      },
      settlement: null,
      paymentId,
      receiptId: null,
      allowanceRemaining: remaining,
    }
  }

  // --- 5. does the payload answer the question we asked? -------------------
  const match = paymentMatchesRequirements(args.paymentPayload, requirements)
  if (!match.ok) {
    const paymentId = await record({
      status: 'INVALID',
      reasonCode: 'PAYMENT_MISMATCH',
      intentId: intent.intentId,
      errorReason: match.reason,
    })
    return invalid(actor.id, trust.band, match.reason, paymentId, remaining)
  }

  const authorization = args.paymentPayload.payload.authorization
  const current = authorizationIsCurrent(authorization, now)
  if (!current.ok) {
    const paymentId = await record({
      status: 'INVALID',
      reasonCode: 'AUTHORIZATION_WINDOW',
      intentId: intent.intentId,
      errorReason: current.reason,
    })
    return invalid(actor.id, trust.band, current.reason, paymentId, remaining)
  }

  // The paying address must be the actor we just judged. Without this an agent
  // could be priced on a trusted wallet's history and paid for by another.
  if (authorization.from.toLowerCase() !== args.wallet.toLowerCase()) {
    const paymentId = await record({
      status: 'INVALID',
      reasonCode: 'PAYER_MISMATCH',
      intentId: intent.intentId,
      errorReason: 'the authorization is signed by a different wallet than the caller',
    })
    return invalid(
      actor.id,
      trust.band,
      'the authorization is signed by a different wallet than the caller',
      paymentId,
      remaining,
    )
  }

  // --- 6. claim the nonce BEFORE spending it -------------------------------
  // The unique index is the replay defence. Claiming first means two concurrent
  // replays cannot both reach the facilitator, which a check-then-settle would
  // allow.
  let paymentId: string
  try {
    paymentId = await record({
      status: 'VERIFIED',
      reasonCode,
      nonce: authorization.nonce.toLowerCase(),
      payer: authorization.from.toLowerCase(),
      intentId: intent.intentId,
    })
  } catch {
    const replayId = await record({
      status: 'INVALID',
      reasonCode: 'NONCE_REPLAY',
      intentId: intent.intentId,
      errorReason: 'this authorization nonce has already been used',
    })
    return invalid(
      actor.id,
      trust.band,
      'this authorization nonce has already been used',
      replayId,
      remaining,
    )
  }

  // --- 7. verify with the real facilitator, without moving money -----------
  let verified
  try {
    verified = await verifyPayment({
      paymentPayload: args.paymentPayload,
      paymentRequirements: requirements,
    })
  } catch (err) {
    const message = err instanceof FacilitatorError ? err.message : String(err)
    await prisma.x402Payment.update({
      where: { id: paymentId },
      data: { status: 'FAILED', errorReason: message },
    })
    // The facilitator being down holds the request. Section 0.2 rule 4: an
    // upstream failure never becomes a confident answer, in either direction.
    throw new X402Error(`Payment could not be verified: ${message}`, 503)
  }

  if (!verified.isValid) {
    await prisma.x402Payment.update({
      where: { id: paymentId },
      data: { status: 'INVALID', errorReason: verified.invalidReason ?? 'facilitator rejected' },
    })
    return invalid(
      actor.id,
      trust.band,
      verified.invalidReason ?? 'the facilitator rejected this payment',
      paymentId,
      remaining,
    )
  }

  // --- 8. the Phase 8 gate, immediately before the resource is served ------
  // Trust could have collapsed between the decision above and this moment.
  const verdict = await verifyEnforcement({
    actorId: actor.id,
    actionType: 'X402_PAYMENT',
    capabilityId: capability.id,
    amount: requirements.amount,
  })
  if (!verdict.enforced) {
    await prisma.x402Payment.update({
      where: { id: paymentId },
      data: { status: 'DENIED', errorReason: verdict.reason },
    })
    // Nothing was settled, so the agent has paid nothing.
    return {
      outcome: 'DENIED',
      status: 403,
      actorId: actor.id,
      trustBand: trust.band,
      reasonCode: 'ENFORCEMENT_NOT_PROVEN',
      detail: verdict.reason,
      paymentRequired: null,
      settlement: null,
      paymentId,
      receiptId: null,
      allowanceRemaining: remaining,
    }
  }

  // --- 9. settle, then record the receipt ----------------------------------
  let settlement: SettlementResponse
  try {
    settlement = await settlePayment({
      paymentPayload: args.paymentPayload,
      paymentRequirements: requirements,
    })
  } catch (err) {
    const message = err instanceof FacilitatorError ? err.message : String(err)
    await prisma.x402Payment.update({
      where: { id: paymentId },
      data: { status: 'FAILED', errorReason: message },
    })
    throw new X402Error(`Payment could not be settled: ${message}`, 503)
  }

  if (!settlement.success) {
    await prisma.x402Payment.update({
      where: { id: paymentId },
      data: {
        status: 'FAILED',
        errorReason: settlement.errorReason ?? 'settlement failed',
        transaction: settlement.transaction || null,
      },
    })
    return invalid(
      actor.id,
      trust.band,
      settlement.errorReason ?? 'settlement failed',
      paymentId,
      remaining,
    )
  }

  // Usage is recorded only now — a request that was never served must not
  // consume the agent's allowance.
  await recordUsage({ capabilityId: capability.id, intentId: intent.intentId, amount: requirements.amount })

  const receipt = await prisma.actionReceipt.findFirst({
    where: { intentId: intent.intentId },
    orderBy: { createdAt: 'desc' },
  })
  if (receipt) {
    await prisma.actionReceipt.update({
      where: { id: receipt.id },
      data: {
        executionStatus: 'EXECUTED_AS_AUTHORIZED',
        executionTxHash: settlement.transaction,
        enforcementAdapters: verdict.adapters,
        enforcementReason: verdict.reason,
        executedAt: new Date(),
      },
    })
  }

  await prisma.x402Payment.update({
    where: { id: paymentId },
    data: {
      status: 'SETTLED',
      transaction: settlement.transaction,
      payer: settlement.payer?.toLowerCase() ?? authorization.from.toLowerCase(),
      receiptId: receipt?.id ?? null,
      settledAt: new Date(),
    },
  })

  logger.info(
    { actorId: actor.id, band: trust.band, transaction: settlement.transaction },
    'x402 payment settled and resource authorized',
  )

  return {
    outcome: 'SETTLED',
    status: 200,
    actorId: actor.id,
    trustBand: trust.band,
    reasonCode,
    detail: 'Payment settled.',
    paymentRequired: null,
    settlement,
    paymentId,
    receiptId: receipt?.id ?? null,
    allowanceRemaining: remaining === null ? null : Math.max(0, remaining - 1),
  }
}

const X402_HEADER_HINT = 'PAYMENT-SIGNATURE'

function invalid(
  actorId: string,
  trustBand: string,
  detail: string,
  paymentId: string,
  remaining: number | null,
): X402Result {
  return {
    outcome: 'INVALID',
    // 402, not 400: the request is well-formed and the resource is still for
    // sale — the agent may simply try again with a correct authorization.
    status: 402,
    actorId,
    trustBand,
    reasonCode: 'PAYMENT_INVALID',
    detail,
    paymentRequired: null,
    settlement: null,
    paymentId,
    receiptId: null,
    allowanceRemaining: remaining,
  }
}

/** How many requests are left in the current window, or null if uncapped. */
export async function allowanceRemaining(
  capabilityId: string,
  frequencyLimit: number | null,
  windowSeconds: number | null,
  now: Date,
): Promise<number | null> {
  if (frequencyLimit === null || windowSeconds === null) return null
  const used = await prisma.capabilityUsage.count({
    where: { capabilityId, createdAt: { gte: new Date(now.getTime() - windowSeconds * 1000) } },
  })
  return Math.max(0, frequencyLimit - used)
}
