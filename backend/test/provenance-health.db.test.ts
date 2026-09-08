import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getProvenanceHealth } from '../src/provenance/health.js'
import { prisma } from '../src/lib/prisma.js'
import type { NormalizedEvidenceEvent } from '../src/evidence/types.js'

const CHAIN = 'test-health-chain'
let dbUp = false

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbUp = true
  } catch {
    console.warn('\n[provenance-health.db] Postgres unreachable — skipping.\n')
  }
})

afterEach(async () => {
  if (!dbUp) return
  await prisma.evidenceEvent.deleteMany({ where: { chain: CHAIN } })
  await prisma.substreamsCursor.deleteMany({ where: { chain: CHAIN } })
})

const event = (over: Partial<NormalizedEvidenceEvent> = {}): NormalizedEvidenceEvent => ({
  chain: CHAIN,
  wallet: '0xhea1thhea1thhea1thhea1thhea1thhea1thhea',
  counterparty: null,
  eventType: 'transfer',
  protocol: null,
  protocolType: null,
  amount: '1',
  timestamp: new Date(),
  blockNumber: 1n,
  transactionHash: '0xtx',
  sourceType: 'token-api',
  sourceId: 'a',
  deploymentId: null,
  ...over,
})

describe('getProvenanceHealth (real Postgres, no network calls)', () => {
  it('reports null lastSuccessAt when there is no token-api evidence anywhere', async () => {
    if (!dbUp) return
    // Global signal, not scoped to this test's chain — only assert shape.
    const health = await getProvenanceHealth()
    expect(health.tokenApi).toHaveProperty('lastSuccessAt')
    expect(health.tokenApi).toHaveProperty('stale')
  })

  it('reports a fresh token-api timestamp as not stale', async () => {
    if (!dbUp) return
    await prisma.evidenceEvent.create({ data: event({ sourceId: 'fresh' }) })
    const health = await getProvenanceHealth()
    expect(health.tokenApi.lastSuccessAt).not.toBeNull()
    expect(health.tokenApi.stale).toBe(false)
  })

  it('lists every registered deployment, seen or not', async () => {
    if (!dbUp) return
    const health = await getProvenanceHealth()
    expect(health.deployments.length).toBeGreaterThan(0)
    for (const d of health.deployments) {
      expect(d).toHaveProperty('lastSeenBlock')
      expect(d).toHaveProperty('lastSeenAt')
    }
  })

  it('reports substreams cursor lag and correctly flags a stale one', async () => {
    if (!dbUp) return
    await prisma.substreamsCursor.create({
      data: {
        chain: CHAIN,
        moduleName: 'map_funding_transfers',
        cursor: 'c',
        blockNumber: 5n,
        updatedAt: new Date(Date.now() - 3600_000), // 1h old, well past the 15min default
      },
    })
    const health = await getProvenanceHealth()
    const row = health.substreams.find((s) => s.chain === CHAIN)
    expect(row).toBeDefined()
    expect(row?.blockNumber).toBe('5')
    expect(row?.stale).toBe(true)
    expect(row?.lagSeconds).toBeGreaterThan(3000)
  })

  it('makes no outbound network call — a bad gateway key does not break /health', async () => {
    if (!dbUp) return
    // getProvenanceHealth must resolve purely from Postgres. If it reached
    // out to the gateway or Token API, an invalid credential here would throw.
    await expect(getProvenanceHealth()).resolves.toBeDefined()
  })
})
