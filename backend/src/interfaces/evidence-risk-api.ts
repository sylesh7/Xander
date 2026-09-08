/**
 * ============================================================================
 * THE SUGANTHAN -> SYLESH SEAM.  Backend-Suganthan.md Phase 12.2.
 * ============================================================================
 *
 * This is the ONLY module Sylesh's track imports from the Evidence & Risk
 * Engine. Everything inside src/graph, src/evidence, src/behavior-graph,
 * src/risk and src/provenance is an implementation detail their code never
 * touches directly (Backend-Sylesh.md Phase 24).
 *
 * If Sylesh needs something this file doesn't expose, that is a conversation
 * with Suganthan, not a workaround.
 *
 * STATUS: REAL, as of Phase 12. The stub is gone. Both functions do real work
 * against real Postgres, the real Token API, and the real Standardized
 * Subgraphs gateway. The two fixture addresses from the stub era
 * (FIXTURE_CLEAN_WALLET, FIXTURE_CLUSTERED_WALLET) still resolve — they are
 * now seeded as real data by prisma/seed.ts rather than hardcoded responses,
 * exactly as promised when the stub shipped.
 */
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { checkFreshness } from '../provenance/freshness-guard.js'
import { refreshWalletEvidence as doRefresh } from '../evidence/refresh.js'
import { buildClusters, persistClusters } from '../behavior-graph/index.js'
import { scoreWalletSet } from '../risk/index.js'

export { FIXTURE_CLEAN_WALLET, FIXTURE_CLUSTERED_WALLET } from './stub-fixtures.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * 'PENDING_REVIEW' is the freshness-guard result (Phase 11).
 *
 * Section 0.2 rule 4: a stale or failed Graph query holds the claim; it never
 * silently defaults to ALLOW. Sylesh's Policy Engine (Phase 20) must branch on
 * this FIRST, before it looks at riskScore. Treating PENDING_REVIEW as OK is
 * the single most damaging integration bug available in this system.
 */
export type RiskStatus = 'OK' | 'PENDING_REVIEW'

export interface RiskFeature {
  name: string
  value: number
}

/** Provenance for one contributing source. Section 0.2 rule 3. */
export interface RiskSource {
  type: string
  deployment: string | null
  /** Block number as a string — these exceed Number.MAX_SAFE_INTEGER. */
  block: string | null
}

export interface ClusterRisk {
  clusterId: string | null
  riskScore: number
  confidence: Confidence
  policyVersion: string
  features: RiskFeature[]
  sources: RiskSource[]
  status: RiskStatus
}

// ---------------------------------------------------------------------------
// BullMQ invalidation contract (Phase 10.4 <-> Sylesh Phase 14)
// ---------------------------------------------------------------------------

/**
 * Queue name Suganthan's Substreams webhook receiver publishes to after
 * persisting new evidence. Sylesh's cache worker consumes it.
 *
 * Import this constant — do not retype the string on either side.
 */
export const RISK_INVALIDATION_QUEUE = 'risk-invalidation' as const

