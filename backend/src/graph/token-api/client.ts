/**
 * Token API client — Backend-Suganthan.md Phase 3.
 *
 * Answers: who funded this wallet, when, how much, from how many sources, and
 * when did it first appear.
 *
 * There is NO official Token API Node/TypeScript SDK (confirmed twice in the
 * spec's research passes, and again here — the service publishes an OpenAPI
 * document and nothing else). This thin authenticated fetch wrapper is the
 * permanent answer, not a placeholder waiting for an SDK that does not exist
 * (Section 0.2 rule 2).
 *
 * Everything this module returns is a raw Token API shape. Phase 5's normalizer
 * converts it to EvidenceEvent; nothing downstream should import from here.
 */
import { env, requireGraphMarketApiToken } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import type {
  TokenApiBalance,
  TokenApiErc20Transfer,
  TokenApiNativeTransfer,
  TokenApiResponse,
  TokenApiToken,
  TokenApiTransfer,
  TransferQuery,
} from './types.js'

/** Thrown for any non-2xx Token API response, with the status preserved. */
export class TokenApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Token API ${status} on ${path}: ${body.slice(0, 200)}`)
    this.name = 'TokenApiError'
  }

  /** Credential missing, expired, or revoked. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403
  }

  /** Plan rate limit (200/min on the free tier). Caller may back off and retry. */
  get isRateLimited(): boolean {
    return this.status === 429
  }
}

/** Supported network ids, from config — never a hardcoded switch (rule 1). */
function supportedNetworks(): string[] {
  return env.TOKEN_API_NETWORKS.split(',')
    .map((n) => n.trim())
    .filter(Boolean)
}

function assertNetwork(network: string): string {
  const allowed = supportedNetworks()
  if (!allowed.includes(network)) {
    throw new Error(
      `Unsupported Token API network "${network}". Allowed: ${allowed.join(', ')}. ` +
        'Update TOKEN_API_NETWORKS rather than editing code.',
    )
  }
  return network
}

/**
 * The plan caps how many items a single request may return, and returns 403 —
 * not a truncated list — when `limit` exceeds it. Clamp silently rather than
 * letting a caller's reasonable-looking `limit: 100` fail the whole fetch.
 */
function clampLimit(limit: number | undefined): number {
  const max = env.TOKEN_API_MAX_ITEMS
  if (limit === undefined) return max
  if (limit > max) {
    logger.debug({ requested: limit, max }, 'clamping Token API limit to plan maximum')
    return max
  }
  return Math.max(1, limit)
}

async function get<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T[]> {
  const url = new URL(path, env.TOKEN_API_BASE_URL)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${requireGraphMarketApiToken()}`,
    },
  })

  if (!res.ok) {
    throw new TokenApiError(res.status, path, await res.text())
  }

  const body = (await res.json()) as TokenApiResponse<T>
  return body.data ?? []
}

