/**
 * Cursor persistence — runs against real Postgres, same rationale as
 * evidence-repository.db.test.ts: cursor resume is a database property, and
 * mocking Prisma here would only prove the mock does what it was told.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getCursor,
  getCursorInfo,
  getCursorLag,
  writeCursor,
} from '../src/graph/substreams/cursor.js'
import { prisma } from '../src/lib/prisma.js'

const CHAIN = 'test-cursor-chain'
const MODULE = 'map_funding_transfers'

let dbUp = false

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbUp = true
  } catch {
    console.warn('\n[substreams-cursor.db] Postgres unreachable — skipping.\n')
  }
})

afterEach(async () => {
  if (dbUp) await prisma.substreamsCursor.deleteMany({ where: { chain: CHAIN } })
})

describe('cursor persistence (real Postgres)', () => {
  it('returns undefined for a stream with no persisted cursor (Golden Rule 3: start from the beginning)', async () => {
    if (!dbUp) return
    expect(await getCursor(CHAIN, MODULE)).toBeUndefined()
  })

  it('writes and reads back a cursor', async () => {
    if (!dbUp) return
    await writeCursor(CHAIN, MODULE, 'opaque-cursor-abc', 21_000_002n)
    expect(await getCursor(CHAIN, MODULE)).toBe('opaque-cursor-abc')
  })

  it('a later write replaces the cursor rather than adding a row', async () => {
    if (!dbUp) return
    await writeCursor(CHAIN, MODULE, 'first', 100n)
    await writeCursor(CHAIN, MODULE, 'second', 200n)
    expect(await getCursor(CHAIN, MODULE)).toBe('second')
    const rows = await prisma.substreamsCursor.findMany({ where: { chain: CHAIN } })
    expect(rows).toHaveLength(1)
  })

  it('THE GOLDEN RULE 4 TEST: one cursor per (chain, module) — never mixed', async () => {
    await writeCursor(CHAIN, 'map_funding_transfers', 'mainnet-cursor', 100n)
    await writeCursor(CHAIN, 'some_other_module', 'other-cursor', 999n)
    expect(await getCursor(CHAIN, 'map_funding_transfers')).toBe('mainnet-cursor')
    expect(await getCursor(CHAIN, 'some_other_module')).toBe('other-cursor')
    await prisma.substreamsCursor.deleteMany({
      where: { chain: CHAIN, moduleName: 'some_other_module' },
    })
  })

  it('two chains streaming the same module do not collide', async () => {
    await writeCursor('chain-a', MODULE, 'cursor-a', 1n)
    await writeCursor('chain-b', MODULE, 'cursor-b', 2n)
    expect(await getCursor('chain-a', MODULE)).toBe('cursor-a')
    expect(await getCursor('chain-b', MODULE)).toBe('cursor-b')
    await prisma.substreamsCursor.deleteMany({ where: { chain: { in: ['chain-a', 'chain-b'] } } })
  })

  it('getCursorLag reports the last persisted block, for Phase 11 /health', async () => {
    if (!dbUp) return
    await writeCursor(CHAIN, MODULE, 'c', 21_000_500n)
    const lag = await getCursorLag(CHAIN, MODULE)
    expect(lag?.blockNumber).toBe(21_000_500n)
    expect(lag?.updatedAt).toBeInstanceOf(Date)
  })

  it('getCursorLag returns null, never a fabricated block, when nothing is persisted', async () => {
    if (!dbUp) return
    expect(await getCursorLag(CHAIN, MODULE)).toBeNull()
  })

  describe('getCursorInfo — the fix for the relative-stop-block-on-resume bug', () => {
    it('returns both the cursor and its block in one read', async () => {
      if (!dbUp) return
      await writeCursor(CHAIN, MODULE, 'opaque-xyz', 46_543_723n)
      const info = await getCursorInfo(CHAIN, MODULE)
      expect(info?.cursor).toBe('opaque-xyz')
      expect(info?.blockNumber).toBe(46_543_723n)
    })

    it('returns undefined, not a fabricated block, when nothing is persisted', async () => {
      if (!dbUp) return
      // A caller anchoring startBlockNum on this MUST fall back to its own
      // --start, never silently coerce to 0 — that would restart every
      // never-before-seen stream from genesis.
      expect(await getCursorInfo(CHAIN, MODULE)).toBeUndefined()
    })

    it('THE BUG THIS FIXES, reproduced directly: a stale --start makes a relative stop land behind an advanced cursor', async () => {
      if (!dbUp) return
      // This is the exact scenario a live kill -9 + restart produced: stream
      // started at block 46543680, ran unsupervised, and by the time it was
      // killed the cursor had genuinely advanced to 46543723 — 43 blocks past
      // the original --start. A caller resuming with `--stop +10` (meaning
      // "stop 10 blocks past wherever the SDK thinks I started") is asking
      // for block 46543690 if anchored to the stale --start, which is
      // already 33 blocks in the past relative to the real cursor.
      const originalStart = 46_543_680n
      await writeCursor(CHAIN, MODULE, 'resumed', 46_543_723n)

      const info = await getCursorInfo(CHAIN, MODULE)
      const effectiveStartBlock = info?.blockNumber ?? originalStart
      const relativeStopOffset = 10n

      // Anchored to the stale --start (the bug): the stop lands behind the
      // cursor and the server would reject the request outright.
      const buggyStop = originalStart + relativeStopOffset
      expect(buggyStop).toBeLessThan(info!.blockNumber)

      // Anchored to the cursor's real block (the fix): the stop is always
      // ahead of where the stream is actually resuming.
      const fixedStop = effectiveStartBlock + relativeStopOffset
      expect(fixedStop).toBeGreaterThan(info!.blockNumber)
    })
  })
})
