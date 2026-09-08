/**
 * Risk-invalidation BullMQ producer — Backend-Suganthan.md Phase 10.4.
 *
 * This is the seam with Sylesh's Phase 14 cache worker. The queue name and
 * payload shape live in ONE place — `src/interfaces/evidence-risk-api.ts` — and
 * this module only imports and uses them, per Phase 12's own rule that nobody
 * retypes the string on either side.
 */
import { Queue } from 'bullmq'
import { env } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import {
  RISK_INVALIDATION_QUEUE,
  type RiskInvalidationJob,
} from '../../interfaces/evidence-risk-api.js'

let queue: Queue<RiskInvalidationJob> | null = null

function getQueue(): Queue<RiskInvalidationJob> {
  queue ??= new Queue<RiskInvalidationJob>(RISK_INVALIDATION_QUEUE, {
    connection: { url: env.REDIS_URL },
  })
  return queue
}

/**
 * Enqueues one invalidation job.
 *
 * Called after new evidence is durably persisted (Phase 10.3/10.4), never
 * before — an invalidation racing ahead of the write it is invalidating for
 * would have Sylesh's cache worker refetch and repopulate with the SAME stale
 * data it just evicted.
 *
 * `jobId` deduplicates: BullMQ treats a job with a jobId already present in
 * the queue as a no-op rather than a duplicate enqueue, so a burst of five
 * events for the same wallet in one block produces one job, not five.
 */
export async function enqueueRiskInvalidation(walletOrClusterId: string): Promise<void> {
  await getQueue().add(
    'invalidate',
    { walletOrClusterId },
    { jobId: walletOrClusterId, removeOnComplete: true, removeOnFail: 1000 },
  )
  logger.debug({ walletOrClusterId }, 'enqueued risk-invalidation')
}

/** Closes the underlying BullMQ connection. For tests and graceful shutdown. */
export async function closeInvalidationQueue(): Promise<void> {
  if (queue) {
    await queue.close()
    queue = null
  }
}
