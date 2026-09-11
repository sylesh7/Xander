/**
 * Known-funder registry loader — Xander V2 spec section 12.3.
 *
 * The impure half of the known-funder mitigation. `fundingCorrelation` stays a
 * pure function that reads a Map it was handed; this module is the only thing
 * that touches the table.
 *
 * Readme.md has promised this registry "from day one" and called it "the single
 * most important lesson" from the Arbitrum airdrop precedent. Until V2 Phase 0
 * it did not exist, and shared-funder evidence was treated identically whether
 * the funder was a private wallet or Binance.
 */
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { knownFunderKey } from './features.js'
import type { Confidence, KnownFunder, KnownFunderCategory, KnownFunderIndex } from './types.js'

interface CacheEntry {
  loadedAtMs: number
  index: KnownFunderIndex
}

let cache: CacheEntry | null = null

/**
 * Every label live at `now`, indexed by `chain|address`.
 *
 * Cached in-process for KNOWN_FUNDER_CACHE_TTL_SECONDS, mirroring the
 * deployment registry: the table is small, changes rarely, and is read on every
 * cache-miss scoring pass, so re-querying it per claim is pure overhead.
 *
 * Expired labels are filtered out rather than deleted. An exchange rotating a
 * hot wallet retires the old address, but a decision made while that label was
 * live must stay reconstructable, so the row survives with a closed validTo.
 */
export async function loadKnownFunders(
  opts: { now?: Date; force?: boolean } = {},
): Promise<KnownFunderIndex> {
  const now = opts.now ?? new Date()
  const ttlMs = env.KNOWN_FUNDER_CACHE_TTL_SECONDS * 1000

  if (!opts.force && cache && Date.now() - cache.loadedAtMs < ttlMs) {
    return cache.index
  }

  const rows = await prisma.knownFunderAddress.findMany({
    where: {
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    select: { address: true, chain: true, label: true, category: true, confidence: true },
  })

  const index = new Map<string, KnownFunder>()
  for (const row of rows) {
    index.set(knownFunderKey(row.chain, row.address), {
      label: row.label,
      category: row.category as KnownFunderCategory,
      confidence: row.confidence as Confidence,
    })
  }

  cache = { loadedAtMs: Date.now(), index }
  logger.debug({ labels: index.size }, 'loaded known-funder registry')
  return index
}

/**
 * Drops the in-process cache.
 *
 * For tests that insert a label and immediately score against it, and for an
 * operator who has just corrected a bad label and does not want to wait out the
 * TTL before a wrong decision stops being made.
 */
export function resetKnownFunderCache(): void {
  cache = null
}
