/**
 * Standardized Subgraphs — shared types. Backend-Suganthan.md Phase 4.
 *
 * Schema families and their entity names were verified against the live
 * Messari schema files and The Graph's Standardized Subgraphs docs
 * (2026-09-07), not recalled. See src/graph/standardized-subgraphs/queries/*
 * for the per-family entity lists and where each was confirmed.
 */

/**
 * Schema family identifiers.
 *
 * These are the values `DeploymentRegistryEntry.schemaFamily` may hold. The
 * whole point of Phase 4 is that a family — not a protocol — selects the query
 * module, so adding protocol #10 is an INSERT and never a code change
 * (Section 0.2 rule 1).
 *
 * The Graph publishes 11 standardized schemas; these three are the ones this
 * project queries. Adding a fourth means adding a query module here, not a
 * branch in existing code.
 */
export const SCHEMA_FAMILIES = ['lending-cdp', 'dex-amm', 'yield-aggregator'] as const

export type SchemaFamily = (typeof SCHEMA_FAMILIES)[number]

export function isSchemaFamily(value: string): value is SchemaFamily {
  return (SCHEMA_FAMILIES as readonly string[]).includes(value)
}

/**
 * A registry row, narrowed to what the client needs. Mirrors
 * DeploymentRegistryEntry in the locked schema.
 */
export interface DeploymentEntry {
  id: string
  protocol: string
  chain: string
  schemaFamily: string
  deploymentId: string
  enabled: boolean
}

/**
 * Provenance captured on EVERY query — Section 0.2 rule 3.
 *
 * `deploymentMatches` is the check `deeptrace` and `atlas` each built
 * independently: the deployment the gateway actually served must equal the
 * deployment pinned in the registry. A mismatch means the data is not from the
 * source we think it is, and Phase 11 must refuse to score on it.
 */
export interface QueryProvenance {
  /** The deployment id pinned in DeploymentRegistryEntry. */
  pinnedDeployment: string
  /** The deployment the gateway reported in _meta. Null if it did not report one. */
  servedDeployment: string | null
  /** Block number as a string — exceeds Number.MAX_SAFE_INTEGER. */
  block: string | null
  blockHash: string | null
  /** False when the served deployment does not match the pinned one. */
  deploymentMatches: boolean
  /** True when the gateway flagged the response as served from an unfinalised block. */
  hasIndexingErrors: boolean
  fetchedAt: Date
}

/** Every query returns its payload alongside the provenance that produced it. */
export interface ProvenancedResult<T> {
  data: T
  provenance: QueryProvenance
}

/** The `_meta` block appended to every query. */
export interface GraphMeta {
  block: { number: number; hash?: string | null }
  deployment?: string | null
  hasIndexingErrors?: boolean | null
}
