/**
 * V2 Phase 5 — human-backed agents and active liveness, real Postgres over
 * real HTTP. NO MOCKS.
 *
 * The acceptance condition asserted directly: a user creates one agent,
 * establishes World-backed assurance, completes active liveness, and receives
 * an initial bounded capability set.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

const { app } = await import('../src/server.js')
const { prisma } = await import('../src/lib/prisma.js')
const { FIXTURE_CLEAN_WALLET } = await import('../src/interfaces/stub-fixtures.js')
const { resolveActorForWallet } = await import('../src/actor/actor-resolver.js')
const { canTransition } = await import('../src/agents/agent-service.js')
const { HAND_LANDMARK } = await import('../src/verification/liveness-geometry.js')
const { resetPolicyCache } = await import('../src/authorization/native-policy-evaluator.js')

const KEY = 'test-api-key'
const auth = <T extends { set: (a: string, b: string) => T }>(req: T): T =>
  req.set('X-API-Key', KEY)

const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`
const SHARED_FIXTURE_WALLETS = [FIXTURE_CLEAN_WALLET.toLowerCase()]

const createdActorIds: string[] = []
const createdClaimIds: string[] = []
let seeded = false

beforeAll(async () => {
  resetPolicyCache()
  seeded = (await prisma.policy.count({ where: { active: true } })) > 0
})

afterAll(async () => {
  const shared = await prisma.actorIdentity.findMany({
    where: { kind: 'WALLET', externalId: { in: SHARED_FIXTURE_WALLETS } },
    select: { actorId: true },
  })
  const protectedIds = new Set(shared.map((r) => r.actorId))
  await prisma.verificationChallenge.deleteMany({ where: { claimId: { in: createdClaimIds } } })
  await prisma.claim.deleteMany({ where: { id: { in: createdClaimIds } } })
  await prisma.actor.deleteMany({
    where: { id: { in: createdActorIds.filter((id) => !protectedIds.has(id)) } },
  })
  await prisma.$disconnect()
})

/** A real PASSED World verification, the same shape the V1 flow produces. */
async function passedWorldChallenge(wallet: string): Promise<string> {
  const claim = await prisma.claim.create({
    data: {
      wallet,
      campaignId: `agent-test-${randomBytes(4).toString('hex')}`,
      riskDecision: 'CHALLENGE',
    },
  })
  createdClaimIds.push(claim.id)
  const challenge = await prisma.verificationChallenge.create({
    data: {
      claimId: claim.id,
      wallet,
      status: 'PASSED',
      worldActionId: `claim-agent-${randomBytes(3).toString('hex')}`,
      signalHash: randomBytes(32).toString('hex'),
      resolvedAt: new Date(),
    },
  })
  return challenge.id
}

/** Landmarks for a hand with `count` fingers extended. */
function hand(count: number): Array<{ x: number; y: number }> {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9 }))
  const fingers: Array<[number, number, number]> = [
    [HAND_LANDMARK.INDEX_FINGER_TIP, HAND_LANDMARK.INDEX_FINGER_PIP, 0.42],
    [HAND_LANDMARK.MIDDLE_FINGER_TIP, HAND_LANDMARK.MIDDLE_FINGER_PIP, 0.5],
    [HAND_LANDMARK.RING_FINGER_TIP, HAND_LANDMARK.RING_FINGER_PIP, 0.58],
    [HAND_LANDMARK.PINKY_TIP, HAND_LANDMARK.PINKY_PIP, 0.68],
    [HAND_LANDMARK.THUMB_TIP, HAND_LANDMARK.THUMB_IP, 0.3],
  ]
  fingers.forEach(([tip, pip, x], i) => {
    points[pip] = { x, y: 0.7 }
    points[tip] = { x, y: i < count ? 0.5 : 0.78 }
  })
  return points
}

/** A trace that starts closed then holds `count` — a real transition. */
function trace(count: number) {
  return Array.from({ length: 16 }, (_, i) => ({
    tMs: i * 100,
    landmarks: hand(i < 4 ? 0 : count),
  }))
}

