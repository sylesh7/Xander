/**
 * Fixture wallet addresses — Backend-Suganthan.md Phase 12.
 *
 * These started life as a stub-era file returning hardcoded ClusterRisk
 * responses. As of Phase 12 the stub is gone: `evidence-risk-api.ts` does
 * real work, and these two addresses are seeded as real EvidenceEvent rows
 * (and, for the clustered one, a real persisted Cluster) by prisma/seed.ts —
 * exactly as promised when the stub shipped: "the same addresses keep
 * working once the real implementation replaces the stub."
 *
 * Import these constants rather than pasting the literals — the interface
 * doc (docs/EVIDENCE-RISK-INTERFACE.md) references them by name.
 */

/** Phase 12.1 scenario A — a clean wallet, resolves ALLOW. */
export const FIXTURE_CLEAN_WALLET = '0x0000000000000000000000000000000000000c1e'

/** Phase 12.1 scenario B — one member of a real, persisted coordinated cluster. */
export const FIXTURE_CLUSTERED_WALLET = '0x00000000000000000000000000000000000c1057'
