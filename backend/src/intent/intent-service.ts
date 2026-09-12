/**
 * Intent service — the Xander V2 section 8 authorization flow, Phase 1 depth.
 *
 * WHAT THIS DOES NOT DO, deliberately. It never writes a `Claim`, a
 * `VerificationChallenge` or a V1 `EvidenceReceipt`. Phase 1's acceptance
 * condition is that a claim can be expressed as an Intent *without changing the
 * existing claim flow*, so this is a parallel path that READS V1's risk and
 * policy through their public entry points and writes only V2 tables. The Claim
 * Gate keeps behaving exactly as it did.
 *
 * It also does not issue World challenges or grant capabilities. A CHALLENGE
 * result records that assurance is required; actually running the assurance
 * workflow is Phase 5, and capabilities are Phase 3.
 */
import { Prisma, type Actor } from '@prisma/client'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { getRiskThroughCache } from '../cache/risk-cache.js'
import { decide, type PolicyDecision } from '../policy/policy-engine.js'
import { resolveActorForWallet } from '../actor/actor-resolver.js'
import { buildTrustContext } from '../trust/trust-context.js'
import { policyEvaluator } from '../authorization/native-policy-evaluator.js'
import { getLiveLease, grantCapability } from '../capabilities/capability-service.js'
import { isEvmAddress, normalizeAddress } from '../actor/actor-types.js'
import {
  REASON_CODES,
  type ActionType,
  type AuthorizationResult,
  type IntentParameters,
} from './intent-types.js'
import {
  defaultExpiry,
  hashDecisionPayload,
  hashEvidenceSnapshot,
  hashIntentParameters,
  isExpired,
} from './intent-validator.js'

const UNIQUE_VIOLATION = 'P2002'

export class IntentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'IntentError'
  }
}

export interface CreateIntentInput {
  /** Either an existing actor, or a wallet to resolve one from. */
  actorId?: string | undefined
  wallet?: string | undefined
  resourceType: string
  resourceId: string
  actionType: ActionType
  chainId?: number | undefined
  targetAddress?: string | undefined
  amount?: string | undefined
  asset?: string | undefined
  protocol?: string | undefined
  expiresAt?: Date | undefined
  idempotencyKey?: string | undefined
}

export interface IntentView {
  intentId: string
  actorId: string
  status: string
  actionType: string
  resourceType: string
  resourceId: string
  parametersHash: string
  idempotencyKey: string
  expiresAt: string
  createdAt: string
  decision: DecisionView | null
  receiptId: string | null
  /** True when this call replayed a prior intent rather than creating one. */
  replayed: boolean
}

export interface DecisionView {
  decisionId: string
  result: AuthorizationResult
  reasonCode: string
  reasonSummary: string
  requiredAssurance: string | null
  policyVersion: string
  riskScore: number
  clusterId: string | null
  confidence: string
  evidenceIds: string[]
  createdAt: string
}

/**
 * V1's PENDING_REVIEW maps to V2 REVIEW, and that mapping is now enforced in
 * `authorize` as a fail-closed branch rather than a lookup table.
 *
 * It is a branch and not a table entry on purpose: since Phase 3 the V2 policy
 * evaluator produces the result, and a table would have left PENDING_REVIEW as
 * one input among many that a permissive rule could out-rank. Both specs call
 * treating PENDING_REVIEW as OK the single most damaging integration bug
 * available in this codebase, so it short-circuits before policy runs at all.
 */

/**
 * Stable, human-readable lineage identifiers for the evidence behind a decision.
 *
 * HONEST LIMITATION: these are SOURCE-level, not row-level. The locked
 * Suganthan->Sylesh interface exposes provenance (`{type, deployment, block}`)
 * but not the underlying `EvidenceEvent` ids, and reaching around it with a
 * deep import is exactly what the ownership rule forbids. Row-level lineage
 * needs the interface to expose it, which is a conversation with that track's
 * owner rather than something to fake here. Recorded as a Phase 2 item.
 */
function evidenceLineage(risk: PolicyDecision): string[] {
  return risk.sources
    .map((s) => `${s.type}:${s.deployment ?? 'none'}@${s.block ?? 'unknown'}`)
    .sort()
}