async function newActor(): Promise<string> {
  const actor = await resolveActorForWallet(randomWallet())
  createdActorIds.push(actor.id)
  return actor.id
}

describe('V2 Phase 5 — THE ACCEPTANCE CONDITION', () => {
  it('create agent -> World assurance -> liveness -> bounded capabilities', async () => {
    if (!seeded) return
    const wallet = randomWallet()

    // 1. create
    const created = await auth(request(app).post('/v2/agents')).send({
      wallet,
      name: 'Alpha',
    })
    expect(created.status).toBe(201)
    const { agentId, actorId } = created.body as { agentId: string; actorId: string }
    createdActorIds.push(actorId)
    expect(created.body.status).toBe('DRAFT')
    expect(created.body.verification.world).toBe('REQUIRED')

    // 2. active liveness — issue, then answer with a real landmark trace
    const start = await auth(request(app).post('/v2/verification/liveness/start')).send({
      actorId,
      agentId,
      sessionBinding: randomBytes(16).toString('hex'),
    })
    expect(start.status).toBe(201)
    const challenge = start.body as {
      challengeId: string
      nonce: string
      sessionBinding: string
      target: number
      instruction: string
    }
    expect(challenge.target).toBeGreaterThanOrEqual(1)
    expect(challenge.instruction).toContain(String(challenge.target))

    const complete = await auth(
      request(app).post('/v2/verification/liveness/complete'),
    ).send({
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      sessionBinding: challenge.sessionBinding,
      cvVersion: 'test-1',
      frames: trace(challenge.target),
    })
    expect(complete.status).toBe(200)
    expect(complete.body.passed, JSON.stringify(complete.body)).toBe(true)

    // 3. World assurance + liveness -> lease + capability envelope
    const worldChallengeId = await passedWorldChallenge(wallet.toLowerCase())
    const verified = await auth(request(app).post(`/v2/agents/${agentId}/verify`)).send({
      worldChallengeId,
      livenessChallengeId: challenge.challengeId,
    })
    expect(verified.status, JSON.stringify(verified.body)).toBe(200)

    expect(verified.body.status).toBe('ACTIVE')
    // Both proofs present, so the longer lease.
    expect(verified.body.assurance.level).toBe('WORLD_PLUS_ACTIVE')
    expect(verified.body.capabilityIds.length).toBeGreaterThan(0)

    // 4. the envelope is BOUNDED, not unlimited
    const caps = await prisma.capability.findMany({ where: { actorId } })
    expect(caps.length).toBeGreaterThan(0)
    for (const cap of caps) {
      expect(cap.frequencyLimit, `${cap.actionType} has no frequency bound`).not.toBeNull()
      // Every grant hangs off the lease, so it dies with the assurance.
      expect(cap.assuranceLeaseId).toBe(verified.body.assurance.leaseId)
    }
    // Nothing that moves value was granted on the strength of verification alone.
    expect(caps.some((c) => c.actionType === 'BORROW')).toBe(false)
    expect(caps.some((c) => c.actionType === 'TRANSFER')).toBe(false)
  }, 90_000)

  it('World alone yields the SHORTER lease than World plus liveness', async () => {
    if (!seeded) return
    // The rotation model: a credential proves someone was verified once,
    // a fresh liveness proof says someone is present now.
    const wallet = randomWallet()
    const created = await auth(request(app).post('/v2/agents')).send({ wallet, name: 'Beta' })
    const { agentId, actorId } = created.body as { agentId: string; actorId: string }
    createdActorIds.push(actorId)

    const worldChallengeId = await passedWorldChallenge(wallet.toLowerCase())
    const verified = await auth(request(app).post(`/v2/agents/${agentId}/verify`)).send({
      worldChallengeId,
    })
    expect(verified.status).toBe(200)
    expect(verified.body.assurance.level).toBe('WORLD_ONLY')

    const ttl = Date.parse(verified.body.assurance.expiresAt) - Date.now()
    expect(ttl).toBeLessThan(12 * 3600 * 1000)
  }, 90_000)
})