function transferParams(q: TransferQuery): Record<string, string | number | undefined> {
  return {
    network: assertNetwork(q.network ?? env.TOKEN_API_DEFAULT_NETWORK),
    transaction_id: q.transactionId,
    from_address: q.fromAddress,
    to_address: q.toAddress,
    start_time: q.startTime,
    end_time: q.endTime,
    start_block: q.startBlock,
    end_block: q.endBlock,
    limit: clampLimit(q.limit),
    page: q.page ?? 1,
  }
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * ERC-20 transfers.
 *
 * NOTE: this endpoint has no `address` parameter — it takes `from_address` and
 * `to_address` separately. (The spec documents `?address=`, which 200s while
 * silently ignoring the filter; verified against the live OpenAPI document.)
 * For funding evidence you want `toAddress`.
 */
export async function getTransfers(query: TransferQuery = {}): Promise<TokenApiErc20Transfer[]> {
  return get<TokenApiErc20Transfer>('/v1/evm/transfers', {
    ...transferParams(query),
    contract: query.contract,
  })
}

/**
 * Native-currency transfers (ETH, MATIC, ...).
 *
 * Queried separately because a funder bankrolling a cluster typically sends
 * plain ETH for gas, which never appears in the ERC-20 feed. Omitting this
 * would make FUNDING_CORRELATION blind to the most common funding pattern.
 */
export async function getNativeTransfers(
  query: TransferQuery = {},
): Promise<TokenApiNativeTransfer[]> {
  return get<TokenApiNativeTransfer>('/v1/evm/transfers/native', transferParams(query))
}

export async function getBalances(
  address: string,
  opts: { network?: string; contract?: string; limit?: number; page?: number } = {},
): Promise<TokenApiBalance[]> {
  return get<TokenApiBalance>('/v1/evm/balances', {
    network: assertNetwork(opts.network ?? env.TOKEN_API_DEFAULT_NETWORK),
    address,
    contract: opts.contract,
    limit: clampLimit(opts.limit),
    page: opts.page ?? 1,
  })
}

export async function getTokens(
  contract: string,
  opts: { network?: string } = {},
): Promise<TokenApiToken[]> {
  return get<TokenApiToken>('/v1/evm/tokens', {
    network: assertNetwork(opts.network ?? env.TOKEN_API_DEFAULT_NETWORK),
    contract,
    limit: clampLimit(undefined),
  })
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * Walks pages until exhausted or `maxItems` is reached.
 *
 * The free plan returns at most 10 items per request, so anything wanting a
 * wallet's real history must paginate. `maxItems` is a required guard — an
 * unbounded walk against a high-traffic address will burn the 200/min rate
 * limit and stall the caller.
 */
async function paginate<T>(
  fetchPage: (page: number) => Promise<T[]>,
  maxItems: number,
): Promise<T[]> {
  const out: T[] = []
  const pageSize = env.TOKEN_API_MAX_ITEMS
  const maxPages = Math.ceil(maxItems / pageSize)

  for (let page = 1; page <= maxPages; page++) {
    const rows = await fetchPage(page)
    out.push(...rows)
    if (rows.length < pageSize) break // short page means no more data
    if (out.length >= maxItems) break
  }

  return out.slice(0, maxItems)
}

/**
 * Every inbound transfer to a wallet — ERC-20 and native, merged and sorted
 * oldest-first.
 *
 * This is the primary input to FUNDING_CORRELATION (Phase 7): the earliest
 * inbound transfers identify a wallet's funder, and `FUNDING_LOOKBACK_HOPS`
 * decides how far back to walk from there.
 *
 * Sorted ascending by (block, then position within block) so "earliest inbound
 * transfer" is simply the first element.
 *
 * `maxItemsPerSource` caps EACH feed independently, so the result can hold up
 * to twice that many rows. This is deliberate: a single shared cap could fill
 * entirely with ERC-20 rows and return zero native transfers, hiding the gas
 * funder — precisely the blindness querying the native feed exists to prevent.
 */
export async function getInboundTransfers(
  address: string,
  opts: { network?: string; maxItemsPerSource?: number } = {},
): Promise<TokenApiTransfer[]> {
  const network = assertNetwork(opts.network ?? env.TOKEN_API_DEFAULT_NETWORK)
  const maxItems = opts.maxItemsPerSource ?? env.TOKEN_API_MAX_ITEMS * 5

  const [erc20, native] = await Promise.all([
    paginate<TokenApiErc20Transfer>(
      (page) => getTransfers({ network, toAddress: address, page }),
      maxItems,
    ),
    paginate<TokenApiNativeTransfer>(
      (page) => getNativeTransfers({ network, toAddress: address, page }),
      maxItems,
    ),
  ])

  const merged: TokenApiTransfer[] = [
    ...erc20.map((t) => ({ kind: 'erc20' as const, ...t })),
    ...native.map((t) => ({ kind: 'native' as const, ...t })),
  ]

  return merged.sort((a, b) => {
    if (a.block_num !== b.block_num) return a.block_num - b.block_num
    const ai = a.kind === 'erc20' ? a.log_index : a.transaction_index
    const bi = b.kind === 'erc20' ? b.log_index : b.transaction_index
    return ai - bi
  })
}

/**
 * The earliest block at which a wallet received anything — feeds
 * Wallet.firstSeenBlock and the WALLET_AGE_SIMILARITY feature (Phase 7).
 *
 * Returns null when the wallet has no inbound history, which the caller must
 * treat as "unknown", never as "block 0".
 */
export async function getFirstSeenBlock(
  address: string,
  opts: { network?: string } = {},
): Promise<number | null> {
  const transfers = await getInboundTransfers(address, opts)
  return transfers[0]?.block_num ?? null
}
