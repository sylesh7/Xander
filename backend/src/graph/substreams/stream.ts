/**
 * Substreams stream consumer — Backend-Suganthan.md Phase 10.
 *
 * The bridge between the Phase 9 WASM module and the Phase 5 evidence
 * repository: connects over gRPC, decodes `sybil_shield.v1.FundingTransfers`,
 * normalizes it, persists it idempotently, handles reorgs, and enqueues
 * cache invalidation for Sylesh's Phase 14 worker.
 *
 * Built directly against `@substreams/core` + `@connectrpc/connect-node`
 * (pinned 0.16.0 / 1.3.0) rather than a third-party webhook-relay package.
 * That is a deliberate change from the original scaffold, not a shortcut:
 * checked against the current (2026) streamingfast/substreams-skills
 * substreams-sink guide, which documents this exact pattern as the current
 * recommendation for a custom app sink — cursor persistence and reorg
 * handling live in the consumer's own code either way, so a relay package
 * would add a hop without removing any of the work this file already does.
 *
 * EVERY TYPE BELOW WAS CHECKED AGAINST THE INSTALLED PACKAGE, not assumed from
 * the skill's illustrative example — the example and the real .d.ts files
 * disagree in three places:
 *   - `createRequest` has no `params` option. Module parameters are injected
 *     into the package's modules via `applyParams` BEFORE building the
 *     request, using `"moduleName=value"` strings.
 *   - `createGrpcTransport` requires `httpVersion: "2"` — the example omits it.
 *   - `stopBlockNum` is typed `number | bigint | \`+${number}\`` — a plain
 *     numeric string like `"1000"` is a type error; only the `+N` relative
 *     form is a template-literal string.
 * The three `response.message.case` branches (`blockScopedData`,
 * `blockUndoSignal`, `fatalError`) and the reorg/cursor rules ARE exactly as
 * the skill's javascript-sink.md and cursor-reorg.md document.
 */
import {
  applyParams,
  createAuthInterceptor,
  createRegistry,
  createRequest,
  createSubstream,
  fetchSubstream,
  streamBlocks,
  unpackMapOutput,
} from '@substreams/core'
import { readFile } from 'node:fs/promises'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { Code, ConnectError } from '@connectrpc/connect'
import { env, requireGraphMarketApiToken } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import { normalizeSubstreamsEvent, type SubstreamsEventInput } from '../../evidence/normalizer.js'
import { persistEvidenceEvent, rollbackEvidenceAboveBlock } from '../../evidence/repository.js'
import { enqueueRiskInvalidation } from './invalidation-queue.js'
import { getCursor, writeCursor } from './cursor.js'
import { resolveEndpoint } from './endpoints.js'

const MODULE_NAME = 'map_funding_transfers'

/** The decoded shape of one FundingTransfers message, as proto3 JSON. */
interface FundingTransfersJson {
  blockNumber?: string
  timestamp?: string
  erc20?: Array<{
    blockNumber?: string
    timestamp?: string
    txHash?: string
    logIndex?: number
    contract?: string
    from?: string
    to?: string
    value?: string
  }>
  native?: Array<{
    blockNumber?: string
    timestamp?: string
    txHash?: string
    transactionIndex?: number
    from?: string
    to?: string
    value?: string
  }>
}

/**
 * Fatal transport errors that must NOT be retried.
 *
 * Deliberately excludes `Code.Internal` — on a long-lived stream that is
 * normally a transient RST_STREAM/reset, the routine disconnect a retry loop
 * exists to ride out, not a real failure.
 */
const FATAL_CODES = new Set<Code>([Code.Unauthenticated, Code.InvalidArgument])

function isRetryable(err: unknown): boolean {
  if (err instanceof ConnectError) return !FATAL_CODES.has(err.code)
  return true
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Loads a `.spkg` from a local filesystem path or a remote URL.
 *
 * `fetchSubstream` (`@substreams/core`) calls the platform `fetch`, which does
 * NOT support `file://` on Node — confirmed by running it: "fetch failed: not
 * implemented... yet...". A bare path with no scheme (or a Windows drive
 * letter, which `new URL()` also rejects) is read directly and parsed with
 * `createSubstream`, which is the same real function `fetchSubstream` uses
 * internally once bytes are in hand. Only an actual remote scheme goes through
 * `fetchSubstream`.
 */
