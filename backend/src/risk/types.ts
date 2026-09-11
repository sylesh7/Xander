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
  /** Network slug the event was observed on. Scopes the known-funder lookup. */
  chain: string
  counterparty: string | null
  eventType: string
  timestamp: Date
  blockNumber: bigint
}

/** Categories a labelled funder can carry — Xander V2 spec section 12.3. */
export const KNOWN_FUNDER_CATEGORIES = [
  'EXCHANGE',
  'BRIDGE',
  'FAUCET',
  'PROTOCOL_TREASURY',
  'KNOWN_DISTRIBUTOR',
  'OTHER',
] as const

export type KnownFunderCategory = (typeof KNOWN_FUNDER_CATEGORIES)[number]

/** A funder the registry has a label for. */
export interface KnownFunder {
  label: string
  category: KnownFunderCategory
  confidence: Confidence
}

/**
 * Labelled funders, keyed by `chain|address` (both lowercased) — build the key
 * with `knownFunderKey`, never by hand.
 *
 * A read-only Map rather than a repository handle so FUNDING_CORRELATION stays
 * a pure function: the impure lookup happens once in `src/risk/index.ts` and
 * the extractor only ever reads what it was handed.
 */
export type KnownFunderIndex = ReadonlyMap<string, KnownFunder>

/** No labels at all. The behaviour every pure unit test gets by default. */
export const EMPTY_KNOWN_FUNDERS: KnownFunderIndex = new Map()

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
  /** Labelled benign funders. Empty means "no registry" — the pre-V2 behaviour. */
  knownFunders: KnownFunderIndex
  /**
   * What a shared-funder signal is worth when the funder is labelled benign.
   * Multiplies, never zeroes: a ring really can be funded out of one exchange
   * account, so the signal is weakened rather than discarded.
   */
  knownFunderWeightMultiplier: number
}

export type FeatureExtractor = (
  wallets: readonly string[],
  window: EvidenceWindow,
  opts: FeatureOptions,
) => FeatureResult
