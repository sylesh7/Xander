/**
 * V2 Phase 3 — Capability + Policy against real Postgres over real HTTP.
 *
 * Requires a migrated database and `npm run db:seed`. NO MOCKS.
 *
 * The acceptance condition is asserted directly: the same actor receives
 * different capabilities for different actions.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

const { app } = await import('../src/server.js')
const { prisma } = await import('../src/lib/prisma.js')
const { FIXTURE_CLEAN_WALLET, FIXTURE_CLUSTERED_WALLET } = await import(
  '../src/interfaces/stub-fixtures.js'
)
const { checkCapability, grantCapability, recordUsage, revokeCapabilities } = await import(
  '../src/capabilities/capability-service.js'
)
const { resetPolicyCache } = await import('../src/authorization/native-policy-evaluator.js')

const KEY = 'test-api-key'
const auth = <T extends { set: (a: string, b: string) => T }>(req: T): T =>
  req.set('X-API-Key', KEY)

/** Fixture wallets shared with the other /v2 suites. Their actors are never deleted. */
const SHARED_FIXTURE_WALLETS = [FIXTURE_CLEAN_WALLET, FIXTURE_CLUSTERED_WALLET].map((w) =>
  w.toLowerCase(),
)

const createdActorIds: string[] = []
function trackActor(id: string): string {
  createdActorIds.push(id)
  return id
}

let seeded = false

beforeAll(async () => {
  resetPolicyCache()
  seeded =
    (await prisma.policy.count({ where: { active: true } })) > 0 &&
    (await prisma.evidenceEvent.count({ where: { wallet: FIXTURE_CLEAN_WALLET } })) > 0
})

afterAll(async () => {
  const shared = await prisma.actorIdentity.findMany({
    where: { kind: 'WALLET', externalId: { in: SHARED_FIXTURE_WALLETS } },
    select: { actorId: true },
  })
  const protectedIds = new Set(shared.map((r) => r.actorId))
  await prisma.actor.deleteMany({
    where: { id: { in: createdActorIds.filter((id) => !protectedIds.has(id)) } },
  })
  await prisma.$disconnect()
})

/** A standalone actor with no wallet — trust is INSUFFICIENT_EVIDENCE by design. */
async function bareActor(type = 'AGENT'): Promise<string> {
  const res = await auth(request(app).post('/v2/actors')).send({ actorType: type })
  expect(res.status).toBe(201)
  return trackActor(res.body.id as string)
}

async function postIntent(body: Record<string, unknown>) {
  const res = await auth(request(app).post('/v2/intents')).send(body)
  if (res.status >= 300) {
    throw new Error(`POST /v2/intents -> ${res.status} ${JSON.stringify(res.body)}`)
  }
  trackActor(res.body.actorId as string)
  return res.body as {
    intentId: string
    actorId: string
    decision: { result: string; reasonCode: string; reasonSummary: string } | null
  }
}

const USDC = (whole: number): string => (BigInt(whole) * 1_000_000n).toString()

describe('V2 Phase 3 — the acceptance condition', () => {
  it('THE SAME ACTOR RECEIVES DIFFERENT CAPABILITIES FOR DIFFERENT ACTIONS', async () => {
    if (!seeded) return
    const wallet = FIXTURE_CLEAN_WALLET

    const claim = await postIntent({
      wallet,
      resourceType: 'campaign',
      resourceId: `p3-claim-${randomBytes(3).toString('hex')}`,
      actionType: 'CLAIM',
      amount: USDC(50),
    })
    const trade = await postIntent({
      actorId: claim.actorId,
      resourceType: 'market',
      resourceId: `p3-trade-${randomBytes(3).toString('hex')}`,
      actionType: 'TRADE',
      amount: USDC(5000),
    })
    const borrow = await postIntent({
      actorId: claim.actorId,
      resourceType: 'market',
      resourceId: `p3-borrow-${randomBytes(3).toString('hex')}`,
      actionType: 'BORROW',
      amount: USDC(50_000),
    })

    // One actor, three actions, three different answers.
    expect(claim.decision?.result).toBe('ALLOW')
    expect(trade.decision?.result).toBe('LIMIT')
    expect(borrow.decision?.result).toBe('CHALLENGE')

    const caps = await prisma.capability.findMany({ where: { actorId: claim.actorId } })
    const byAction = new Map(caps.map((c) => [c.actionType, c]))

    // ALLOW and LIMIT minted capabilities; CHALLENGE minted nothing.
    expect(byAction.get('CLAIM')).toBeDefined()
    expect(byAction.get('TRADE')).toBeDefined()
    expect(byAction.get('BORROW')).toBeUndefined()

    // And the TRADE grant is genuinely attenuated, not merely approved.
    expect(byAction.get('TRADE')!.capabilityType).toBe('ATTENUATED_GRANT')
    expect(byAction.get('TRADE')!.amountLimit).not.toBeNull()
  }, 90_000)

  it('LIMIT attenuates a request rather than rejecting it', async () => {
    if (!seeded) return
    const res = await postIntent({
      wallet: FIXTURE_CLEAN_WALLET,
      resourceType: 'market',
      resourceId: `p3-atten-${randomBytes(3).toString('hex')}`,
      actionType: 'TRADE',
      amount: USDC(999_999),
    })
    expect(res.decision?.result).toBe('LIMIT')

    const cap = await prisma.capability.findFirst({
      where: { sourceDecisionId: { not: null }, actionType: 'TRADE', actorId: res.actorId },
      orderBy: { createdAt: 'desc' },
    })
    // Asked for 999,999 — granted a real but far smaller authority.
    expect(BigInt(cap!.amountLimit!)).toBeLessThan(BigInt(USDC(999_999)))
    expect(cap!.capabilityType).toBe('ATTENUATED_GRANT')
  }, 60_000)
})