async function loadPackage(spkgPath: string): ReturnType<typeof fetchSubstream> {
  const isRemote = /^(https?|ipfs|gs):\/\//i.test(spkgPath)
  if (isRemote) return fetchSubstream(spkgPath)
  return createSubstream(await readFile(spkgPath))
}

export interface StreamOptions {
  network?: string
  /** Comma-separated lower-case addresses. Empty = no filter (see substreams.yaml). */
  watchList?: string
  startBlock?: bigint
  /**
   * Absolute block number, or `+N` relative to startBlock. Omit to stream
   * forever. Matches `createRequest`'s real `stopBlockNum` type — a plain
   * numeric string is not accepted, only the `+N` template form.
   */
  stopBlock?: number | bigint | `+${number}`
  spkgPath: string
}

function funder(t: { from?: string }): string {
  if (!t.from) throw new Error('Substreams event missing `from` address')
  return t.from
}

function recipient(t: { to?: string }): string {
  if (!t.to) throw new Error('Substreams event missing `to` address')
  return t.to
}

/** Builds the two normalized (from-perspective, to-perspective) rows for one transfer. */
function transferPair(
  chain: string,
  entityId: string,
  common: Pick<SubstreamsEventInput, 'timestamp' | 'blockNumber' | 'transactionHash' | 'amount'>,
  from: string,
  to: string,
): [SubstreamsEventInput, SubstreamsEventInput] {
  return [
    { chain, wallet: from, counterparty: to, eventType: 'transfer', entityId, ...common },
    { chain, wallet: to, counterparty: from, eventType: 'transfer', entityId, ...common },
  ]
}

/**
 * Converts one decoded FundingTransfers block into normalized events and
 * persists them, then enqueues one invalidation per distinct wallet touched.
 *
 * Runs BEFORE the cursor is written for this block (Golden Rule 1) — if the
 * process dies partway through this function, the block is reprocessed on
 * restart, and Phase 5's idempotent upsert makes that free rather than
 * duplicating anything.
 */
async function persistBlock(chain: string, data: FundingTransfersJson): Promise<void> {
  const touched = new Set<string>()
  const inputs: SubstreamsEventInput[] = []

  for (const t of data.erc20 ?? []) {
    if (!t.txHash || t.blockNumber === undefined || t.timestamp === undefined) continue
    const from = funder(t)
    const to = recipient(t)
    inputs.push(
      ...transferPair(
        chain,
        `${t.txHash}-${t.logIndex ?? 0}`,
        {
          timestamp: t.timestamp,
          blockNumber: t.blockNumber,
          transactionHash: t.txHash,
          amount: t.value ?? null,
        },
        from,
        to,
      ),
    )
    touched.add(from.toLowerCase())
    touched.add(to.toLowerCase())
  }

  for (const t of data.native ?? []) {
    if (!t.txHash || t.blockNumber === undefined || t.timestamp === undefined) continue
    const from = funder(t)
    const to = recipient(t)
    inputs.push(
      ...transferPair(
        chain,
        `${t.txHash}-${t.transactionIndex ?? 0}`,
        {
          timestamp: t.timestamp,
          blockNumber: t.blockNumber,
          transactionHash: t.txHash,
          amount: t.value ?? null,
        },
        from,
        to,
      ),
    )
    touched.add(from.toLowerCase())
    touched.add(to.toLowerCase())
  }

  let anyNew = false
  for (const input of inputs) {
    const isNew = await persistEvidenceEvent(normalizeSubstreamsEvent(input))
    anyNew ||= isNew
  }

  // Only wake Sylesh's cache worker when something actually changed — a
  // replayed block (e.g. after a restart) touches no new rows and should not
  // spend a job evicting and repopulating a cache that never went stale.
  if (anyNew) {
    for (const wallet of touched) {
      await enqueueRiskInvalidation(wallet)
    }
  }
}

/**
 * Handles the chain's "undo" signal for reorged-out blocks.
 *
 * Rolls back EvidenceEvent rows above the last valid block, THEN persists the
 * rewound cursor — the same after-not-before ordering as the happy path, for
 * the same reason: a crash between the two steps should redo the rollback
 * rather than resume from a cursor claiming work that was never rolled back.
 */