describe('V2 Phase 5 — assurance cannot be asserted, only proven', () => {
  it('refuses to human-back an agent with no World verification', async () => {
    if (!seeded) return
    const created = await auth(request(app).post('/v2/agents')).send({
      wallet: randomWallet(),
      name: 'NoWorld',
    })
    createdActorIds.push(created.body.actorId as string)

    const res = await auth(request(app).post(`/v2/agents/${created.body.agentId}/verify`)).send({
      worldChallengeId: 'does-not-exist',
    })
    expect(res.status).toBe(400)
  }, 60_000)

  it('refuses a World challenge that did not pass', async () => {
    if (!seeded) return
    const wallet = randomWallet()
    const created = await auth(request(app).post('/v2/agents')).send({ wallet, name: 'Failed' })
    createdActorIds.push(created.body.actorId as string)

    const claim = await prisma.claim.create({
      data: { wallet, campaignId: `agent-fail-${randomBytes(4).toString('hex')}`, riskDecision: 'CHALLENGE' },
    })
    createdClaimIds.push(claim.id)
    const failed = await prisma.verificationChallenge.create({
      data: {
        claimId: claim.id,
        wallet,
        status: 'FAILED',
        worldActionId: `claim-fail-${randomBytes(3).toString('hex')}`,
        signalHash: randomBytes(32).toString('hex'),
      },
    })

    const res = await auth(request(app).post(`/v2/agents/${created.body.agentId}/verify`)).send({
      worldChallengeId: failed.id,
    })
    expect(res.status).toBe(400)
  }, 60_000)

  it("REFUSES ANOTHER ACTOR'S liveness proof", async () => {
    if (!seeded) return
    // Otherwise anyone could point at somebody else's successful challenge.
    const wallet = randomWallet()
    const created = await auth(request(app).post('/v2/agents')).send({ wallet, name: 'Borrower' })
    const { agentId, actorId } = created.body as { agentId: string; actorId: string }
    createdActorIds.push(actorId)

    const strangerId = await newActor()
    const start = await auth(request(app).post('/v2/verification/liveness/start')).send({
      actorId: strangerId,
      sessionBinding: randomBytes(16).toString('hex'),
    })
    const c = start.body as { challengeId: string; nonce: string; sessionBinding: string; target: number }
    await auth(request(app).post('/v2/verification/liveness/complete')).send({
      challengeId: c.challengeId,
      nonce: c.nonce,
      sessionBinding: c.sessionBinding,
      frames: trace(c.target),
    })

    const worldChallengeId = await passedWorldChallenge(wallet.toLowerCase())
    const res = await auth(request(app).post(`/v2/agents/${agentId}/verify`)).send({
      worldChallengeId,
      livenessChallengeId: c.challengeId,
    })
    expect(res.status).toBe(403)
  }, 90_000)
})

