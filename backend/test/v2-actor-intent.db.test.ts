/**
 * V2 Phase 1 — Actor + Intent, against real Postgres over real HTTP.
 *
 * Requires a migrated database and `npm run db:seed`.
 *
 * NO MOCKS. The intent path runs V1's real risk cache, real freshness guard and
 * real policy engine, exactly as the server does. The fixture wallets are
 * synthetic addresses with no on-chain history, so the live Token API refresh
 * they trigger returns nothing and writes no rows.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

const { app } = await import('../src/server.js')
const { prisma } = await import('../src/lib/prisma.js')
const { FIXTURE_CLEAN_WALLET, FIXTURE_CLUSTERED_WALLET } = await import(
  '../src/interfaces/stub-fixtures.js'
)
const { FIXTURE_CHALLENGE_WALLET } = await import('../src/claim/fixtures.js')

const KEY = 'test-api-key'
const auth = <T extends { set: (a: string, b: string) => T }>(req: T): T =>
  req.set('X-API-Key', KEY)

const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`

const createdActorIds: string[] = []
function trackActor(id: string): string {
  createdActorIds.push(id)
  return id
}

let seeded = false

beforeAll(async () => {
  seeded =
    (await prisma.policyVersion.count({ where: { active: true } })) > 0 &&
    (await prisma.evidenceEvent.count({ where: { wallet: FIXTURE_CLEAN_WALLET } })) > 0
})

afterAll(async () => {
  // Cascades clear identities, intents, decisions and receipts.
  await prisma.actor.deleteMany({ where: { id: { in: createdActorIds } } })
  await prisma.$disconnect()
})

/** Creates an intent and returns the parsed body, failing loudly on a non-2xx. */
async function postIntent(body: Record<string, unknown>) {
  const res = await auth(request(app).post('/v2/intents')).send(body)
  if (res.status >= 300) {
    throw new Error(`POST /v2/intents -> ${res.status} ${JSON.stringify(res.body)}`)
  }
  trackActor(res.body.actorId as string)
  return res.body as {
    intentId: string
    actorId: string
    status: string
    replayed: boolean
    receiptId: string | null
    decision: {
      result: string
      reasonCode: string
      requiredAssurance: string | null
      riskScore: number
      policyVersion: string
      evidenceIds: string[]
    } | null
  }
}

const claimIntent = (wallet: string) => ({
  wallet,
  resourceType: 'campaign',
  resourceId: 'v2-phase1-campaign',
  actionType: 'CLAIM',
})

describe('V2 Phase 1 — auth', () => {
  it('refuses an unauthenticated request', async () => {
    const res = await request(app).post('/v2/actors').send({ actorType: 'WALLET' })
    expect(res.status).toBe(401)
  })

  it('refuses an unauthenticated read', async () => {
    expect((await request(app).get('/v2/actors/anything')).status).toBe(401)
  })
})

describe('V2 Phase 1 — actors', () => {
  it('creates an actor and reads it back with its identity', async () => {
    const address = randomWallet()
    const created = await auth(request(app).post('/v2/actors')).send({
      actorType: 'WALLET',
      displayName: 'test actor',
      wallet: { address },
    })
    expect(created.status).toBe(201)
    trackActor(created.body.id as string)

    const fetched = await auth(request(app).get(`/v2/actors/${created.body.id}`))
    expect(fetched.status).toBe(200)
    expect(fetched.body.actorType).toBe('WALLET')
    expect(fetched.body.status).toBe('ACTIVE')
    expect(fetched.body.identities).toHaveLength(1)
    expect(fetched.body.identities[0].kind).toBe('WALLET')
    expect(fetched.body.identities[0].externalId).toBe(address.toLowerCase())
  })

  it('stores a wallet identity as UNVERIFIED — seeing an address is not proof of control', async () => {
    // Invariant 3.3. Only a real assurance flow may promote this, and Phase 1
    // has none.
    const created = await auth(request(app).post('/v2/actors')).send({
      actorType: 'WALLET',
      wallet: { address: randomWallet() },
    })
    trackActor(created.body.id as string)
    expect(created.body.identities[0].status).toBe('UNVERIFIED')
    expect(created.body.identities[0].verifiedAt).toBeNull()
    expect(created.body.identities[0].source).toBe('wallet-address')
  })

  it('normalises a checksummed address to one identity', async () => {
    const lower = randomWallet()
    const upper = `0x${lower.slice(2).toUpperCase()}`

    const a = await auth(request(app).post('/v2/actors')).send({
      actorType: 'WALLET',
      wallet: { address: upper },
    })
    trackActor(a.body.id as string)
    expect(a.body.identities[0].externalId).toBe(lower)
  })

  it('refuses to re-parent a wallet already bound to another actor', async () => {
    const address = randomWallet()
    const first = await auth(request(app).post('/v2/actors')).send({
      actorType: 'WALLET',
      wallet: { address },
    })
    trackActor(first.body.id as string)

    const second = await auth(request(app).post('/v2/actors')).send({
      actorType: 'HUMAN',
      wallet: { address },
    })
    // Silently moving a wallet would rewrite whose history it is.
    expect(second.status).toBe(409)
  })

  it('rejects a malformed address', async () => {
    const res = await auth(request(app).post('/v2/actors')).send({
      actorType: 'WALLET',
      wallet: { address: 'not-an-address' },
    })
    expect(res.status).toBe(400)
  })

  it('404s an unknown actor', async () => {
    expect((await auth(request(app).get('/v2/actors/nope'))).status).toBe(404)
  })
})

