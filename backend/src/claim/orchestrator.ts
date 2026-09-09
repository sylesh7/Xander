/**
 * Claim orchestration — Backend-Sylesh.md Phase 22.
 *
 * Everything that turns a risk assessment into a durable decision happens here,
 * so the route handlers stay thin and the ordering guarantees live in one file.
 *
 * THE CONCURRENCY RULE. Two simultaneous screenings of the same
 * {wallet, campaignId} is a real race, not a theoretical one — a claim page
 * that double-fires, a user double-clicking. The acceptance test requires
 * exactly one Claim and one VerificationChallenge to result. Two mechanisms
 * enforce that together:
 *   - `@@unique([wallet, campaignId])` + `upsert` makes the Claim itself
 *     database-enforced, never check-then-insert.
 *   - a `SELECT ... FOR UPDATE` row lock serialises the decision write, so the
 *     second caller observes the first one's committed result instead of
 *     issuing a second challenge against the same claim.
 *
 * The expensive work (Graph refresh, scoring) deliberately happens OUTSIDE the
 * transaction. Holding a row lock across a live Token API call would serialise
 * the whole endpoint behind the slowest upstream request.
 */
import { Prisma } from '@prisma/client'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { getRiskThroughCache } from '../cache/risk-cache.js'
import { recomputeClusterForCandidates } from '../interfaces/evidence-risk-api.js'
import { decide, issueOrReuseChallenge } from '../policy/policy-engine.js'
import { writeEvidenceReceipt } from '../policy/evidence-receipt.js'
import { buildIdKitRequestConfig } from '../world/idkit-request-config.js'
import { extractProofFields, verifyWorldProof } from '../world/idkit-verify.js'
import { assertSignalBinding, WalletBindingError } from '../world/wallet-binding.js'
import { recordNullifier, ReplayError } from '../world/replay-protection.js'

export class ClaimError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ClaimError'
  }
}

export interface ScreenClaimResult {
  claimId: string
  decision: string
  clusterId: string | null
  riskScore: number
  requiredAssurance: string | null
  evidenceReceiptId: string | null
  verificationChallengeId: string | null
  /** Present only on CHALLENGE — everything the client needs to open IDKit. */
  idkit: ReturnType<typeof buildIdKitRequestConfig> | null
  reason: string
  cached: boolean
}

/** A decision the claimant has already been given, replayed rather than recomputed. */
const STICKY_DECISIONS = new Set(['ALLOW', 'BLOCK', 'CHALLENGE'])

function idkitConfigOrNull(
  decision: string,
  params: { wallet: string; claimId: string; campaignId: string },
): ReturnType<typeof buildIdKitRequestConfig> | null {
  if (decision !== 'CHALLENGE') return null
  try {
    return buildIdKitRequestConfig(params)
  } catch (err) {
    // A missing WORLD_RP_ID must not turn a correct CHALLENGE into a 500. The
    // decision stands and is recorded; the client simply cannot open IDKit yet.
    logger.warn({ err }, 'CHALLENGE issued but IDKit config unavailable')
    return null
  }
}

/**
 * Re-runs Phase 6 clustering across every wallet that has claimed on this
 * campaign.
 *
 * This is the integration point the interface doc names: clustering needs a
 * campaign's full candidate set, and the Claim table is the only place that
 * set exists. `getOrComputeClusterRisk(wallet)` takes one wallet and cannot
 * discover the others.
 *
 * Run on new claims only, and never allowed to fail the claim — a clustering
 * error should degrade a claim to "scored alone", which is conservative in the
 * right direction, not reject it.
 */
async function refreshCampaignClusters(campaignId: string): Promise<void> {
  try {
    const claims = await prisma.claim.findMany({
      where: { campaignId },
      select: { wallet: true },
    })
    if (claims.length < 2) return
    await recomputeClusterForCandidates(claims.map((c) => c.wallet))
  } catch (err) {
    logger.warn({ campaignId, err }, 'campaign clustering failed — scoring wallets as-is')
  }
}

