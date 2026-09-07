/**
 * Clustering — Backend-Suganthan.md Phase 6.
 *
 * Union-find over the Phase 6 edge list. Each connected component of size
 * >= MIN_CLUSTER_SIZE becomes a Cluster.
 *
 * The cluster is the unit of analysis (Section 0.2 rule 6): a single wallet's
 * score is meaningless outside its cluster, and Phase 8 re-scores all five
 * features at cluster level rather than averaging pairwise numbers.
 *
 * Pure — no database. `persistClusters` in ./repository.ts writes the result.
 */
import type { GraphEdge } from './pairwise.js'

/**
 * Union-find with path compression and union by size.
 *
 * Near-linear, but the reason it is used here is not speed: connected
 * components are *transitive*, and transitivity is the property that catches a
 * Sybil ring. If A shares a funder with B, and B shares counterparties with C,
 * then A and C are in one cluster even though no direct A-C edge exists. A
 * pairwise-only view would miss exactly the structure being hunted.
 */
export class UnionFind {
  private parent = new Map<string, string>()
  private size = new Map<string, number>()

  add(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x)
      this.size.set(x, 1)
    }
  }

  find(x: string): string {
    this.add(x)
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)!
    // Path compression: flatten the walked chain onto the root.
    let cur = x
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    const [big, small] = (this.size.get(ra) ?? 1) >= (this.size.get(rb) ?? 1) ? [ra, rb] : [rb, ra]
    this.parent.set(small, big)
    this.size.set(big, (this.size.get(big) ?? 1) + (this.size.get(small) ?? 1))
  }

  /** Components as sorted member lists, deterministically ordered. */
  components(): string[][] {
    const groups = new Map<string, string[]>()
    for (const x of this.parent.keys()) {
      const root = this.find(x)
      const g = groups.get(root)
      if (g) g.push(x)
      else groups.set(root, [x])
    }
    return [...groups.values()]
      .map((g) => g.sort())
      .sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!))
  }
}

export type ClusterConfidence = 'LOW' | 'MEDIUM' | 'HIGH'

export interface DetectedCluster {
  wallets: string[]
  edges: GraphEdge[]
  confidence: ClusterConfidence
  /** Mean score of the edges inside this component. */
  meanEdgeScore: number
  /** Share of possible internal pairs that actually have an edge, 0..1. */
  density: number
}

/**
 * Confidence in the cluster's *existence*, not its riskiness.
 *
 * Two things make a detected group trustworthy: the edges are strong, and the
 * group is densely connected rather than a chain of weak links. A five-wallet
 * component held together by four barely-threshold edges is a much weaker claim
 * than five wallets where every pair is linked, even at the same mean score —
 * so density is weighed, not just edge strength.
 *
 * Phase 8 assigns the risk SCORE. This is how much to trust that the cluster is
 * real at all.
 */
export function clusterConfidence(meanEdgeScore: number, density: number): ClusterConfidence {
  if (meanEdgeScore >= 0.9 && density >= 0.75) return 'HIGH'
  if (meanEdgeScore >= 0.7 || density >= 0.5) return 'MEDIUM'
  return 'LOW'
}

/**
 * Groups wallets into clusters from an edge list.
 *
 * Wallets with no qualifying edge form no cluster: they are unclustered, and
 * `getOrComputeClusterRisk` returns `clusterId: null` for them. Manufacturing a
 * singleton cluster would make "is this wallet in a cluster" meaningless.
 */
export function clusterWallets(
  edges: readonly GraphEdge[],
  opts: { minClusterSize: number },
): DetectedCluster[] {
  const uf = new UnionFind()
  for (const e of edges) uf.union(e.a, e.b)

  const edgesByRoot = new Map<string, GraphEdge[]>()
  for (const e of edges) {
    const root = uf.find(e.a)
    const list = edgesByRoot.get(root)
    if (list) list.push(e)
    else edgesByRoot.set(root, [e])
  }

  const clusters: DetectedCluster[] = []
  for (const wallets of uf.components()) {
    if (wallets.length < opts.minClusterSize) continue

    const root = uf.find(wallets[0]!)
    const memberEdges = edgesByRoot.get(root) ?? []
    const meanEdgeScore =
      memberEdges.length === 0
        ? 0
        : memberEdges.reduce((sum, e) => sum + e.score, 0) / memberEdges.length

    const possiblePairs = (wallets.length * (wallets.length - 1)) / 2
    const density = possiblePairs === 0 ? 0 : memberEdges.length / possiblePairs

    clusters.push({
      wallets,
      edges: memberEdges,
      meanEdgeScore,
      density,
      confidence: clusterConfidence(meanEdgeScore, density),
    })
  }
  return clusters
}