describe('V2 Phase 1 — a claim expressed as an Intent (the acceptance condition)', () => {
  it('a clean wallet resolves ALLOW, with an actor created on the fly', async () => {
    if (!seeded) return
    const body = await postIntent(claimIntent(FIXTURE_CLEAN_WALLET))

    expect(body.decision?.result).toBe('ALLOW')
    expect(body.decision?.reasonCode).toBe('RISK_WITHIN_ALLOW_BAND')
    expect(body.status).toBe('DECIDED')
    expect(body.actorId).toBeTruthy()
  }, 30_000)

  it('a coordinated ring resolves BLOCK', async () => {
    if (!seeded) return
    const body = await postIntent(claimIntent(FIXTURE_CLUSTERED_WALLET))

    expect(body.decision?.result).toBe('BLOCK')
    expect(body.decision?.reasonCode).toBe('RISK_IN_BLOCK_BAND')
    expect(body.decision?.riskScore).toBeGreaterThan(0.7)
  }, 30_000)

  it('a challenge-band cluster resolves CHALLENGE and records the assurance needed', async () => {
    if (!seeded) return
    const body = await postIntent(claimIntent(FIXTURE_CHALLENGE_WALLET))

    expect(body.decision?.result).toBe('CHALLENGE')
    expect(body.decision?.requiredAssurance).toBe('SELFIE_CHECK')
    // Phase 1 records that assurance is required; running it is Phase 5.
  }, 30_000)

  it('AN UNKNOWN WALLET RESOLVES REVIEW, NEVER ALLOW', async () => {
    if (!seeded) return
    // The single most damaging mapping to get wrong. V1's PENDING_REVIEW means
    // the evidence was stale or a Graph query failed; turning that into ALLOW
    // is a confident authorization built on nothing.
    const body = await postIntent(claimIntent(randomWallet()))

    expect(body.decision?.result).toBe('REVIEW')
    expect(body.decision?.result).not.toBe('ALLOW')
    expect(body.decision?.reasonCode).toBe('EVIDENCE_NOT_FRESH')
  }, 30_000)

  it('DOES NOT touch the V1 claim flow', async () => {
    if (!seeded) return
    // Phase 1's acceptance condition, asserted literally: a claim can be
    // represented as an Intent WITHOUT changing the existing claim flow.
    //
    // Scoped to this run's own resourceId rather than counting rows globally.
    // A global before/after count is not a valid assertion in a suite that runs
    // files in parallel — claim-api.db.test.ts is creating real Claims at the
    // same moment, and the count would swing for reasons that have nothing to
    // do with what this test is checking.
    const resourceId = `v2-untouched-${randomBytes(6).toString('hex')}`

    const body = await postIntent({
      ...claimIntent(FIXTURE_CHALLENGE_WALLET),
      resourceId,
    })
    expect(body.decision?.result).toBe('CHALLENGE')

    // The V2 path issued a CHALLENGE, which in V1 would have written a Claim
    // and a VerificationChallenge. It must have written neither.
    expect(await prisma.claim.count({ where: { campaignId: resourceId } })).toBe(0)
    expect(
      await prisma.verificationChallenge.count({
        where: { worldActionId: { contains: resourceId } },
      }),
    ).toBe(0)

    // And the intent's own receipt is a V2 ActionReceipt, not a V1 one.
    expect(body.receiptId).toBeTruthy()
    expect(await prisma.actionReceipt.count({ where: { intentId: body.intentId } })).toBe(1)
  }, 30_000)

  it('the V1 claim gate still works unchanged alongside /v2', async () => {
    if (!seeded) return
    const res = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CLEAN_WALLET,
      campaignId: `v2-coexist-${Date.now()}`,
    })
    expect(res.status).toBe(200)
    expect(res.body.decision).toBe('ALLOW')

    await prisma.evidenceReceipt.deleteMany({ where: { claimId: res.body.claimId as string } })
    await prisma.claim.deleteMany({ where: { id: res.body.claimId as string } })
  }, 30_000)
})

