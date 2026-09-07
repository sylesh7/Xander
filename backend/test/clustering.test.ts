import { describe, expect, it } from 'vitest'
import { UnionFind, clusterConfidence, clusterWallets } from '../src/behavior-graph/clustering.js'
import {
  buildEdges,
  counterpartySet,
  earliestFunder,
  groupByWallet,
  jaccard,
  scorePair,
  sharesFunder,
  type EvidenceLike,
} from '../src/behavior-graph/pairwise.js'

const OPTS = { edgeThreshold: 0.5, fundingWindowHours: 24 }
const T0 = new Date('2026-01-01T00:00:00Z')
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

const ev = (over: Partial<EvidenceLike> & { wallet: string }): EvidenceLike => ({
  counterparty: null,
  eventType: 'transfer',
  timestamp: T0,
  blockNumber: 1n,
  amount: '1',
  ...over,
})

/** Phase 12 scenario B: 5 wallets, one funder, tight window. */
function coordinatedSet(): EvidenceLike[] {
  return ['w1', 'w2', 'w3', 'w4', 'w5'].flatMap((w, i) => [
    ev({ wallet: w, counterparty: 'funder', timestamp: at(i), blockNumber: BigInt(100 + i) }),
    ev({
      wallet: w,
      counterparty: 'market-a',
      eventType: 'deposit',
      timestamp: at(60 + i),
      blockNumber: BigInt(200 + i),
    }),
  ])
}

/** Phase 12 scenario A: 5 unrelated wallets. */
function unrelatedSet(): EvidenceLike[] {
  return ['u1', 'u2', 'u3', 'u4', 'u5'].flatMap((w, i) => [
    ev({
      wallet: w,
      counterparty: `funder-${i}`,
      timestamp: at(i * 60 * 24 * 30),
      blockNumber: BigInt(1000 + i * 5000),
    }),
    ev({
      wallet: w,
      counterparty: `market-${i}`,
      eventType: 'deposit',
      timestamp: at(i * 60 * 24 * 30 + 10),
      blockNumber: BigInt(1001 + i * 5000),
    }),
  ])
}

describe('earliestFunder', () => {
  it('returns the first inbound transfer counterparty', () => {
    const f = earliestFunder([
      ev({ wallet: 'w', counterparty: 'late', timestamp: at(100) }),
      ev({ wallet: 'w', counterparty: 'early', timestamp: at(1) }),
    ])
    expect(f?.funder).toBe('early')
  })

  it('ignores non-transfer events — a deposit is not funding', () => {
    const f = earliestFunder([
      ev({ wallet: 'w', counterparty: 'market', eventType: 'deposit', timestamp: at(1) }),
      ev({ wallet: 'w', counterparty: 'realfunder', timestamp: at(5) }),
    ])
    expect(f?.funder).toBe('realfunder')
  })

  it('returns null when there is no inbound evidence', () => {
    // "unknown", not "unfunded".
    expect(earliestFunder([])).toBeNull()
  })
})

describe('jaccard', () => {
  it('scores identical sets 1', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
  })

  it('scores disjoint sets 0', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0)
  })

  it('scores half-overlap correctly', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3)
  })

  it('scores two EMPTY sets 0, not 1', () => {
    // Treating "we know nothing about either wallet" as perfect similarity
    // would wire every evidence-free wallet into one giant cluster.
    expect(jaccard(new Set(), new Set())).toBe(0)
  })

  it('is symmetric', () => {
    const a = new Set(['a', 'b', 'c'])
    const b = new Set(['b', 'c', 'd', 'e'])
    expect(jaccard(a, b)).toBe(jaccard(b, a))
  })
})

