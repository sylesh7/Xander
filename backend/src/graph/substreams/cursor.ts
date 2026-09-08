/**
 * Cursor persistence — Backend-Suganthan.md Phase 10.2.
 *
 * The Golden Rules from the streamingfast/substreams-skills cursor-reorg
 * reference, which this module exists to enforce:
 *
 *   1. Persist the cursor AFTER successful data processing, never before.
 *   2. On restart, load the persisted cursor and resume from it.
 *   3. An absent cursor means "start from the beginning" (initialBlock).
 *   4. One cursor per stream — never mix cursors between streams.
 *
 * Rule 1 is the one a rushed implementation gets wrong, and it is the reason
 * this repository exists as a separate module from the stream loop: persisting
 * before the evidence write means a crash between the two steps skips a block
 * forever; persisting after means a crash just reprocesses it, and Phase 5's
 * idempotent upsert makes reprocessing free.
 *
 * The cursor itself is treated as OPAQUE. It is never parsed or constructed —
 * only stored exactly as the stream handed it back and passed to the next
 * request exactly as read.
 */
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'

/**
 * The persisted cursor for one (chain, module) stream, or undefined if none
 * exists yet — which `@substreams/core`'s `createRequest` treats as "start
 * from the module's initialBlock" (Rule 3).
 */
export async function getCursor(chain: string, moduleName: string): Promise<string | undefined> {
  const row = await prisma.substreamsCursor.findUnique({
    where: { chain_moduleName: { chain, moduleName } },
  })
  return row?.cursor ?? undefined
}

/**
 * The persisted cursor AND the block it was captured at, in one read.
 *
 * `getCursor` alone is enough for most callers, but a caller building a
 * request with a RELATIVE stop block (`+N`) needs the block too — see
 * `runOnce` in `stream.ts` for why: `createRequest`'s `stopBlockNum` computes
 * `+N` relative to `startBlockNum`, not relative to wherever `startCursor`
 * actually resumes from. Anchoring `startBlockNum` to this block, rather than
 * to whatever `--start` the caller originally typed, is what keeps that math
 * meaningful across a restart.
 */
export async function getCursorInfo(
  chain: string,
  moduleName: string,
): Promise<{ cursor: string; blockNumber: bigint } | undefined> {
  const row = await prisma.substreamsCursor.findUnique({
    where: { chain_moduleName: { chain, moduleName } },
  })
  return row ? { cursor: row.cursor, blockNumber: row.blockNumber } : undefined
}

/**
 * Persists a cursor. Call this ONLY after the evidence it corresponds to has
 * been durably written (Rule 1) — never speculatively, never before.
 */
export async function writeCursor(
  chain: string,
  moduleName: string,
  cursor: string,
  blockNumber: bigint,
): Promise<void> {
  await prisma.substreamsCursor.upsert({
    where: { chain_moduleName: { chain, moduleName } },
    create: { chain, moduleName, cursor, blockNumber },
    update: { cursor, blockNumber },
  })
}

/** The last block a stream's cursor was persisted at, for /health (Phase 11). */
export async function getCursorLag(
  chain: string,
  moduleName: string,
): Promise<{ blockNumber: bigint; updatedAt: Date } | null> {
  const row = await prisma.substreamsCursor.findUnique({
    where: { chain_moduleName: { chain, moduleName } },
    select: { blockNumber: true, updatedAt: true },
  })
  if (!row) {
    logger.debug({ chain, moduleName }, 'no cursor persisted yet for this stream')
    return null
  }
  return row
}
