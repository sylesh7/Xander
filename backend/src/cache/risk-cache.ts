/**
 * Risk cache — Backend-Sylesh.md Phase 14.
 *
 * The point of this module is latency asymmetry: a normal claimant should get
 * an instant lookup, and only a genuinely unknown or newly-active wallet should
 * pay for the live Token API + Standardized Subgraph query chain behind
 * `getOrComputeClusterRisk`.
 *
 * Two things about the design are deliberate and worth not "fixing" later:
 *
 * 1. TTL IS A SAFETY NET, NOT THE INVALIDATION MECHANISM. Correctness comes
 *    from explicit eviction driven by Suganthan's `risk-invalidation` queue
 *    (see invalidation-worker.ts). The TTL only bounds how long an entry can
 *    outlive an invalidation that never arrived — a crashed worker, a dropped
 *    Redis connection. Raising it is a latency/staleness tradeoff, never a
 *    correctness one.
 *
 * 2. REDIS BEING DOWN IS A DEGRADATION, NOT AN OUTAGE. Every operation here
 *    returns null / silently no-ops on a Redis error, and the caller falls
 *    through to a direct computation. Phase 23's failure matrix requires
 *    exactly this: "Redis cache unavailable -> falls through to a direct
 *    getOrComputeClusterRisk call, degraded but correct, not a crash."
 */
import Redis from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import {
  getOrComputeClusterRisk,
  refreshWalletEvidence,
  type ClusterRisk,
} from '../interfaces/evidence-risk-api.js'

/**
 * Key convention is fixed by Phase 14: `risk:cluster:<clusterId>` and
 * `risk:wallet:<address>`.
 *
 * The full ClusterRisk is written under BOTH keys for a clustered wallet
 * rather than storing a pointer under the wallet key. A pointer would make
 * every read two round trips, and the acceptance test asks for a single-digit
 * millisecond hit. The duplication is a few hundred bytes.
 */
const walletKey = (address: string): string => `risk:wallet:${address.toLowerCase()}`
const clusterKey = (clusterId: string): string => `risk:cluster:${clusterId}`

/**
 * Members of a cluster that currently have a cached entry.
 *
 * This exists so an invalidation addressed to a CLUSTER id can find and evict
 * the per-wallet copies above. Without it, a cluster-keyed job would evict the
 * cluster entry and leave every member's wallet entry serving the pre-event
 * score — the exact staleness the invalidation was published to prevent.
 */
const clusterMembersKey = (clusterId: string): string => `risk:cluster:${clusterId}:members`

let client: Redis | null = null

/** Null means "no cache this request" — every caller must handle that. */
function getClient(): Redis | null {
  if (!env.RISK_CACHE_ENABLED) return null

  client ??= (() => {
    const c = new Redis(env.REDIS_URL, {
      // The offline queue stays ENABLED. Disabling it looks like the fail-fast
      // choice, but ioredis then drops every command issued during the initial
      // connect handshake — so the first requests after boot silently miss a
      // cache that is actually healthy. `maxRetriesPerRequest` is what bounds a
      // genuine outage: commands reject after one retry, the catch below turns
      // that into a miss, and the caller computes directly.
      maxRetriesPerRequest: 1,
      connectTimeout: env.RISK_CACHE_CONNECT_TIMEOUT_MS,
      lazyConnect: false,
    })
    // ioredis emits 'error' on an EventEmitter with no listener, which crashes
    // the process. A cache outage must never do that.
    c.on('error', (err: Error) => {
      logger.warn({ err: err.message }, 'risk cache: redis error — serving from the compute path')
    })
    return c
  })()

  return client
}

let readyOnce: Promise<void> | null = null

/**
 * The client, but only once it is actually usable.
 *
 * Two failure shapes have to be handled differently and this is what separates
 * them. During the initial connect the client is healthy but not yet `ready`,
 * so a brief bounded wait lets the first requests after boot use the cache
 * instead of silently missing it. When Redis is genuinely down that wait times
 * out ONCE; every call afterwards sees a non-ready status and short-circuits
 * immediately, so a dead cache costs microseconds per claim rather than
 * seconds. If Redis later recovers, ioredis flips the status back to `ready`
 * on its own and the cache resumes with no restart.
 */
async function getReadyClient(): Promise<Redis | null> {
  const c = getClient()
  if (!c) return null
  if (c.status === 'ready') return c

  readyOnce ??= new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      c.off('ready', finish)
      resolve()
    }
    const timer = setTimeout(finish, env.RISK_CACHE_CONNECT_TIMEOUT_MS)
    c.once('ready', finish)
  })
  await readyOnce

  // Re-read through a widened type: the status legitimately changes across the
  // await, which the compiler cannot see past the narrowing above.
  const status: string = c.status
  return status === 'ready' ? c : null
}

/**
 * Reads a cached assessment for a wallet. Null means miss — compute it.
 *
 * A parse failure is treated as a miss rather than an error: a corrupt or
 * previous-schema entry should cost one recomputation, not a failed claim.
 */
export async function readCachedRisk(wallet: string): Promise<ClusterRisk | null> {
  const redis = await getReadyClient()
  if (!redis) return null

  try {
    const raw = await redis.get(walletKey(wallet))
    if (!raw) return null
    return JSON.parse(raw) as ClusterRisk
  } catch (err) {
    logger.warn({ wallet, err }, 'risk cache: read failed — treating as a miss')
    return null
  }
}

