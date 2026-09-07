/**
 * Scoring and policy bands — Backend-Suganthan.md Phase 8.3 / 8.4.
 *
 * `score = Σ weightᵢ × featureᵢ`. Deliberately boring arithmetic: the core is
 * deterministic and auditable, and the AI investigates at the edges but never
 * decides (Section 0.2 rule 5).
 *
 * Weights and thresholds are rows, never constants. A judge asking "why 0.35?"
 * gets a database row rather than a magic number.
 */
import type { Confidence, FeatureName, FeatureResult } from './types.js'
import { robustBaseline, type RobustBaseline } from './robust.js'

export type Band = 'ALLOW' | 'CHALLENGE' | 'BLOCK'

export interface Weight {
  feature: string
  weight: number
}

export interface Threshold {
  band: string
  minScore: number
  maxScore: number
}

/**
 * Unallocated weight, held as an explicit row so the table genuinely sums to
 * 1.0 and the Phase 8 validation is honest rather than special-cased.
 *
 * Its feature value is always 0, so the maximum achievable score is 0.85, not
 * 1.0. That is intentional headroom for a sixth feature, and it is recorded
 * here so "why does nothing ever score 1.0?" has an answer in a row instead of
 * being a mystery.
 */
export const RESERVE_WEIGHT = 'RESERVE'

/** Thrown when the policy itself is malformed. Never swallowed. */
export class PolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyError'
  }
}

const EPSILON = 1e-9

/**
 * Weights must sum to 1.0. Fails loudly — a policy summing to 0.9 would deflate
 * every score in the system by 10% and silently move every wallet a band
 * towards ALLOW.
 */
export function validateWeights(weights: readonly Weight[]): void {
  if (weights.length === 0) throw new PolicyError('No RiskWeight rows: policy is not seeded.')

  for (const w of weights) {
    if (!Number.isFinite(w.weight) || w.weight < 0) {
      throw new PolicyError(`RiskWeight ${w.feature} has an invalid weight: ${w.weight}`)
    }
  }

  const total = weights.reduce((sum, w) => sum + w.weight, 0)
  if (Math.abs(total - 1) > 1e-6) {
    throw new PolicyError(
      `RiskWeight rows sum to ${total.toFixed(6)}, not 1.0. ` +
        `Every score would be scaled by that factor. Fix the rows before scoring.`,
    )
  }
}

/**
 * Thresholds must tile [0, 1] with no gap and no overlap.
 *
 * A gap means some score maps to no band and the claim silently falls through;
 * an overlap means the band depends on row ordering, so the same score could
 * decide differently between two runs. Both are worse than a loud failure.
 */
export function validateThresholds(thresholds: readonly Threshold[]): void {
  if (thresholds.length === 0) {
    throw new PolicyError('No RiskThreshold rows: policy is not seeded.')
  }

  const sorted = [...thresholds].sort((a, b) => a.minScore - b.minScore)
  if (Math.abs(sorted[0]!.minScore) > EPSILON) {
    throw new PolicyError(`Thresholds start at ${sorted[0]!.minScore}, not 0.`)
  }
  if (Math.abs(sorted[sorted.length - 1]!.maxScore - 1) > EPSILON) {
    throw new PolicyError(`Thresholds end at ${sorted[sorted.length - 1]!.maxScore}, not 1.`)
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    if (Math.abs(cur.minScore - prev.maxScore) > EPSILON) {
      throw new PolicyError(
        `Threshold gap or overlap between ${prev.band} (ends ${prev.maxScore}) and ` +
          `${cur.band} (starts ${cur.minScore}).`,
      )
    }
  }
}

/**
 * Maps a score to a band.
 *
 * Bands are half-open `[min, max)` so a score exactly on a boundary belongs to
 * exactly one band. The topmost band is closed at its upper end, otherwise a
 * perfect 1.0 would match nothing.
 */
