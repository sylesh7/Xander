/**
 * `npm run db:seed:refresh` — V2 Phase 0.
 *
 * Runs the REAL script as a subprocess against the REAL database, because the
 * thing being tested is an operator command, and a refactor that made it
 * importable would no longer be testing what an operator actually runs.
 *
 * The bug this closes: fixture rows are deduplicated forever by
 * @@unique([transactionHash, eventType, wallet, sourceId]), so re-seeding never
 * refreshes `createdAt`, and the Phase 11 freshness guard judges token-api
 * evidence purely on `createdAt` recency. Six hours after the first seed every
 * fixture wallet resolves PENDING_REVIEW from wall-clock time alone.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'

const run = promisify(execFile)

const FIXTURE_CHAIN = 'seed'
const STALE_AT = new Date('2020-01-01T00:00:00Z')

afterAll(async () => {
  await prisma.$disconnect()
})

describe('db:seed:refresh', () => {
  it('re-stamps stale fixture evidence without disturbing its on-chain timestamps', async () => {
    // A dedicated stale row on the fixture chain, rather than ageing the real
    // fixtures. Vitest runs test FILES in parallel, and the real fixtures are
    // shared global state: ageing them made FIXTURE_CLEAN_WALLET resolve
    // PENDING_REVIEW — correctly, per the freshness guard — which is never
    // cached, which failed the invalidation-worker test running alongside.
    // A test that has to corrupt shared fixtures to prove its point is a
    // flaky test by construction.
    const ownRow = await prisma.evidenceEvent.create({
      data: {
        chain: FIXTURE_CHAIN,
        wallet: '0x000000000000000000000000000000000refre5h',
        eventType: 'transfer',
        timestamp: new Date('2026-04-01T00:00:00Z'),
        blockNumber: 8_000_001n,
        transactionHash: '0xseedrefreshtest',
        sourceType: 'token-api',
        sourceId: '0xseedrefreshtest-0',
        createdAt: STALE_AT,
      },
    })

    const before = await prisma.evidenceEvent.findMany({
      where: { chain: FIXTURE_CHAIN },
      select: { id: true, timestamp: true },
      orderBy: { id: 'asc' },
    })
    expect(before.length).toBeGreaterThan(1)

    try {
      await run('npm', ['run', 'db:seed:refresh'], { cwd: process.cwd() })

      // The stale row is fresh again — which is the whole point of the command.
      const refreshed = await prisma.evidenceEvent.findUnique({ where: { id: ownRow.id } })
      expect(refreshed?.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000)

      // And not one on-chain timestamp moved, across every fixture row. The
      // scenarios live entirely in the RELATIVE spacing of these values — a
      // tight funding burst, a month-long gap for the clean wallet. Rewriting
      // them to now() would collapse every fixture into a single instant and
      // silently invert what they test.
      const after = await prisma.evidenceEvent.findMany({
        where: { chain: FIXTURE_CHAIN },
        select: { id: true, timestamp: true },
        orderBy: { id: 'asc' },
      })
      expect(after.length).toBe(before.length)
      const beforeById = new Map(before.map((r) => [r.id, r.timestamp.getTime()]))
      for (const row of after) {
        expect(row.timestamp.getTime()).toBe(beforeById.get(row.id))
      }
    } finally {
      await prisma.evidenceEvent.delete({ where: { id: ownRow.id } })
    }
  }, 60_000)

  it('leaves non-fixture evidence alone', async () => {
    // 'seed' is a chain no real evidence source ever emits, so the refresh can
    // never rewrite the provenance of a genuine observation.
    const real = await prisma.evidenceEvent.create({
      data: {
        chain: 'refresh-guard-test-chain',
        wallet: '0x00000000000000000000000000000000realev',
        eventType: 'transfer',
        timestamp: new Date('2026-03-01T00:00:00Z'),
        blockNumber: 9_000_001n,
        transactionHash: '0xrefreshguardtest',
        sourceType: 'token-api',
        sourceId: '0xrefreshguardtest-0',
        createdAt: STALE_AT,
      },
    })

    try {
      await run('npm', ['run', 'db:seed:refresh'], { cwd: process.cwd() })

      const after = await prisma.evidenceEvent.findUnique({ where: { id: real.id } })
      expect(after?.createdAt.getTime()).toBe(STALE_AT.getTime())
    } finally {
      await prisma.evidenceEvent.delete({ where: { id: real.id } })
    }
  }, 60_000)
})
