/**
 * V2 Phase 2 — Trust Context against real Postgres over real HTTP.
 *
 * Requires a migrated database and `npm run db:seed`. NO MOCKS: the trust
 * context runs V1's real risk cache, real freshness guard and real evidence.
 *
 * The acceptance condition is asserted directly — the backend must distinguish
 * ESTABLISHED_LOW, HIGH_RISK and INSUFFICIENT_EVIDENCE without treating an
 * unknown wallet as low risk.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

const { app } = await import('../src/server.js')
const { prisma } = await import('../src/lib/prisma.js')
const { FIXTURE_CLEAN_WALLET, FIXTURE_CLUSTERED_WALLET } = await import(
  '../src/interfaces/stub-fixtures.js'
)
const { recordTrustSignal, trustSignalBalance } = await import('../src/trust/trust-history.js')

const KEY = 'test-api-key'
const auth = <T extends { set: (a: string, b: string) => T }>(req: T): T =>
  req.set('X-API-Key', KEY)

const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`

/** Fixture wallets both /v2 suites share. Their actors are never deleted. */
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
  seeded =
    (await prisma.policyVersion.count({ where: { active: true } })) > 0 &&
    (await prisma.evidenceEvent.count({ where: { wallet: FIXTURE_CLEAN_WALLET } })) > 0
})

afterAll(async () => {
  // Never delete an actor bound to a SHARED fixture wallet. Both /v2 test files
  // adopt those same actors, and vitest runs files in parallel — whichever
  // finished first used to delete the actor the other was mid-test on, cascading
  // away its in-flight intents and surfacing as a 500. Actors for fixture
  // wallets are shared, seed-like state; leaving the rows behind is harmless.
  const shared = await prisma.actorIdentity.findMany({
    where: { kind: 'WALLET', externalId: { in: SHARED_FIXTURE_WALLETS } },
    select: { actorId: true },
  })
  const protectedIds = new Set(shared.map((r) => r.actorId))
  const deletable = createdActorIds.filter((id) => !protectedIds.has(id))
  await prisma.actor.deleteMany({ where: { id: { in: deletable } } })
  await prisma.$disconnect()
})

/** Creates an actor bound to `wallet`, tolerating a wallet already bound. */
async function actorFor(wallet: string): Promise<string> {
  const res = await auth(request(app).post('/v2/actors')).send({
    actorType: 'WALLET',
    wallet: { address: wallet },
  })
  if (res.status === 201) return trackActor(res.body.id as string)
  if (res.status !== 409) {
    throw new Error(`POST /v2/actors -> ${res.status} ${JSON.stringify(res.body)}`)
  }

  const existing = await prisma.actorIdentity.findUnique({
    where: { kind_externalId: { kind: 'WALLET', externalId: wallet.toLowerCase() } },
  })
  return trackActor(existing!.actorId)
}

async function trustFor(actorId: string) {
  const res = await auth(request(app).get(`/v2/actors/${actorId}/trust`))
  if (res.status !== 200) {
    throw new Error(`GET trust -> ${res.status} ${JSON.stringify(res.body)}`)
  }
  return res.body as {
    band: string
    snapshotId: string
    vector: Record<string, { value: number | null; state: string; basis: string }>
    drift: { signals: unknown[]; peakMagnitude: number; hadBaseline: boolean }
    evidenceIds: string[]
    engineVersion: string
  }
}

describe('V2 Phase 2 — the acceptance condition', () => {
  it('an UNKNOWN wallet is INSUFFICIENT_EVIDENCE, not low risk', async () => {
    if (!seeded) return
    const actorId = await actorFor(randomWallet())
    const trust = await trustFor(actorId)

    expect(trust.band).toBe('INSUFFICIENT_EVIDENCE')
    expect(trust.band).not.toBe('ESTABLISHED_LOW')
    expect(trust.band).not.toBe('VERIFIED_LOW')
    expect(trust.band).not.toBe('UNCERTAIN')
  }, 45_000)

  it('a coordinated ring is HIGH_RISK or CRITICAL', async () => {
    if (!seeded) return
    const actorId = await actorFor(FIXTURE_CLUSTERED_WALLET)
    const trust = await trustFor(actorId)

    expect(['HIGH_RISK', 'CRITICAL']).toContain(trust.band)
    expect(trust.vector.coordinationRisk!.state).toBe('KNOWN')
    expect(trust.vector.coordinationRisk!.value).toBeGreaterThan(0.35)
  }, 45_000)

  it('a clean established wallet reaches a LOW band', async () => {
    if (!seeded) return
    const actorId = await actorFor(FIXTURE_CLEAN_WALLET)
    const trust = await trustFor(actorId)

    expect(['ESTABLISHED_LOW', 'VERIFIED_LOW', 'UNCERTAIN']).toContain(trust.band)
    expect(trust.band).not.toBe('INSUFFICIENT_EVIDENCE')
    expect(trust.vector.coordinationRisk!.value).toBeLessThan(0.35)
  }, 45_000)

  it('the three states are genuinely distinguishable in one run', async () => {
    if (!seeded) return
    const [cold, ring, clean] = await Promise.all([
      actorFor(randomWallet()).then(trustFor),
      actorFor(FIXTURE_CLUSTERED_WALLET).then(trustFor),
      actorFor(FIXTURE_CLEAN_WALLET).then(trustFor),
    ])

    expect(cold.band).toBe('INSUFFICIENT_EVIDENCE')
    expect(['HIGH_RISK', 'CRITICAL']).toContain(ring.band)
    expect(clean.band).not.toBe('INSUFFICIENT_EVIDENCE')
    expect(new Set([cold.band, ring.band, clean.band]).size).toBe(3)
  }, 60_000)
})