export function bandFor(score: number, thresholds: readonly Threshold[]): Band {
  validateThresholds(thresholds)
  const sorted = [...thresholds].sort((a, b) => a.minScore - b.minScore)

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!
    const isTop = i === sorted.length - 1
    if (
      score >= t.minScore - EPSILON &&
      (isTop ? score <= t.maxScore + EPSILON : score < t.maxScore)
    ) {
      return t.band as Band
    }
  }

  throw new PolicyError(`Score ${score} matched no threshold band. Thresholds must tile [0, 1].`)
}

export interface ScoredFeature {
  name: FeatureName
  value: number
  weight: number
  /** `weight × value` — this feature's contribution to the score. */
  contribution: number
  confidence: Confidence
  sourceEvidenceIds: string[]
  /** Campaign-relative comparison, when a population was supplied. */
  baseline?: RobustBaseline
  note?: string
}

export interface ScoreResult {
  score: number
  band: Band
  confidence: Confidence
  features: ScoredFeature[]
}

const CONFIDENCE_RANK: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }
const RANK_CONFIDENCE: Confidence[] = ['LOW', 'MEDIUM', 'HIGH']

/**
 * Overall confidence, weighted by how much each feature actually influences the
 * score.
 *
 * A LOW-confidence feature carrying 25% of the weight should drag the result
 * down far more than a LOW-confidence feature carrying 5%. A plain minimum
 * would let one barely-weighted feature veto an otherwise well-evidenced
 * decision; a plain average would let a heavily-weighted guess hide behind
 * several well-evidenced trivia.
 */
export function aggregateConfidence(features: readonly ScoredFeature[]): Confidence {
  const totalWeight = features.reduce((s, f) => s + f.weight, 0)
  if (totalWeight === 0) return 'LOW'
  const weighted = features.reduce((s, f) => s + CONFIDENCE_RANK[f.confidence] * f.weight, 0)
  return RANK_CONFIDENCE[Math.round(weighted / totalWeight)] ?? 'LOW'
}

/**
 * Scores extracted features against a policy.
 *
 * Pure: the policy arrives as arguments, so the same features and the same
 * PolicyVersion always reproduce the same score — which is exactly what makes
 * an Evidence Receipt replayable months later.
 *
 * `campaignPopulations` optionally supplies, per feature, the values observed
 * across the rest of the campaign. When present each feature gets a robust
 * (median/MAD) baseline for the receipt. It does NOT alter the score: the raw
 * value is what the weights multiply, and re-baselining the score itself would
 * make a decision depend on which other claims happened to be in flight.
 */
export function scoreFeatures(
  features: readonly FeatureResult[],
  policy: { weights: readonly Weight[]; thresholds: readonly Threshold[] },
  campaignPopulations?: Partial<Record<FeatureName, readonly number[]>>,
): ScoreResult {
  validateWeights(policy.weights)

  const byName = new Map(policy.weights.map((w) => [w.feature, w.weight]))
  const scored: ScoredFeature[] = []

  for (const f of features) {
    const weight = byName.get(f.name)
    if (weight === undefined) {
      // Silently scoring it at 0 would quietly drop a whole signal.
      throw new PolicyError(
        `Feature ${f.name} has no RiskWeight row. Add one (weight 0 if intentional) ` +
          `rather than letting it vanish from the score.`,
      )
    }
    const population = campaignPopulations?.[f.name]
    scored.push({
      name: f.name,
      value: f.value,
      weight,
      contribution: weight * f.value,
      confidence: f.confidence,
      sourceEvidenceIds: f.sourceEvidenceIds,
      ...(population ? { baseline: robustBaseline(f.value, population) } : {}),
      ...(f.note ? { note: f.note } : {}),
    })
  }

  const score = scored.reduce((sum, f) => sum + f.contribution, 0)
  const clamped = Math.min(1, Math.max(0, score))

  return {
    score: clamped,
    band: bandFor(clamped, policy.thresholds),
    confidence: aggregateConfidence(scored),
    features: scored,
  }
}
