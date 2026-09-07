import { describe, expect, it } from 'vitest'
import {
  extractFeatures,
  fundingCorrelation,
  largestWindowCluster,
  lcsLength,
  protocolBehaviorSimilarity,
  sharedCounterparty,
  spreadSimilarity,
  stddev,
  timingCorrelation,
  walletAgeSimilarity,
} from '../src/risk/features.js'
import { FEATURE_NAMES } from '../src/risk/types.js'
import type { EvidenceWindow, FeatureOptions, RiskEvidenceRow } from '../src/risk/types.js'

const OPTS: FeatureOptions = {
  fundingWindowHours: 24,
  timingNormalizationSeconds: 3600,
  ageNormalizationBlocks: 50_000,
  protocolSequenceMaxLength: 200,
}

const T0 = new Date('2026-01-01T00:00:00Z').getTime()
const at = (minutes: number) => new Date(T0 + minutes * 60_000)

let seq = 0
const row = (over: Partial<RiskEvidenceRow> & { wallet: string }): RiskEvidenceRow => ({
  id: `ev-${++seq}`,
  counterparty: null,
  eventType: 'transfer',
  timestamp: T0 ? at(0) : new Date(),
  blockNumber: 1000n,
  ...over,
})

const win = (events: RiskEvidenceRow[]): EvidenceWindow => ({ events })

/** 5 wallets, one funder, funded minutes apart, same protocol path. */
function coordinated(): { wallets: string[]; window: EvidenceWindow } {
  const wallets = ['w1', 'w2', 'w3', 'w4', 'w5']
  const events = wallets.flatMap((w, i) => [
    row({ wallet: w, counterparty: 'funder', timestamp: at(i), blockNumber: BigInt(1000 + i) }),
    row({
      wallet: w,
      counterparty: 'market-a',
      eventType: 'deposit',
      timestamp: at(60 + i),
      blockNumber: BigInt(1100 + i),
    }),
    row({
      wallet: w,
      counterparty: 'market-a',
      eventType: 'borrow',
      timestamp: at(70 + i),
      blockNumber: BigInt(1110 + i),
    }),
  ])
  return { wallets, window: win(events) }
}

/** 5 wallets, different funders, months apart, different protocols. */
function unrelated(): { wallets: string[]; window: EvidenceWindow } {
  const wallets = ['u1', 'u2', 'u3', 'u4', 'u5']
  const events = wallets.flatMap((w, i) => [
    row({
      wallet: w,
      counterparty: `funder-${i}`,
      timestamp: at(i * 60 * 24 * 60),
      blockNumber: BigInt(100_000 + i * 400_000),
    }),
    row({
      wallet: w,
      counterparty: `venue-${i}`,
      eventType: i % 2 === 0 ? 'swap' : 'repay',
      timestamp: at(i * 60 * 24 * 60 + 5),
      blockNumber: BigInt(100_010 + i * 400_000),
    }),
  ])
  return { wallets, window: win(events) }
}

describe('maths helpers', () => {
  it('stddev is 0 for fewer than two samples', () => {
    expect(stddev([])).toBe(0)
    expect(stddev([5])).toBe(0)
  })

  it('stddev of identical values is 0', () => {
    expect(stddev([3, 3, 3])).toBe(0)
  })

  it('spreadSimilarity clamps at 0 rather than going negative', () => {
    expect(spreadSimilarity(10_000, 3600)).toBe(0)
    expect(spreadSimilarity(0, 3600)).toBe(1)
    expect(spreadSimilarity(1800, 3600)).toBeCloseTo(0.5)
  })

  it('largestWindowCluster finds the densest burst, not the total count', () => {
    // One funder, three wallets in a burst plus two stragglers years later.
    const h = 3_600_000
    const times = [0, 1 * h, 2 * h, 8000 * h, 9000 * h]
    expect(largestWindowCluster(times, 24 * h)).toBe(3)
  })

  it('lcsLength allows gaps — subsequence, not substring', () => {
    expect(lcsLength(['a', 'x', 'b', 'c'], ['a', 'b', 'c'])).toBe(3)
  })

  it('lcsLength is 0 for an empty sequence', () => {
    expect(lcsLength([], ['a'])).toBe(0)
  })

  it('lcsLength is symmetric', () => {
    const a = ['deposit', 'borrow', 'repay', 'withdraw']
    const b = ['deposit', 'swap', 'borrow', 'repay']
    expect(lcsLength(a, b)).toBe(lcsLength(b, a))
  })
})