describe('scorePair', () => {
  it('takes the MAX of the two signals, not the average', () => {
    // Wallets funded by one address minutes apart are related even if they
    // later touch entirely different protocols. Averaging would dilute a
    // conclusive funding signal below threshold with an unrelated weak one.
    const a = [ev({ wallet: 'a', counterparty: 'f', timestamp: at(0) })]
    const b = [ev({ wallet: 'b', counterparty: 'f', timestamp: at(5) })]
    const s = scorePair(a, b, { fundingWindowHours: 24 })
    expect(s.fundingCorrelation).toBe(1)
    expect(s.sharedCounterparty).toBe(1)
    expect(s.score).toBe(1)

    const c = [
      ev({ wallet: 'c', counterparty: 'f', timestamp: at(0) }),
      ev({ wallet: 'c', counterparty: 'x1', eventType: 'deposit' }),
      ev({ wallet: 'c', counterparty: 'x2', eventType: 'deposit' }),
    ]
    const d = [
      ev({ wallet: 'd', counterparty: 'f', timestamp: at(5) }),
      ev({ wallet: 'd', counterparty: 'y1', eventType: 'deposit' }),
      ev({ wallet: 'd', counterparty: 'y2', eventType: 'deposit' }),
    ]
    const s2 = scorePair(c, d, { fundingWindowHours: 24 })
    expect(s2.fundingCorrelation).toBe(1)
    expect(s2.sharedCounterparty).toBeLessThan(0.5)
    expect(s2.score).toBe(1) // max, so the funding signal survives
  })
})

describe('sharesFunder respects the window', () => {
  it('links wallets funded minutes apart', () => {
    const a = [ev({ wallet: 'a', counterparty: 'f', timestamp: at(0) })]
    const b = [ev({ wallet: 'b', counterparty: 'f', timestamp: at(30) })]
    expect(sharesFunder(a, b, 24)).toBe(true)
  })

  it('does not link the same funder years apart', () => {
    // A busy exchange hot wallet funds thousands of unrelated people.
    const a = [ev({ wallet: 'a', counterparty: 'exchange', timestamp: at(0) })]
    const b = [ev({ wallet: 'b', counterparty: 'exchange', timestamp: at(60 * 24 * 400) })]
    expect(sharesFunder(a, b, 24)).toBe(false)
  })
})

describe('UnionFind', () => {
  it('is transitive — this is why components, not pairs', () => {
    // A-B and B-C linked means A and C are one cluster with no direct A-C edge.
    // A pairwise-only view misses exactly the ring structure being hunted.
    const uf = new UnionFind()
    uf.union('a', 'b')
    uf.union('b', 'c')
    expect(uf.find('a')).toBe(uf.find('c'))
    expect(uf.components()).toEqual([['a', 'b', 'c']])
  })

  it('keeps disjoint groups apart', () => {
    const uf = new UnionFind()
    uf.union('a', 'b')
    uf.union('c', 'd')
    expect(uf.components()).toHaveLength(2)
  })

  it('returns components largest first, deterministically', () => {
    const uf = new UnionFind()
    uf.union('c', 'd')
    uf.union('a', 'b')
    uf.union('b', 'z')
    const comps = uf.components()
    expect(comps[0]).toEqual(['a', 'b', 'z'])
    expect(comps[1]).toEqual(['c', 'd'])
  })
})

describe('clusterConfidence', () => {
  it('needs strong edges AND density for HIGH', () => {
    expect(clusterConfidence(0.95, 0.9)).toBe('HIGH')
    // Strong edges but a sparse chain is a weaker claim than it looks.
    expect(clusterConfidence(0.95, 0.3)).toBe('MEDIUM')
  })

  it('falls to LOW for weak, sparse groups', () => {
    expect(clusterConfidence(0.5, 0.2)).toBe('LOW')
  })
})

describe('THE PHASE 6 ACCEPTANCE TEST', () => {
  it('5 wallets sharing a funder in a tight window form ONE cluster', () => {
    const byWallet = groupByWallet(coordinatedSet())
    const edges = buildEdges(byWallet, OPTS)
    const clusters = clusterWallets(edges, { minClusterSize: 2 })

    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.wallets).toEqual(['w1', 'w2', 'w3', 'w4', 'w5'])
    // Every pair is linked, so this is a fully dense component.
    expect(clusters[0]!.density).toBe(1)
    expect(clusters[0]!.confidence).toBe('HIGH')
  })

  it('5 unrelated wallets form NO cluster', () => {
    const byWallet = groupByWallet(unrelatedSet())
    const edges = buildEdges(byWallet, OPTS)
    const clusters = clusterWallets(edges, { minClusterSize: 2 })

    expect(edges).toHaveLength(0)
    expect(clusters).toHaveLength(0)
  })

  it('separates a coordinated ring from unrelated wallets in one mixed run', () => {
    const byWallet = groupByWallet([...coordinatedSet(), ...unrelatedSet()])
    const clusters = clusterWallets(buildEdges(byWallet, OPTS), { minClusterSize: 2 })
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.wallets).toHaveLength(5)
    expect(clusters[0]!.wallets.every((w) => w.startsWith('w'))).toBe(true)
  })
})

