/**
 * Policy Engine — Backend-Sylesh.md Phase 20.
 *
 * The thesis of the whole product lives in this file: THE SCORE DOES NOT DECIDE
 * ANYTHING BY ITSELF. Policy decides the minimum assurance a claim needs. A
 * low-risk wallet must never see a Selfie Check prompt — if escalation leaks
 * into an "always verify" flow, the product is just a blanket biometric gate
 * with extra steps.
 *
 * Two ordering rules are load-bearing:
 *
 * 1. PENDING_REVIEW IS BRANCHED ON FIRST, BEFORE riskScore IS READ. When the
 *    evidence engine cannot vouch for its data it returns riskScore 0 — which
 *    lands squarely in the ALLOW band. A missing status check therefore does
 *    not fail loudly; it silently approves exactly the claims the system was
 *    least sure about. Both specs call this the single most damaging
 *    integration bug available in this codebase.
 *
 * 2. THE BAND COMES FROM THE SAME POLICY VERSION THAT PRODUCED THE SCORE.
 *    Scoring against v1.0's weights and banding against v1.1's thresholds would
 *    produce a decision no single policy ever authorised, and an Evidence
 *    Receipt naming one version would not reproduce it.
 */
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import type { ClusterRisk, Confidence, RiskFeature, RiskSource } from '../interfaces/evidence-risk-api.js'
import { buildWorldAction } from '../world/idkit-request-config.js'
import { expectedSignalHash } from '../world/wallet-binding.js'

export type Decision = 'ALLOW' | 'CHALLENGE' | 'BLOCK' | 'PENDING_REVIEW'
export type RequiredAssurance = 'SELFIE_CHECK' | null

export interface PolicyDecision {
  decision: Decision
  requiredAssurance: RequiredAssurance
  riskScore: number
  clusterId: string | null
  confidence: Confidence
  policyVersion: string
  features: RiskFeature[]
  sources: RiskSource[]
  /** Why this decision, in a form a receipt can carry and a human can read. */
  reason: string
}

interface Threshold {
  band: string
  minScore: number
  maxScore: number
}

/**
 * Reads the bands to decide with.
 *
 * Preference order is deliberate: the exact version that scored this wallet,
 * then whatever is active, then the live editable table. The last fallback
 * exists because Phase 20 explicitly allows running before PolicyVersion
 * activation is wired; it is a documented degradation, and it is logged, not a
 * silent equivalent.
 */
async function resolveThresholds(policyVersion: string): Promise<Threshold[]> {
  const named = await prisma.policyVersion.findUnique({ where: { version: policyVersion } })
  if (named) return named.thresholds as unknown as Threshold[]

  const active = await prisma.policyVersion.findFirst({ where: { active: true } })
  if (active) {
    logger.warn(
      { requested: policyVersion, using: active.version },
      'policy engine: scored policy version not found — banding with the active version',
    )
    return active.thresholds as unknown as Threshold[]
  }

  const live = await prisma.riskThreshold.findMany({ orderBy: { minScore: 'asc' } })
  logger.warn('policy engine: no PolicyVersion — banding with live RiskThreshold rows')
  return live.map((t) => ({ band: t.band, minScore: t.minScore, maxScore: t.maxScore }))
}

/**
 * Bands are half-open [min, max) so adjacent rows cannot both match, with the
 * top band closed at 1.0 so a perfect score still lands somewhere.
 */
function bandFor(score: number, thresholds: readonly Threshold[]): string | null {
  for (const t of thresholds) {
    const withinTop = t.maxScore >= 1 && score <= 1
    if (score >= t.minScore && (score < t.maxScore || withinTop)) return t.band
  }
  return null
}

const HELD: Omit<PolicyDecision, 'riskScore' | 'clusterId' | 'confidence' | 'policyVersion' | 'features' | 'sources'> = {
  decision: 'PENDING_REVIEW',
  requiredAssurance: null,
  reason: '',
}

/**
 * Maps a risk assessment to the assurance a claim requires.
 *
 * NOTE ON THE UNIQUENESS SIGNAL: Selfie Check's medium-assurance uniqueness
 * signal is deliberately NOT an input here. Whether it comes back as a
 * threshold-able number or a boolean is still unconfirmed against a real verify
 * response, and weighting a field whose shape is a guess would be exactly the
 * fabricated-confidence failure Section 0.2 rule 4 forbids. It is recorded when
 * present; it does not move a decision.
 */
