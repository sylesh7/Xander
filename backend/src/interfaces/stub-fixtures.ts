/**
 * Deterministic stub responses so Sylesh can build Phases 14/20/21/22 before
 * Suganthan's Phases 3-11 land. These addresses are also seeded by
 * prisma/seed.ts, so the same addresses keep working once the real
 * implementation replaces the stub.
 *
 * DELETE THIS FILE at Phase 12 once getOrComputeClusterRisk is real.
 */
import type { ClusterRisk } from './evidence-risk-api.js'

/** Phase 12.1 scenario A — clean wallet, scores near 0, resolves ALLOW. */
export const FIXTURE_CLEAN_WALLET = '0x0000000000000000000000000000000000000c1e'

/** Phase 12.1 scenario B — member of a synthetic coordinated 5-wallet cluster. */
export const FIXTURE_CLUSTERED_WALLET = '0x00000000000000000000000000000000000c1057'

export const STUB_FIXTURES: Record<string, ClusterRisk> = {
  [FIXTURE_CLEAN_WALLET]: {
    clusterId: null,
    riskScore: 0.04,
    confidence: 'HIGH',
    policyVersion: 'stub-1.0',
    features: [
      { name: 'FUNDING_CORRELATION', value: 0 },
      { name: 'TIMING_CORRELATION', value: 0.02 },
      { name: 'WALLET_AGE_SIMILARITY', value: 0.05 },
      { name: 'SHARED_COUNTERPARTY', value: 0.03 },
      { name: 'PROTOCOL_BEHAVIOR_SIMILARITY', value: 0.11 },
    ],
    sources: [{ type: 'token-api', deployment: null, block: '21000000' }],
    status: 'OK',
  },
  [FIXTURE_CLUSTERED_WALLET]: {
    clusterId: 'stub-cluster-001',
    riskScore: 0.72,
    confidence: 'HIGH',
    policyVersion: 'stub-1.0',
    features: [
      { name: 'FUNDING_CORRELATION', value: 1 },
      { name: 'TIMING_CORRELATION', value: 0.93 },
      { name: 'WALLET_AGE_SIMILARITY', value: 0.88 },
      { name: 'SHARED_COUNTERPARTY', value: 0.64 },
      { name: 'PROTOCOL_BEHAVIOR_SIMILARITY', value: 0.79 },
    ],
    sources: [
      { type: 'token-api', deployment: null, block: '21000000' },
      { type: 'standardized-subgraph', deployment: 'QmStubDeploymentId', block: '20999980' },
    ],
    status: 'OK',
  },
}
