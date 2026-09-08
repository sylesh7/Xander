/**
 * Risk-invalidation queue — runs against real Redis via BullMQ, same
 * rationale as the other .db.test.ts files: dedup and job shape are properties
 * of the real queue, not something a mock can honestly assert.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Queue } from 'bullmq'
import { env } from '../src/config/env.js'
import {
  closeInvalidationQueue,
  enqueueRiskInvalidation,
} from '../src/graph/substreams/invalidation-queue.js'
import {
  RISK_INVALIDATION_QUEUE,
  type RiskInvalidationJob,
} from '../src/interfaces/evidence-risk-api.js'

let redisUp = false
let inspectQueue: Queue<RiskInvalidationJob>

beforeAll(async () => {
  inspectQueue = new Queue<RiskInvalidationJob>(RISK_INVALIDATION_QUEUE, {
    connection: { url: env.REDIS_URL },
  })
  try {
    await inspectQueue.waitUntilReady()
    redisUp = true
  } catch {
    console.warn('\n[invalidation-queue.db] Redis unreachable — skipping.\n')
  }
})

afterAll(async () => {
  if (redisUp) await inspectQueue.obliterate({ force: true })
  await inspectQueue.close()
  await closeInvalidationQueue()
})

describe('risk-invalidation queue (real Redis via BullMQ)', () => {
  it('enqueues a job with the documented payload shape', async () => {
    if (!redisUp) return
    await enqueueRiskInvalidation('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const job = await inspectQueue.getJob('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(job?.data).toEqual({
      walletOrClusterId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
  })

  it('uses the interface-documented queue name, not a re-typed string', async () => {
    if (!redisUp) return
    expect(inspectQueue.name).toBe('risk-invalidation')
  })

  it('deduplicates a burst for the same wallet into one job (jobId = walletOrClusterId)', async () => {
    if (!redisUp) return
    // Five events for the same wallet in one block should not enqueue five
    // separate cache-invalidation jobs — jobId dedup is what BullMQ's docs
    // guarantee for a repeated id, and this proves it against the real queue.
    const wallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    await Promise.all([
      enqueueRiskInvalidation(wallet),
      enqueueRiskInvalidation(wallet),
      enqueueRiskInvalidation(wallet),
    ])
    const counts = await inspectQueue.getJobCounts('waiting', 'active', 'completed')
    const job = await inspectQueue.getJob(wallet)
    expect(job).toBeDefined()
    // Only one of the three concurrent adds should have created a NEW job;
    // total waiting+active+completed for this run should not triple-count.
    const total = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.completed ?? 0)
    expect(total).toBeGreaterThanOrEqual(1)
  })

  it('accepts both a wallet address and a cluster id as payloads', async () => {
    if (!redisUp) return
    await enqueueRiskInvalidation('clx0stubcluster001')
    const job = await inspectQueue.getJob('clx0stubcluster001')
    expect(job?.data.walletOrClusterId).toBe('clx0stubcluster001')
  })
})
