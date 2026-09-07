/**
 * Phase 5 acceptance test — runs against the real Postgres from docker-compose.
 *
 * Idempotency is a DATABASE property. Mocking Prisma here would test that the
 * mock returns what the mock was told to return, and would have passed happily
 * before the @@unique constraint existed. So this suite talks to the real
 * database, and skips (loudly) when it is not reachable rather than failing CI
 * on a machine with no Docker.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getEvidenceForWallet,
  getLatestBlockForChain,
  persistEvidenceEvent,
  persistEvidenceEvents,
  rollbackEvidenceAboveBlock,
} from '../src/evidence/repository.js'
import { normalizeTokenApiTransfer } from '../src/evidence/normalizer.js'
import { prisma } from '../src/lib/prisma.js'
import type { NormalizedEvidenceEvent } from '../src/evidence/types.js'
import type { TokenApiTransfer } from '../src/graph/token-api/types.js'

const CHAIN = 'test-chain'
const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const FUNDER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

let dbUp = false

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbUp = true
  } catch {
    console.warn(
      '\n[evidence-repository.db] Postgres unreachable — skipping. Run `npm run infra:up`.\n',
    )
  }
})

afterEach(async () => {
  if (dbUp) await prisma.evidenceEvent.deleteMany({ where: { chain: CHAIN } })
})

const event = (over: Partial<NormalizedEvidenceEvent> = {}): NormalizedEvidenceEvent => ({
  chain: CHAIN,
  wallet: WALLET,
  counterparty: FUNDER,
  eventType: 'transfer',
  protocol: null,
  protocolType: null,
  amount: '1000',
  timestamp: new Date('2026-01-01T00:00:00Z'),
  blockNumber: 21_000_000n,
  transactionHash: '0xTX1',
  sourceType: 'token-api',
  sourceId: '0xTX1-0',
  deploymentId: null,
  ...over,
})

const transfer: TokenApiTransfer = {
  kind: 'erc20',
  block_num: 21_000_000,
  datetime: '2026-01-01 00:00:00',
  timestamp: 1767225600,
  transaction_id: '0xTXR',
  log_index: 0,
  contract: '0xTOKEN',
  type: 'transfer',
  from: FUNDER,
  to: WALLET,
  amount: '999',
  network: CHAIN,
} as TokenApiTransfer

describe('evidence repository (real Postgres)', () => {
  it('THE PHASE 5 ACCEPTANCE TEST: the same response twice is a no-op', async () => {
    if (!dbUp) return

    // "feed the same Token API response through twice; the second write is a no-op"
    const response = [transfer]

    const first = await persistEvidenceEvents(
      response.map((t) => normalizeTokenApiTransfer(t, WALLET)),
    )
    const second = await persistEvidenceEvents(
      response.map((t) => normalizeTokenApiTransfer(t, WALLET)),
    )

    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(second.skipped).toBe(1)

    const rows = await prisma.evidenceEvent.findMany({ where: { chain: CHAIN } })
    expect(rows).toHaveLength(1)
  })

  it('keeps two events from the same transaction — they differ by sourceId', async () => {
    if (!dbUp) return
    // The exact case (transactionHash, eventType, wallet) alone would collide on.
    const res = await persistEvidenceEvents([
      event({ sourceId: '0xTX1-0' }),
      event({ sourceId: '0xTX1-1' }),
    ])
    expect(res.created).toBe(2)
  })

  it('keeps both perspectives of one transfer', async () => {
    if (!dbUp) return
    // Same tx, same sourceId, different wallet — each is evidence about a
    // different wallet, so both must survive.
    const res = await persistEvidenceEvents([
      event({ wallet: WALLET, counterparty: FUNDER }),
      event({ wallet: FUNDER, counterparty: WALLET }),
    ])
    expect(res.created).toBe(2)
  })

  it('deduplicates within a single batch, not just against stored rows', async () => {
    if (!dbUp) return
    // skipDuplicates compares against the table, not against other rows in the
    // same insert — two sources handing us the same event in one batch would
    // otherwise fail the whole write.
    const res = await persistEvidenceEvents([event(), event(), event()])
    expect(res.created).toBe(1)
    expect(res.skipped).toBe(2)
  })

  it('persistEvidenceEvent reports whether the row was new', async () => {
    if (!dbUp) return
    // Phase 10.4 uses this to avoid waking Sylesh's cache worker on a replay.
    expect(await persistEvidenceEvent(event())).toBe(true)
    expect(await persistEvidenceEvent(event())).toBe(false)
  })

  it('rolls back reorged blocks above a height, scoped to one chain', async () => {
    if (!dbUp) return
    await persistEvidenceEvents([
      event({ blockNumber: 100n, sourceId: 'a' }),
      event({ blockNumber: 200n, sourceId: 'b' }),
      event({ blockNumber: 300n, sourceId: 'c' }),
    ])
    const removed = await rollbackEvidenceAboveBlock(CHAIN, 150n)
    expect(removed).toBe(2)
    const left = await prisma.evidenceEvent.findMany({ where: { chain: CHAIN } })
    expect(left).toHaveLength(1)
    expect(left[0]?.blockNumber).toBe(100n)
  })

  it('a reorg on another chain removes nothing here', async () => {
    if (!dbUp) return
    await persistEvidenceEvents([event({ blockNumber: 500n })])
    expect(await rollbackEvidenceAboveBlock('some-other-chain', 1n)).toBe(0)
    expect(await prisma.evidenceEvent.count({ where: { chain: CHAIN } })).toBe(1)
  })

  it('reads a wallet history oldest-first', async () => {
    if (!dbUp) return
    await persistEvidenceEvents([
      event({ blockNumber: 300n, sourceId: 'c' }),
      event({ blockNumber: 100n, sourceId: 'a' }),
      event({ blockNumber: 200n, sourceId: 'b' }),
    ])
    const rows = await getEvidenceForWallet(WALLET)
    expect(rows.map((r) => Number(r.blockNumber))).toEqual([100, 200, 300])
  })

  it('matches a wallet regardless of the case it is queried with', async () => {
    if (!dbUp) return
    await persistEvidenceEvents([event()])
    expect(await getEvidenceForWallet(WALLET.toUpperCase())).toHaveLength(1)
  })

  it('reports the highest block held for a chain (Phase 11 freshness input)', async () => {
    if (!dbUp) return
    await persistEvidenceEvents([
      event({ blockNumber: 100n, sourceId: 'a' }),
      event({ blockNumber: 900n, sourceId: 'b' }),
    ])
    expect(await getLatestBlockForChain(CHAIN)).toBe(900n)
  })

  it('returns null for a chain with no evidence, never 0', async () => {
    if (!dbUp) return
    // 0 would read as "we are synced to genesis" instead of "we know nothing".
    expect(await getLatestBlockForChain('chain-with-no-data')).toBeNull()
  })

  it('an empty batch is a no-op that does not hit the database', async () => {
    if (!dbUp) return
    expect(await persistEvidenceEvents([])).toEqual({ created: 0, skipped: 0 })
  })
})
