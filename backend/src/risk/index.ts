/**
 * Risk engine entry point — Backend-Suganthan.md Phase 7.
 *
 * The only place in src/risk that reads env or the database. The extractors
 * themselves stay pure so they can be unit-tested with no infrastructure.
 */
import { env } from '../config/env.js'
import { getEvidenceForWallets } from '../evidence/repository.js'
import { extractFeatures } from './features.js'
import type { EvidenceWindow, FeatureOptions, FeatureResult } from './types.js'

export * from './features.js'
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
