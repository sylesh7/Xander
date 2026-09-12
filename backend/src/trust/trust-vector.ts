/**
 * Trust vector construction and band derivation — Xander V2 spec section 6.
 *
 * Pure. Every input arrives as an argument, including the clock.
 */
import {
  dimension,
  unknown,
  type FreshnessClass,
  type TrustBand,
  type TrustDimensionValue,
  type TrustVector,
} from './trust-types.js'

/** Thresholds, all injected so none of them is an inline number in a formula. */
export interface TrustBandOptions {
  /** coordinationRisk at or above this is CRITICAL. */
  criticalCoordinationRisk: number
  /** coordinationRisk at or above this is HIGH_RISK. */
  highCoordinationRisk: number
  /** coordinationRisk below this counts as "low risk" for the two LOW bands. */
  lowCoordinationRisk: number
  /** historyStrength at or above this counts as an established actor. */
  establishedHistoryStrength: number
  /** humanAssurance at or above this counts as verified. */
  verifiedHumanAssurance: number
  /** Below this many known dimensions, there is not enough to band at all. */
  minKnownDimensions: number
}

/**
 * Freshness age thresholds in seconds. FRESH is anything under `aging`.
 */
export interface FreshnessOptions {
  agingAfterSeconds: number
  staleAfterSeconds: number
  expiredAfterSeconds: number
}

export function classifyFreshness(ageSeconds: number, opts: FreshnessOptions): FreshnessClass {
  if (ageSeconds >= opts.expiredAfterSeconds) return 'EXPIRED'
  if (ageSeconds >= opts.staleAfterSeconds) return 'STALE'
  if (ageSeconds >= opts.agingAfterSeconds) return 'AGING'
  return 'FRESH'
}

/** Freshness class as a dimension value, so the vector carries one scale. */
export function freshnessToDimension(cls: FreshnessClass): TrustDimensionValue {
  const byClass: Record<FreshnessClass, number> = {
    FRESH: 1,
    AGING: 0.66,
    STALE: 0.33,
    EXPIRED: 0,
  }
  return dimension(byClass[cls], `evidence freshness is ${cls}`)
}

/** How many dimensions were actually measured. */
export function knownDimensionCount(vector: TrustVector): number {
  return Object.values(vector).filter((d) => d.state === 'KNOWN').length
}

/**
 * Derives the overall band from the vector.
 *
 * ORDER IS THE WHOLE ALGORITHM, and it is deliberately not a weighted average.
 * Averaging would let a strong dimension mathematically cancel a dangerous one
 * — a well-funded, long-lived, World-verified actor sitting inside a confirmed
 * coordinated ring would average out to "fine". Risk is therefore checked
 * first and can only ever move the band downward.
 *
 * 1. Not enough measured dimensions  -> INSUFFICIENT_EVIDENCE
 * 2. coordinationRisk unknown        -> INSUFFICIENT_EVIDENCE
 * 3. coordinationRisk >= critical    -> CRITICAL
 * 4. coordinationRisk >= high        -> HIGH_RISK
 * 5. low risk + verified human       -> VERIFIED_LOW
 * 6. low risk + established history  -> ESTABLISHED_LOW
 * 7. otherwise                       -> UNCERTAIN
 *
 * Steps 1 and 2 are invariant 3.2 in code: an actor we could not measure is
 * INSUFFICIENT_EVIDENCE, never a LOW band. UNCERTAIN is reserved for actors we
 * DID measure and found genuinely mixed — conflating the two would let a cold
 * wallet read as merely ambiguous rather than unassessed.
 */
export function deriveBand(vector: TrustVector, opts: TrustBandOptions): TrustBand {
  const coordination = vector.coordinationRisk
  const history = vector.historyStrength
  const human = vector.humanAssurance

  if (knownDimensionCount(vector) < opts.minKnownDimensions) return 'INSUFFICIENT_EVIDENCE'
  if (coordination.state !== 'KNOWN' || coordination.value === null) return 'INSUFFICIENT_EVIDENCE'

  if (coordination.value >= opts.criticalCoordinationRisk) return 'CRITICAL'
  if (coordination.value >= opts.highCoordinationRisk) return 'HIGH_RISK'

  const lowRisk = coordination.value < opts.lowCoordinationRisk
  const verified = human.state === 'KNOWN' && (human.value ?? 0) >= opts.verifiedHumanAssurance
  const established =
    history.state === 'KNOWN' && (history.value ?? 0) >= opts.establishedHistoryStrength

  if (lowRisk && verified) return 'VERIFIED_LOW'
  if (lowRisk && established) return 'ESTABLISHED_LOW'
  return 'UNCERTAIN'
}

/**
 * The cold-start vector — section 6.1, `trust-bootstrap` in the Phase 2 build list.
 *
 * Every dimension is UNKNOWN with a stated reason. This is the shape a wallet
 * nobody has ever seen must produce, and the reason the whole module exists:
 * the honest answer to "how risky is this actor?" for a brand-new address is
 * "we cannot tell", and that has to be representable without looking like a
 * clean bill of health.
 */
export function bootstrapVector(reason = 'no evidence for this actor yet'): TrustVector {
  return {
    behaviorIntegrity: unknown(reason),
    coordinationRisk: unknown(reason),
    historyStrength: unknown(reason),
    humanAssurance: unknown('no completed assurance for this actor'),
    agentReputation: unknown('no external agent reputation source consulted'),
    evidenceFreshness: unknown(reason),
    investigationConfidence: unknown('no investigation has been run for this actor'),
  }
}

/** Serialisable form for the snapshot's detail column. */
export function vectorToJson(vector: TrustVector): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(vector).map(([name, d]) => [
      name,
      { value: d.value, state: d.state, basis: d.basis },
    ]),
  )
}