/**
 * Fetch-or-create backed by the unique constraint, not by a prior read.
 *
 * `upsert` is NOT sufficient on its own here, which a concurrency test proved
 * rather than a review predicting it: Prisma implements upsert as a
 * find-then-create, so two simultaneous callers can both miss and both attempt
 * the insert, and the loser gets P2002. The spec's own wording allows exactly
 * this alternative — "or catch the unique-constraint violation and re-fetch".
 * Losing the race is a normal outcome, so it resolves to the winner's row
 * instead of surfacing as a 500.
 */
async function getOrCreateClaim(
  wallet: string,
  campaignId: string,
): Promise<{ claim: { id: string; riskDecision: string; clusterId: string | null }; created: boolean }> {
  const found = await prisma.claim.findUnique({
    where: { wallet_campaignId: { wallet, campaignId } },
  })
  if (found) return { claim: found, created: false }

  try {
    const created = await prisma.claim.create({
      data: { wallet, campaignId, riskDecision: 'PENDING_REVIEW' },
    })
    return { claim: created, created: true }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await prisma.claim.findUniqueOrThrow({
        where: { wallet_campaignId: { wallet, campaignId } },
      })
      return { claim: raced, created: false }
    }
    throw err
  }
}

export async function screenClaim(params: {
  wallet: string
  campaignId: string
}): Promise<ScreenClaimResult> {
  const wallet = params.wallet.toLowerCase()
  const { campaignId } = params

  const { claim, created } = await getOrCreateClaim(wallet, campaignId)

  if (created) await refreshCampaignClusters(campaignId)

  // A decision already handed to this claimant is replayed as-is. PENDING_REVIEW
  // is the one non-sticky state: it means "we could not tell yet", so asking
  // again after the evidence recovers must be able to produce a real answer.
  if (STICKY_DECISIONS.has(claim.riskDecision)) {
    const [receipt, challenge] = await Promise.all([
      prisma.evidenceReceipt.findUnique({ where: { claimId: claim.id } }),
      prisma.verificationChallenge.findFirst({
        where: { claimId: claim.id },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    return {
      claimId: claim.id,
      decision: claim.riskDecision,
      clusterId: claim.clusterId,
      riskScore: receipt?.riskScore ?? 0,
      requiredAssurance: receipt?.requiredAssurance ?? null,
      evidenceReceiptId: receipt?.id ?? null,
      verificationChallengeId: challenge?.id ?? null,
      idkit: idkitConfigOrNull(claim.riskDecision, { wallet, claimId: claim.id, campaignId }),
      reason: 'Existing decision replayed — this claim was already screened.',
      cached: true,
    }
  }

  const { risk, cached } = await getRiskThroughCache(wallet)
  const decision = await decide(risk)

  // Only the writes are transactional. The lock makes the second concurrent
  // caller wait here and then observe a committed decision.
  const written = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Claim" WHERE id = ${claim.id} FOR UPDATE`

    const fresh = await tx.claim.findUniqueOrThrow({ where: { id: claim.id } })
    if (STICKY_DECISIONS.has(fresh.riskDecision)) {
      const [receipt, challenge] = await Promise.all([
        tx.evidenceReceipt.findUnique({ where: { claimId: claim.id } }),
        tx.verificationChallenge.findFirst({
          where: { claimId: claim.id },
          orderBy: { createdAt: 'desc' },
        }),
      ])
      // Every field comes from the WINNER's persisted receipt, not from this
      // caller's own computation. Mixing the two would return the winner's
      // decision alongside the loser's score — two numbers that were never
      // decided together, and a receipt id that does not match either.
      return {
        decision: fresh.riskDecision,
        receiptId: receipt?.id ?? null,
        challengeId: challenge?.id ?? null,
        clusterId: fresh.clusterId,
        riskScore: receipt?.riskScore ?? 0,
        requiredAssurance: receipt?.requiredAssurance ?? null,
        raced: true,
      }
    }

    let challengeId: string | null = null
    if (decision.decision === 'CHALLENGE') {
      const issued = await issueOrReuseChallenge(tx, { claimId: claim.id, wallet, campaignId })
      challengeId = issued.challengeId
    }

    const receipt = await writeEvidenceReceipt(tx, {
      claimId: claim.id,
      wallet,
      decision,
      worldChallengeId: challengeId,
    })

    await tx.claim.update({
      where: { id: claim.id },
      data: {
        riskDecision: decision.decision,
        clusterId: decision.clusterId,
        policyVersion: decision.policyVersion,
        // A CHALLENGE is not decided yet — /claim/finalize decides it once
        // World resolves. Stamping decidedAt here would make a claim awaiting
        // verification indistinguishable from one that has finished.
        decidedAt:
          decision.decision === 'ALLOW' || decision.decision === 'BLOCK' ? new Date() : null,
      },
    })

    return {
      decision: decision.decision,
      receiptId: receipt.id,
      challengeId,
      clusterId: decision.clusterId,
      riskScore: decision.riskScore,
      requiredAssurance: decision.requiredAssurance as string | null,
      raced: false,
    }
  })

  return {
    claimId: claim.id,
    decision: written.decision,
    clusterId: written.clusterId,
    riskScore: written.riskScore,
    requiredAssurance: written.requiredAssurance,
    evidenceReceiptId: written.receiptId,
    verificationChallengeId: written.challengeId,
    idkit: idkitConfigOrNull(written.decision, { wallet, claimId: claim.id, campaignId }),
    reason: written.raced ? 'Concurrent screening resolved first — its decision stands.' : decision.reason,
    cached,
  }
}

// ---------------------------------------------------------------------------
// World verification (Phases 18-19)
// ---------------------------------------------------------------------------

export interface VerifyResult {
  status: 'PASSED' | 'FAILED' | 'RETRYABLE'
  challengeId: string
  reason: string
}

/**
 * Verifies a World proof against a claim's open challenge.
 *
 * Check order is not arbitrary. World confirms cryptographic validity first,
 * because the wallet-binding and replay checks operate on fields that are only
 * trustworthy once it has. Then binding (is this proof FOR this claim?), then
 * replay (has this proof been spent already?) — cheapest-to-verify last-line
 * checks after the authoritative one.
 */
export async function verifyClaim(params: {
  claimId: string
  idkitResponse: unknown
  rpId?: string
}): Promise<VerifyResult> {
  const claim = await prisma.claim.findUnique({ where: { id: params.claimId } })
  if (!claim) throw new ClaimError(`Claim ${params.claimId} not found.`, 404)

  const challenge = await prisma.verificationChallenge.findFirst({
    where: { claimId: claim.id, status: 'ISSUED' },
    orderBy: { createdAt: 'desc' },
  })
  if (!challenge) {
    throw new ClaimError(
      'No open verification challenge for this claim. Re-issue one with POST /world/challenge.',
      409,
    )
  }

  const outcome = await verifyWorldProof({
    idkitResponse: params.idkitResponse,
    ...(params.rpId ? { rpId: params.rpId } : {}),
  })

  // Phase 23: a timeout leaves the challenge ISSUED and retryable. It never
  // becomes an ALLOW, and it never becomes a FAILED either — World not
  // answering is not the user failing.
  if (outcome.kind === 'UNAVAILABLE') {
    return {
      status: 'RETRYABLE',
      challengeId: challenge.id,
      reason: `World verification unavailable: ${outcome.reason}. Challenge remains open.`,
    }
  }

  if (outcome.kind === 'REJECTED') {
    await prisma.verificationChallenge.update({
      where: { id: challenge.id },
      data: { status: 'FAILED', resolvedAt: new Date() },
    })
    return { status: 'FAILED', challengeId: challenge.id, reason: outcome.reason }
  }

  let nullifier: string
  let signalHash: string
  try {
    const fields = extractProofFields(outcome.body, params.idkitResponse)
    nullifier = fields.nullifier
    signalHash = fields.signalHash
  } catch (err) {
    await prisma.verificationChallenge.update({
      where: { id: challenge.id },
      data: { status: 'FAILED', resolvedAt: new Date() },
    })
    return {
      status: 'FAILED',
      challengeId: challenge.id,
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  try {
    assertSignalBinding({ wallet: claim.wallet, claimId: claim.id, signalHash })
    await recordNullifier({
      challengeId: challenge.id,
      nullifier,
      rpId: params.rpId ?? challenge.rpId ?? '',
    })
  } catch (err) {
    if (err instanceof WalletBindingError || err instanceof ReplayError) {
      await prisma.verificationChallenge.update({
        where: { id: challenge.id },
        data: { status: 'FAILED', resolvedAt: new Date() },
      })
      return { status: 'FAILED', challengeId: challenge.id, reason: err.message }
    }
    throw err
  }

  return {
    status: 'PASSED',
    challengeId: challenge.id,
    reason: 'Proof verified, bound to this wallet and claim, and not previously used.',
  }
}

// ---------------------------------------------------------------------------
// Finalization (Phase 22)
// ---------------------------------------------------------------------------

/**
 * Resolves a CHALLENGE into its final decision once World has answered.
 *
 * A still-open challenge is a 409, never a decision. Defaulting an unanswered
 * challenge either way would undo the entire escalation step: to ALLOW is
 * fail-open, to BLOCK punishes a user for a verification they may still be
 * completing.
 */
export async function finalizeClaim(params: { claimId: string }): Promise<{
  claimId: string
  decision: string
  evidenceReceiptId: string | null
  worldChallengeId: string | null
  reason: string
}> {
  const claim = await prisma.claim.findUnique({ where: { id: params.claimId } })
  if (!claim) throw new ClaimError(`Claim ${params.claimId} not found.`, 404)

  if (claim.riskDecision !== 'CHALLENGE') {
    const receipt = await prisma.evidenceReceipt.findUnique({ where: { claimId: claim.id } })
    return {
      claimId: claim.id,
      decision: claim.riskDecision,
      evidenceReceiptId: receipt?.id ?? null,
      worldChallengeId: receipt?.worldChallengeId ?? null,
      reason: 'Claim was not awaiting verification — existing decision returned unchanged.',
    }
  }

  const challenge = await prisma.verificationChallenge.findFirst({
    where: { claimId: claim.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!challenge) throw new ClaimError('Claim is CHALLENGE but has no challenge row.', 500)

  if (challenge.status === 'ISSUED') {
    throw new ClaimError(
      'Verification is still outstanding. Complete POST /world/verify before finalizing.',
      409,
    )
  }

  const decision = challenge.status === 'PASSED' ? 'ALLOW' : 'BLOCK'
  const reason =
    challenge.status === 'PASSED'
      ? 'Selfie Check passed: the additional uniqueness assurance the policy required was provided.'
      : `Selfie Check did not pass (challenge ${challenge.status}). The required assurance was not met.`

  const receiptId = await prisma.$transaction(async (tx) => {
    await tx.claim.update({
      where: { id: claim.id },
      data: { riskDecision: decision, decidedAt: new Date() },
    })

    const receipt = await tx.evidenceReceipt.update({
      where: { claimId: claim.id },
      data: { decision, worldChallengeId: challenge.id },
    })
    return receipt.id
  })

  logger.info({ claimId: claim.id, decision, challenge: challenge.status }, 'claim finalized')

  return {
    claimId: claim.id,
    decision,
    evidenceReceiptId: receiptId,
    worldChallengeId: challenge.id,
    reason,
  }
}

/**
 * Re-issues a challenge for a claim whose previous one expired or timed out.
 *
 * Distinct from initial issuance, which happens inside `/screen-claim`. This
 * exists because an abandoned prompt should be recoverable without re-running
 * the whole risk pipeline.
 */
export async function reissueChallenge(params: { claimId: string }): Promise<{
  claimId: string
  challengeId: string
  reused: boolean
  idkit: ReturnType<typeof buildIdKitRequestConfig> | null
}> {
  const claim = await prisma.claim.findUnique({ where: { id: params.claimId } })
  if (!claim) throw new ClaimError(`Claim ${params.claimId} not found.`, 404)

  if (claim.riskDecision !== 'CHALLENGE') {
    throw new ClaimError(
      `Claim is ${claim.riskDecision}, not CHALLENGE. Only a challenged claim needs a challenge.`,
      409,
    )
  }

  const issued = await issueOrReuseChallenge(prisma, {
    claimId: claim.id,
    wallet: claim.wallet,
    campaignId: claim.campaignId,
  })

  return {
    claimId: claim.id,
    challengeId: issued.challengeId,
    reused: issued.reused,
    idkit: idkitConfigOrNull('CHALLENGE', {
      wallet: claim.wallet,
      claimId: claim.id,
      campaignId: claim.campaignId,
    }),
  }
}