export async function decide(risk: ClusterRisk): Promise<PolicyDecision> {
  const base = {
    riskScore: risk.riskScore,
    clusterId: risk.clusterId,
    confidence: risk.confidence,
    policyVersion: risk.policyVersion,
    features: risk.features,
    sources: risk.sources,
  }

  // Rule 1. Before riskScore is read at all.
  if (risk.status === 'PENDING_REVIEW') {
    return {
      ...base,
      ...HELD,
      reason:
        'Evidence was stale or a required Graph query failed. The claim is held rather than ' +
        'scored — an unknown wallet is not a safe wallet.',
    }
  }

  const thresholds = await resolveThresholds(risk.policyVersion)
  const band = bandFor(risk.riskScore, thresholds)

  if (!band) {
    return {
      ...base,
      ...HELD,
      reason: `Score ${risk.riskScore} matched no configured policy band. Held rather than guessed.`,
    }
  }

  switch (band) {
    case 'ALLOW':
      return {
        ...base,
        decision: 'ALLOW',
        requiredAssurance: null,
        reason: `Score ${risk.riskScore.toFixed(4)} is in the ALLOW band under policy ${risk.policyVersion}.`,
      }
    case 'CHALLENGE':
      return {
        ...base,
        decision: 'CHALLENGE',
        requiredAssurance: 'SELFIE_CHECK',
        reason:
          `Score ${risk.riskScore.toFixed(4)} is in the CHALLENGE band under policy ` +
          `${risk.policyVersion}. Additional uniqueness assurance is required before this ` +
          `claim can resolve.`,
      }
    case 'BLOCK':
      return {
        ...base,
        decision: 'BLOCK',
        requiredAssurance: null,
        reason: `Score ${risk.riskScore.toFixed(4)} is in the BLOCK band under policy ${risk.policyVersion}.`,
      }
    default:
      // A band name nobody wrote a mapping for is a configuration error, not a
      // decision. Guessing which of allow/block it meant is not recoverable.
      return {
        ...base,
        ...HELD,
        reason: `Policy band "${band}" has no decision mapping. Held rather than guessed.`,
      }
  }
}

// ---------------------------------------------------------------------------
// Challenge issuance (Phase 20) — only ever reached on CHALLENGE.
// ---------------------------------------------------------------------------

/** A PASSED challenge older than the Selfie Check validity window is not "still verified". */
function validitySince(): Date {
  return new Date(Date.now() - env.WORLD_CHALLENGE_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
}

function isTimedOut(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > env.WORLD_CHALLENGE_TTL_MINUTES * 60 * 1000
}

/**
 * Issues the Selfie Check challenge for a claim, or reuses a live one.
 *
 * Two different clocks apply and they are not interchangeable:
 *   - WORLD_CHALLENGE_VALIDITY_DAYS (90) governs how long a PASSED proof counts
 *     as "still verified".
 *   - WORLD_CHALLENGE_TTL_MINUTES governs how long an unanswered prompt stays
 *     open before it is EXPIRED and re-issued.
 *
 * `tx` is threaded through so issuance can join the orchestrator's transaction:
 * the Phase 22 acceptance test requires two concurrent screenings of the same
 * claim to produce ONE challenge, and that guarantee comes from the row lock
 * the caller holds, not from a check here.
 */
export async function issueOrReuseChallenge(
  tx: Pick<typeof prisma, 'verificationChallenge'>,
  params: { claimId: string; wallet: string; campaignId: string },
): Promise<{ challengeId: string; reused: boolean }> {
  const worldActionId = buildWorldAction(params.campaignId)

  const passed = await tx.verificationChallenge.findFirst({
    where: { claimId: params.claimId, status: 'PASSED', resolvedAt: { gte: validitySince() } },
    orderBy: { resolvedAt: 'desc' },
  })
  if (passed) return { challengeId: passed.id, reused: true }

  const open = await tx.verificationChallenge.findFirst({
    where: { claimId: params.claimId, status: 'ISSUED' },
    orderBy: { createdAt: 'desc' },
  })

  if (open && !isTimedOut(open.createdAt)) return { challengeId: open.id, reused: true }

  if (open) {
    await tx.verificationChallenge.update({
      where: { id: open.id },
      data: { status: 'EXPIRED', resolvedAt: new Date() },
    })
  }

  const created = await tx.verificationChallenge.create({
    data: {
      claimId: params.claimId,
      wallet: params.wallet.toLowerCase(),
      status: 'ISSUED',
      worldActionId,
      // Bound at issuance, so verification compares against what THIS claim
      // asked for rather than re-deriving from whatever the client sends back.
      signalHash: expectedSignalHash(params.wallet, params.claimId),
    },
  })

  return { challengeId: created.id, reused: false }
}
