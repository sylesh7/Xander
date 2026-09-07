/**
 * Standardized Subgraphs gateway client — Backend-Suganthan.md Phase 4.
 *
 * Generic: it knows how to talk to the gateway and how to capture provenance.
 * It knows nothing about lending, DEXes or vaults — that lives in queries/*,
 * one module per SCHEMA FAMILY, never per protocol.
 *
 * Two consumer-facing request shapes, per The Graph's "Serving Queries" docs:
 *
 *   POST /api/subgraphs/id/{SUBGRAPH_ID}       — gateway resolves to the latest
 *                                                sufficiently-synced deployment
 *   POST /api/deployments/id/{DEPLOYMENT_ID}   — pins an exact version
 *
 * The spec's Section 0.3 shows only the `subgraphs` form while Section 0.4
 * documents DeploymentRegistryEntry.deploymentId as "the Qm... id from Graph
 * Explorer". Those are different identifier spaces and the path segment must
 * match the identifier kind, so this client picks the path from the
 * identifier's shape rather than hardcoding one.
 *
 * For a Sybil firewall, pinning matters: `/deployments/id/` is what makes an
 * Evidence Receipt reproducible months later. `/subgraphs/id/` silently follows
 * whatever version an Indexer has synced, which would make a replayed decision
 * disagree with the original.
 *
 * AUTH: `Authorization: Bearer <API_KEY>`. The legacy form embedding the key in
 * the path (/api/{key}/subgraphs/id/...) still resolves on gateway.thegraph.com
 * and is available via GRAPH_GATEWAY_AUTH_MODE=path, but header auth is the
 * documented method and keeps the key out of access logs, proxy logs and
 * Referer headers. Default is header.
 */
import { env, requireGraphGatewayApiKey } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import type { DeploymentEntry, GraphMeta, ProvenancedResult, QueryProvenance } from './types.js'

/** Thrown when the gateway returns a transport error or GraphQL errors. */
export class SubgraphQueryError extends Error {
  constructor(
    readonly deploymentId: string,
    message: string,
    readonly graphQLErrors?: unknown[],
    readonly status?: number,
  ) {
    super(`Subgraph query failed for ${deploymentId}: ${message}`)
    this.name = 'SubgraphQueryError'
  }

  /** Key missing, disabled, or outside its subgraph/domain allow-list. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403
  }

  /** Key's rate limit or monthly cap reached. */
  get isRateLimited(): boolean {
    return this.status === 429
  }

  /**
   * 402: the gateway's escrow is unfunded, or its sender is not yet whitelisted
   * by Indexers. Distinct from an auth failure — the credential is fine, the
   * payment path is not — so an operator gets a useful alert rather than
   * hunting a key problem that does not exist.
   */
  get isPaymentRequired(): boolean {
    return this.status === 402
  }
}

/**
 * A deployment id is an IPFS CIDv0 (`Qm…`) or a 0x-prefixed 32-byte hash.
 * A subgraph id is base58 and neither of those. The gateway exposes them under
 * different path segments.
 */
export function gatewayPathFor(id: string): 'deployments' | 'subgraphs' {
  return id.startsWith('Qm') || id.startsWith('0x') ? 'deployments' : 'subgraphs'
}

export function buildGatewayUrl(id: string): string {
  const base = `${env.GRAPH_GATEWAY_BASE_URL}/api`
  const suffix = `${gatewayPathFor(id)}/id/${id}`
  return env.GRAPH_GATEWAY_AUTH_MODE === 'path'
    ? `${base}/${requireGraphGatewayApiKey()}/${suffix}`
    : `${base}/${suffix}`
}

/** Request headers, including bearer auth unless the key rides in the path. */
export function gatewayHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (env.GRAPH_GATEWAY_AUTH_MODE !== 'path') {
    headers.Authorization = `Bearer ${requireGraphGatewayApiKey()}`
  }
  return headers
}

/**
 * `_meta` is appended to every query — Section 0.2 rule 3. Provenance is not a
 * decoration bolted on later; a result without it cannot be scored.
 */
