/**
 * Risk cache degradation — Backend-Sylesh.md Phase 23 failure matrix:
 * "Redis cache unavailable -> falls through to a direct getOrComputeClusterRisk
 * call, degraded but correct, not a crash."
 *
 * Points the cache at a port nothing is listening on. No Redis required — the
 * whole point is that there isn't one.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.stubEnv('RISK_CACHE_ENABLED', 'true')
vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6399')
vi.stubEnv('RISK_CACHE_CONNECT_TIMEOUT_MS', '250')

const { closeRiskCache, invalidateRisk, readCachedRisk, writeCachedRisk } = await import(
  '../src/cache/risk-cache.js'
)

const WALLET = '0x00000000000000000000000000000000000dead1'

const risk = {
  clusterId: null,
  riskScore: 0.1,
  confidence: 'HIGH' as const,
  policyVersion: '1.0',
  features: [],
  sources: [],
  status: 'OK' as const,
}

afterAll(async () => {
  await closeRiskCache()
})

describe('Phase 23 — Redis unavailable', () => {
  it('reads report a miss instead of throwing', async () => {
    // A miss is correct-but-slow. A throw would take the whole claim down.
    await expect(readCachedRisk(WALLET)).resolves.toBeNull()
  })

  it('writes fail silently instead of throwing', async () => {
    await expect(writeCachedRisk(WALLET, risk)).resolves.toBeUndefined()
  })

  it('invalidation degrades to naming the wallet it was told about', async () => {
    await expect(invalidateRisk(WALLET)).resolves.toEqual([WALLET])
  })

  it('does not hang — a dead cache must not become a request timeout', async () => {
    const start = performance.now()
    await readCachedRisk(WALLET)
    expect(performance.now() - start).toBeLessThan(3000)
  })
})