describe('V2 Phase 2 — unknown is never zero', () => {
  it('stores null, not 0, for a dimension it could not measure', async () => {
    if (!seeded) return
    const actorId = await actorFor(FIXTURE_CLEAN_WALLET)
    const trust = await trustFor(actorId)

    // agentReputation cannot be measured until ERC-8004 lands in Phase 6.
    expect(trust.vector.agentReputation!.value).toBeNull()
    expect(trust.vector.agentReputation!.state).toBe('UNKNOWN')

    const row = await prisma.trustSnapshot.findUnique({ where: { id: trust.snapshotId } })
    // The column itself must be NULL — a 0 would be read as "measured, poor".
    expect(row!.agentReputation).toBeNull()
  }, 45_000)

  it('gives every dimension a stated basis', async () => {
    if (!seeded) return
    const trust = await trustFor(await actorFor(FIXTURE_CLEAN_WALLET))
    for (const [name, d] of Object.entries(trust.vector)) {
      expect(d.basis.length, `${name} has no basis`).toBeGreaterThan(0)
    }
  }, 45_000)

  it('an actor with no wallet at all is INSUFFICIENT_EVIDENCE', async () => {
    const created = await auth(request(app).post('/v2/actors')).send({ actorType: 'ORGANIZATION' })
    const actorId = trackActor(created.body.id as string)
    const trust = await trustFor(actorId)

    expect(trust.band).toBe('INSUFFICIENT_EVIDENCE')
    expect(trust.evidenceIds).toHaveLength(0)
  }, 45_000)
})

describe('V2 Phase 2 — append-only history', () => {
  it('writes a NEW snapshot each evaluation rather than mutating the last', async () => {
    if (!seeded) return
    const actorId = await actorFor(FIXTURE_CLEAN_WALLET)

    const first = await trustFor(actorId)
    const second = await trustFor(actorId)

    expect(second.snapshotId).not.toBe(first.snapshotId)
    // The earlier snapshot must survive, so a decision that cited it stays
    // reconstructable.
    expect(await prisma.trustSnapshot.findUnique({ where: { id: first.snapshotId } })).not.toBeNull()
  }, 60_000)

  it('serves history newest-first', async () => {
    if (!seeded) return
    const actorId = await actorFor(FIXTURE_CLEAN_WALLET)
    await trustFor(actorId)
    await trustFor(actorId)

    const res = await auth(request(app).get(`/v2/actors/${actorId}/trust/history`))
    expect(res.status).toBe(200)
    expect(res.body.snapshots.length).toBeGreaterThanOrEqual(2)

    const times = (res.body.snapshots as Array<{ createdAt: string }>).map((s) =>
      Date.parse(s.createdAt),
    )
    expect(times).toEqual([...times].sort((a, b) => b - a))
  }, 60_000)

  it('records trust signals and reports a balance', async () => {
    const created = await auth(request(app).post('/v2/actors')).send({ actorType: 'AGENT' })
    const actorId = trackActor(created.body.id as string)

    await recordTrustSignal({
      actorId,
      kind: 'SUCCESSFUL_CHALLENGE',
      weight: 1,
      detail: 'passed',
      source: 'v2-trust.db.test.ts',
    })
    await recordTrustSignal({
      actorId,
      kind: 'POLICY_VIOLATION',
      weight: 0.5,
      detail: 'violated',
      source: 'v2-trust.db.test.ts',
    })

    const balance = await trustSignalBalance(actorId)
    expect(balance.count).toBe(2)
    expect(balance.positive).toBe(1)
    expect(balance.negative).toBe(0.5)
    expect(balance.net).toBe(0.5)
  })

  it('derives positive/negative from the kind, not from the caller', async () => {
    const created = await auth(request(app).post('/v2/actors')).send({ actorType: 'AGENT' })
    const actorId = trackActor(created.body.id as string)

    await recordTrustSignal({
      actorId,
      kind: 'CONFIRMED_COORDINATED_CLUSTER',
      weight: 1,
      detail: 'ring',
      source: 'v2-trust.db.test.ts',
    })
    const row = await prisma.trustSignal.findFirst({ where: { actorId } })
    // The same event can never be positive in one place and negative in another.
    expect(row!.positive).toBe(false)
  })

  it('signal balance does NOT move the band', async () => {
    if (!seeded) return
    // Section 3.1 — deterministic evidence decides. A run of routine successes
    // must not offset a live coordination signal.
    const actorId = await actorFor(FIXTURE_CLUSTERED_WALLET)
    const before = await trustFor(actorId)

    for (let i = 0; i < 5; i++) {
      await recordTrustSignal({
        actorId,
        kind: 'SUCCESSFUL_ACTION',
        weight: 1,
        detail: `clean run ${i}`,
        source: 'v2-trust.db.test.ts',
      })
    }

    const after = await trustFor(actorId)
    expect(after.band).toBe(before.band)
    expect(['HIGH_RISK', 'CRITICAL']).toContain(after.band)
  }, 60_000)
})

