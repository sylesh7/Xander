/**
 * Evidence repository — Backend-Suganthan.md Phase 5.
 *
 * The ONLY writer of EvidenceEvent rows. Every path in — Token API backfill,
 * Standardized Subgraph fetch, Substreams webhook — lands here, so idempotency
 * is enforced in one place rather than remembered at four call sites.
 *
 * Phase 5 acceptance test: "feed the same Token API response through twice; the
 * second write is a no-op."
 */
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import type { NormalizedEvidenceEvent } from './types.js'

export interface PersistResult {
  /** Rows that did not exist before. */
  created: number
  /**
   * Events handed in that did NOT become a new row — either already stored, or
   * duplicated within this batch. `created + skipped === events.length` always,
   * so a caller can reconcile without knowing which kind of duplicate it was.
   */
  skipped: number
}

/**
 * Persists normalized events idempotently.
 *
 * Uses createMany + skipDuplicates rather than a loop of upserts. Both are
 * correct, but this is one round trip instead of N and, more importantly, it
 * cannot partially apply: a Substreams batch either lands or does not.
 *
 * Idempotency rests on @@unique([transactionHash, eventType, wallet, sourceId]).
 * Re-fetching an overlapping block range — which the Token API pagination and
 * the Substreams cursor both do routinely at their boundaries — is therefore
 * free rather than corrupting.
 *
 * Note this is deliberately NOT an update: an EvidenceEvent is an immutable
 * observation. If a row exists for that key, the same on-chain fact was already
 * recorded, and rewriting it would silently mutate the evidence an Evidence
 * Receipt was built from.
 */
export async function persistEvidenceEvents(
  events: NormalizedEvidenceEvent[],
): Promise<PersistResult> {
  if (events.length === 0) return { created: 0, skipped: 0 }

  // Two sources can hand us the same event inside one batch (an ERC-20 transfer
  // seen by both the Token API backfill and the Substreams stream). Deduplicate
  // in memory first: skipDuplicates only compares against rows already in the
  // table, not against other rows in the same insert.
  const seen = new Set<string>()
  const unique = events.filter((e) => {
    const key = `${e.transactionHash}|${e.eventType}|${e.wallet}|${e.sourceId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const result = await prisma.evidenceEvent.createMany({
    data: unique,
    skipDuplicates: true,
  })

  // Counted against what the CALLER passed, not against the deduplicated list —
  // an in-batch duplicate is still an event that did not become a row, and
  // silently dropping it from the tally makes created+skipped stop summing.
  const skipped = events.length - result.count
  logger.debug(
    { received: events.length, deduped: unique.length, created: result.count, skipped },
    'persisted evidence events',
  )

  return { created: result.count, skipped }
}

/**
 * Persists one event, returning whether it was new.
 *
 * For the Substreams webhook receiver, which processes events individually and
 * needs to know whether anything actually changed before enqueuing a
 * risk-invalidation job (Phase 10.4). Enqueuing on a duplicate would wake
 * Sylesh's cache worker for nothing.
 */
export async function persistEvidenceEvent(event: NormalizedEvidenceEvent): Promise<boolean> {
  // createMany + skipDuplicates rather than create() + catch(P2002): a
  // replayed event is a routine, expected outcome on this path (Phase 10's
  // stream resumes at the start of a block on every reconnect, so the tail of
  // the previous session is reprocessed by design) — not an exceptional one.
  // Prisma logs every query error globally regardless of whether the caller
  // catches it, so throwing on every duplicate under normal operation would
  // spam error-level logs for something that isn't an error. createMany never
  // throws for a duplicate; it just doesn't create the row.
  const { count } = await prisma.evidenceEvent.createMany({ data: [event], skipDuplicates: true })
  return count === 1
}

/**
 * Deletes evidence from blocks above `fromBlock` on one chain.
 *
 * Phase 10.3: the Substreams sink's "undo" signal for reorged-out blocks must
 * roll back the corresponding rows. Scoped by chain because a reorg on one
 * chain says nothing about another.
 */
export async function rollbackEvidenceAboveBlock(
  chain: string,
  fromBlock: bigint,
): Promise<number> {
  const { count } = await prisma.evidenceEvent.deleteMany({
    where: { chain, blockNumber: { gt: fromBlock } },
  })
  if (count > 0) {
    logger.warn({ chain, fromBlock: fromBlock.toString(), count }, 'rolled back reorged evidence')
  }
  return count
}

/** Every event for a wallet, oldest first — the input shape Phase 6/7 expect. */
export async function getEvidenceForWallet(
  wallet: string,
  opts: { since?: Date; limit?: number } = {},
) {
  return prisma.evidenceEvent.findMany({
    where: {
      wallet: wallet.toLowerCase(),
      ...(opts.since ? { timestamp: { gte: opts.since } } : {}),
    },
    orderBy: [{ blockNumber: 'asc' }, { sourceId: 'asc' }],
    ...(opts.limit ? { take: opts.limit } : {}),
  })
}

/** Every event for a set of wallets — the candidate set Phase 6 clusters over. */
export async function getEvidenceForWallets(wallets: string[], opts: { since?: Date } = {}) {
  return prisma.evidenceEvent.findMany({
    where: {
      wallet: { in: wallets.map((w) => w.toLowerCase()) },
      ...(opts.since ? { timestamp: { gte: opts.since } } : {}),
    },
    orderBy: [{ blockNumber: 'asc' }, { sourceId: 'asc' }],
  })
}

/** Freshness input for Phase 11: the highest block we hold for a chain. */
export async function getLatestBlockForChain(chain: string): Promise<bigint | null> {
  const row = await prisma.evidenceEvent.findFirst({
    where: { chain },
    orderBy: { blockNumber: 'desc' },
    select: { blockNumber: true },
  })
  return row?.blockNumber ?? null
}
