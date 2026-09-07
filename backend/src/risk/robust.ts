/**
 * Robust statistics — Backend-Suganthan.md Phase 8.1.
 *
 * WHY THIS FILE EXISTS, in one sentence: if most of a campaign's participants
 * are coordinated attackers, a mean/stddev baseline normalizes the attack into
 * looking "normal".
 *
 * That is a real contamination problem, not a style preference. Suppose 70% of
 * a campaign's wallets are one Sybil ring, all sharing a funder. The MEAN
 * funding-correlation is then high, so every attacker sits near the average and
 * scores as unremarkable — while the 30% of honest users become the outliers.
 * The detector inverts.
 *
 * The median tolerates up to 50% contamination before it moves, and MAD (median
 * absolute deviation) does the same for spread. Anywhere a value is compared
 * against "the rest of the set", these are used instead of mean/stddev.
 */

/** Median of a numeric sample. Returns 0 for an empty sample. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/**
 * Median absolute deviation: `median(|xᵢ − median(x)|)`.
 *
 * The robust counterpart to standard deviation. Unlike stddev, a handful of
 * extreme values cannot inflate it.
 */
export function mad(values: readonly number[]): number {
  if (values.length === 0) return 0
  const m = median(values)
  return median(values.map((v) => Math.abs(v - m)))
}

/**
 * Scale factor making MAD a consistent estimator of standard deviation for
 * normally distributed data: 1 / Φ⁻¹(0.75) ≈ 1.4826.
 *
 * Without it a robust z-score is not comparable to an ordinary one, and any
 * threshold tuned against normal-distribution intuition would be wrong by ~48%.
 */
export const MAD_TO_STDDEV = 1.4826

/**
 * How many robust standard deviations `value` sits above the population median.
 *
 * Returns 0 when MAD is 0 — which happens when more than half the population
 * shares one value. That is common and not an error: in a campaign where most
 * wallets score 0 on a feature, MAD is 0, and the honest answer is "this
 * population has no usable spread", not a division by zero or an infinite
 * z-score.
 */
export function robustZScore(value: number, population: readonly number[]): number {
  if (population.length === 0) return 0
  const spread = mad(population) * MAD_TO_STDDEV
  if (spread === 0) return 0
  return (value - median(population)) / spread
}

/** The p-th percentile (0..1) by linear interpolation. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
}

export interface RobustBaseline {
  median: number
  mad: number
  /** Robust z-score of the observed value against the population. */
  zScore: number
  /** Population size the baseline was computed from. */
  sampleSize: number
}

/**
 * Summarises how a value compares to its campaign population.
 *
 * Reported alongside the raw feature value rather than replacing it — the raw
 * value is what the weights multiply, and the baseline is what an investigator
 * needs in order to answer "was 0.6 high for THIS campaign?". Both end up on
 * the Evidence Receipt, and `RiskEvidence.baseline` stores the median.
 */
export function robustBaseline(value: number, population: readonly number[]): RobustBaseline {
  return {
    median: median(population),
    mad: mad(population),
    zScore: robustZScore(value, population),
    sampleSize: population.length,
  }
}