describe('V2 Phase 1 — receipts and lineage', () => {
  it('every decision produces a receipt that pins its evidence and payload', async () => {
    if (!seeded) return
    const body = await postIntent(claimIntent(FIXTURE_CLUSTERED_WALLET))
    expect(body.receiptId).toBeTruthy()

    const receipt = await prisma.actionReceipt.findUnique({ where: { id: body.receiptId! } })
    expect(receipt).not.toBeNull()
    expect(receipt!.evidenceSnapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt!.decisionPayloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt!.intentId).toBe(body.intentId)
    expect(receipt!.actorId).toBe(body.actorId)
  }, 30_000)

  it('never reports an action as executed — Phase 1 has no enforcement', async () => {
    if (!seeded) return
    // Section 18.2: nothing may be reported as executed-as-authorized until an
    // enforcement adapter confirms it.
    const body = await postIntent(claimIntent(FIXTURE_CLEAN_WALLET))
    const receipt = await prisma.actionReceipt.findUnique({ where: { id: body.receiptId! } })
    expect(receipt!.executionStatus).toBe('NOT_EXECUTED')
    expect(receipt!.executionTxHash).toBeNull()
  }, 30_000)

  it('records the trust figures the decision was actually made against', async () => {
    if (!seeded) return
    const body = await postIntent(claimIntent(FIXTURE_CLUSTERED_WALLET))
    const decision = await prisma.authorizationDecision.findFirst({
      where: { intentId: body.intentId },
    })
    // Invariant 3.6 — a decision that cannot say what produced it is not
    // reconstructable.
    expect(decision!.riskScore).toBeGreaterThan(0.7)
    expect(decision!.policyVersion).not.toBe('none')
    expect(decision!.clusterId).toBeTruthy()
  }, 30_000)
})

describe('V2 Phase 1 — idempotency and races', () => {
  it('replays a prior decision for a repeated idempotency key', async () => {
    if (!seeded) return
    const key = `idem-${randomBytes(8).toString('hex')}`
    const wallet = FIXTURE_CLEAN_WALLET

    const first = await postIntent({ ...claimIntent(wallet), idempotencyKey: key })
    const second = await postIntent({ ...claimIntent(wallet), idempotencyKey: key })

    // A retried network call must not produce a second authorization.
    expect(second.intentId).toBe(first.intentId)
    expect(second.replayed).toBe(true)
    expect(await prisma.intent.count({ where: { idempotencyKey: key } })).toBe(1)
  }, 45_000)

  it('two CONCURRENT submissions of one key produce exactly one intent', async () => {
    if (!seeded) return
    const key = `idem-race-${randomBytes(8).toString('hex')}`
    const payload = { ...claimIntent(FIXTURE_CLEAN_WALLET), idempotencyKey: key }

    const [a, b] = await Promise.all([
      auth(request(app).post('/v2/intents')).send(payload),
      auth(request(app).post('/v2/intents')).send(payload),
    ])
    trackActor(a.body.actorId as string)

    expect(a.body.intentId).toBe(b.body.intentId)
    expect(await prisma.intent.count({ where: { idempotencyKey: key } })).toBe(1)
  }, 45_000)

  it('two CONCURRENT intents for one new wallet resolve to ONE actor', async () => {
    if (!seeded) return
    // Two actors owning one wallet would make "who is acting?" unanswerable and
    // split that wallet's trust history in half.
    const wallet = randomWallet()

    const [a, b] = await Promise.all([
      auth(request(app).post('/v2/intents')).send(claimIntent(wallet)),
      auth(request(app).post('/v2/intents')).send(claimIntent(wallet)),
    ])
    trackActor(a.body.actorId as string)

    expect(a.body.actorId).toBe(b.body.actorId)
    expect(
      await prisma.actorIdentity.count({ where: { kind: 'WALLET', externalId: wallet } }),
    ).toBe(1)
  }, 45_000)

  it('without a key, two identical requests are two separate intents', async () => {
    if (!seeded) return
    const wallet = FIXTURE_CLEAN_WALLET
    const first = await postIntent(claimIntent(wallet))
    const second = await postIntent(claimIntent(wallet))
    expect(second.intentId).not.toBe(first.intentId)
    // Same action, so the same parameters hash — idempotency is opt-in.
    expect(second.replayed).toBe(false)
  }, 45_000)
})

