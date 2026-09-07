/**
 * The one internal shape — Backend-Suganthan.md Phase 5.
 *
 * Token API, Standardized Subgraph and Substreams data all become this, so
 * nothing downstream ever knows which Graph product produced a fact.
 * `src/behavior-graph`, `src/risk` and `src/provenance` read EvidenceEvent rows
 * and never import from `src/graph/**`.
 */

/** Values `EvidenceEvent.sourceType` may hold. */
export const SOURCE_TYPES = ['token-api', 'standardized-subgraph', 'substreams'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

/**
 * Values `EvidenceEvent.eventType` may hold.
 *
 * Deliberately a closed set: PROTOCOL_BEHAVIOR_SIMILARITY (Phase 7) compares
 * ordered sequences of these, and a typo silently becoming a new "type" would
 * make two identical behaviours look different.
 */
export const EVENT_TYPES = [
  'transfer',
  'deposit',
  'withdraw',
  'borrow',
  'repay',
  'liquidate',
  'swap',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/**
 * A normalized evidence event, before it has a database id.
 *
 * Field notes that are correctness requirements, not style:
 * - `amount` is a string. On-chain amounts exceed Number.MAX_SAFE_INTEGER and
 *   must never pass through a float.
 * - `blockNumber` is a bigint for the same reason.
 * - `wallet` is the PERSPECTIVE address — the wallet this row is evidence
 *   about. `counterparty` is the other side. One transfer produces two rows if
 *   both ends are under analysis, which is why `wallet` is part of the
 *   uniqueness key.
 * - `sourceId` is the SOURCE's own key for this event (`hash-logIndex` and
 *   friends). It is what makes two events in the same transaction distinct.
 */
export interface NormalizedEvidenceEvent {
  chain: string
  wallet: string
  counterparty: string | null
  eventType: EventType
  protocol: string | null
  /** Schema family for subgraph-sourced events; null for raw transfers. */
  protocolType: string | null
  amount: string | null
  timestamp: Date
  blockNumber: bigint
  transactionHash: string
  sourceType: SourceType
  sourceId: string
  deploymentId: string | null
}

/** Lower-cases an address so the same wallet never appears under two spellings. */
export function normalizeAddress(address: string): string {
  return address.toLowerCase()
}

/**
 * Seconds-since-epoch (as number or string, which is how both The Graph and
 * the Token API report it) to a Date.
 *
 * Throws on a non-finite value rather than producing an Invalid Date that
 * would fail much later, inside a timing-correlation calculation, with no clue
 * where it came from.
 */
export function timestampFromSeconds(seconds: number | string): Date {
  const n = typeof seconds === 'string' ? Number(seconds) : seconds
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid timestamp: ${String(seconds)}`)
  }
  return new Date(n * 1000)
}
