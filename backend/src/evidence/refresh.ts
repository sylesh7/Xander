/**
 * Wallet evidence refresh — Backend-Suganthan.md Phase 12.
 *
 * The real body behind `refreshWalletEvidence` in the Suganthan -> Sylesh
 * interface. Pulls Token API inbound transfers and Standardized Subgraph
 * account activity for a wallet, normalizes both, and persists idempotently.
 *
 * Deliberately does NOT decide whether a refresh is needed — that staleness
 * judgment belongs to the freshness guard (Phase 11) and to Sylesh's Phase 14
 * cache layer, which is documented as the caller of this on a cache miss.
 * This function always fetches when called; callers control WHEN it's called.
 */
import { getInboundTransfers } from '../graph/token-api/client.js'
import { getDeployments } from '../graph/standardized-subgraphs/deployment-registry.js'
import * as lendingCdp from '../graph/standardized-subgraphs/queries/lending-cdp.js'
import * as dexAmm from '../graph/standardized-subgraphs/queries/dex-amm.js'
import * as yieldAggregator from '../graph/standardized-subgraphs/queries/yield-aggregator.js'
import {
  normalizeDexEvents,
  normalizeLendingEvents,
  normalizeTokenApiTransfers,
  normalizeYieldEvents,
} from './normalizer.js'
import { persistEvidenceEvents } from './repository.js'
import { logger } from '../lib/logger.js'
import type { NormalizedEvidenceEvent } from './types.js'

export interface RefreshResult {
  tokenApiEvents: number
  subgraphEvents: number
  created: number
  errors: string[]
}

/**
 * One entry per schema family this project queries. Adding a fourth family
 * means adding a row here — the same registry-driven pattern as Phase 4,
 * never a hardcoded protocol branch (Section 0.2 rule 1).
 */
const FAMILY_HANDLERS = [
  {
    family: lendingCdp.SCHEMA_FAMILY,
    fetch: lendingCdp.getAccountActivityAcrossFamily,
    normalize: (
      data: Awaited<ReturnType<typeof lendingCdp.getAccountActivityAcrossFamily>>[number],
    ) => {
      if (!('result' in data)) return []
      const { entry, result } = data
      return [
        ...normalizeLendingEvents(result.data.deposits, 'deposit', entry),
        ...normalizeLendingEvents(result.data.borrows, 'borrow', entry),
        ...normalizeLendingEvents(result.data.repays, 'repay', entry),
        ...normalizeLendingEvents(result.data.withdraws, 'withdraw', entry),
      ]
    },
  },
  {
    family: dexAmm.SCHEMA_FAMILY,
    fetch: dexAmm.getAccountActivityAcrossFamily,
    normalize: (
      data: Awaited<ReturnType<typeof dexAmm.getAccountActivityAcrossFamily>>[number],
    ) => {
      if (!('result' in data)) return []
      const { entry, result } = data
      return [
        ...normalizeDexEvents(result.data.swaps, 'swap', entry),
        ...normalizeDexEvents(result.data.deposits, 'deposit', entry),
        ...normalizeDexEvents(result.data.withdraws, 'withdraw', entry),
      ]
    },
  },
  {
    family: yieldAggregator.SCHEMA_FAMILY,
    fetch: yieldAggregator.getAccountActivityAcrossFamily,
    normalize: (
      data: Awaited<ReturnType<typeof yieldAggregator.getAccountActivityAcrossFamily>>[number],
    ) => {
      if (!('result' in data)) return []
      const { entry, result } = data
      return [
        ...normalizeYieldEvents(result.data.deposits, 'deposit', entry),
        ...normalizeYieldEvents(result.data.withdraws, 'withdraw', entry),
      ]
    },
  },
] as const

/**
 * Fetches and persists a wallet's Token API history plus its activity across
 * every enabled Standardized Subgraph deployment, in every schema family.
 *
 * A single deployment failing (rate limit, transient network error) does not
 * abort the refresh — `queryFamily` already isolates per-deployment failures
 * (Phase 4), and this collects them as reported errors rather than throwing,
 * so a partial refresh still leaves whatever evidence WAS reachable in place
 * rather than leaving stale data because one deployment hiccuped.
 */
export async function refreshWalletEvidence(walletAddress: string): Promise<RefreshResult> {
  const wallet = walletAddress.toLowerCase()
  const errors: string[] = []
  const allEvents: NormalizedEvidenceEvent[] = []

  let tokenApiEvents = 0
  try {
    const transfers = await getInboundTransfers(wallet)
    const normalized = normalizeTokenApiTransfers(transfers, wallet)
    allEvents.push(...normalized)
    tokenApiEvents = normalized.length
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn({ wallet, err }, 'refreshWalletEvidence: Token API fetch failed')
    errors.push(`token-api: ${msg}`)
  }

  const registry = await getDeployments()
  let subgraphEvents = 0

  for (const handler of FAMILY_HANDLERS) {
    const deployments = registry.filter((d) => d.schemaFamily === handler.family)
    if (deployments.length === 0) continue

    try {
      const results = await handler.fetch(wallet, { deployments })
      for (const r of results) {
        if ('error' in r) {
          errors.push(`${r.entry.protocol}: ${r.error.message}`)
          continue
        }
        const events = handler.normalize(r as never)
        allEvents.push(...events)
        subgraphEvents += events.length
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(
        { wallet, family: handler.family, err },
        'refreshWalletEvidence: family fetch failed',
      )
      errors.push(`${handler.family}: ${msg}`)
    }
  }

  const { created } = await persistEvidenceEvents(allEvents)

  logger.debug(
    { wallet, tokenApiEvents, subgraphEvents, created, errors: errors.length },
    'refreshed wallet evidence',
  )

  return { tokenApiEvents, subgraphEvents, created, errors }
}