const META_FRAGMENT = `_meta { block { number hash } deployment hasIndexingErrors }`

/** Splices the _meta selection into a query body's outermost braces. */
export function withMeta(query: string): string {
  const close = query.lastIndexOf('}')
  if (close === -1) throw new Error('Malformed GraphQL query: no closing brace')
  return `${query.slice(0, close)}  ${META_FRAGMENT}\n${query.slice(close)}`
}

function toProvenance(pinned: string, meta: GraphMeta | undefined): QueryProvenance {
  const served = meta?.deployment ?? null
  return {
    pinnedDeployment: pinned,
    servedDeployment: served,
    block: meta?.block?.number != null ? String(meta.block.number) : null,
    blockHash: meta?.block?.hash ?? null,
    // A gateway that reports no deployment cannot be proven to match. Treat
    // "unknown" as "does not match" — failing closed is the whole point.
    deploymentMatches: served !== null && served === pinned,
    hasIndexingErrors: meta?.hasIndexingErrors === true,
    fetchedAt: new Date(),
  }
}

/**
 * Runs a GraphQL query against one pinned deployment and returns the data with
 * its provenance.
 *
 * Deliberately does NOT throw on a deployment mismatch — it records it in
 * provenance and lets Phase 11's freshness guard decide. That keeps the
 * "what happened" and "what do we do about it" concerns separate, and means an
 * investigator can still see the mismatched data rather than only an exception.
 */
export async function queryDeployment<T>(
  entry: Pick<DeploymentEntry, 'deploymentId' | 'protocol' | 'schemaFamily'>,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<ProvenancedResult<T>> {
  const url = buildGatewayUrl(entry.deploymentId)
  const body = JSON.stringify({ query: withMeta(query), variables })

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers: gatewayHeaders(), body })
  } catch (cause) {
    throw new SubgraphQueryError(
      entry.deploymentId,
      cause instanceof Error ? cause.message : 'network error',
    )
  }

  if (!res.ok) {
    throw new SubgraphQueryError(
      entry.deploymentId,
      `HTTP ${res.status}: ${await res.text()}`,
      undefined,
      res.status,
    )
  }

  const payload = (await res.json()) as {
    data?: (T & { _meta?: GraphMeta }) | null
    errors?: unknown[]
  }

  if (payload.errors?.length) {
    throw new SubgraphQueryError(
      entry.deploymentId,
      JSON.stringify(payload.errors).slice(0, 300),
      payload.errors,
    )
  }
  if (!payload.data) {
    throw new SubgraphQueryError(entry.deploymentId, 'gateway returned no data')
  }

  const { _meta, ...data } = payload.data
  const provenance = toProvenance(entry.deploymentId, _meta)

  if (!provenance.deploymentMatches) {
    // The deeptrace/atlas discipline: pinned deployment did not serve this.
    logger.warn(
      {
        protocol: entry.protocol,
        pinned: provenance.pinnedDeployment,
        served: provenance.servedDeployment,
      },
      'deployment mismatch — provenance flagged, Phase 11 must not score on this',
    )
  }

  return { data: data as T, provenance }
}

/**
 * Runs the SAME query across every deployment in a schema family.
 *
 * This is the Phase 4 acceptance test in function form: two deployment ids
 * tagged with the same schemaFamily flow through one query function with no
 * `if (protocol === 'aave')` branch anywhere.
 *
 * A failing deployment does not abort the batch — it is returned as an error
 * entry so the caller can score on what succeeded while Phase 11 accounts for
 * what did not.
 */
export async function queryFamily<T>(
  entries: DeploymentEntry[],
  query: string,
  variables: Record<string, unknown> = {},
): Promise<
  Array<{ entry: DeploymentEntry } & ({ result: ProvenancedResult<T> } | { error: Error })>
> {
  return Promise.all(
    entries.map(async (entry) => {
      try {
        return { entry, result: await queryDeployment<T>(entry, query, variables) }
      } catch (err) {
        logger.warn({ protocol: entry.protocol, err }, 'deployment query failed')
        return { entry, error: err instanceof Error ? err : new Error(String(err)) }
      }
    }),
  )
}