async function resolveActor(input: CreateIntentInput): Promise<Actor> {
  if (input.actorId) {
    const actor = await prisma.actor.findUnique({ where: { id: input.actorId } })
    if (!actor) throw new IntentError(`No actor ${input.actorId}.`, 404)
    return actor
  }
  if (!input.wallet || !isEvmAddress(input.wallet)) {
    throw new IntentError('Either actorId or a valid wallet address is required.', 400)
  }
  return resolveActorForWallet(input.wallet)
}

/**
 * The full Phase 1 path: resolve actor, record intent, authorize, receipt.
 *
 * Idempotent on `idempotencyKey` (section 27.3). Re-submitting a key returns the
 * original intent and its original decision rather than re-deciding — a retried
 * network call must not produce a second, possibly different, authorization for
 * the same requested action.
 */
export async function createIntent(
  input: CreateIntentInput,
  opts: { now?: Date } = {},
): Promise<IntentView> {
  const now = opts.now ?? new Date()
  const actor = await resolveActor(input)

  const params: IntentParameters = {
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    actionType: input.actionType,
    chainId: input.chainId ?? null,
    targetAddress: input.targetAddress ? normalizeAddress(input.targetAddress) : null,
    amount: input.amount ?? null,
    asset: input.asset ?? null,
    protocol: input.protocol ?? null,
  }
  const parametersHash = hashIntentParameters(params)
  const expiresAt = input.expiresAt ?? defaultExpiry(now, env.INTENT_DEFAULT_TTL_SECONDS)

  // A caller that supplies no key gets a unique one, so two genuinely separate
  // requests for the same action are two intents. Idempotency is opt-in and
  // caller-controlled, the way it is in any payments API.
  const idempotencyKey = input.idempotencyKey ?? `int_${crypto.randomUUID()}`

  const existing = await findByIdempotencyKey(idempotencyKey)
  if (existing) return existing

  let intent
  try {
    intent = await prisma.intent.create({
      data: {
        actorId: actor.id,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        actionType: params.actionType,
        chainId: params.chainId,
        targetAddress: params.targetAddress,
        amount: params.amount,
        asset: params.asset,
        protocol: params.protocol,
        parametersHash,
        expiresAt,
        idempotencyKey,
        status: 'PENDING',
      },
    })
  } catch (err) {
    // Concurrent submission of the same key — the winner's intent is the answer.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
      const winner = await findByIdempotencyKey(idempotencyKey)
      if (winner) return winner
    }
    throw err
  }

  const decision = await authorize({
    intentId: intent.id,
    actor,
    parametersHash,
    expiresAt,
    now,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    actionType: params.actionType,
    amount: params.amount,
    asset: params.asset,
    chainId: params.chainId,
    targetAddress: params.targetAddress,
  })

  await prisma.intent.update({ where: { id: intent.id }, data: { status: 'DECIDED' } })

  const view = await getIntent(intent.id)
  if (!view) throw new IntentError('Intent vanished immediately after creation.', 500)
  logger.info(
    { intentId: intent.id, actorId: actor.id, result: decision.result },
    'intent authorized',
  )
  return view
}

/**
 * Produces the AuthorizationDecision and its ActionReceipt.
 *
 * Order matters. Expiry and actor status are checked BEFORE any risk lookup:
 * both are cheap, both are absolute, and an expired or frozen actor's intent
 * must not consume upstream Graph quota to arrive at a foregone answer.
 */
