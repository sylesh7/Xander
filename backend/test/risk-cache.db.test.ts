/**
 * Risk cache — Backend-Sylesh.md Phase 14 acceptance test.
 *
 * Requires the local Redis from `npm run infra:up`.
 *
 * The cache is disabled globally in vitest.config.ts so unit tests need no
 * Redis; this file turns it on before importing the module, because env.ts
 * parses once at import time.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubEnv('RISK_CACHE_ENABLED', 'true')

const { closeRiskCache, invalidateRisk, isWalletAddress, readCachedRisk, writeCachedRisk } =
  await import('../src/cache/risk-cache.js')
const { default: Redis } = await import('ioredis')
const { env } = await import('../src/config/env.js')

const WALLET = '0x00000000000000000000000000000000000cac41'
const MATE = '0x00000000000000000000000000000000000cac42'
const CLUSTER = 'cluster-cache-test'

const clustered = {
  clusterId: CLUSTER,
  riskScore: 0.43,
  confidence: 'MEDIUM' as const,
  policyVersion: '1.0',
  features: [{ name: 'FUNDING_CORRELATION', value: 1 }],
  sources: [{ type: 'token-api', deployment: null, block: '3049000' }],
  status: 'OK' as const,
}

const raw = new Redis(env.REDIS_URL)

beforeEach(async () => {
  await raw.del(
    `risk:wallet:${WALLET}`,
    `risk:wallet:${MATE}`,
    `risk:cluster:${CLUSTER}`,
    `risk:cluster:${CLUSTER}:members`,
  )
})

afterAll(async () => {
  await raw.del(
    `risk:wallet:${WALLET}`,
    `risk:wallet:${MATE}`,
    `risk:cluster:${CLUSTER}`,
    `risk:cluster:${CLUSTER}:members`,
  )
  await raw.quit()
  await closeRiskCache()
})

describe('Phase 14 — cache round trip', () => {
  it('returns a miss for an uncached wallet', async () => {
    expect(await readCachedRisk(WALLET)).toBeNull()
  })

  it('caches and returns an assessment', async () => {
    await writeCachedRisk(WALLET, clustered)
    const hit = await readCachedRisk(WALLET)

    expect(hit).not.toBeNull()
    expect(hit?.riskScore).toBe(0.43)
    expect(hit?.clusterId).toBe(CLUSTER)
  })

  it('serves a hit in single-digit milliseconds — the point of the cache', async () => {
    await writeCachedRisk(WALLET, clustered)

    const start = performance.now()
    await readCachedRisk(WALLET)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(10)
  })

  it('applies the configured TTL as a safety net', async () => {
    await writeCachedRisk(WALLET, clustered)
    const ttl = await raw.ttl(`risk:wallet:${WALLET}`)

    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(env.RISK_CACHE_TTL_SECONDS)
  })

  it('NEVER caches PENDING_REVIEW', async () => {
    // PENDING_REVIEW describes the system's confidence, not the wallet.
    // Caching it would keep holding claims long after the evidence recovered.
    await writeCachedRisk(WALLET, { ...clustered, status: 'PENDING_REVIEW', riskScore: 0 })
    expect(await readCachedRisk(WALLET)).toBeNull()
  })
})

describe('Phase 14 — invalidation', () => {
  it('distinguishes a wallet address from a cluster id', () => {
    expect(isWalletAddress(WALLET)).toBe(true)
    expect(isWalletAddress('cmttoow03000wiqk8835urngh')).toBe(false)
  })

  it('evicts a wallet entry', async () => {
    await writeCachedRisk(WALLET, clustered)
    await invalidateRisk(WALLET)

    expect(await readCachedRisk(WALLET)).toBeNull()
  })

  it('evicts every member when one member gets new evidence', async () => {
    // Section 0.2 rule 6: the cluster is the unit of analysis, so one member's
    // new funding transfer changes the score all of them inherit. Evicting only
    // the wallet that moved would leave its siblings serving a score computed
    // without the event that implicates them.
    await writeCachedRisk(WALLET, clustered)
    await writeCachedRisk(MATE, clustered)

    const affected = await invalidateRisk(WALLET)

    expect(affected).toContain(WALLET)
    expect(affected).toContain(MATE)
    expect(await readCachedRisk(WALLET)).toBeNull()
    expect(await readCachedRisk(MATE)).toBeNull()
  })

  it('evicts all member wallets when addressed by cluster id', async () => {
    await writeCachedRisk(WALLET, clustered)
    await writeCachedRisk(MATE, clustered)

    const affected = await invalidateRisk(CLUSTER)

    expect(affected.sort()).toEqual([WALLET, MATE].sort())
    expect(await readCachedRisk(WALLET)).toBeNull()
    expect(await readCachedRisk(MATE)).toBeNull()
  })

  it('is a no-op, not an error, for an unknown id', async () => {
    await expect(invalidateRisk('cluster-that-never-existed')).resolves.toEqual([])
  })
})
