/**
 * Risk-invalidation consumer — Backend-Sylesh.md Phase 14, the other half of
 * Suganthan's Phase 10.4 producer.
 *
 * The contract (docs/EVIDENCE-RISK-INTERFACE.md §4) is: queue
 * `risk-invalidation`, payload `{ walletOrClusterId }`, where the id is either
 * a `0x...` address or a `Cluster.id`. Both constants are imported from the
 * interface module — Phase 12's rule is that neither side retypes the string.
 *
 * On each job: evict, then recompute and repopulate. Evicting alone would be
 * correct but would push the cost of the next claim onto a user; the whole
 * point of reacting to a stream event is that the new score is ready before
 * anyone asks for it.
 */
import { Worker, type Job } from 'bullmq'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import {
  RISK_INVALIDATION_QUEUE,
  getOrComputeClusterRisk,
  refreshWalletEvidence,
  type RiskInvalidationJob,
} from '../interfaces/evidence-risk-api.js'
import { invalidateRisk, isWalletAddress, writeCachedRisk } from './risk-cache.js'

/**
 * Which wallets this job is about.
 *
 * For a cluster id the cached member index may be cold (nothing cached yet, or
 * a Redis restart), so the database is the fallback source of truth for
 * membership — otherwise an invalidation for a cluster nobody has queried yet
 * would silently repopulate nothing.
 */
async function resolveWallets(walletOrClusterId: string, evicted: string[]): Promise<string[]> {
  if (isWalletAddress(walletOrClusterId)) return [walletOrClusterId.toLowerCase()]
  if (evicted.length > 0) return evicted

  const members = await prisma.wallet.findMany({
    where: { clusterId: walletOrClusterId },
    select: { address: true },
  })
  return members.map((m) => m.address)
}

export async function handleInvalidation(job: Job<RiskInvalidationJob>): Promise<void> {
  const { walletOrClusterId } = job.data

  const evicted = await invalidateRisk(walletOrClusterId)
  const wallets = await resolveWallets(walletOrClusterId, evicted)

  if (wallets.length === 0) {
    logger.debug({ walletOrClusterId }, 'risk-invalidation: nothing to repopulate')
    return
  }

  // One recomputation, not one per member. Risk is a property of the cluster
  // (Section 0.2 rule 6), so every member of a cluster resolves to the same
  // ClusterRisk — scoring each of them in turn would be N identical passes over
  // the same evidence. Siblings repopulate lazily on their next read.
  const representative = wallets[0]
  if (!representative) return

  await refreshWalletEvidence(representative)
  const risk = await getOrComputeClusterRisk(representative)
  await writeCachedRisk(representative, risk)

  logger.info(
    {
      walletOrClusterId,
      evicted: evicted.length,
      status: risk.status,
      riskScore: risk.riskScore,
      clusterId: risk.clusterId,
    },
    'risk-invalidation: cache evicted and repopulated',
  )
}

let worker: Worker<RiskInvalidationJob> | null = null

/** Starts the consumer. Called from server.ts when the process actually listens. */
export function startInvalidationWorker(): Worker<RiskInvalidationJob> {
  worker ??= new Worker<RiskInvalidationJob>(RISK_INVALIDATION_QUEUE, handleInvalidation, {
    connection: { url: env.REDIS_URL },
  })

  // A failed invalidation is not fatal — the TTL still bounds staleness — but
  // it must be visible, because a silently dead worker degrades into "the cache
  // is serving pre-event scores" with no other symptom.
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, walletOrClusterId: job?.data.walletOrClusterId, err },
      'risk-invalidation job failed')
  })

  logger.info({ queue: RISK_INVALIDATION_QUEUE }, 'risk-invalidation worker started')
  return worker
}

export async function stopInvalidationWorker(): Promise<void> {
  if (worker) {
    await worker.close()
    worker = null
  }
}
