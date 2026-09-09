/**
 * Evidence Receipt — Backend-Sylesh.md Phase 21.
 *
 * The concrete artifact the whole provenance discipline exists to produce: the
 * thing a judge, a protocol operator, or a falsely-flagged user opens to answer
 * "why was this wallet challenged?".
 *
 * The receipt must reconstruct the decision WITHOUT hitting The Graph or World
 * again. That is why it stores the feature VALUES rather than pointers to a
 * recomputation, and why it names the exact `PolicyVersion` that decided —
 * weights get retuned, and a receipt that said "policy: current" would quietly
 * stop reproducing its own decision the first time someone edited a weight.
 */
import { prisma } from '../lib/prisma.js'
import type { PolicyDecision } from './policy-engine.js'

/** Everything needed to serve `GET /receipts/:id`. */
export interface ReceiptView {
  id: string
  claimId: string
  wallet: string
  clusterId: string | null
  decision: string
  riskScore: number
  confidence: string
  features: unknown
  sources: unknown
  policyVersion: string
  requiredAssurance: string | null
  worldChallengeId: string | null
  createdAt: Date
}

/**
 * Writes (or re-writes) the receipt for a claim.
 *
 * Upsert rather than create because `EvidenceReceipt.claimId` is unique and a
 * claim legitimately gets a second decision: `POST /claim/finalize` resolves a
 * CHALLENGE into ALLOW or BLOCK. One claim, one current receipt.
 *
 * `tx` is accepted so the receipt is written inside the orchestrator's
 * transaction — Phase 23 requires a mid-orchestration write failure to roll the
 * whole decision back, and a receipt committed independently of the claim it
 * describes would survive that rollback as a record of a decision that never
 * happened.
 */
export async function writeEvidenceReceipt(
  tx: Pick<typeof prisma, 'evidenceReceipt'>,
  params: {
    claimId: string
    wallet: string
    decision: PolicyDecision
    worldChallengeId?: string | null
  },
): Promise<{ id: string }> {
  const { decision } = params

  const data = {
    wallet: params.wallet.toLowerCase(),
    clusterId: decision.clusterId,
    decision: decision.decision,
    riskScore: decision.riskScore,
    confidence: decision.confidence,
    features: decision.features as unknown as object,
    sources: decision.sources as unknown as object,
    policyVersion: decision.policyVersion,
    requiredAssurance: decision.requiredAssurance,
    worldChallengeId: params.worldChallengeId ?? null,
  }

  const row = await tx.evidenceReceipt.upsert({
    where: { claimId: params.claimId },
    create: { claimId: params.claimId, ...data },
    update: data,
  })

  return { id: row.id }
}

export async function getReceipt(id: string): Promise<ReceiptView | null> {
  return prisma.evidenceReceipt.findUnique({ where: { id } })
}

export async function getReceiptByClaim(claimId: string): Promise<ReceiptView | null> {
  return prisma.evidenceReceipt.findUnique({ where: { claimId } })
}
