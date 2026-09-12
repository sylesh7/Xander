/**
 * Risk-invalidation seam — Backend-Sylesh.md Phases 14 and 24.
 *
 * This is the actual cross-track integration point: Suganthan's Substreams sink
 * publishes to `risk-invalidation` (Phase 10.4) and this worker consumes it.
 * The test drives the REAL producer and the REAL worker over the REAL queue, so
 * it fails if either side changes the queue name or payload shape — which is
 * exactly the seam both specs warn about.
 *
 * Requires Postgres + Redis and a seeded database.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubEnv('RISK_CACHE_ENABLED', 'true')

// NO MOCKS. The worker calls the real `refreshWalletEvidence`, which is the
// whole point of this seam — a stubbed refresh would prove the cache was
// repopulated without proving the evidence behind it was ever fetched.
const { prisma } = await import('../src/lib/prisma.js')
const { FIXTURE_CLEAN_WALLET } = await import('../src/interfaces/stub-fixtures.js')
const { enqueueRiskInvalidation, closeInvalidationQueue } = await import(
  '../src/graph/substreams/invalidation-queue.js'
)
const { handleInvalidation, startInvalidationWorker, stopInvalidationWorker } = await import(
  '../src/cache/invalidation-worker.js'
)
const { closeRiskCache, readCachedRisk, writeCachedRisk } = await import(
  '../src/cache/risk-cache.js'
)

const cached = {
  clusterId: null,
  riskScore: 0.99,
  confidence: 'HIGH' as const,
  policyVersion: 'stale-policy',
  features: [],
  sources: [],
  status: 'OK' as const,
}

let seeded = false

beforeEach(async () => {
  seeded = (await prisma.evidenceEvent.count({ where: { wallet: FIXTURE_CLEAN_WALLET } })) > 0
})

afterAll(async () => {
  await stopInvalidationWorker()
  await closeInvalidationQueue()
  await closeRiskCache()
  await prisma.$disconnect()
})

describe('Phase 14 — the consumer', () => {
  it('evicts the stale entry and repopulates it with a fresh computation', async () => {
    if (!seeded) return

    // Seed the cache with a deliberately wrong score, as if it predated an event.
    await writeCachedRisk(FIXTURE_CLEAN_WALLET, cached)
    expect((await readCachedRisk(FIXTURE_CLEAN_WALLET))?.riskScore).toBe(0.99)

    await handleInvalidation({
      data: { walletOrClusterId: FIXTURE_CLEAN_WALLET },
    } as Parameters<typeof handleInvalidation>[0])

    const after = await readCachedRisk(FIXTURE_CLEAN_WALLET)
    expect(after).not.toBeNull()
    // Recomputed, not merely evicted — the stale 0.99 is gone and the real
    // score is already in place for the next claim.
    expect(after?.riskScore).not.toBe(0.99)
    expect(after?.policyVersion).toBe('1.0')
  })

  it('handles a cluster id by resolving members from the database', async () => {
    if (!seeded) return
    const wallet = await prisma.wallet.findFirst({ where: { clusterId: { not: null } } })
    if (!wallet?.clusterId) return

    await expect(
      handleInvalidation({
        data: { walletOrClusterId: wallet.clusterId },
      } as Parameters<typeof handleInvalidation>[0]),
    ).resolves.toBeUndefined()

    const repopulated = await readCachedRisk(wallet.address)
    expect(repopulated).not.toBeNull()
  })

  it('is a no-op for an id with no wallets behind it', async () => {
    await expect(
      handleInvalidation({
        data: { walletOrClusterId: 'cluster-with-no-members' },
      } as Parameters<typeof handleInvalidation>[0]),
    ).resolves.toBeUndefined()
  })
})

describe('Phase 24 — the real queue round trip', () => {
  it('a job published by the producer is consumed by the worker', async () => {
    if (!seeded) return

    // A wallet unique to this run. The jobId the producer derives IS the wallet
    // address, and BullMQ dedupes on jobId while retaining failed jobs
    // (removeOnFail: 1000) — so using a shared fixture wallet coupled this test
    // to every other suite that touches it, and a retained job from anywhere
    // turned the enqueue below into a silent no-op with no worker event ever
    // firing. Latent all along; the suite growing past 30 files is what started
    // landing it. A unique wallet makes the collision impossible.
    const wallet = `0x${randomBytes(20).toString('hex')}`
    await writeCachedRisk(wallet, cached)

    const worker = startInvalidationWorker()
    const completed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no job completed within 60s')), 60_000)
      // Match on OUR job: the worker also drains jobs other files enqueued, and
      // resolving on the first completion would race our cache assertion.
      worker.on('completed', (job) => {
        if (job?.id !== wallet) return
        clearTimeout(timer)
        resolve()
      })
      worker.on('failed', (job, err) => {
        if (job?.id !== wallet) return
        clearTimeout(timer)
        reject(err)
      })
    })

    // Suganthan's producer, imported from their module — not a hand-rolled
    // enqueue that could drift from the real one.
    await enqueueRiskInvalidation(wallet)
    await completed

    const after = await readCachedRisk(wallet)
    expect(after?.riskScore).not.toBe(0.99)
  }, 75_000)
})