/** Payload shape for RISK_INVALIDATION_QUEUE jobs. */
export interface RiskInvalidationJob {
  /** A wallet address (0x...) or a Cluster.id. */
  walletOrClusterId: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PENDING_REVIEW: ClusterRisk = {
  clusterId: null,
  riskScore: 0,
  confidence: 'LOW',
  policyVersion: 'none',
  features: [],
  sources: [],
  status: 'PENDING_REVIEW',
}

/**
 * The wallet set to score: an existing cluster's full membership if the
 * wallet has one, otherwise just the wallet alone.
 *
 * Deliberately read-only. Forming NEW clusters needs a campaign's full
 * candidate wallet set, which this function does not have — it takes one
 * wallet, not a campaign. See `recomputeClusterForCampaign` below for the
 * function that actually runs Phase 6 clustering; this only looks up what a
 * prior clustering pass already decided.
 */
async function resolveScoringSet(
  wallet: string,
): Promise<{ wallets: string[]; clusterId: string | null }> {
  const row = await prisma.wallet.findUnique({
    where: { address: wallet },
    include: { cluster: { include: { wallets: true } } },
  })

  if (row?.cluster) {
    return {
      wallets: row.cluster.wallets.map((w) => w.address),
      clusterId: row.cluster.id,
    }
  }
  return { wallets: [wallet], clusterId: null }
}

/** Derives the sources array from the raw evidence behind a scored wallet set. */
async function deriveSources(wallets: readonly string[]): Promise<RiskSource[]> {
  const grouped = await prisma.evidenceEvent.groupBy({
    by: ['sourceType', 'deploymentId'],
    where: { wallet: { in: wallets.map((w) => w.toLowerCase()) } },
    _max: { blockNumber: true },
  })
  return grouped.map((g) => ({
    type: g.sourceType,
    deployment: g.deploymentId,
    block: g._max.blockNumber != null ? g._max.blockNumber.toString() : null,
  }))
}

// ---------------------------------------------------------------------------
// The two functions Sylesh calls
// ---------------------------------------------------------------------------

/**
 * Returns the risk assessment for the cluster a wallet belongs to.
 *
 * The cluster is the unit of analysis (Section 0.2 rule 6) — an unclustered
 * wallet returns clusterId: null and is scored on its own evidence.
 *
 * Callers MUST handle `status: 'PENDING_REVIEW'` explicitly.
 */
export async function getOrComputeClusterRisk(walletAddress: string): Promise<ClusterRisk> {
  const wallet = walletAddress.toLowerCase()

  try {
    const { wallets, clusterId } = await resolveScoringSet(wallet)

    const freshness = await checkFreshness(wallets)
    if (!freshness.fresh) {
      logger.info(
        { wallet, clusterId, reasons: freshness.reasons },
        'evidence not fresh — PENDING_REVIEW',
      )
      return PENDING_REVIEW
    }

    const [result, sources] = await Promise.all([scoreWalletSet(wallets), deriveSources(wallets)])

    return {
      clusterId,
      riskScore: result.score,
      confidence: result.confidence,
      policyVersion: result.policyVersion,
      features: result.features.map((f) => ({ name: f.name, value: f.value })),
      sources,
      status: 'OK',
    }
  } catch (err) {
    // Section 0.2 rule 4: any failure here — no active policy, a scoring
    // error, a database hiccup — resolves PENDING_REVIEW. A caught exception
    // must never leave the caller inferring a confident score from a crash.
    logger.error({ wallet, err }, 'getOrComputeClusterRisk failed — PENDING_REVIEW')
    return PENDING_REVIEW
  }
}

/**
 * Triggers Token API + Standardized Subgraph fetches for a wallet if its
 * evidence is stale. Sylesh's claim orchestrator calls this before
 * getOrComputeClusterRisk on a cache miss.
 *
 * Idempotent and safe to call repeatedly; Phase 5's idempotent upsert makes a
 * redundant refresh a cheap no-op rather than duplicate evidence.
 */
export async function refreshWalletEvidence(walletAddress: string): Promise<void> {
  const result = await doRefresh(walletAddress)
  if (result.errors.length > 0) {
    logger.warn(
      { walletAddress, errors: result.errors },
      'refreshWalletEvidence completed with partial failures',
    )
  }
}

// ---------------------------------------------------------------------------
// Additive export — NOT one of the two locked functions above.
// ---------------------------------------------------------------------------

/**
 * Runs Phase 6 clustering over an explicit candidate wallet set and persists
 * the result, so a subsequent `getOrComputeClusterRisk` call for any of those
 * wallets finds a real cluster instead of scoring them alone.
 *
 * Why this exists and isn't automatic: `getOrComputeClusterRisk(wallet)` takes
 * one wallet, not a campaign — it has no way to know which OTHER wallets
 * belong in the same candidate set (Phase 6's clustering needs "every wallet
 * that interacted with a given campaign," which only Sylesh's Claim table
 * knows). Call this once per campaign, over that campaign's full wallet list,
 * before scoring individual claims — the natural point is claim intake
 * (Sylesh Phase 22), not this file, since only that code has the campaign
 * context.
 */
export async function recomputeClusterForCandidates(wallets: string[]): Promise<string[]> {
  const { clusters } = await buildClusters(wallets)
  return persistClusters(clusters)
}
