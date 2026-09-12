/**
 * Trust Context types — Xander V2 spec section 6, built in Phase 2.
 *
 * Pure. No database, no network, no clock.
 *
 * THE ONE IDEA THIS FILE EXISTS TO ENFORCE: absence of evidence is not low
 * risk. Invariant 3.2 — "a new wallet is represented as INSUFFICIENT_EVIDENCE,
 * not as SAFE" — and section 6.1 is explicit that a cold-start actor's
 * dimensions must not be mapped to LOW_RISK.
 *
 * The type system carries that rule rather than a convention doing it: a
 * dimension's value is `number | null`, and `null` means UNKNOWN. There is no
 * numeric encoding of "we don't know", so no arithmetic can silently average
 * ignorance into confidence, and every consumer is forced by the compiler to
 * decide what absence means for its own purpose. A `0` here would have been
 * read as "measured, and it came out clean" by the first person to touch it.
 */

/** The seven dimensions of section 6's trust vector. */
export const TRUST_DIMENSIONS = [
  'behaviorIntegrity',
  'coordinationRisk',
  'historyStrength',
  'humanAssurance',
  'agentReputation',
  'evidenceFreshness',
  'investigationConfidence',
] as const

export type TrustDimensionName = (typeof TRUST_DIMENSIONS)[number]

/**
 * Why a dimension holds the value it does.
 *
 * KNOWN            — measured from real evidence.
 * UNKNOWN          — no evidence available to measure it. Not zero, not safe.
 * NOT_APPLICABLE   — the dimension is meaningless for this actor (agent
 *                    reputation for a plain wallet, say). Also not zero.
 */
export const DIMENSION_STATES = ['KNOWN', 'UNKNOWN', 'NOT_APPLICABLE'] as const
export type DimensionState = (typeof DIMENSION_STATES)[number]

/**
 * One dimension.
 *
 * `value` is in [0, 1] when the state is KNOWN and is null otherwise — the two
 * always agree, which `dimension()` and `unknown()` below guarantee so callers
 * cannot construct an inconsistent pair by hand.
 *
 * `basis` is the short human explanation that ends up in a receipt. A trust
 * number nobody can account for is not auditable, and section 3.6 requires
 * every decision to carry its lineage.
 */
export interface TrustDimensionValue {
  value: number | null
  state: DimensionState
  basis: string
}

/** A measured dimension. Clamps to [0, 1] rather than trusting the caller. */
export function dimension(value: number, basis: string): TrustDimensionValue {
  return { value: Math.min(1, Math.max(0, value)), state: 'KNOWN', basis }
}

/** An unmeasurable dimension. The reason is required, not optional. */
export function unknown(basis: string): TrustDimensionValue {
  return { value: null, state: 'UNKNOWN', basis }
}

/** A dimension that does not apply to this kind of actor. */
export function notApplicable(basis: string): TrustDimensionValue {
  return { value: null, state: 'NOT_APPLICABLE', basis }
}

/** The full vector — every dimension present, none optional. */
export type TrustVector = Record<TrustDimensionName, TrustDimensionValue>

/**
 * Trust bands — section 6.2, plus INSUFFICIENT_EVIDENCE.
 *
 * The spec lists five bands and separately insists that UNKNOWN is "a
 * trust/evidence state, not a risk score". INSUFFICIENT_EVIDENCE is that state
 * made explicit as a band, because Phase 2's own acceptance condition requires
 * the backend to distinguish it from ESTABLISHED_LOW and HIGH_RISK, and
 * invariant 3.2 names it as the representation for a new wallet. Leaving it out
 * would have forced cold-start actors into UNCERTAIN, which reads as "we
 * measured and it was mixed" rather than "we have nothing".
 */
export const TRUST_BANDS = [
  'VERIFIED_LOW',
  'ESTABLISHED_LOW',
  'UNCERTAIN',
  'HIGH_RISK',
  'CRITICAL',
  'INSUFFICIENT_EVIDENCE',
] as const
export type TrustBand = (typeof TRUST_BANDS)[number]

/**
 * Evidence freshness classes — section 21.3.
 *
 * Explicit classes rather than an exponential decay curve, because the spec
 * says so directly: "Do not create arbitrary exponential formulas initially."
 * A named class is something an operator can reason about and a receipt can
 * state; a decay constant is a number nobody can defend.
 */
export const FRESHNESS_CLASSES = ['FRESH', 'AGING', 'STALE', 'EXPIRED'] as const
export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number]

/** Behaviour-drift signal kinds — section 6.3. */
export const DRIFT_SIGNALS = [
  'NEW_COUNTERPARTY',
  'UNUSUAL_AMOUNT',
  'NEW_PROTOCOL_CATEGORY',
  'NEW_TIMING_REGIME',
  'BEHAVIOR_SEQUENCE_DEVIATION',
  'SUDDEN_CLUSTER_EXPANSION',
] as const
export type DriftSignalName = (typeof DRIFT_SIGNALS)[number]

export interface DriftSignal {
  name: DriftSignalName
  /** 0..1 — how pronounced the deviation is, not how bad it is. */
  magnitude: number
  detail: string
}

/**
 * The drift verdict for an actor.
 *
 * Section 6.3 is emphatic: "Behavior drift is a signal, not an automatic proof
 * of abuse." A legitimate user genuinely does start using a new protocol. So
 * this type reports what changed and how much, and deliberately carries no
 * field resembling a verdict — the policy engine decides what drift means.
 */
export interface DriftResult {
  signals: DriftSignal[]
  /** Highest single magnitude, or 0 when nothing drifted. */
  peakMagnitude: number
  /** False when there was no baseline to compare against. */
  hadBaseline: boolean
}

/** Positive and negative trust events — sections 21.1 and 21.2. */
export const TRUST_SIGNAL_KINDS = [
  'SUCCESSFUL_ACTION',
  'CLEAN_BEHAVIOR',
  'SUCCESSFUL_CHALLENGE',
  'TRUSTED_ATTESTATION',
  'CONFIRMED_COORDINATED_CLUSTER',
  'POLICY_VIOLATION',
  'FAILED_ASSURANCE',
  'BEHAVIOR_DRIFT',
  'REPEATED_ABNORMAL_ACTION',
  'INVALIDATED_ATTESTATION',
] as const
export type TrustSignalKind = (typeof TRUST_SIGNAL_KINDS)[number]

export const POSITIVE_TRUST_SIGNALS: ReadonlySet<TrustSignalKind> = new Set([
  'SUCCESSFUL_ACTION',
  'CLEAN_BEHAVIOR',
  'SUCCESSFUL_CHALLENGE',
  'TRUSTED_ATTESTATION',
])

export function isPositiveSignal(kind: TrustSignalKind): boolean {
  return POSITIVE_TRUST_SIGNALS.has(kind)
}

/** Bumped when the vector's construction changes, so old snapshots stay interpretable. */
export const TRUST_ENGINE_VERSION = '2.0.0'