describe('every extractor guards a single-wallet set', () => {
  // Without this, stddev of one sample is 0 and spreadSimilarity turns that
  // into a perfect 1.0 — a lone wallet scoring maximum coordination with itself.
  const single = ['solo']
  const w = win([row({ wallet: 'solo', counterparty: 'f' })])

  for (const fn of [
    fundingCorrelation,
    timingCorrelation,
    walletAgeSimilarity,
    sharedCounterparty,
    protocolBehaviorSimilarity,
  ]) {
    it(`${fn.name} returns 0 / LOW`, () => {
      const r = fn(single, w, OPTS)
      expect(r.value).toBe(0)
      expect(r.confidence).toBe('LOW')
    })
  }
})

describe('FUNDING_CORRELATION', () => {
  it('scores 1.0 when every wallet shares one funder in the window', () => {
    const { wallets, window } = coordinated()
    const r = fundingCorrelation(wallets, window, OPTS)
    expect(r.value).toBe(1)
    expect(r.confidence).toBe('HIGH')
    expect(r.sourceEvidenceIds.length).toBe(5)
  })

  it('scores 0 when every wallet has a different funder', () => {
    const { wallets, window } = unrelated()
    expect(fundingCorrelation(wallets, window, OPTS).value).toBe(0)
  })

  it('scales with the size of the shared-funder group', () => {
    // 3 of 5 share a funder: (3-1)/(5-1) = 0.5
    const wallets = ['a', 'b', 'c', 'd', 'e']
    const window = win([
      row({ wallet: 'a', counterparty: 'shared', timestamp: at(0) }),
      row({ wallet: 'b', counterparty: 'shared', timestamp: at(10) }),
      row({ wallet: 'c', counterparty: 'shared', timestamp: at(20) }),
      row({ wallet: 'd', counterparty: 'other-1', timestamp: at(0) }),
      row({ wallet: 'e', counterparty: 'other-2', timestamp: at(0) }),
    ])
    expect(fundingCorrelation(wallets, window, OPTS).value).toBeCloseTo(0.5)
  })

  it('ignores a shared funder outside the time window', () => {
    // A busy exchange hot wallet funds thousands of unrelated people over years.
    const wallets = ['a', 'b']
    const window = win([
      row({ wallet: 'a', counterparty: 'exchange', timestamp: at(0) }),
      row({ wallet: 'b', counterparty: 'exchange', timestamp: at(60 * 24 * 400) }),
    ])
    expect(fundingCorrelation(wallets, window, OPTS).value).toBe(0)
  })

  it('does not count a deposit as funding', () => {
    const wallets = ['a', 'b']
    const window = win([
      row({ wallet: 'a', counterparty: 'market', eventType: 'deposit', timestamp: at(0) }),
      row({ wallet: 'b', counterparty: 'market', eventType: 'deposit', timestamp: at(1) }),
    ])
    const r = fundingCorrelation(wallets, window, OPTS)
    expect(r.value).toBe(0)
    expect(r.note).toMatch(/no inbound transfer evidence/)
  })

  it('reports LOW confidence when few wallets have funding evidence', () => {
    const wallets = ['a', 'b', 'c', 'd', 'e']
    const window = win([
      row({ wallet: 'a', counterparty: 'f', timestamp: at(0) }),
      row({ wallet: 'b', counterparty: 'f', timestamp: at(1) }),
    ])
    const r = fundingCorrelation(wallets, window, OPTS)
    // Value looks meaningful but rests on 2 of 5 wallets — the receipt must say so.
    expect(r.value).toBeCloseTo(0.25)
    expect(r.confidence).toBe('LOW')
    expect(r.note).toMatch(/2\/5/)
  })
})

describe('TIMING_CORRELATION', () => {
  it('scores near 1 for wallets acting minutes apart', () => {
    const { wallets, window } = coordinated()
    expect(timingCorrelation(wallets, window, OPTS).value).toBeGreaterThan(0.9)
  })

  it('scores 0 for wallets acting months apart', () => {
    const { wallets, window } = unrelated()
    expect(timingCorrelation(wallets, window, OPTS).value).toBe(0)
  })

  it('uses first activity, not last', () => {
    // Same arrival, wildly different later behaviour: still coordinated arrival.
    const wallets = ['a', 'b']
    const window = win([
      row({ wallet: 'a', timestamp: at(0) }),
      row({ wallet: 'a', eventType: 'swap', timestamp: at(100_000) }),
      row({ wallet: 'b', timestamp: at(1) }),
    ])
    expect(timingCorrelation(wallets, window, OPTS).value).toBeGreaterThan(0.9)
  })
})