describe('V2 Phase 3 — fail closed', () => {
  it('an actor with no evidence is held for REVIEW, never allowed', async () => {
    if (!seeded) return
    const actorId = await bareActor()
    const res = await postIntent({
      actorId,
      resourceType: 'campaign',
      resourceId: 'p3-cold',
      actionType: 'CLAIM',
      amount: USDC(1),
    })
    expect(res.decision?.result).toBe('REVIEW')
    expect(res.decision?.result).not.toBe('ALLOW')
    expect(await prisma.capability.count({ where: { actorId } })).toBe(0)
  }, 60_000)

  it('a coordinated ring is blocked and granted nothing', async () => {
    if (!seeded) return
    const res = await postIntent({
      wallet: FIXTURE_CLUSTERED_WALLET,
      resourceType: 'campaign',
      resourceId: `p3-ring-${randomBytes(3).toString('hex')}`,
      actionType: 'CLAIM',
      amount: USDC(10),
    })
    expect(['BLOCK', 'CHALLENGE', 'REVIEW']).toContain(res.decision?.result)
    expect(res.decision?.result).not.toBe('ALLOW')
    expect(res.decision?.result).not.toBe('LIMIT')

    const caps = await prisma.capability.count({
      where: { actorId: res.actorId, actionType: 'CLAIM' },
    })
    expect(caps).toBe(0)
  }, 60_000)

  it('an action requiring assurance is CHALLENGEd while no lease exists', async () => {
    if (!seeded) return
    // Phase 3 defines leases but nothing establishes one until Phase 5, so this
    // must escalate rather than silently pass.
    const res = await postIntent({
      wallet: FIXTURE_CLEAN_WALLET,
      resourceType: 'treasury',
      resourceId: `p3-borrow-${randomBytes(3).toString('hex')}`,
      actionType: 'BORROW',
      amount: USDC(1000),
    })
    expect(res.decision?.result).toBe('CHALLENGE')
  }, 60_000)
})

