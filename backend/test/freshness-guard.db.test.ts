/**
 * Freshness guard — Phase 11. Runs against real Postgres, since staleness is
 * fundamentally about real timestamps and real cursor rows, not something a
 * mock can honestly assert.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { checkFreshness } from '../src/provenance/freshness-guard.js'
import { prisma } from '../src/lib/prisma.js'
import { env } from '../src/config/env.js'
import type { NormalizedEvidenceEvent } from '../src/evidence/types.js'

const WALLET = '0xf1e5f1e5f1e5f1e5f1e5f1e5f1e5f1e5f1e5f1e5'
const CHAIN = 'test-freshness-chain'

let dbUp = false

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbUp = true
  } catch {
    console.warn('\n[freshness-guard.db] Postgres unreachable — skipping.\n')
  }
})

afterEach(async () => {
  if (!dbUp) return
  await prisma.evidenceEvent.deleteMany({ where: { chain: CHAIN } })
  await prisma.substreamsCursor.deleteMany({ where: { chain: CHAIN } })
})

const event = (over: Partial<NormalizedEvidenceEvent> = {}): NormalizedEvidenceEvent => ({
  chain: CHAIN,
  wallet: WALLET,
  counterparty: null,
  eventType: 'transfer',
  protocol: null,
  protocolType: null,
  amount: '1',
  timestamp: new Date(),
  blockNumber: 1n,
  transactionHash: '0xtx',
  sourceType: 'token-api',
  sourceId: 'a',
  deploymentId: null,
  ...over,
})

describe('THE PHASE 11 ACCEPTANCE TEST: no evidence resolves not-fresh, never a confident answer', () => {
  it('a wallet with zero evidence is not fresh', async () => {
    if (!dbUp) return
    const result = await checkFreshness([WALLET])
    expect(result.fresh).toBe(false)
    expect(result.reasons[0]).toMatch(/no evidence/)
  })
})

describe('token-api freshness — recency of our own last successful fetch', () => {
  it('recent token-api evidence is fresh', async () => {
    if (!dbUp) return
    await prisma.evidenceEvent.create({ data: event({ sourceId: 'recent' }) })
    const result = await checkFreshness([WALLET])
    expect(result.fresh).toBe(true)
  })

  it('old token-api evidence is not fresh', async () => {
    if (!dbUp) return
    // createdAt is a Prisma @default(now()) — force it stale directly.
    const row = await prisma.evidenceEvent.create({ data: event({ sourceId: 'stale' }) })
    const staleAt = new Date(Date.now() - (env.FRESHNESS_MAX_EVIDENCE_AGE_SECONDS + 60) * 1000)
    await prisma.evidenceEvent.update({ where: { id: row.id }, data: { createdAt: staleAt } })

    const result = await checkFreshness([WALLET])
    expect(result.fresh).toBe(false)
    expect(result.reasons[0]).toMatch(/token-api evidence is/)
  })
})

describe('substreams freshness — is the live stream still running', () => {
  it('a chain with a recent cursor is fresh', async () => {
    if (!dbUp) return
    await prisma.evidenceEvent.create({
      data: event({ sourceType: 'substreams', sourceId: 's1' }),
    })
    await prisma.substreamsCursor.create({
      data: { chain: CHAIN, moduleName: 'map_funding_transfers', cursor: 'c', blockNumber: 1n },
    })
    const result = await checkFreshness([WALLET])
    expect(result.fresh).toBe(true)
  })

  it('substreams evidence with NO cursor row is not fresh', async () => {
    if (!dbUp) return
    // The stream claims to have produced this data but left no cursor —
    // exactly the "required deployment query failed outright" spirit for the
    // streaming path: something is wrong, hold the claim.
    await prisma.evidenceEvent.create({
      data: event({ sourceType: 'substreams', sourceId: 's2' }),
    })
    const result = await checkFreshness([WALLET])
    expect(result.fresh).toBe(false)
    expect(result.reasons[0]).toMatch(/no substreams cursor/)
  })

  it('a stale cursor makes the wallet not fresh', async () => {
    if (!dbUp) return
    await prisma.evidenceEvent.create({
      data: event({ sourceType: 'substreams', sourceId: 's3' }),
    })
    await prisma.substreamsCursor.create({
      data: {
        chain: CHAIN,
        moduleName: 'map_funding_transfers',
        cursor: 'c',
        blockNumber: 1n,
        updatedAt: new Date(Date.now() - (env.FRESHNESS_MAX_STREAM_LAG_SECONDS + 60) * 1000),
      },
    })
    const result = await checkFreshness([WALLET])
    expect(result.fresh).toBe(false)
    expect(result.reasons[0]).toMatch(/cursor.*stale/)
  })
})

describe('checkFreshness respects the injectable clock', () => {
  it('an explicit `now` in the past treats fresh evidence as stale', async () => {
    if (!dbUp) return
    await prisma.evidenceEvent.create({ data: event({ sourceId: 'x' }) })
    const farFuture = new Date(Date.now() + (env.FRESHNESS_MAX_EVIDENCE_AGE_SECONDS + 3600) * 1000)
    const result = await checkFreshness([WALLET], { now: farFuture })
    expect(result.fresh).toBe(false)
  })
})