export async function handleUndo(
  chain: string,
  lastValidBlockNumber: bigint,
  lastValidCursor: string,
): Promise<void> {
  const removed = await rollbackEvidenceAboveBlock(chain, lastValidBlockNumber)
  await writeCursor(chain, MODULE_NAME, lastValidCursor, lastValidBlockNumber)
  logger.warn(
    { chain, lastValidBlockNumber: lastValidBlockNumber.toString(), removed },
    'reorg: rolled back evidence and rewound cursor',
  )
}

/** One streaming pass. Returns normally on a clean stream end (a stopBlock hit). */
async function runOnce(
  pkg: Awaited<ReturnType<typeof fetchSubstream>>,
  chain: string,
  opts: StreamOptions,
): Promise<void> {
  const token = requireGraphMarketApiToken()
  const endpoint = resolveEndpoint(opts.network ?? chain)
  const registry = createRegistry(pkg)

  // Module parameters have no field on createRequest — they are applied
  // in-place to the package's module list first (verified against the
  // installed @substreams/core types, which differ from the skill's example).
  applyParams([`${MODULE_NAME}=${opts.watchList ?? ''}`], pkg.modules?.modules ?? [])

  const transport = createGrpcTransport({
    httpVersion: '2',
    baseUrl: `https://${endpoint}`,
    interceptors: [createAuthInterceptor(token)],
    jsonOptions: { typeRegistry: registry },
  })

  const cursor = await getCursor(chain, MODULE_NAME)
  const request = createRequest({
    substreamPackage: pkg,
    outputModule: MODULE_NAME,
    productionMode: true,
    startBlockNum: opts.startBlock ?? 0n,
    stopBlockNum: opts.stopBlock ?? 0,
    startCursor: cursor,
  })

  let blockCount = 0

  for await (const response of streamBlocks(transport, request)) {
    switch (response.message.case) {
      case 'blockScopedData': {
        const data = response.message.value
        const unpacked = unpackMapOutput(response, registry)
        if (unpacked !== undefined) {
          await persistBlock(chain, unpacked.toJson() as FundingTransfersJson)
          // Rule 1: cursor written only after the block's evidence is durable.
          await writeCursor(chain, MODULE_NAME, data.cursor, data.clock?.number ?? 0n)
          blockCount++
        }
        break
      }
      case 'blockUndoSignal': {
        const signal = response.message.value
        if (signal.lastValidBlock) {
          await handleUndo(chain, signal.lastValidBlock.number, signal.lastValidCursor)
        }
        break
      }
      case 'fatalError':
        // A server-side module failure. Without this branch it falls through
        // and the stream just ends "cleanly" with no indication anything
        // went wrong — the single most misleading failure mode this
        // consumer could have.
        throw new Error(
          `Substreams fatal error in module ${response.message.value.module}: ` +
            `${response.message.value.reason}`,
        )
      default:
        break
    }
  }

  // A clean exit with zero blocks processed and no stopBlock configured is not
  // success — createGrpcTransport ends the stream silently on a bad token
  // instead of throwing Unauthenticated.
  if (blockCount === 0 && !opts.stopBlock) {
    throw new Error('Substreams stream ended with 0 blocks processed — check the API token')
  }
}

/**
 * Runs the stream with reconnect/backoff, resuming from the persisted cursor
 * on every reconnect (Golden Rule 2).
 */
export async function runSubstreamsStream(opts: StreamOptions): Promise<void> {
  const chain = opts.network ?? env.SUBSTREAMS_DEFAULT_NETWORK
  const pkg = await loadPackage(opts.spkgPath)

  let attempt = 0
  for (;;) {
    try {
      await runOnce(pkg, chain, opts)
      return
    } catch (err) {
      if (!isRetryable(err)) {
        logger.error({ err, chain }, 'fatal Substreams stream error — not retrying')
        throw err
      }
      attempt++
      const delayMs = Math.min(30_000, 1000 * 2 ** attempt)
      logger.warn({ err, chain, attempt, delayMs }, 'retryable Substreams error, reconnecting')
      await sleep(delayMs)
    }
  }
}
