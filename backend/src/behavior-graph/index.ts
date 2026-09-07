/**
 * Behavior graph entry point — Backend-Suganthan.md Phase 6.
 *
 * Ties the pure pieces to the database: read evidence, build edges, cluster,
 * persist. This is the only file in the folder that touches Prisma, so the
 * graph maths stays independently testable.
 */
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { getEvidenceForWallets } from '../evidence/repository.js'
import { clusterWallets, type DetectedCluster } from './clustering.js'
import { buildEdges, groupByWallet, toEvidenceLike } from './pairwise.js'

export * from './clustering.js'
export * from './pairwise.js'

export interface BuildClustersResult {
  clusters: DetectedCluster[]
  /** Wallets in the candidate set that ended up in no cluster. */
  unclustered: string[]
  edgeCount: number
}

/**
 * Builds clusters over a candidate wallet set — typically every wallet that
 * interacted with one campaign in the current window.
 *
 * Pure computation; nothing is written. `persistClusters` does that separately
 * so a caller can inspect a proposed clustering without committing to it.
 */
export async function buildClusters(
  wallets: string[],
  opts: { since?: Date } = {},
): Promise<BuildClustersResult> {
  const rows = await getEvidenceForWallets(wallets, opts)
  const byWallet = groupByWallet(rows.map(toEvidenceLike))

  // Wallets with zero evidence still belong in the candidate set — their
  // absence from the graph is itself a finding, not a reason to drop them.
  for (const w of wallets.map((w) => w.toLowerCase())) {
    if (!byWallet.has(w)) byWallet.set(w, [])
  }

  const edges = buildEdges(byWallet, {
    edgeThreshold: env.EDGE_THRESHOLD,
    fundingWindowHours: env.FUNDING_WINDOW_HOURS,
  })
  const clusters = clusterWallets(edges, { minClusterSize: env.MIN_CLUSTER_SIZE })

  const clustered = new Set(clusters.flatMap((c) => c.wallets))
  const unclustered = [...byWallet.keys()].filter((w) => !clustered.has(w)).sort()

  logger.debug(
    { candidates: byWallet.size, edges: edges.length, clusters: clusters.length },
    'built behavior graph',
  )

  return { clusters, unclustered, edgeCount: edges.length }
}

/**
 * Writes detected clusters and points their member wallets at them.
 *
 * `score` is left at 0 here. Phase 8 owns scoring, and writing a placeholder
 * that looks like a real score is exactly the kind of confident invented number
 * Section 0.2 rule 4 exists to prevent.
 *
 * Runs in a transaction so a wallet is never left pointing at a half-written
 * cluster.
 */
export async function persistClusters(clusters: DetectedCluster[]): Promise<string[]> {
  const ids: string[] = []

  for (const c of clusters) {
    const id = await prisma.$transaction(async (tx) => {
      const cluster = await tx.cluster.create({
        data: { confidence: c.confidence, score: 0 },
      })
      for (const wallet of c.wallets) {
        await tx.wallet.upsert({
          where: { address: wallet },
          create: { address: wallet, clusterId: cluster.id },
          update: { clusterId: cluster.id },
        })
      }
      return cluster.id
    })
    ids.push(id)
  }

  if (ids.length > 0) {
    logger.info({ clusters: ids.length }, 'persisted clusters')
  }
  return ids
}
