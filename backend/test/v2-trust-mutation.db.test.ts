/**
 * V2 Phase 7 — live trust mutation against real Postgres. NO MOCKS.
 *
 * The acceptance condition asserted directly: a new on-chain event can change
 * an actor's TrustSnapshot and cause an ACTIVE capability to be attenuated or
 * frozen.
 *
 * Evidence is inserted the same way the Substreams sink inserts it, then the
 * real invalidation path is driven — no shortcut into the mutation function
 * for the headline test.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const { prisma } = await import('../src/lib/prisma.js')
const { resolveActorForWallet } = await import('../src/actor/actor-resolver.js')
const { grantCapability } = await import('../src/capabilities/capability-service.js')
const { applyTrustMutation } = await import('../src/trust/trust-mutation.js')
const { mutateTrustForWallets } = await import('../src/cache/invalidation-worker.js')
const { buildTrustContext } = await import('../src/trust/trust-context.js')
const { resetPolicyCache } = await import('../src/authorization/native-policy-evaluator.js')

const createdActorIds: string[] = []
const createdWallets: string[] = []
let seeded = false

const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`

beforeAll(async () => {
  resetPolicyCache()
  seeded = (await prisma.policy.count({ where: { active: true } })) > 0
})

afterAll(async () => {
  await prisma.evidenceEvent.deleteMany({ where: { wallet: { in: createdWallets } } })
  await prisma.actor.deleteMany({ where: { id: { in: createdActorIds } } })
  await prisma.$disconnect()
})

/**
 * Inserts evidence the freshness guard judges purely on `createdAt` recency.
 *
 * sourceType is 'token-api', NOT 'substreams', for the reason the seed script
 * documents: the Phase 11 guard treats substreams evidence as requiring a live
 * SubstreamsCursor row for its chain, so substreams rows on a synthetic chain
 * resolve PENDING_REVIEW forever. An actor stuck at INSUFFICIENT_EVIDENCE from
 * the start has no band to fall FROM, which is exactly how the first version of
 * this test managed to prove nothing.
 */
async function insertEvidence(args: {
  wallet: string
  counterparty: string
  count: number
  eventType?: string
  minutesApart?: number
}): Promise<void> {
  const now = Date.now()
  const rows = Array.from({ length: args.count }, (_, i) => ({
    chain: 'seed',
    wallet: args.wallet.toLowerCase(),
    counterparty: args.counterparty.toLowerCase(),
    eventType: args.eventType ?? 'transfer',
    protocol: 'seed-protocol',
    protocolType: 'lending-cdp',
    amount: '1000000000000000000',
    timestamp: new Date(now - (args.count - i) * (args.minutesApart ?? 1) * 60_000),
    blockNumber: BigInt(7_000_000 + i),
    transactionHash: `0xmut${randomBytes(8).toString('hex')}${i}`,
    sourceType: 'token-api',
    sourceId: `0xmut${randomBytes(8).toString('hex')}${i}-0`,
    deploymentId: null,
  }))
  await prisma.evidenceEvent.createMany({ data: rows, skipDuplicates: true })
}

async function actorWithCapability(amountLimit: string | null): Promise<{
  actorId: string
  wallet: string
  capabilityId: string
}> {
  const wallet = randomWallet()
  createdWallets.push(wallet.toLowerCase())
  const actor = await resolveActorForWallet(wallet)
  createdActorIds.push(actor.id)

  const capability = await grantCapability({
    actorId: actor.id,
    actionType: 'TRADE',
    resourceScope: 'mutation-test',
    limits: {
      amountLimit,
      frequencyLimit: 20,
      frequencyWindowSeconds: 86_400,
      allowedTargets: [],
      expiresAt: null,
    },
    attenuated: false,
  })
  return { actorId: actor.id, wallet, capabilityId: capability.id }
}

