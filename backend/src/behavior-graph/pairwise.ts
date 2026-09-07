/**
 * Pairwise wallet relationships — Backend-Suganthan.md Phase 6.
 *
 * Two signals decide whether an edge exists between a pair of wallets:
 * FUNDING_CORRELATION and SHARED_COUNTERPARTY. Phase 7 defines all five
 * features at the CLUSTER level; these are the pairwise forms used to build
 * the graph the clusters come from.
 *
 * The two-pass shape — pairwise edges first, cluster-level re-scoring second —
 * is what keeps the final score explainable. A single opaque similarity number
 * could not be broken down for an Evidence Receipt.
 *
 * Everything here is pure. No database, no network, no clock.
 */
import type { EvidenceEvent } from '@prisma/client'

/** The subset of an EvidenceEvent these calculations read. */
export interface EvidenceLike {
  wallet: string
  counterparty: string | null
  eventType: string
  timestamp: Date
  blockNumber: bigint
  amount: string | null
}

export type EvidenceByWallet = Map<string, EvidenceLike[]>

/** Groups events by wallet, preserving chronological order within each. */
export function groupByWallet(events: readonly EvidenceLike[]): EvidenceByWallet {
  const out: EvidenceByWallet = new Map()
  for (const e of events) {
    const list = out.get(e.wallet)
    if (list) list.push(e)
    else out.set(e.wallet, [e])
  }
  for (const list of out.values()) {
    list.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
      return a.timestamp.getTime() - b.timestamp.getTime()
    })
  }
  return out
}

/**
 * The address that first sent this wallet anything, and when.
 *
 * Only inbound transfers count: `counterparty` on a transfer row the wallet
 * received. `FUNDING_LOOKBACK_HOPS` is 1 by default — the direct funder only.
 * Walking further back is a real graph traversal and the spec says not to reach
 * for it until direct-funder correlation proves insufficient.
 *
 * Returns null when the wallet has no inbound transfer evidence, which callers
 * must treat as "unknown" rather than "unfunded".
 */
export function earliestFunder(events: readonly EvidenceLike[]): {
  funder: string
  at: Date
} | null {
  let best: { funder: string; at: Date } | null = null
  for (const e of events) {
    if (e.eventType !== 'transfer' || !e.counterparty) continue
    if (best === null || e.timestamp < best.at) {
      best = { funder: e.counterparty, at: e.timestamp }
    }
  }
  return best
}

/**
 * Do these two wallets share a funder, within the configured window?
 *
 * Binary rather than graded: either the same address bankrolled both inside the
 * window or it did not. The graded version is the cluster-level
 * FUNDING_CORRELATION in Phase 7, which measures how much of a *set* shares one
 * funder.
 */
export function sharesFunder(
  a: readonly EvidenceLike[],
  b: readonly EvidenceLike[],
  windowHours: number,
): boolean {
  const fa = earliestFunder(a)
  const fb = earliestFunder(b)
  if (!fa || !fb) return false
  if (fa.funder !== fb.funder) return false
  const hours = Math.abs(fa.at.getTime() - fb.at.getTime()) / 3_600_000
  return hours <= windowHours
}

/** Distinct counterparties a wallet has touched, in any event type. */
export function counterpartySet(events: readonly EvidenceLike[]): Set<string> {
  const out = new Set<string>()
  for (const e of events) if (e.counterparty) out.add(e.counterparty)
  return out
}

/**
 * Jaccard similarity of two counterparty sets: |A ∩ B| / |A ∪ B|.
 *
 * Two empty sets score 0, not 1. Set theory would say the empty intersection
 * over the empty union is undefined, and treating "we know nothing about either
 * wallet" as perfect similarity would wire every evidence-free wallet into one
 * giant cluster — the worst possible failure for a Sybil firewall.
 */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const v of small) if (large.has(v)) intersection++
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

export interface PairScore {
  fundingCorrelation: number
  sharedCounterparty: number
  /** The value compared against EDGE_THRESHOLD. */
  score: number
}

/**
 * Scores one pair.
 *
 * The pair's score is the MAXIMUM of the two signals, not their average. They
 * are independent evidence of coordination: wallets funded by one address
 * minutes apart are related even if they later touch entirely different
 * protocols, and averaging would let a strong signal be diluted below the
 * threshold by an unrelated weak one.
 */
export function scorePair(
  a: readonly EvidenceLike[],
  b: readonly EvidenceLike[],
  opts: { fundingWindowHours: number },
): PairScore {
  const fundingCorrelation = sharesFunder(a, b, opts.fundingWindowHours) ? 1 : 0
  const sharedCounterparty = jaccard(counterpartySet(a), counterpartySet(b))
  return {
    fundingCorrelation,
    sharedCounterparty,
    score: Math.max(fundingCorrelation, sharedCounterparty),
  }
}

export interface GraphEdge {
  a: string
  b: string
  score: number
  fundingCorrelation: number
  sharedCounterparty: number
}

/**
 * Builds the edge list over a candidate wallet set.
 *
 * O(n²) in the number of wallets, which is correct for a campaign-sized
 * candidate set. If that ever becomes the bottleneck, the fix is blocking on
 * shared funder before the pairwise sweep — not a cheaper similarity measure.
 */
export function buildEdges(
  byWallet: EvidenceByWallet,
  opts: { edgeThreshold: number; fundingWindowHours: number },
): GraphEdge[] {
  const wallets = [...byWallet.keys()].sort()
  const edges: GraphEdge[] = []

  for (let i = 0; i < wallets.length; i++) {
    for (let j = i + 1; j < wallets.length; j++) {
      const a = wallets[i]!
      const b = wallets[j]!
      const s = scorePair(byWallet.get(a)!, byWallet.get(b)!, opts)
      if (s.score >= opts.edgeThreshold) {
        edges.push({
          a,
          b,
          score: s.score,
          fundingCorrelation: s.fundingCorrelation,
          sharedCounterparty: s.sharedCounterparty,
        })
      }
    }
  }
  return edges
}

/** Narrows a Prisma row to what these functions read. */
export function toEvidenceLike(row: EvidenceEvent): EvidenceLike {
  return {
    wallet: row.wallet,
    counterparty: row.counterparty,
    eventType: row.eventType,
    timestamp: row.timestamp,
    blockNumber: row.blockNumber,
    amount: row.amount,
  }
}
