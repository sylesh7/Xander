/**
 * Risk engine entry point — Backend-Suganthan.md Phase 7.
 *
 * The only place in src/risk that reads env or the database. The extractors
 * themselves stay pure so they can be unit-tested with no infrastructure.
 */
import { env } from '../config/env.js'
import { getEvidenceForWallets } from '../evidence/repository.js'
import { extractFeatures } from './features.js'
import type { EvidenceWindow, FeatureName, FeatureOptions, FeatureResult } from './types.js'
import { loadActivePolicy } from './policy.js'
import { scoreFeatures, type ScoredFeature, type ScoreResult } from './scoring.js'

export * from './features.js'
export * from './policy.js'
export * from './robust.js'
export * from './scoring.js'
export * from './types.js'

/** Tunables from config. Section 0.2 rule 1: never inline numbers. */
export function featureOptionsFromEnv(): FeatureOptions {
  return {
    fundingWindowHours: env.FUNDING_WINDOW_HOURS,
    timingNormalizationSeconds: env.TIMING_NORMALIZATION_SECONDS,
    ageNormalizationBlocks: env.AGE_NORMALIZATION_BLOCKS,
    protocolSequenceMaxLength: env.PROTOCOL_SEQUENCE_MAX_LENGTH,
  }
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
  const rows = await getEvidenceForWallets([...wallets], opts)
  const window: EvidenceWindow = {
    events: rows.map((r) => ({
      id: r.id,
      wallet: r.wallet,
      counterparty: r.counterparty,
      eventType: r.eventType,
      timestamp: r.timestamp,
      blockNumber: r.blockNumber,
    })),
  }
  return extractFeatures(wallets, window, featureOptionsFromEnv())
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