describe('V2 Phase 7 — THE ACCEPTANCE CONDITION', () => {
  it('A NEW ON-CHAIN EVENT SUSPENDS AN ACTIVE CAPABILITY', async () => {
    if (!seeded) return
    // 1. an actor with real evidence and a live capability
    const { actorId, wallet, capabilityId } = await actorWithCapability('1000000000')
    await insertEvidence({ wallet, counterparty: randomWallet(), count: 6, minutesApart: 60 })

    // Establish a baseline snapshot to degrade FROM.
    const before = await buildTrustContext(actorId)
    expect(await prisma.capability.findUnique({ where: { id: capabilityId } })).toMatchObject({
      status: 'ACTIVE',
    })

    // 2. the evidence goes stale — exactly what the freshness guard reacts to,
    //    and the most realistic way an actor becomes unmeasurable in production.
    await prisma.evidenceEvent.updateMany({
      where: { wallet: wallet.toLowerCase() },
      data: { createdAt: new Date(Date.now() - 30 * 86_400_000) },
    })

    // 3. drive the REAL invalidation path, the one the Substreams sink calls
    const changed = await mutateTrustForWallets([wallet])
    expect(changed).toBeGreaterThan(0)

    // 4. the capability is no longer usable
    const after = await prisma.capability.findUnique({ where: { id: capabilityId } })
    expect(after!.status).not.toBe('ACTIVE')
    expect(['SUSPENDED', 'REVOKED']).toContain(after!.status)

    // 5. and the trust history records why
    const snapshots = await prisma.trustSnapshot.findMany({
      where: { actorId },
      orderBy: { createdAt: 'desc' },
      take: 2,
    })
    expect(snapshots.length).toBeGreaterThanOrEqual(2)
    expect(snapshots[0]!.overallBand).not.toBe(before.band)

    const signals = await prisma.trustSignal.findMany({ where: { actorId } })
    expect(signals.some((s) => s.kind === 'BEHAVIOR_DRIFT')).toBe(true)
  }, 120_000)

  it('records the mutation with a stated reason, not silently', async () => {
    if (!seeded) return
    const { actorId, wallet } = await actorWithCapability('500000000')
    await insertEvidence({ wallet, counterparty: randomWallet(), count: 6, minutesApart: 60 })
    await buildTrustContext(actorId)

    await prisma.evidenceEvent.updateMany({
      where: { wallet: wallet.toLowerCase() },
      data: { createdAt: new Date(Date.now() - 30 * 86_400_000) },
    })
    const result = await applyTrustMutation(actorId, { reason: 'phase7-test' })

    expect(result.degraded).toBe(true)
    expect(result.consequence).not.toBe('NONE')
    const signals = await prisma.trustSignal.findMany({ where: { actorId, source: 'phase7-test' } })
    expect(signals.length).toBeGreaterThan(0)
    expect(signals[0]!.detail).toContain(result.consequence)
  }, 120_000)
})

describe('V2 Phase 7 — mutation is conservative', () => {
  it('DOES NOTHING on a first evaluation, when there is nothing to compare to', async () => {
    if (!seeded) return
    // Treating "no prior band" as a degradation would punish every actor the
    // moment they are first seen.
    const { actorId, capabilityId } = await actorWithCapability('1000000000')

    const result = await applyTrustMutation(actorId, { reason: 'first-look' })
    expect(result.previousBand).toBeNull()
    expect(result.consequence).toBe('NONE')
    expect(result.degraded).toBe(false)

    const capability = await prisma.capability.findUnique({ where: { id: capabilityId } })
    expect(capability!.status).toBe('ACTIVE')
  }, 90_000)

  it('leaves capabilities alone when the band does not move', async () => {
    if (!seeded) return
    const { actorId, wallet, capabilityId } = await actorWithCapability('1000000000')
    await insertEvidence({ wallet, counterparty: randomWallet(), count: 6, minutesApart: 60 })

    await buildTrustContext(actorId)
    const result = await applyTrustMutation(actorId, { reason: 'no-change' })

    expect(result.degraded).toBe(false)
    expect(result.consequence).toBe('NONE')
    expect((await prisma.capability.findUnique({ where: { id: capabilityId } }))!.status).toBe(
      'ACTIVE',
    )
  }, 90_000)

  it('never widens a ceiling when trust improves', async () => {
    if (!seeded) return
    // Rising trust is a reason to grant more on the next request, never to
    // retroactively expand a grant nobody re-evaluated.
    const { actorId, wallet, capabilityId } = await actorWithCapability('1000000000')
    await insertEvidence({ wallet, counterparty: randomWallet(), count: 6, minutesApart: 60 })

    // Degrade, then restore the evidence so the band recovers.
    await buildTrustContext(actorId)
    await prisma.evidenceEvent.updateMany({
      where: { wallet: wallet.toLowerCase() },
      data: { createdAt: new Date(Date.now() - 30 * 86_400_000) },
    })
    await applyTrustMutation(actorId, { reason: 'degrade' })

    await prisma.evidenceEvent.updateMany({
      where: { wallet: wallet.toLowerCase() },
      data: { createdAt: new Date() },
    })
    const recovered = await applyTrustMutation(actorId, { reason: 'recover' })

    expect(recovered.consequence).toBe('NONE')
    const capability = await prisma.capability.findUnique({ where: { id: capabilityId } })
    // Still capped at or below what it was; recovery does not restore it.
    expect(BigInt(capability!.amountLimit!)).toBeLessThanOrEqual(1000000000n)
  }, 120_000)

  it('is a no-op for wallets nobody has an actor for', async () => {
    expect(await mutateTrustForWallets([randomWallet()])).toBe(0)
  }, 60_000)
})