describe('V2 Phase 2 — intent integration', () => {
  it('an intent decision now cites a real trust snapshot', async () => {
    if (!seeded) return
    // Closes the Phase 1 carry-forward: AuthorizationDecision.trustSnapshotId
    // was a column with nothing writing to it.
    const res = await auth(request(app).post('/v2/intents')).send({
      wallet: FIXTURE_CLUSTERED_WALLET,
      resourceType: 'campaign',
      resourceId: `trust-link-${randomBytes(4).toString('hex')}`,
      actionType: 'CLAIM',
    })
    expect(res.status).toBe(201)
    trackActor(res.body.actorId as string)

    const decision = await prisma.authorizationDecision.findFirst({
      where: { intentId: res.body.intentId as string },
    })
    expect(decision!.trustSnapshotId).not.toBeNull()

    const snapshot = await prisma.trustSnapshot.findUnique({
      where: { id: decision!.trustSnapshotId! },
    })
    expect(snapshot).not.toBeNull()
    expect(snapshot!.actorId).toBe(res.body.actorId)

    // And the receipt pins the same snapshot.
    const receipt = await prisma.actionReceipt.findFirst({
      where: { intentId: res.body.intentId as string },
    })
    expect(receipt!.trustSnapshotId).toBe(decision!.trustSnapshotId)
  }, 60_000)

  it('still returns the V1-derived result — trust does not yet change the outcome', async () => {
    if (!seeded) return
    // Phase 2 builds the context; Phase 3 is what turns it into authorization.
    // Saying so in a test stops a later reader assuming the band is load-bearing.
    const res = await auth(request(app).post('/v2/intents')).send({
      wallet: FIXTURE_CLUSTERED_WALLET,
      resourceType: 'campaign',
      resourceId: `trust-noop-${randomBytes(4).toString('hex')}`,
      actionType: 'CLAIM',
    })
    expect(res.status, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`).toBe(201)
    trackActor(res.body.actorId as string)
    expect(res.body.decision.result).toBe('BLOCK')
  }, 60_000)
})

describe('V2 Phase 2 — routes', () => {
  it('requires auth', async () => {
    expect((await request(app).get('/v2/actors/x/trust')).status).toBe(401)
    expect((await request(app).get('/v2/actors/x/trust/history')).status).toBe(401)
  })

  it('404s trust for an unknown actor', async () => {
    expect((await auth(request(app).get('/v2/actors/nope/trust'))).status).toBe(404)
  })

  it('serves a cached snapshot with ?fresh=false', async () => {
    if (!seeded) return
    // A dedicated actor, not a shared fixture one. This asserts "the cached read
    // returns the snapshot I just built", which is only true if nothing else
    // snapshots the same actor in between — and /v2/intents now builds a trust
    // context on every call, so the parallel intent suite would race it.
    const actorId = await actorFor(randomWallet())
    const built = await trustFor(actorId)

    const cached = await auth(request(app).get(`/v2/actors/${actorId}/trust?fresh=false`))
    expect(cached.status).toBe(200)
    expect(cached.body.cached).toBe(true)
    expect(cached.body.snapshotId).toBe(built.snapshotId)
  }, 45_000)

  it('404s ?fresh=false before any snapshot exists', async () => {
    const created = await auth(request(app).post('/v2/actors')).send({ actorType: 'HUMAN' })
    trackActor(created.body.id as string)
    const res = await auth(
      request(app).get(`/v2/actors/${created.body.id}/trust?fresh=false`),
    )
    expect(res.status).toBe(404)
  })
})
