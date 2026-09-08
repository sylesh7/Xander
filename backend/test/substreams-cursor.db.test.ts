/**
 * Cursor persistence — runs against real Postgres, same rationale as
 * evidence-repository.db.test.ts: cursor resume is a database property, and
 * mocking Prisma here would only prove the mock does what it was told.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getCursor, getCursorLag, writeCursor } from '../src/graph/substreams/cursor.js'
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
})
