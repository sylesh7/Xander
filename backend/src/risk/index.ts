/**
 * Risk engine entry point — Backend-Suganthan.md Phase 7.
 *
 * The only place in src/risk that reads env or the database. The extractors
 * themselves stay pure so they can be unit-tested with no infrastructure.
 */
import { env } from '../config/env.js'
import { getEvidenceForWallets } from '../evidence/repository.js'
import { extractFeatures } from './features.js'
import { loadKnownFunders } from './known-funders.js'
import {
  EMPTY_KNOWN_FUNDERS,
  type EvidenceWindow,
  type FeatureName,
  type FeatureOptions,
  type FeatureResult,
} from './types.js'
import { loadActivePolicy } from './policy.js'
import { scoreFeatures, type ScoredFeature, type ScoreResult } from './scoring.js'

export * from './features.js'
export * from './known-funders.js'
export * from './policy.js'
export * from './robust.js'
export * from './scoring.js'
export * from './types.js'

/**
 * Tunables from config. Section 0.2 rule 1: never inline numbers.
 *
 * Known funders default to EMPTY here because this function is synchronous and
 * the registry lives in Postgres. Anything scoring real evidence must go through
 * `featureOptions()` instead; this overload exists for pure unit tests and for
 * callers that genuinely want the unlabelled behaviour.
 */
export function featureOptionsFromEnv(): FeatureOptions {
  return {
    fundingWindowHours: env.FUNDING_WINDOW_HOURS,
    timingNormalizationSeconds: env.TIMING_NORMALIZATION_SECONDS,
    ageNormalizationBlocks: env.AGE_NORMALIZATION_BLOCKS,
    protocolSequenceMaxLength: env.PROTOCOL_SEQUENCE_MAX_LENGTH,
    knownFunders: EMPTY_KNOWN_FUNDERS,
    knownFunderWeightMultiplier: env.KNOWN_FUNDER_WEIGHT_MULTIPLIER,
  }
}

/** The same tunables, with the known-funder registry actually loaded. */
export async function featureOptions(): Promise<FeatureOptions> {
  return { ...featureOptionsFromEnv(), knownFunders: await loadKnownFunders() }
}

/**
 * Loads the evidence window for a wallet set and extracts all five features.
 *
 * Phase 8 turns these into a score. This function deliberately stops short of
 * that: features are observations, scoring is policy, and keeping them apart is
 * what lets a PolicyVersion be re-applied to an old set of features to
 * reproduce a decision.
 */
export async function extractClusterFeatures(
  wallets: readonly string[],
  opts: { since?: Date } = {},
): Promise<FeatureResult[]> {
  const [rows, options] = await Promise.all([
    getEvidenceForWallets([...wallets], opts),
    featureOptions(),
  ])
  const window: EvidenceWindow = {
    events: rows.map((r) => ({
      id: r.id,
      wallet: r.wallet,
      chain: r.chain,
      counterparty: r.counterparty,
      eventType: r.eventType,
      timestamp: r.timestamp,
      blockNumber: r.blockNumber,
    })),
  }
  return extractFeatures(wallets, window, options)
}

/**
 * The full Phase 7 + 8 path: extract features for a wallet set, then score them
 * against the active policy.
 *
 * Returns the score, band, per-feature contributions and the policy version
 * that produced them — everything an Evidence Receipt needs.
 */
export async function scoreWalletSet(
  wallets: readonly string[],
  opts: { since?: Date; campaignPopulations?: CampaignPopulations } = {},
): Promise<ScoreResult & { policyVersion: string; features: ScoredFeature[] }> {
  const [features, policy] = await Promise.all([
    extractClusterFeatures(wallets, opts),
    loadActivePolicy(),
  ])
  const result = scoreFeatures(features, policy, opts.campaignPopulations)
  return { ...result, policyVersion: policy.version }
}

export type CampaignPopulations = Partial<Record<FeatureName, readonly number[]>>
