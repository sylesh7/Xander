/**
 * Risk feature types — Backend-Suganthan.md Phase 7.
 *
 * The acceptance test fixes the extractor signature:
 *   "(walletSet, evidenceWindow) => { value, confidence, sourceEvidenceIds }"
 */

/** Feature names. These are the exact values `RiskWeight.feature` holds. */
export const FEATURE_NAMES = [
  'FUNDING_CORRELATION',
  'TIMING_CORRELATION',
  'WALLET_AGE_SIMILARITY',
  'SHARED_COUNTERPARTY',
  'PROTOCOL_BEHAVIOR_SIMILARITY',
] as const

export type FeatureName = (typeof FEATURE_NAMES)[number]

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * One extracted feature.
 *
 * `value` and `confidence` answer different questions and must not be
 * conflated. `value` is how strong the signal is; `confidence` is how much
 * evidence there was to compute it from. A value of 0 with LOW confidence means
 * "we found nothing and barely looked"; 0 with HIGH confidence means "we looked
 * hard and these wallets are genuinely unrelated". Phase 8 weights the value;
 * Phase 11 and the Evidence Receipt care about the confidence.
 *
 * `sourceEvidenceIds` is what makes a receipt reconstructable — it points at the
 * exact EvidenceEvent rows behind the number.
 */
export interface FeatureResult {
  name: FeatureName
  /** Always in [0, 1]. */
  value: number
  confidence: Confidence
  sourceEvidenceIds: string[]
  /** Human-readable note explaining a degraded or zero result. */
  note?: string
}

/** An evidence row as the feature extractors read it. */
export interface RiskEvidenceRow {
  id: string
  wallet: string
  counterparty: string | null
  eventType: string
  timestamp: Date
  blockNumber: bigint
}

/**
 * Everything an extractor is allowed to see: the wallet set under analysis and
 * the evidence window for it. Nothing else — no database handle, no clock.
 */
export interface EvidenceWindow {
  /** Rows for every wallet in the set, in any order. */
  events: readonly RiskEvidenceRow[]
}

/** Tunables. Passed in explicitly so extractors stay pure and testable. */
export interface FeatureOptions {
  fundingWindowHours: number
  timingNormalizationSeconds: number
  ageNormalizationBlocks: number
  /**
   * Cap on the event sequence length compared by
   * PROTOCOL_BEHAVIOR_SIMILARITY. LCS is O(n*m) per pair, so an unbounded
   * sequence on a busy wallet would dominate the whole scoring pass.
   */
  protocolSequenceMaxLength: number
}

export type FeatureExtractor = (
  wallets: readonly string[],
  window: EvidenceWindow,
  opts: FeatureOptions,
) => FeatureResult
