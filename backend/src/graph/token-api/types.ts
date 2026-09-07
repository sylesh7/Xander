/**
 * Token API response shapes.
 *
 * These field names are NOT guessed and NOT copied from the spec — they were
 * read off live responses and the service's own OpenAPI document
 * (Pinax API 3.21.1, 2026-07-09) during Phase 3.
 *
 * Nothing outside src/graph/token-api may import these. Phase 5's normalizer
 * turns them into EvidenceEvent rows, and downstream code only ever sees that
 * shape (Backend-Suganthan.md Phase 3: "Feed every response through the Phase 5
 * normalizer immediately — nothing downstream touches a raw Token API shape.").
 */

/** Envelope every Token API endpoint returns. */
export interface TokenApiResponse<T> {
  data: T[]
  statistics?: Record<string, unknown>
  pagination?: Record<string, unknown>
}

/**
 * An ERC-20 transfer from GET /v1/evm/transfers.
 *
 * `amount` is the raw on-chain integer as a string — never parse it into a
 * number (Section 0.2 / schema rule: on-chain amounts are strings, never
 * floats). `value` is the service's pre-divided decimal convenience field and
 * is lossy; prefer `amount` + `decimals` for anything that must be exact.
 */
export interface TokenApiErc20Transfer {
  block_num: number
  datetime: string
  timestamp: number
  transaction_id: string
  log_index: number
  contract: string
  type: string
  from: string
  to: string
  name?: string
  symbol?: string
  decimals?: number
  amount: string
  value?: number
  network: string
}

/**
 * A native-currency (ETH/MATIC/...) transfer from GET /v1/evm/transfers/native.
 *
 * Shape differs from the ERC-20 one: no `contract`, and `transaction_index` +
 * `call_index` replace `log_index`. Native transfers matter for funding
 * analysis — a funder bankrolling a Sybil cluster commonly sends plain ETH for
 * gas, which never appears in the ERC-20 feed.
 */
export interface TokenApiNativeTransfer {
  block_num: number
  datetime: string
  timestamp: number
  transaction_id: string
  transaction_index: number
  call_index: number
  type: string
  from: string
  to: string
  name?: string
  symbol?: string
  decimals?: number
  amount: string
  value?: number
  network: string
}

/** A token balance from GET /v1/evm/balances. */
export interface TokenApiBalance {
  last_update: string
  last_update_block_num: number
  last_update_timestamp: number
  address: string
  contract: string
  amount: string
  value?: number
  name?: string
  symbol?: string
  decimals?: number
  network?: string
}

/** Token metadata from GET /v1/evm/tokens. */
export interface TokenApiToken {
  contract: string
  name?: string
  symbol?: string
  decimals?: number
  network?: string
  [key: string]: unknown
}

/**
 * Either transfer kind, tagged so the Phase 5 normalizer can branch without
 * re-sniffing fields.
 */
export type TokenApiTransfer =
  ({ kind: 'erc20' } & TokenApiErc20Transfer) | ({ kind: 'native' } & TokenApiNativeTransfer)

/** Query options shared by both transfer endpoints. */
export interface TransferQuery {
  network?: string
  transactionId?: string
  /** ERC-20 endpoint only; ignored for native transfers. */
  contract?: string
  fromAddress?: string
  toAddress?: string
  startTime?: string
  endTime?: string
  startBlock?: number
  endBlock?: number
  /** Clamped to TOKEN_API_MAX_ITEMS — the API 403s above its plan cap. */
  limit?: number
  page?: number
}
