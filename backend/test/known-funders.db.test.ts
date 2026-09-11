/**
 * Known-funder registry against real Postgres — V2 spec section 12.3.
 *
 * The pure half of this feature is covered in features.test.ts. What can only
 * be proven here is that the real table, the real validity-window query and the
 * real cache actually deliver a label into the extractor and change a score.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { loadKnownFunders, resetKnownFunderCache } from '../src/risk/known-funders.js'
import { fundingCorrelation, knownFunderKey } from '../src/risk/features.js'
import { featureOptionsFromEnv } from '../src/risk/index.js'
import type { EvidenceWindow, FeatureOptions, RiskEvidenceRow } from '../src/risk/types.js'

const CHAIN = 'known-funder-test-chain'
const EXCHANGE = '0x00000000000000000000000000000000exch01'
const PRIVATE = '0x00000000000000000000000000000000priv01'

let seq = 0
const T0 = new Date('2026-02-01T00:00:00Z').getTime()

function row(wallet: string, counterparty: string, minutes: number): RiskEvidenceRow {
  return {
    id: `kf-ev-${++seq}`,
    wallet,
    chain: CHAIN,
    counterparty,
    eventType: 'transfer',
    timestamp: new Date(T0 + minutes * 60_000),
    blockNumber: BigInt(5_000_000 + seq),
  }
}

/** Four wallets, all funded by one address inside the window. */
function coFundedBy(funder: string): { wallets: string[]; window: EvidenceWindow } {
  const wallets = ['kfa', 'kfb', 'kfc', 'kfd']
  return { wallets, window: { events: wallets.map((w, i) => row(w, funder, i)) } }
}

async function optionsWithRegistry(): Promise<FeatureOptions> {
  resetKnownFunderCache()
  return { ...featureOptionsFromEnv(), knownFunders: await loadKnownFunders() }
}

beforeEach(async () => {
  await prisma.knownFunderAddress.deleteMany({ where: { chain: CHAIN } })
  resetKnownFunderCache()
})

afterEach(async () => {
  await prisma.knownFunderAddress.deleteMany({ where: { chain: CHAIN } })
  resetKnownFunderCache()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('known-funder registry — real table', () => {
  it('a labelled funder loaded from Postgres down-weights a real score', async () => {
    const { wallets, window } = coFundedBy(EXCHANGE)

    // Unlabelled first: the pre-V2 behaviour, a maximal coordination signal.
    const before = fundingCorrelation(wallets, window, await optionsWithRegistry())
    expect(before.value).toBe(1)

    await prisma.knownFunderAddress.create({
      data: {
        address: EXCHANGE,
        chain: CHAIN,
        label: 'Test Exchange 1',
        category: 'EXCHANGE',
        source: 'known-funders.db.test.ts',
        confidence: 'HIGH',
      },
    })

    const after = fundingCorrelation(wallets, window, await optionsWithRegistry())
    expect(after.value).toBeCloseTo(0.15)
    expect(after.note).toMatch(/labelled EXCHANGE \(Test Exchange 1\)/)
  })

  it('does not down-weight an unlabelled private funder', async () => {
    await prisma.knownFunderAddress.create({
      data: {
        address: EXCHANGE,
        chain: CHAIN,
        label: 'Test Exchange 1',
        category: 'EXCHANGE',
        source: 'known-funders.db.test.ts',
        confidence: 'HIGH',
      },
    })

    const { wallets, window } = coFundedBy(PRIVATE)
    const r = fundingCorrelation(wallets, window, await optionsWithRegistry())
    expect(r.value).toBe(1)
  })

  it('ignores a label whose validity window has closed', async () => {
    // An exchange rotated this hot wallet away last week. The row survives so a
    // decision made while it was live stays reconstructable, but it must stop
    // excusing new evidence.
    await prisma.knownFunderAddress.create({
      data: {
        address: EXCHANGE,
        chain: CHAIN,
        label: 'Retired Hot Wallet',
        category: 'EXCHANGE',
        source: 'known-funders.db.test.ts',
        confidence: 'HIGH',
        validFrom: new Date(Date.now() - 30 * 86_400_000),
        validTo: new Date(Date.now() - 7 * 86_400_000),
      },
    })

    const index = await loadKnownFunders({ force: true })
    expect(index.get(knownFunderKey(CHAIN, EXCHANGE))).toBeUndefined()

    const { wallets, window } = coFundedBy(EXCHANGE)
    expect(fundingCorrelation(wallets, window, await optionsWithRegistry()).value).toBe(1)
  })

  it('ignores a label that is not in effect yet', async () => {
    await prisma.knownFunderAddress.create({
      data: {
        address: EXCHANGE,
        chain: CHAIN,
        label: 'Future Label',
        category: 'BRIDGE',
        source: 'known-funders.db.test.ts',
        confidence: 'HIGH',
        validFrom: new Date(Date.now() + 86_400_000),
      },
    })

    const index = await loadKnownFunders({ force: true })
    expect(index.get(knownFunderKey(CHAIN, EXCHANGE))).toBeUndefined()
  })

  it('serves a cached index until forced, so scoring does not re-query per claim', async () => {
    const first = await loadKnownFunders({ force: true })
    const sizeBefore = first.size

    await prisma.knownFunderAddress.create({
      data: {
        address: PRIVATE,
        chain: CHAIN,
        label: 'Added After Cache Warm',
        category: 'OTHER',
        source: 'known-funders.db.test.ts',
        confidence: 'LOW',
      },
    })

    // Still the cached view — the TTL has not elapsed.
    expect((await loadKnownFunders()).size).toBe(sizeBefore)
    // And the fresh view sees it.
    expect((await loadKnownFunders({ force: true })).size).toBe(sizeBefore + 1)
  })

  it('the seeded registry is present and every row carries provenance', async () => {
    // Section 12.3 rows are seeded by prisma/seed.ts. A label with no source is
    // an anonymous assertion, which is exactly what this column exists to stop.
    const seeded = await prisma.knownFunderAddress.findMany({
      where: { chain: { not: CHAIN } },
      select: { source: true, confidence: true, category: true, address: true },
    })

    expect(seeded.length).toBeGreaterThan(0)
    for (const rowItem of seeded) {
      expect(rowItem.source.trim().length).toBeGreaterThan(0)
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(rowItem.confidence)
      expect(rowItem.address).toBe(rowItem.address.toLowerCase())
    }
    expect(seeded.some((r) => r.category === 'BRIDGE')).toBe(true)
  })
})
