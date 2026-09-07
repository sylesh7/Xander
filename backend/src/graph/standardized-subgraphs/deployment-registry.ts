/**
 * Deployment Registry — Backend-Suganthan.md Phase 4.
 *
 * THE ONLY PLACE "which protocols we support" LIVES.
 *
 * Adding protocol #10 is an INSERT into DeploymentRegistryEntry. It is never a
 * code change, never a switch, never a constant in a file (Section 0.2 rule 1).
 * This is the single pattern The Graph's own ETHGlobal Lisbon retrospective
 * flagged as the biggest independent convergence across ten teams — deeptrace,
 * atlas, BookerBob and "Am I cooked" each built one without coordinating.
 *
 * Loaded at startup and refreshed on a TTL, so an operator can enable a
 * protocol in the database and have it picked up without a redeploy.
 */
import { env } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'
import type { DeploymentEntry, SchemaFamily } from './types.js'

interface CacheState {
  entries: DeploymentEntry[]
  loadedAt: number
}

let cache: CacheState | null = null
/** De-duplicates concurrent refreshes so a cold start issues one query, not N. */
let inFlight: Promise<DeploymentEntry[]> | null = null

function isStale(state: CacheState): boolean {
  return Date.now() - state.loadedAt > env.DEPLOYMENT_REGISTRY_TTL_SECONDS * 1000
}

async function load(): Promise<DeploymentEntry[]> {
  const rows = await prisma.deploymentRegistryEntry.findMany({
    where: { enabled: true },
    orderBy: [{ schemaFamily: 'asc' }, { protocol: 'asc' }],
  })

  const entries: DeploymentEntry[] = rows.map((r) => ({
    id: r.id,
    protocol: r.protocol,
    chain: r.chain,
    schemaFamily: r.schemaFamily,
    deploymentId: r.deploymentId,
    enabled: r.enabled,
  }))

  cache = { entries, loadedAt: Date.now() }
  logger.debug(
    { count: entries.length, families: [...new Set(entries.map((e) => e.schemaFamily))] },
    'deployment registry loaded',
  )
  return entries
}

/**
 * All enabled deployments, from cache when fresh.
 *
 * Note this returns ONLY enabled rows: disabling a misbehaving protocol is an
 * UPDATE, and the next refresh stops querying it. No deploy required.
 */
export async function getDeployments(): Promise<DeploymentEntry[]> {
  if (cache && !isStale(cache)) return cache.entries
  if (inFlight) return inFlight

  inFlight = load().finally(() => {
    inFlight = null
  })
  return inFlight
}

/**
 * Every enabled deployment in one schema family.
 *
 * This is what a query module calls. It never asks "which protocol is this" —
 * the family selects the query, and the registry supplies the deployments.
 */
export async function getDeploymentsForFamily(
  family: SchemaFamily | string,
): Promise<DeploymentEntry[]> {
  const all = await getDeployments()
  return all.filter((e) => e.schemaFamily === family)
}

/** Every enabled deployment on one chain, across families. */
export async function getDeploymentsForChain(chain: string): Promise<DeploymentEntry[]> {
  const all = await getDeployments()
  return all.filter((e) => e.chain === chain)
}

/** The schema families that currently have at least one enabled deployment. */
export async function getActiveFamilies(): Promise<string[]> {
  const all = await getDeployments()
  return [...new Set(all.map((e) => e.schemaFamily))]
}

/**
 * Forces a reload on the next read. Call after seeding or after an operator
 * enables a protocol; Phase 11's /health reporting also uses this.
 */
export function invalidateRegistryCache(): void {
  cache = null
}

/** Test seam — lets a unit test install a registry without a database. */
export function __setRegistryCacheForTests(entries: DeploymentEntry[]): void {
  cache = { entries, loadedAt: Date.now() }
}