describe('V2 Phase 5 — liveness challenge integrity', () => {
  async function issue(actorId: string) {
    const res = await auth(request(app).post('/v2/verification/liveness/start')).send({
      actorId,
      sessionBinding: randomBytes(16).toString('hex'),
    })
    return res.body as { challengeId: string; nonce: string; sessionBinding: string; target: number }
  }

  it('rejects a wrong nonce', async () => {
    const c = await issue(await newActor())
    const res = await auth(request(app).post('/v2/verification/liveness/complete')).send({
      challengeId: c.challengeId,
      nonce: randomBytes(32).toString('hex'),
      sessionBinding: c.sessionBinding,
      frames: trace(c.target),
    })
    expect(res.body.passed).toBe(false)
    expect(res.body.failureCode).toBe('NONCE_MISMATCH')
  })

  it('rejects a proof from a different session', async () => {
    const c = await issue(await newActor())
    const res = await auth(request(app).post('/v2/verification/liveness/complete')).send({
      challengeId: c.challengeId,
      nonce: c.nonce,
      sessionBinding: randomBytes(16).toString('hex'),
      frames: trace(c.target),
    })
    expect(res.body.passed).toBe(false)
    expect(res.body.failureCode).toBe('SESSION_BINDING_MISMATCH')
  })

  it('IS SINGLE USE, even after a failure', async () => {
    // Consuming only on success would turn one nonce into unlimited attempts,
    // letting an attacker retry until a synthesised trace happened to satisfy it.
    const c = await issue(await newActor())

    const wrong = await auth(request(app).post('/v2/verification/liveness/complete')).send({
      challengeId: c.challengeId,
      nonce: c.nonce,
      sessionBinding: c.sessionBinding,
      frames: trace(c.target === 5 ? 1 : 5),
    })
    expect(wrong.body.passed).toBe(false)

    const retry = await auth(request(app).post('/v2/verification/liveness/complete')).send({
      challengeId: c.challengeId,
      nonce: c.nonce,
      sessionBinding: c.sessionBinding,
      frames: trace(c.target),
    })
    expect(retry.body.passed).toBe(false)
    expect(retry.body.failureCode).toBe('ALREADY_CONSUMED')
  })

  it('rejects an expired challenge', async () => {
    const c = await issue(await newActor())
    await prisma.livenessChallenge.update({
      where: { id: c.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const res = await auth(request(app).post('/v2/verification/liveness/complete')).send({
      challengeId: c.challengeId,
      nonce: c.nonce,
      sessionBinding: c.sessionBinding,
      frames: trace(c.target),
    })
    expect(res.body.passed).toBe(false)
    expect(res.body.failureCode).toBe('EXPIRED')
  })

  it('STORES NO BIOMETRIC MATERIAL — derived counts only', async () => {
    // Sections 3.7 and 28. Landmarks are verified and discarded.
    const c = await issue(await newActor())
    await auth(request(app).post('/v2/verification/liveness/complete')).send({
      challengeId: c.challengeId,
      nonce: c.nonce,
      sessionBinding: c.sessionBinding,
      frames: trace(c.target),
    })

    const row = await prisma.livenessChallenge.findUnique({ where: { id: c.challengeId } })
    const signal = row!.signalJson as { observedCounts?: number[] } | null
    expect(Object.keys(signal ?? {})).toEqual(['observedCounts'])
    expect(signal!.observedCounts!.every((n) => Number.isInteger(n))).toBe(true)
    // No landmarks anywhere in the stored record.
    expect(JSON.stringify(row)).not.toContain('landmarks')
  })

  it('rejects a still image over HTTP, not just in the unit test', async () => {
    const c = await issue(await newActor())
    const still = Array.from({ length: 16 }, (_, i) => ({ tMs: i * 100, landmarks: hand(c.target) }))
    const res = await auth(request(app).post('/v2/verification/liveness/complete')).send({
      challengeId: c.challengeId,
      nonce: c.nonce,
      sessionBinding: c.sessionBinding,
      frames: still,
    })
    expect(res.body.passed).toBe(false)
    expect(res.body.failureCode).toBe('NO_TRANSITION_OBSERVED')
  })

  it('rejects a frame that is not 21 landmarks at the schema boundary', async () => {
    const c = await issue(await newActor())
    const res = await auth(request(app).post('/v2/verification/liveness/complete')).send({
      challengeId: c.challengeId,
      nonce: c.nonce,
      sessionBinding: c.sessionBinding,
      frames: [{ tMs: 0, landmarks: [{ x: 0.1, y: 0.1 }] }],
    })
    expect(res.status).toBe(400)
  })
})

describe('V2 Phase 5 — lifecycle', () => {
  it('permits only legal status transitions', () => {
    expect(canTransition('DRAFT', 'VERIFYING')).toBe(true)
    expect(canTransition('HUMAN_BACKED', 'ACTIVE')).toBe(true)
    expect(canTransition('ACTIVE', 'FROZEN')).toBe(true)
    expect(canTransition('FROZEN', 'ACTIVE')).toBe(true)
    // Terminal — an agent whose authority was destroyed is replaced, not revived.
    expect(canTransition('REVOKED', 'ACTIVE')).toBe(false)
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false)
  })

  it('FREEZE SUSPENDS CAPABILITIES, it is not just a flag', async () => {
    if (!seeded) return
    // Section 19.3. An agent marked frozen whose capabilities still pass
    // checkCapability is not frozen.
    const wallet = randomWallet()
    const created = await auth(request(app).post('/v2/agents')).send({ wallet, name: 'Freezer' })
    const { agentId, actorId } = created.body as { agentId: string; actorId: string }
    createdActorIds.push(actorId)

    const worldChallengeId = await passedWorldChallenge(wallet.toLowerCase())
    await auth(request(app).post(`/v2/agents/${agentId}/verify`)).send({ worldChallengeId })

    expect(await prisma.capability.count({ where: { actorId, status: 'ACTIVE' } })).toBeGreaterThan(0)

    const frozen = await auth(request(app).post(`/v2/agents/${agentId}/freeze`)).send({
      reason: 'test',
    })
    expect(frozen.status).toBe(200)
    expect(frozen.body.status).toBe('FROZEN')
    expect(await prisma.capability.count({ where: { actorId, status: 'ACTIVE' } })).toBe(0)
    expect(await prisma.capability.count({ where: { actorId, status: 'SUSPENDED' } })).toBeGreaterThan(0)

    const thawed = await auth(request(app).post(`/v2/agents/${agentId}/unfreeze`)).send({
      reason: 'test',
    })
    expect(thawed.status).toBe(200)
    expect(await prisma.capability.count({ where: { actorId, status: 'ACTIVE' } })).toBeGreaterThan(0)
  }, 120_000)

  it('refuses to unfreeze into an expired assurance lease', async () => {
    if (!seeded) return
    // Restoring authority that nothing currently vouches for.
    const wallet = randomWallet()
    const created = await auth(request(app).post('/v2/agents')).send({ wallet, name: 'Lapsed' })
    const { agentId, actorId } = created.body as { agentId: string; actorId: string }
    createdActorIds.push(actorId)

    const worldChallengeId = await passedWorldChallenge(wallet.toLowerCase())
    const verified = await auth(request(app).post(`/v2/agents/${agentId}/verify`)).send({
      worldChallengeId,
    })
    await auth(request(app).post(`/v2/agents/${agentId}/freeze`)).send({ reason: 'test' })

    await prisma.assuranceLease.update({
      where: { id: verified.body.assurance.leaseId as string },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await auth(request(app).post(`/v2/agents/${agentId}/unfreeze`)).send({
      reason: 'test',
    })
    expect(res.status).toBe(409)
  }, 120_000)

  it('revoke is terminal and kills capabilities outright', async () => {
    if (!seeded) return
    const wallet = randomWallet()
    const created = await auth(request(app).post('/v2/agents')).send({ wallet, name: 'Doomed' })
    const { agentId, actorId } = created.body as { agentId: string; actorId: string }
    createdActorIds.push(actorId)

    const worldChallengeId = await passedWorldChallenge(wallet.toLowerCase())
    await auth(request(app).post(`/v2/agents/${agentId}/verify`)).send({ worldChallengeId })

    const revoked = await auth(request(app).post(`/v2/agents/${agentId}/revoke`)).send({
      reason: 'test',
    })
    expect(revoked.body.status).toBe('REVOKED')
    expect(await prisma.capability.count({ where: { actorId, status: 'ACTIVE' } })).toBe(0)

    // No way back.
    const res = await auth(request(app).post(`/v2/agents/${agentId}/unfreeze`)).send({
      reason: 'test',
    })
    expect(res.status).toBe(409)
  }, 120_000)

  it('requires auth on every agent route', async () => {
    expect((await request(app).post('/v2/agents').send({ name: 'x' })).status).toBe(401)
    expect((await request(app).get('/v2/agents')).status).toBe(401)
  })
})