async function authorize(args: {
  intentId: string
  actor: Actor
  parametersHash: string
  expiresAt: Date
  now: Date
  resourceType: string
  resourceId: string
  actionType: string
  amount: string | null
  asset: string | null
  chainId: number | null
  targetAddress: string | null
}): Promise<{ result: AuthorizationResult; decisionId: string }> {
  const {
    intentId,
    actor,
    parametersHash,
    expiresAt,
    now,
    resourceType,
    resourceId,
    actionType,
    amount,
    asset,
    chainId,
    targetAddress,
  } = args

  if (isExpired(expiresAt, now)) {
    return persistDecision({
      intentId,
      actorId: actor.id,
      result: 'REVIEW',
      reasonCode: REASON_CODES.INTENT_EXPIRED,
      reasonSummary: 'The intent expired before it could be authorized.',
      policyVersion: 'none',
      riskScore: 0,
      clusterId: null,
      confidence: 'LOW',
      requiredAssurance: null,
      evidenceIds: [],
      parametersHash,
    })
  }

  if (actor.status !== 'ACTIVE') {
    return persistDecision({
      intentId,
      actorId: actor.id,
      result: 'BLOCK',
      reasonCode: REASON_CODES.ACTOR_NOT_ACTIVE,
      reasonSummary: `Actor status is ${actor.status}, so no action is authorized.`,
      policyVersion: 'none',
      riskScore: 0,
      clusterId: null,
      confidence: 'LOW',
      requiredAssurance: null,
      evidenceIds: [],
      parametersHash,
    })
  }

  const walletIdentity = await prisma.actorIdentity.findFirst({
    where: { actorId: actor.id, kind: 'WALLET' },
    orderBy: { createdAt: 'asc' },
  })

  // No wallet means no on-chain evidence can be gathered at all. That is an
  // absence of evidence, which invariant 3.2 says is REVIEW, never SAFE.
  if (!walletIdentity) {
    return persistDecision({
      intentId,
      actorId: actor.id,
      result: 'REVIEW',
      reasonCode: REASON_CODES.EVIDENCE_NOT_FRESH,
      reasonSummary:
        'Actor has no wallet identity, so no on-chain evidence exists to authorize against.',
      policyVersion: 'none',
      riskScore: 0,
      clusterId: null,
      confidence: 'LOW',
      requiredAssurance: null,
      evidenceIds: [],
      parametersHash,
    })
  }

  // V1's real risk engine still produces the evidence. `decide` is still called
  // because it branches on PENDING_REVIEW before reading riskScore, and that
  // ordering is the one thing both specs refuse to see reimplemented.
  const { risk } = await getRiskThroughCache(walletIdentity.externalId)
  const policy = await decide(risk)

  // Phase 2: the trust context this decision rests on. A trust failure must
  // never become a permissive decision, so a throw here leaves the band
  // unknown and the fail-closed path below takes over.
  let trustSnapshotId: string | null = null
  let trust: Awaited<ReturnType<typeof buildTrustContext>> | null = null
  try {
    trust = await buildTrustContext(actor.id, { campaignId: resourceId, risk })
    trustSnapshotId = trust.snapshotId
  } catch (err) {
    logger.warn({ actorId: actor.id, err }, 'trust context unavailable for this decision')
  }

  // FAIL CLOSED (section 27.5). V1 holding the claim, or trust being
  // unavailable, both mean we cannot authorise — and neither may be overridden
  // by a permissive policy rule. Policy runs only once we have a real trust
  // band to run it against.
  if (policy.decision === 'PENDING_REVIEW' || trust === null) {
    return persistDecision({
      intentId,
      actorId: actor.id,
      result: 'REVIEW',
      reasonCode: REASON_CODES.EVIDENCE_NOT_FRESH,
      reasonSummary: policy.reason,
      policyVersion: policy.policyVersion,
      riskScore: policy.riskScore,
      clusterId: policy.clusterId,
      confidence: policy.confidence,
      requiredAssurance: policy.requiredAssurance,
      evidenceIds: evidenceLineage(policy),
      parametersHash,
      trustSnapshotId,
    })
  }

  // Phase 3: trust becomes authoritative. The V2 policy evaluator decides,
  // against the trust band rather than the raw V1 score, and can now return
  // LIMIT — which V1 had no way to express.
  const lease = await getLiveLease(actor.id)
  const currentCapabilities = await prisma.capability.findMany({
    where: { actorId: actor.id, actionType, status: 'ACTIVE' },
    select: { id: true, actionType: true, amountLimit: true, expiresAt: true },
  })

  const outcome = await policyEvaluator.evaluate({
    actor: { id: actor.id, actorType: actor.actorType, status: actor.status },
    intent: {
      id: intentId,
      actionType,
      resourceType,
      resourceId,
      amount,
      asset,
      chainId,
      targetAddress,
    },
    trust: {
      band: trust.band,
      coordinationRisk: trust.vector.coordinationRisk.value,
      behaviorIntegrity: trust.vector.behaviorIntegrity.value,
      evidenceFreshness: trust.vector.evidenceFreshness.value,
      snapshotId: trust.snapshotId,
    },
    assurance: {
      hasLiveLease: lease !== null,
      level: lease?.level ?? null,
      expiresAt: lease?.expiresAt ?? null,
    },
    currentCapabilities,
  })

  const decision = await persistDecision({
    intentId,
    actorId: actor.id,
    result: outcome.result,
    reasonCode: outcome.reasonCode,
    reasonSummary: `${outcome.reasonSummary} Trust band: ${trust.band}.`,
    policyVersion: outcome.policyVersion,
    riskScore: policy.riskScore,
    clusterId: policy.clusterId,
    confidence: policy.confidence,
    requiredAssurance: outcome.requiredAssurance,
    evidenceIds: evidenceLineage(policy),
    parametersHash,
    trustSnapshotId,
    policyId: outcome.policyId,
  })

  // A capability is only minted for an outcome that actually authorises
  // something. CHALLENGE, REVIEW and BLOCK grant nothing.
  if ((outcome.result === 'ALLOW' || outcome.result === 'LIMIT') && outcome.limits) {
    await grantCapability({
      actorId: actor.id,
      actionType,
      resourceScope: `${resourceType}:${resourceId}`,
      chainScope: chainId,
      limits: outcome.limits,
      sourceDecisionId: decision.decisionId,
      assuranceLeaseId: lease?.id ?? null,
      attenuated: outcome.attenuated,
    })
  }

  return decision
}