describe('cluster formation rules', () => {
  it('produces no singleton clusters', () => {
    // An unclustered wallet gets clusterId: null. A singleton "cluster" would
    // make "is this wallet in a cluster" meaningless.
    const byWallet = groupByWallet([ev({ wallet: 'lonely', counterparty: 'f' })])
    const clusters = clusterWallets(buildEdges(byWallet, OPTS), { minClusterSize: 2 })
    expect(clusters).toHaveLength(0)
  })

  it('honours MIN_CLUSTER_SIZE', () => {
    const edges = buildEdges(groupByWallet(coordinatedSet()), OPTS)
    expect(clusterWallets(edges, { minClusterSize: 6 })).toHaveLength(0)
    expect(clusterWallets(edges, { minClusterSize: 5 })).toHaveLength(1)
  })

  it('links a chain transitively even without direct edges', () => {
    // a-b linked by a shared funder. b-c linked by counterparty overlap
    // (2 shared of 4 union = 0.5, exactly the threshold). a-c share nothing:
    // different funders, zero counterparty overlap. So a and c land in one
    // cluster purely through b.
    const events: EvidenceLike[] = [
      ev({ wallet: 'a', counterparty: 'f1', timestamp: at(0) }),
      ev({ wallet: 'b', counterparty: 'f1', timestamp: at(1) }),
      ev({ wallet: 'b', counterparty: 's1', eventType: 'deposit' }),
      ev({ wallet: 'b', counterparty: 's2', eventType: 'deposit' }),
      ev({ wallet: 'c', counterparty: 's1', eventType: 'deposit' }),
      ev({ wallet: 'c', counterparty: 's2', eventType: 'deposit' }),
      ev({ wallet: 'c', counterparty: 'f2', timestamp: at(9999) }),
    ]
    const clusters = clusterWallets(buildEdges(groupByWallet(events), OPTS), {
      minClusterSize: 2,
    })
    expect(clusters).toHaveLength(1)
    expect(clusters[0]!.wallets).toEqual(['a', 'b', 'c'])
    // Not fully connected, so confidence is below HIGH despite strong edges.
    expect(clusters[0]!.density).toBeLessThan(1)
  })

  it('does not cluster wallets with no evidence at all', () => {
    const byWallet = groupByWallet([])
    byWallet.set('empty1', [])
    byWallet.set('empty2', [])
    expect(buildEdges(byWallet, OPTS)).toHaveLength(0)
  })

  it('is deterministic across input orderings', () => {
    const forward = coordinatedSet()
    const reversed = [...forward].reverse()
    const a = clusterWallets(buildEdges(groupByWallet(forward), OPTS), { minClusterSize: 2 })
    const b = clusterWallets(buildEdges(groupByWallet(reversed), OPTS), { minClusterSize: 2 })
    expect(a[0]!.wallets).toEqual(b[0]!.wallets)
    expect(a[0]!.confidence).toBe(b[0]!.confidence)
  })
})

describe('counterpartySet', () => {
  it('collects distinct counterparties across event types', () => {
    const s = counterpartySet([
      ev({ wallet: 'w', counterparty: 'a' }),
      ev({ wallet: 'w', counterparty: 'a', eventType: 'deposit' }),
      ev({ wallet: 'w', counterparty: 'b', eventType: 'borrow' }),
      ev({ wallet: 'w', counterparty: null }),
    ])
    expect([...s].sort()).toEqual(['a', 'b'])
  })
})
