/**
 * THE SUGANTHAN -> SYLESH SEAM, tested for real — Phase 12.
 *
 * Runs against real Postgres. This is the contract Sylesh's whole track is
 * built on; a mocked version of it would only prove the mock behaves as
 * instructed, not that the real seam does what the interface doc promises.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  getOrComputeClusterRisk,
  recomputeClusterForCandidates,
} from '../src/interfaces/evidence-risk-api.js'
import { persistEvidenceEvents } from '../src/evidence/repository.js'
import { prisma } from '../src/lib/prisma.js'
import type { NormalizedEvidenceEvent } from '../src/evidence/types.js'

const CHAIN = 'test-interface-chain'
let dbUp = false

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`
    dbUp = true
  } catch {
    console.warn('\n[evidence-risk-api.db] Postgres unreachable — skipping.\n')
  }
})

afterEach(async () => {
  if (!dbUp) return
  const wallets = await prisma.evidenceEvent.findMany({
    where: { chain: CHAIN },
    select: { wallet: true },
    distinct: ['wallet'],
  })
  const clusterIds = await prisma.wallet.findMany({
    where: { address: { in: wallets.map((w) => w.wallet) } },
    select: { clusterId: true },
  })
  await prisma.evidenceEvent.deleteMany({ where: { chain: CHAIN } })
  await prisma.wallet.deleteMany({ where: { address: { in: wallets.map((w) => w.wallet) } } })
  const ids = [...new Set(clusterIds.map((c) => c.clusterId).filter((id): id is string => !!id))]
  if (ids.length > 0) await prisma.cluster.deleteMany({ where: { id: { in: ids } } })
})

const T0 = Date.now()
const at = (minutes: number) => new Date(T0 + minutes * 60_000)

const event = (
  over: Partial<NormalizedEvidenceEvent> & { wallet: string },
): NormalizedEvidenceEvent => ({
  chain: CHAIN,
  counterparty: null,
  eventType: 'transfer',
  protocol: null,
  protocolType: null,
  amount: '1',
  timestamp: at(0),
  blockNumber: 1n,
  transactionHash: `0xtx-${Math.random()}`,
  sourceType: 'token-api',
  sourceId: `${Math.random()}`,
  deploymentId: null,
  ...over,
})

describe('getOrComputeClusterRisk', () => {
  it('THE MOST DANGEROUS CASE: an unknown wallet resolves PENDING_REVIEW, never a scored ALLOW', async () => {
    if (!dbUp) return
    // If this ever returned status: OK with riskScore: 0, a caller skipping
    // the status check would read it as a confident, well-evidenced ALLOW —
    // exactly backwards for a wallet the system knows nothing about.
    const risk = await getOrComputeClusterRisk('0x1111111111111111111111111111111111111a')
    expect(risk.status).toBe('PENDING_REVIEW')
  })

  it('scores an unclustered wallet alone, with clusterId null', async () => {
    if (!dbUp) return
    const wallet = '0x2222222222222222222222222222222222222b'
    await persistEvidenceEvents([
      event({ wallet, counterparty: '0xfunder', timestamp: at(0) }),
      event({ wallet, counterparty: '0xvenue', eventType: 'deposit', timestamp: at(60 * 24 * 30) }),
    ])
    const risk = await getOrComputeClusterRisk(wallet)
    expect(risk.status).toBe('OK')
    expect(risk.clusterId).toBeNull()
    expect(risk.policyVersion).not.toBe('none')
  })

  it('THE PHASE 12 ACCEPTANCE TEST: a persisted cluster scores as a cluster, not five separate lookups', async () => {
    if (!dbUp) return
    const wallets = [
      '0x3333333333333333333333333333333333330a',
      '0x3333333333333333333333333333333333330b',
      '0x3333333333333333333333333333333333330c',
      '0x3333333333333333333333333333333333330d',
      '0x3333333333333333333333333333333333330e',
    ]
    const funder = '0xsharedfunder'
    await persistEvidenceEvents(
      wallets.flatMap((w, i) => [
        event({ wallet: w, counterparty: funder, timestamp: at(i) }),
        event({
          wallet: w,
          counterparty: '0xsharedvenue',
          eventType: 'deposit',
          timestamp: at(60 + i),
        }),
      ]),
    )

    const clusterIds = await recomputeClusterForCandidates(wallets)
    expect(clusterIds).toHaveLength(1)

    const risk = await getOrComputeClusterRisk(wallets[0]!)
    expect(risk.status).toBe('OK')
    expect(risk.clusterId).toBe(clusterIds[0])

    // Every member resolves to the SAME cluster and the SAME score — proof
    // this is cluster-level scoring, not five independent single-wallet
    // lookups that happen to agree.
    const riskForAnotherMember = await getOrComputeClusterRisk(wallets[2]!)
    expect(riskForAnotherMember.clusterId).toBe(risk.clusterId)
    expect(riskForAnotherMember.riskScore).toBe(risk.riskScore)
  })

  it('derives sources from the real evidence behind the score', async () => {
    if (!dbUp) return
    const wallet = '0x4444444444444444444444444444444444440a'
    await persistEvidenceEvents([event({ wallet, blockNumber: 555n })])
    const risk = await getOrComputeClusterRisk(wallet)
    expect(risk.sources.length).toBeGreaterThan(0)
    expect(risk.sources[0]?.type).toBe('token-api')
    expect(risk.sources[0]?.block).toBe('555')
  })
})

describe('recomputeClusterForCandidates', () => {
  it('is additive to, not one of, the two locked interface functions', async () => {
    // A structural check that it is actually exported alongside, not instead
    // of, getOrComputeClusterRisk / refreshWalletEvidence.
    const mod = await import('../src/interfaces/evidence-risk-api.js')
    expect(typeof mod.getOrComputeClusterRisk).toBe('function')
    expect(typeof mod.refreshWalletEvidence).toBe('function')
    expect(typeof mod.recomputeClusterForCandidates).toBe('function')
  })
})