describe('WALLET_AGE_SIMILARITY', () => {
  it('scores near 1 for wallets first seen in adjacent blocks', () => {
    const { wallets, window } = coordinated()
    expect(walletAgeSimilarity(wallets, window, OPTS).value).toBeGreaterThan(0.99)
  })

  it('scores 0 for wallets hundreds of thousands of blocks apart', () => {
    const { wallets, window } = unrelated()
    expect(walletAgeSimilarity(wallets, window, OPTS).value).toBe(0)
  })

  it('stays in block space, so a cross-chain cluster is not distorted', () => {
    // Polygon blocks are ~2s and mainnet ~12s. Converting to wall-clock via one
    // average-block-time constant would silently corrupt this comparison.
    const wallets = ['a', 'b']
    const window = win([
      row({ wallet: 'a', blockNumber: 21_000_000n, timestamp: at(0) }),
      row({ wallet: 'b', blockNumber: 21_000_010n, timestamp: at(0) }),
    ])
    expect(walletAgeSimilarity(wallets, window, OPTS).value).toBeGreaterThan(0.99)
  })
})

describe('SHARED_COUNTERPARTY', () => {
  it('scores 1 when every wallet touches exactly the same counterparties', () => {
    const { wallets, window } = coordinated()
    expect(sharedCounterparty(wallets, window, OPTS).value).toBe(1)
  })

  it('scores 0 for disjoint counterparties', () => {
    const { wallets, window } = unrelated()
    expect(sharedCounterparty(wallets, window, OPTS).value).toBe(0)
  })

  it('averages over ALL pairs, including empty ones', () => {
    // Skipping empty pairs would let a cluster of mostly-unknown wallets
    // inherit the score of its one well-documented pair.
    const wallets = ['a', 'b', 'c']
    const window = win([
      row({ wallet: 'a', counterparty: 'x' }),
      row({ wallet: 'b', counterparty: 'x' }),
      // c has no evidence at all
    ])
    // pairs: a-b = 1, a-c = 0, b-c = 0  ->  1/3
    expect(sharedCounterparty(wallets, window, OPTS).value).toBeCloseTo(1 / 3)
  })

  it('cites the evidence behind the overlap', () => {
    const wallets = ['a', 'b']
    const window = win([
      row({ wallet: 'a', counterparty: 'shared' }),
      row({ wallet: 'b', counterparty: 'shared' }),
    ])
    expect(sharedCounterparty(wallets, window, OPTS).sourceEvidenceIds).toHaveLength(2)
  })
})

