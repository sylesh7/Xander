/**
 * Reorg handling — runs against real Postgres.
 *
 * Backend-Suganthan.md Phase 10.3: "Reorg handling is not optional — the sink
 * protocol's 'undo' signal for reorged-out blocks must roll back the
 * corresponding EvidenceEvent rows." This is that acceptance test, exercised
 * against the real database rather than a mock.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { handleUndo } from '../src/graph/substreams/stream.js'
import { getCursor } from '../src/graph/substreams/cursor.js'
import { persistEvidenceEvents } from '../src/evidence/repository.js'
import { prisma } from '../src/lib/prisma.js'
import type { NormalizedEvidenceEvent } from '../src/evidence/types.js'

const CHAIN = 'test-reorg-chain'
const MODULE = 'map_funding_transfers'

let dbUp = false

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbUp = true
  } catch {
    console.warn('\n[substreams-reorg.db] Postgres unreachable — skipping.\n')
  }
})

afterEach(async () => {
  if (dbUp) {
    await prisma.evidenceEvent.deleteMany({ where: { chain: CHAIN } })
    await prisma.substreamsCursor.deleteMany({ where: { chain: CHAIN } })
  }
})

const event = (block: bigint, sourceId: string): NormalizedEvidenceEvent => ({
  chain: CHAIN,
  wallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  counterparty: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  eventType: 'transfer',
  protocol: null,
  protocolType: null,
  amount: '1000',
  timestamp: new Date('2026-01-01T00:00:00Z'),
  blockNumber: block,
  transactionHash: `0xtx${block}`,
  sourceType: 'substreams',
  sourceId,
  deploymentId: null,
})

describe('THE PHASE 10.3 ACCEPTANCE TEST: reorg rolls back evidence and rewinds the cursor', () => {
  it('deletes evidence above the last valid block and persists the rewound cursor', async () => {
    if (!dbUp) return

    // Simulate three blocks having streamed in, including two that get
    // reorged out.
    await persistEvidenceEvents([
      event(100n, 'a'), // survives — at the reorg boundary
      event(200n, 'b'), // reorged out
      event(300n, 'c'), // reorged out
    ])

    await handleUndo(CHAIN, 100n, 'rewound-cursor-xyz')

    const remaining = await prisma.evidenceEvent.findMany({ where: { chain: CHAIN } })
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.blockNumber).toBe(100n)

    // The cursor is rewound to the undo signal's cursor, not left pointing at
    // the reorged-out blocks — resuming from the old cursor would skip the
    // range that needs to be re-streamed.
    expect(await getCursor(CHAIN, MODULE)).toBe('rewound-cursor-xyz')
  })

  it("a reorg on one chain does not touch another chain's evidence", async () => {
    if (!dbUp) return
    await persistEvidenceEvents([{ ...event(500n, 'x'), chain: 'other-chain' }, event(500n, 'y')])

    await handleUndo(CHAIN, 100n, 'c1')

    const otherChainRows = await prisma.evidenceEvent.findMany({ where: { chain: 'other-chain' } })
    expect(otherChainRows).toHaveLength(1)
    await prisma.evidenceEvent.deleteMany({ where: { chain: 'other-chain' } })
  })

  it('an undo with nothing above the boundary is a no-op on evidence, but still rewinds the cursor', async () => {
    if (!dbUp) return
    await persistEvidenceEvents([event(50n, 'a')])
    await handleUndo(CHAIN, 100n, 'c2')

    const remaining = await prisma.evidenceEvent.findMany({ where: { chain: CHAIN } })
    expect(remaining).toHaveLength(1) // block 50 is below the 100 boundary
    expect(await getCursor(CHAIN, MODULE)).toBe('c2')
  })
})
