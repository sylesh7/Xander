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
 * STATUS: TYPED STUB. The signatures and the queue contract below are FINAL —
 * build against them. The bodies are filled in across Phases 3-11 and finished
 * in Phase 12. Phase progress is tracked in docs/PROGRESS-SUGANTHAN.md.
 */
import { logger } from '../lib/logger.js'
import { STUB_FIXTURES } from './stub-fixtures.js'

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
  const fixture = STUB_FIXTURES[walletAddress.toLowerCase()]
  if (fixture) return fixture

  // Phases 3-11 replace this. Until then an unknown wallet resolves
  // PENDING_REVIEW, which is the correct conservative default and forces the
  // Phase 20 branch to be written first.
  logger.warn(
    { walletAddress },
    'getOrComputeClusterRisk is a Phase 12 stub — returning PENDING_REVIEW. ' +
      'Use a seeded fixture address to exercise the OK path.',
  )
  return {
    clusterId: null,
    riskScore: 0,
    confidence: 'LOW',
    policyVersion: 'stub',
    features: [],
    sources: [],
    status: 'PENDING_REVIEW',
  }
}

/**
 * Triggers Token API + Standardized Subgraph fetches for a wallet if its
 * evidence is stale. Sylesh's claim orchestrator calls this before
 * getOrComputeClusterRisk on a cache miss.
 *
 * Idempotent and safe to call repeatedly; a fresh wallet is a no-op.
 */
export async function refreshWalletEvidence(walletAddress: string): Promise<void> {
  logger.warn({ walletAddress }, 'refreshWalletEvidence is a Phase 12 stub — no-op.')
}