async function persistDecision(args: {
  intentId: string
  actorId: string
  result: AuthorizationResult
  reasonCode: string
  reasonSummary: string
  policyVersion: string
  riskScore: number
  clusterId: string | null
  confidence: string
  requiredAssurance: string | null
  evidenceIds: string[]
  parametersHash: string
  trustSnapshotId?: string | null
  policyId?: string | null
}): Promise<{ result: AuthorizationResult; decisionId: string }> {
  const decision = await prisma.authorizationDecision.create({
    data: {
      intentId: args.intentId,
      policyVersion: args.policyVersion,
      result: args.result,
      reasonCode: args.reasonCode,
      reasonSummary: args.reasonSummary,
      evidenceIds: args.evidenceIds,
      requiredAssurance: args.requiredAssurance,
      riskScore: args.riskScore,
      clusterId: args.clusterId,
      confidence: args.confidence,
      trustSnapshotId: args.trustSnapshotId ?? null,
      policyId: args.policyId ?? null,
    },
  })

  await prisma.actionReceipt.create({
    data: {
      intentId: args.intentId,
      decisionId: decision.id,
      actorId: args.actorId,
      policyVersion: args.policyVersion,
      trustSnapshotId: args.trustSnapshotId ?? null,
      evidenceSnapshotHash: hashEvidenceSnapshot(args.evidenceIds),
      decisionPayloadHash: hashDecisionPayload({
        result: args.result,
        reasonCode: args.reasonCode,
        policyVersion: args.policyVersion,
        riskScore: args.riskScore,
        parametersHash: args.parametersHash,
      }),
      // Section 18.2 — nothing is executed until an enforcement adapter says so,
      // and Phase 1 has no enforcement.
      executionStatus: 'NOT_EXECUTED',
    },
  })

  return { result: args.result, decisionId: decision.id }
}

async function findByIdempotencyKey(key: string): Promise<IntentView | null> {
  const intent = await prisma.intent.findUnique({ where: { idempotencyKey: key } })
  if (!intent) return null
  const view = await getIntent(intent.id)
  return view ? { ...view, replayed: true } : null
}

/** One intent with its latest decision and receipt. */
export async function getIntent(id: string): Promise<IntentView | null> {
  const intent = await prisma.intent.findUnique({
    where: { id },
    include: {
      decisions: { orderBy: { createdAt: 'desc' }, take: 1 },
      receipts: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  if (!intent) return null

  const decision = intent.decisions[0]

  return {
    intentId: intent.id,
    actorId: intent.actorId,
    status: intent.status,
    actionType: intent.actionType,
    resourceType: intent.resourceType,
    resourceId: intent.resourceId,
    parametersHash: intent.parametersHash,
    idempotencyKey: intent.idempotencyKey,
    expiresAt: intent.expiresAt.toISOString(),
    createdAt: intent.createdAt.toISOString(),
    receiptId: intent.receipts[0]?.id ?? null,
    replayed: false,
    decision: decision
      ? {
          decisionId: decision.id,
          result: decision.result as AuthorizationResult,
          reasonCode: decision.reasonCode,
          reasonSummary: decision.reasonSummary,
          requiredAssurance: decision.requiredAssurance,
          policyVersion: decision.policyVersion,
          riskScore: decision.riskScore,
          clusterId: decision.clusterId,
          confidence: decision.confidence,
          evidenceIds: Array.isArray(decision.evidenceIds)
            ? (decision.evidenceIds as string[])
            : [],
          createdAt: decision.createdAt.toISOString(),
        }
      : null,
  }
}