/**
 * Caches an assessment.
 *
 * PENDING_REVIEW IS NEVER CACHED. It means "a Graph query was stale or failed",
 * which is a transient condition about the system, not a finding about the
 * wallet. Caching it for an hour would keep holding claims long after the
 * evidence recovered, and would make the freshness guard's own recovery
 * invisible. A miss on the next request is exactly what we want here.
 */
export async function writeCachedRisk(wallet: string, risk: ClusterRisk): Promise<void> {
  if (risk.status === 'PENDING_REVIEW') return

  const redis = await getReadyClient()
  if (!redis) return

  const ttl = env.RISK_CACHE_TTL_SECONDS
  const payload = JSON.stringify(risk)

  try {
    const pipeline = redis.pipeline()
    pipeline.set(walletKey(wallet), payload, 'EX', ttl)

    if (risk.clusterId) {
      pipeline.set(clusterKey(risk.clusterId), payload, 'EX', ttl)
      pipeline.sadd(clusterMembersKey(risk.clusterId), wallet.toLowerCase())
      // The member index outlives the entries it indexes on purpose. If it
      // expired first, a cluster-keyed invalidation arriving late would find an
      // empty set and skip wallet keys that are still live.
      pipeline.expire(clusterMembersKey(risk.clusterId), ttl * 2)
    }

    await pipeline.exec()
  } catch (err) {
    logger.warn({ wallet, err }, 'risk cache: write failed — entry not cached')
  }
}

/**
 * A wallet address, as opposed to a Cluster.id (a cuid).
 *
 * The invalidation payload is documented as "a 0x... address OR a Cluster.id"
 * (docs/EVIDENCE-RISK-INTERFACE.md §4), so the consumer has to tell them apart.
 */
export function isWalletAddress(id: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(id)
}

/**
 * Evicts everything affected by new evidence for `walletOrClusterId`, and
 * returns the wallets whose risk is now unknown.
 *
 * Evicting the whole cluster for a single wallet's event is not
 * over-invalidation — it is Section 0.2 rule 6. The cluster is the unit of
 * analysis, so one member's new funding transfer changes the score every member
 * inherits. Evicting only the wallet that moved would leave its four siblings
 * serving a score computed without the event that implicates all of them.
 */
export async function invalidateRisk(walletOrClusterId: string): Promise<string[]> {
  const redis = await getReadyClient()
  if (!redis) return isWalletAddress(walletOrClusterId) ? [walletOrClusterId.toLowerCase()] : []

  try {
    if (isWalletAddress(walletOrClusterId)) {
      const wallet = walletOrClusterId.toLowerCase()

      // Read before deleting: the cached entry is what knows which cluster this
      // wallet belongs to, so the sibling eviction below has to happen first.
      const cached = await readCachedRisk(wallet)
      const affected = new Set([wallet])

      if (cached?.clusterId) {
        const siblings = await redis.smembers(clusterMembersKey(cached.clusterId))
        siblings.forEach((s) => affected.add(s))
        await redis.del(clusterKey(cached.clusterId), clusterMembersKey(cached.clusterId))
      }

      await redis.del(...[...affected].map(walletKey))
      return [...affected]
    }

    const members = await redis.smembers(clusterMembersKey(walletOrClusterId))
    const keys = [clusterKey(walletOrClusterId), clusterMembersKey(walletOrClusterId)]
    if (members.length > 0) keys.push(...members.map(walletKey))
    await redis.del(...keys)
    return members
  } catch (err) {
    logger.warn({ walletOrClusterId, err }, 'risk cache: invalidation failed')
    return []
  }
}

/**
 * The read-through every caller should use: cache hit, or compute and cache.
 *
 * On a miss the evidence is refreshed BEFORE it is scored, which is the whole
 * Phase 24 seam — `refreshWalletEvidence()` then `getOrComputeClusterRisk()`.
 * Skipping the refresh would score a first-time wallet against no evidence at
 * all, and "we have never seen this wallet" would read as "this wallet looks
 * clean".
 *
 * A refresh failure is deliberately NOT fatal here. `refreshWalletEvidence`
 * already logs partial upstream failures, and the freshness guard behind
 * `getOrComputeClusterRisk` is what decides whether the evidence it managed to
 * gather is good enough to score — that judgement belongs there, not here. If
 * it isn't, the answer comes back PENDING_REVIEW and the claim is held.
 */
export async function getRiskThroughCache(
  wallet: string,
): Promise<{ risk: ClusterRisk; cached: boolean }> {
  const hit = await readCachedRisk(wallet)
  if (hit) return { risk: hit, cached: true }

  try {
    await refreshWalletEvidence(wallet)
  } catch (err) {
    logger.warn({ wallet, err }, 'refreshWalletEvidence failed — scoring on existing evidence')
  }

  const risk = await getOrComputeClusterRisk(wallet)
  await writeCachedRisk(wallet, risk)
  return { risk, cached: false }
}

/** Closes the connection. For graceful shutdown and tests. */
export async function closeRiskCache(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined)
    client = null
  }
}
