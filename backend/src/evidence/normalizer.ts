/**
 * Evidence Normalizer — Backend-Suganthan.md Phase 5.
 *
 * Pure functions, one per source. No I/O, no database, no clock — everything
 * needed comes in as an argument, so each is independently unit-testable and
 * the Phase 7 feature extractors can be tested against fabricated events with
 * no network at all.
 *
 * After this boundary, nothing downstream knows whether a fact came from the
 * Token API, a Standardized Subgraph, or Substreams.
 */
import type { DeploymentEntry } from '../graph/standardized-subgraphs/types.js'
import type { TokenApiTransfer } from '../graph/token-api/types.js'
import {
  normalizeAddress,
  timestampFromSeconds,
  type EventType,
  type NormalizedEvidenceEvent,
} from './types.js'

// ---------------------------------------------------------------------------
// Token API  (Phase 3)
// ---------------------------------------------------------------------------

/**
 * A Token API transfer, from the perspective of one wallet.
 *
 * `perspective` decides which side of the transfer is `wallet` and which is
 * `counterparty`. The same transfer normalized from both ends yields two rows,
 * which is intended: each is evidence about a different wallet, and the
 * uniqueness key includes `wallet` precisely so both survive.
 *
 * `sourceId` embeds the log/call index. Without it, two transfers to the same
 * wallet in one transaction would collide on the Phase 5 uniqueness key and the
 * second would silently overwrite the first.
 */
export function normalizeTokenApiTransfer(
  transfer: TokenApiTransfer,
  perspective: string,
): NormalizedEvidenceEvent {
  const wallet = normalizeAddress(perspective)
  const from = normalizeAddress(transfer.from)
  const to = normalizeAddress(transfer.to)

  if (wallet !== from && wallet !== to) {
    throw new Error(
      `Perspective ${wallet} is neither side of transfer ${transfer.transaction_id} ` +
        `(${from} -> ${to}). Normalizing it would invent a relationship that does not exist.`,
    )
  }

  const sourceId =
    transfer.kind === 'erc20'
      ? `${transfer.transaction_id}-${transfer.log_index}`
      : `${transfer.transaction_id}-${transfer.transaction_index}-${transfer.call_index}`

  return {
    chain: transfer.network,
    wallet,
    counterparty: wallet === to ? from : to,
    eventType: 'transfer',
    // A plain transfer has no protocol. Attributing one here would fabricate
    // provenance the source never claimed.
    protocol: null,
    protocolType: null,
    amount: transfer.amount,
    timestamp: timestampFromSeconds(transfer.timestamp),
    blockNumber: BigInt(transfer.block_num),
    transactionHash: transfer.transaction_id,
    sourceType: 'token-api',
    sourceId,
    deploymentId: null,
  }
}

/** Normalizes a batch from one wallet's perspective. */
export function normalizeTokenApiTransfers(
  transfers: TokenApiTransfer[],
  perspective: string,
): NormalizedEvidenceEvent[] {
  return transfers.map((t) => normalizeTokenApiTransfer(t, perspective))
}

// ---------------------------------------------------------------------------
// Standardized Subgraphs  (Phase 4)
// ---------------------------------------------------------------------------

/**
 * The shape every Messari-family event shares. The three families differ in
 * what the counterparty entity is called — `market`, `pool`, `vault` — so the
 * caller passes it explicitly rather than this function sniffing fields.
 */
export interface SubgraphEventLike {
  id: string
  hash: string
  blockNumber: string | number
  timestamp: string | number
  amount?: string | null
  account: { id: string }
}

/**
 * A Standardized Subgraph event.
 *
 * `deploymentId` and `protocolType` come from the registry entry, not from the
 * response — provenance must say which pinned deployment produced this, and the
 * response cannot vouch for itself.
 *
 * `sourceId` is the subgraph's own entity id, which is already `hash-logIndex`
 * in every Messari schema, so it uniquely identifies the event within its tx.
 */