describe('PROTOCOL_BEHAVIOR_SIMILARITY', () => {
  it('scores 1 for wallets running an identical event sequence', () => {
    const { wallets, window } = coordinated()
    expect(protocolBehaviorSimilarity(wallets, window, OPTS).value).toBe(1)
  })

  it('still scores high on SHORT divergent sequences — but flags it', () => {
    // A real property of the formula, not a bug: with two-event sequences drawn
    // from a seven-value vocabulary, two wallets that both open with a transfer
    // already score 0.5 by coincidence. The value stays as the spec defines it;
    // the weakness surfaces as reduced confidence.
    const { wallets, window } = unrelated()
    const r = protocolBehaviorSimilarity(wallets, window, OPTS)
    expect(r.value).toBeGreaterThan(0.5)
    expect(r.confidence).not.toBe('HIGH')
    expect(r.note).toMatch(/weakly evidenced/)
  })

  it('scores low for divergent sequences that are long enough to mean something', () => {
    const mk = (w: string, types: string[]) =>
      types.map((t, i) => row({ wallet: w, eventType: t, blockNumber: BigInt(i + 1) }))
    const window = win([
      ...mk('a', ['deposit', 'deposit', 'borrow', 'repay', 'withdraw', 'withdraw']),
      ...mk('b', ['swap', 'swap', 'swap', 'transfer', 'swap', 'transfer']),
    ])
    const r = protocolBehaviorSimilarity(['a', 'b'], window, OPTS)
    expect(r.value).toBeLessThan(0.4)
    expect(r.confidence).toBe('HIGH')
  })

  it('divides by the LONGER sequence so a prefix does not score 1.0', () => {
    // 'a' is a strict prefix of 'b'. Dividing by the shorter would say these
    // wallets behave identically, which they do not.
    const wallets = ['a', 'b']
    const window = win([
      row({ wallet: 'a', eventType: 'deposit', blockNumber: 1n }),
      row({ wallet: 'b', eventType: 'deposit', blockNumber: 1n }),
      row({ wallet: 'b', eventType: 'borrow', blockNumber: 2n }),
      row({ wallet: 'b', eventType: 'repay', blockNumber: 3n }),
      row({ wallet: 'b', eventType: 'withdraw', blockNumber: 4n }),
    ])
    expect(protocolBehaviorSimilarity(wallets, window, OPTS).value).toBeCloseTo(0.25)
  })

  it('respects order — the same events in a different order score lower', () => {
    const wallets = ['a', 'b']
    const mk = (w: string, types: string[]) =>
      types.map((t, i) => row({ wallet: w, eventType: t, blockNumber: BigInt(i + 1) }))
    const window = win([
      ...mk('a', ['deposit', 'borrow', 'repay', 'withdraw']),
      ...mk('b', ['withdraw', 'repay', 'borrow', 'deposit']),
    ])
    expect(protocolBehaviorSimilarity(wallets, window, OPTS).value).toBeLessThan(0.5)
  })

  it('truncates long sequences, keeping the EARLIEST events', () => {
    // A ring's tell is a shared setup sequence, not a shared tail.
    const capped: FeatureOptions = { ...OPTS, protocolSequenceMaxLength: 3 }
    const wallets = ['a', 'b']
    const window = win([
      ...['deposit', 'borrow', 'repay', 'swap', 'swap'].map((t, i) =>
        row({ wallet: 'a', eventType: t, blockNumber: BigInt(i + 1) }),
      ),
      ...['deposit', 'borrow', 'repay', 'withdraw', 'withdraw'].map((t, i) =>
        row({ wallet: 'b', eventType: t, blockNumber: BigInt(i + 1) }),
      ),
    ])
    expect(protocolBehaviorSimilarity(wallets, window, capped).value).toBe(1)
    expect(protocolBehaviorSimilarity(wallets, window, OPTS).value).toBeLessThan(1)
  })
})

describe('THE PHASE 7 ACCEPTANCE TEST', () => {
  it('each extractor is pure — same input, same output, no side effects', () => {
    const { wallets, window } = coordinated()
    const a = extractFeatures(wallets, window, OPTS)
    const b = extractFeatures(wallets, window, OPTS)
    expect(a.map((f) => f.value)).toEqual(b.map((f) => f.value))
  })

  it('returns { value, confidence, sourceEvidenceIds } for every feature', () => {
    const { wallets, window } = coordinated()
    const results = extractFeatures(wallets, window, OPTS)
    expect(results.map((r) => r.name)).toEqual([...FEATURE_NAMES])
    for (const r of results) {
      expect(typeof r.value).toBe('number')
      expect(r.value).toBeGreaterThanOrEqual(0)
      expect(r.value).toBeLessThanOrEqual(1)
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(r.confidence)
      expect(Array.isArray(r.sourceEvidenceIds)).toBe(true)
    }
  })

  it('separates a coordinated cluster from an unrelated set on every feature', () => {
    const c = extractFeatures(...([coordinated().wallets, coordinated().window, OPTS] as const))
    const u = extractFeatures(...([unrelated().wallets, unrelated().window, OPTS] as const))
    for (let i = 0; i < c.length; i++) {
      expect(c[i]!.value).toBeGreaterThanOrEqual(u[i]!.value)
    }
    // Four of the five separate strictly; PROTOCOL_BEHAVIOR_SIMILARITY is the
    // one that does not, for the short-sequence reason documented above.
    const strict = c.filter((f, i) => f.value > u[i]!.value)
    expect(strict.length).toBeGreaterThanOrEqual(4)
  })

  it('a zero value with LOW confidence is distinguishable from zero with HIGH', () => {
    // "we found nothing and barely looked" vs "we looked hard and they are
    // genuinely unrelated" — Phase 8 and the Evidence Receipt need both.
    const noEvidence = fundingCorrelation(['a', 'b'], win([]), OPTS)
    expect(noEvidence.value).toBe(0)
    expect(noEvidence.confidence).toBe('LOW')

    const { wallets, window } = unrelated()
    const wellEvidenced = fundingCorrelation(wallets, window, OPTS)
    expect(wellEvidenced.value).toBe(0)
    expect(wellEvidenced.confidence).toBe('HIGH')
  })
})