describe('V2 Phase 1 — validation and guards', () => {
  it('requires exactly one of actorId or wallet', async () => {
    const neither = await auth(request(app).post('/v2/intents')).send({
      resourceType: 'campaign',
      resourceId: 'x',
      actionType: 'CLAIM',
    })
    expect(neither.status).toBe(400)

    const both = await auth(request(app).post('/v2/intents')).send({
      ...claimIntent(randomWallet()),
      actorId: 'some-actor',
    })
    expect(both.status).toBe(400)
  })

  it('rejects a float amount — uint256 does not survive a JSON number', async () => {
    const res = await auth(request(app).post('/v2/intents')).send({
      ...claimIntent(randomWallet()),
      actionType: 'TRANSFER',
      amount: '10.5',
    })
    expect(res.status).toBe(400)
  })

  it('rejects an unknown action type', async () => {
    const res = await auth(request(app).post('/v2/intents')).send({
      ...claimIntent(randomWallet()),
      actionType: 'DEFINITELY_NOT_AN_ACTION',
    })
    expect(res.status).toBe(400)
  })

  it('holds an already-expired intent rather than deciding it', async () => {
    if (!seeded) return
    const body = await postIntent({
      ...claimIntent(FIXTURE_CLEAN_WALLET),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    expect(body.decision?.result).toBe('REVIEW')
    expect(body.decision?.reasonCode).toBe('INTENT_EXPIRED')
  }, 30_000)

  it('blocks a non-ACTIVE actor before any scoring happens', async () => {
    if (!seeded) return
    const created = await auth(request(app).post('/v2/actors')).send({
      actorType: 'AGENT',
      wallet: { address: FIXTURE_CLEAN_WALLET },
    })
    // FIXTURE_CLEAN_WALLET may already be bound by an earlier test; either way
    // we need its actor id.
    const actorId =
      created.status === 201
        ? (created.body.id as string)
        : ((
            await prisma.actorIdentity.findUnique({
              where: { kind_externalId: { kind: 'WALLET', externalId: FIXTURE_CLEAN_WALLET } },
            })
          )?.actorId as string)
    trackActor(actorId)

    await prisma.actor.update({ where: { id: actorId }, data: { status: 'FROZEN' } })
    try {
      const body = await postIntent({
        actorId,
        resourceType: 'campaign',
        resourceId: 'frozen-test',
        actionType: 'CLAIM',
      })
      expect(body.decision?.result).toBe('BLOCK')
      expect(body.decision?.reasonCode).toBe('ACTOR_NOT_ACTIVE')
    } finally {
      await prisma.actor.update({ where: { id: actorId }, data: { status: 'ACTIVE' } })
    }
  }, 30_000)

  it('404s an unknown intent', async () => {
    expect((await auth(request(app).get('/v2/intents/nope'))).status).toBe(404)
  })

  it('404s an intent created against an unknown actor', async () => {
    const res = await auth(request(app).post('/v2/intents')).send({
      actorId: 'does-not-exist',
      resourceType: 'campaign',
      resourceId: 'x',
      actionType: 'CLAIM',
    })
    expect(res.status).toBe(404)
  })
})