export function normalizeSubgraphEvent(
  event: SubgraphEventLike,
  eventType: EventType,
  entry: Pick<DeploymentEntry, 'chain' | 'protocol' | 'schemaFamily' | 'deploymentId'>,
  counterpartyId: string | null,
): NormalizedEvidenceEvent {
  return {
    chain: entry.chain,
    wallet: normalizeAddress(event.account.id),
    counterparty: counterpartyId ? normalizeAddress(counterpartyId) : null,
    eventType,
    protocol: entry.protocol,
    protocolType: entry.schemaFamily,
    amount: event.amount ?? null,
    timestamp: timestampFromSeconds(event.timestamp),
    blockNumber: BigInt(event.blockNumber),
    transactionHash: event.hash,
    sourceType: 'standardized-subgraph',
    sourceId: event.id,
    deploymentId: entry.deploymentId,
  }
}

/** Lending events. Counterparty is the market. */
export function normalizeLendingEvents(
  events: Array<SubgraphEventLike & { market?: { id: string } }>,
  eventType: EventType,
  entry: Pick<DeploymentEntry, 'chain' | 'protocol' | 'schemaFamily' | 'deploymentId'>,
): NormalizedEvidenceEvent[] {
  return events.map((e) => normalizeSubgraphEvent(e, eventType, entry, e.market?.id ?? null))
}

/** DEX events. Counterparty is the liquidity pool. */
export function normalizeDexEvents(
  events: Array<SubgraphEventLike & { pool?: { id: string } }>,
  eventType: EventType,
  entry: Pick<DeploymentEntry, 'chain' | 'protocol' | 'schemaFamily' | 'deploymentId'>,
): NormalizedEvidenceEvent[] {
  return events.map((e) => normalizeSubgraphEvent(e, eventType, entry, e.pool?.id ?? null))
}

/** Yield-aggregator events. Counterparty is the vault. */
export function normalizeYieldEvents(
  events: Array<SubgraphEventLike & { vault?: { id: string } }>,
  eventType: EventType,
  entry: Pick<DeploymentEntry, 'chain' | 'protocol' | 'schemaFamily' | 'deploymentId'>,
): NormalizedEvidenceEvent[] {
  return events.map((e) => normalizeSubgraphEvent(e, eventType, entry, e.vault?.id ?? null))
}

// ---------------------------------------------------------------------------
// Substreams  (Phases 9-10)
// ---------------------------------------------------------------------------

/**
 * One entity change delivered by the Substreams sink.
 *
 * Kept deliberately loose: the exact `EntityChanges` payload is settled in
 * Phase 9 when the Rust module is written. What is fixed now is that whatever
 * arrives goes through THIS function and comes out as an EvidenceEvent — the
 * webhook receiver never writes to the database directly.
 */
export interface SubstreamsEventInput {
  chain: string
  wallet: string
  counterparty?: string | null
  eventType: EventType
  protocol?: string | null
  protocolType?: string | null
  amount?: string | null
  /** Seconds since epoch. */
  timestamp: number | string
  blockNumber: number | string | bigint
  transactionHash: string
  /** The module's own key for this change, e.g. `${hash}-${index}`. */
  entityId: string
}

export function normalizeSubstreamsEvent(input: SubstreamsEventInput): NormalizedEvidenceEvent {
  return {
    chain: input.chain,
    wallet: normalizeAddress(input.wallet),
    counterparty: input.counterparty ? normalizeAddress(input.counterparty) : null,
    eventType: input.eventType,
    protocol: input.protocol ?? null,
    protocolType: input.protocolType ?? null,
    amount: input.amount ?? null,
    timestamp: timestampFromSeconds(input.timestamp),
    blockNumber: BigInt(input.blockNumber),
    transactionHash: input.transactionHash,
    sourceType: 'substreams',
    sourceId: input.entityId,
    deploymentId: null,
  }
}