describe('V2 Phase 3 — capability enforcement', () => {
  it('denies an amount above the ceiling, with a specific reason', async () => {
    const actorId = await bareActor()
    await grantCapability({
      actorId,
      actionType: 'TRANSFER',
      resourceScope: 'test',
      limits: {
        amountLimit: '500',
        frequencyLimit: null,
        frequencyWindowSeconds: null,
        allowedTargets: [],
        expiresAt: null,
      },
      attenuated: false,
    })

    expect((await checkCapability({ actorId, actionType: 'TRANSFER', amount: '400' })).allowed).toBe(true)

    const denied = await checkCapability({ actorId, actionType: 'TRANSFER', amount: '600' })
    expect(denied.allowed).toBe(false)
    expect(denied.denial).toBe('AMOUNT_EXCEEDS_LIMIT')
  })

  it('enforces a frequency limit from real usage rows', async () => {
    const actorId = await bareActor()
    const cap = await grantCapability({
      actorId,
      actionType: 'API_REQUEST',
      resourceScope: 'test',
      limits: {
        amountLimit: null,
        frequencyLimit: 2,
        frequencyWindowSeconds: 3600,
        allowedTargets: [],
        expiresAt: null,
      },
      attenuated: false,
    })

    expect((await checkCapability({ actorId, actionType: 'API_REQUEST' })).allowed).toBe(true)
    await recordUsage({ capabilityId: cap.id })
    await recordUsage({ capabilityId: cap.id })

    const third = await checkCapability({ actorId, actionType: 'API_REQUEST' })
    expect(third.allowed).toBe(false)
    expect(third.denial).toBe('FREQUENCY_LIMIT_REACHED')
  })

  it('denies an expired capability', async () => {
    const actorId = await bareActor()
    await grantCapability({
      actorId,
      actionType: 'TRADE',
      resourceScope: 'test',
      limits: {
        amountLimit: null,
        frequencyLimit: null,
        frequencyWindowSeconds: null,
        allowedTargets: [],
        expiresAt: new Date(Date.now() - 1000),
      },
      attenuated: false,
    })
    const check = await checkCapability({ actorId, actionType: 'TRADE' })
    expect(check.allowed).toBe(false)
    expect(check.denial).toBe('CAPABILITY_EXPIRED')
  })

  it('denies a target outside the allow-list', async () => {
    const actorId = await bareActor()
    await grantCapability({
      actorId,
      actionType: 'TRANSFER',
      resourceScope: 'test',
      limits: {
        amountLimit: null,
        frequencyLimit: null,
        frequencyWindowSeconds: null,
        allowedTargets: ['0x000000000000000000000000000000000000aaaa'],
        expiresAt: null,
      },
      attenuated: false,
    })

    const ok = await checkCapability({
      actorId,
      actionType: 'TRANSFER',
      targetAddress: '0x000000000000000000000000000000000000AAAA',
    })
    expect(ok.allowed).toBe(true)

    const bad = await checkCapability({
      actorId,
      actionType: 'TRANSFER',
      targetAddress: '0x000000000000000000000000000000000000bbbb',
    })
    expect(bad.allowed).toBe(false)
    expect(bad.denial).toBe('TARGET_NOT_ALLOWED')
  })

  it('revocation is a state transition, not a delete', async () => {
    const actorId = await bareActor()
    await grantCapability({
      actorId,
      actionType: 'TRADE',
      resourceScope: 'test',
      limits: {
        amountLimit: null,
        frequencyLimit: null,
        frequencyWindowSeconds: null,
        allowedTargets: [],
        expiresAt: null,
      },
      attenuated: false,
    })

    expect(await revokeCapabilities({ actorId, reason: 'test' })).toBe(1)
    // The row survives so it can still explain why an action stopped working.
    const row = await prisma.capability.findFirst({ where: { actorId } })
    expect(row).not.toBeNull()
    expect(row!.status).toBe('REVOKED')
    expect((await checkCapability({ actorId, actionType: 'TRADE' })).allowed).toBe(false)
  })
})

describe('V2 Phase 3 — assurance leases', () => {
  it('a capability dies with the assurance lease it depended on', async () => {
    const actorId = await bareActor()
    const lease = await prisma.assuranceLease.create({
      data: {
        actorId,
        level: 'WORLD_ONLY',
        expiresAt: new Date(Date.now() + 60_000),
        sessionBinding: randomBytes(16).toString('hex'),
      },
    })
    await grantCapability({
      actorId,
      actionType: 'TRANSFER',
      resourceScope: 'test',
      limits: {
        amountLimit: null,
        frequencyLimit: null,
        frequencyWindowSeconds: null,
        allowedTargets: [],
        expiresAt: null,
      },
      assuranceLeaseId: lease.id,
      attenuated: false,
    })

    expect((await checkCapability({ actorId, actionType: 'TRANSFER' })).allowed).toBe(true)

    // Rotation deadline passes without a fresh proof.
    await prisma.assuranceLease.update({
      where: { id: lease.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const after = await checkCapability({ actorId, actionType: 'TRANSFER' })
    expect(after.allowed).toBe(false)
    expect(after.denial).toBe('ASSURANCE_LEASE_EXPIRED')
  })

  it('reports assurance state on the capabilities route', async () => {
    const actorId = await bareActor()
    const res = await auth(request(app).get(`/v2/actors/${actorId}/capabilities`))
    expect(res.status).toBe(200)
    expect(res.body.assurance.hasLiveLease).toBe(false)
    expect(res.body.capabilities).toEqual([])
  })
})

describe('V2 Phase 3 — V1 is still untouched', () => {
  it('the V1 claim gate is unaffected by the V2 policy engine', async () => {
    if (!seeded) return
    const campaignId = `p3-v1-${randomBytes(4).toString('hex')}`
    const res = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CLEAN_WALLET,
      campaignId,
    })
    expect(res.status).toBe(200)
    // V1 still speaks its own vocabulary — no LIMIT, no capability.
    expect(['ALLOW', 'CHALLENGE', 'BLOCK', 'PENDING_REVIEW']).toContain(res.body.decision)

    await prisma.evidenceReceipt.deleteMany({ where: { claimId: res.body.claimId as string } })
    await prisma.claim.deleteMany({ where: { id: res.body.claimId as string } })
  }, 60_000)
})
