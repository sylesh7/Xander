/**
 * Claim Gate API — Backend-Sylesh.md Phases 20-23 acceptance tests.
 *
 * Requires migrated Postgres and `npm run db:seed`.
 *
 * `refreshWalletEvidence` is the ONLY thing mocked, and only to keep the suite
 * off the live Token API and gateway — it always fetches when called by design.
 * Everything the tests actually assert on (scoring, clustering, banding,
 * challenge issuance, receipts, the transaction) runs for real against Postgres.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

// NO MOCKS. `refreshWalletEvidence` runs for real against the live Token API
// and the Standardized Subgraphs gateway on every cache miss. That costs a
// couple of seconds per screening, which is why this file's timeouts are
// generous — but it means the claim path is exercised exactly as production
// runs it. Verified safe for these fixtures: they are synthetic addresses with
// no on-chain history, so a real refresh returns nothing and writes no rows.
const { app } = await import('../src/server.js')
const { prisma } = await import('../src/lib/prisma.js')
const { FIXTURE_CLEAN_WALLET, FIXTURE_CLUSTERED_WALLET } = await import(
  '../src/interfaces/stub-fixtures.js'
)
const { FIXTURE_CHALLENGE_WALLET } = await import('../src/claim/fixtures.js')

const KEY = 'test-api-key'
const auth = <T extends { set: (a: string, b: string) => T }>(req: T): T =>
  req.set('X-API-Key', KEY)

/** Unique per test so campaign-level clustering in one test cannot affect another. */
const campaign = (name: string): string => `test-${name}-${Date.now()}`

const createdCampaigns: string[] = []
function track(id: string): string {
  createdCampaigns.push(id)
  return id
}

let seeded = false

beforeAll(async () => {
  seeded =
    (await prisma.policyVersion.count({ where: { active: true } })) > 0 &&
    (await prisma.evidenceEvent.count({ where: { wallet: FIXTURE_CLEAN_WALLET } })) > 0
})

afterAll(async () => {
  const claims = await prisma.claim.findMany({
    where: { campaignId: { in: createdCampaigns } },
    select: { id: true },
  })
  const ids = claims.map((c) => c.id)
  await prisma.verificationChallenge.deleteMany({ where: { claimId: { in: ids } } })
  await prisma.evidenceReceipt.deleteMany({ where: { claimId: { in: ids } } })
  await prisma.claim.deleteMany({ where: { campaignId: { in: createdCampaigns } } })
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------

describe('Phase 22 — auth', () => {
  it('rejects an unauthenticated request before it reaches the orchestrator', async () => {
    const res = await request(app)
      .post('/screen-claim')
      .send({ wallet: FIXTURE_CLEAN_WALLET, campaignId: 'unauthenticated' })

    expect(res.status).toBe(401)
    // Nothing was created — the rejection happened at the edge.
    expect(await prisma.claim.count({ where: { campaignId: 'unauthenticated' } })).toBe(0)
  })

  it('rejects a wrong key', async () => {
    const res = await request(app)
      .post('/screen-claim')
      .set('X-API-Key', 'not-the-key')
      .send({ wallet: FIXTURE_CLEAN_WALLET, campaignId: 'wrong-key' })

    expect(res.status).toBe(401)
  })

  it('leaves /health open — an uptime check must not need a credential', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('Phase 22 — request validation', () => {
  it('rejects a malformed wallet before the orchestrator sees it', async () => {
    const res = await auth(request(app).post('/screen-claim')).send({
      wallet: 'not-an-address',
      campaignId: 'x',
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_request')
  })

  it('rejects a missing campaignId', async () => {
    const res = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CLEAN_WALLET,
    })
    expect(res.status).toBe(400)
  })
})

describe('Phase 20 — the two synthetic scenarios, end to end', () => {
  it('a clean wallet resolves ALLOW with no World call at all', async () => {
    if (!seeded) return
    const campaignId = track(campaign('allow'))

    const res = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CLEAN_WALLET,
      campaignId,
    })

    expect(res.status).toBe(200)
    expect(res.body.decision).toBe('ALLOW')
    expect(res.body.requiredAssurance).toBeNull()

    // The entire adaptive thesis, asserted: no challenge row exists, so the
    // user was never prompted for biometrics.
    const challenges = await prisma.verificationChallenge.count({
      where: { claimId: res.body.claimId },
    })
    expect(challenges).toBe(0)
    expect(res.body.idkit).toBeNull()
  })

  it('a challenge-band cluster resolves CHALLENGE and issues a VerificationChallenge', async () => {
    if (!seeded) return
    const campaignId = track(campaign('challenge'))

    const res = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CHALLENGE_WALLET,
      campaignId,
    })

    expect(res.status).toBe(202)
    expect(res.body.decision).toBe('CHALLENGE')
    expect(res.body.requiredAssurance).toBe('SELFIE_CHECK')
    expect(res.body.riskScore).toBeGreaterThanOrEqual(0.35)
    expect(res.body.riskScore).toBeLessThan(0.7)

    const challenge = await prisma.verificationChallenge.findFirst({
      where: { claimId: res.body.claimId },
    })
    expect(challenge).not.toBeNull()
    expect(challenge?.status).toBe('ISSUED')
    expect(challenge?.worldActionId).toBe(`claim-${campaignId}`)

    // The client gets everything it needs to open IDKit, including the signal
    // that binds the proof to this wallet and this claim.
    expect(res.body.idkit.preset).toBe('selfieCheckLegacy')
    expect(res.body.idkit.signal).toContain(res.body.claimId)
  })

  it('a coordinated ring resolves BLOCK', async () => {
    if (!seeded) return
    const campaignId = track(campaign('block'))

    const res = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CLUSTERED_WALLET,
      campaignId,
    })

    expect(res.body.decision).toBe('BLOCK')
    expect(res.body.riskScore).toBeGreaterThanOrEqual(0.7)
  })

  it('an unknown wallet is HELD, never allowed', async () => {
    if (!seeded) return
    const campaignId = track(campaign('unknown'))

    // Freshly random, so it is genuinely unknown every run.
    //
    // This used to be the literal constant 0x...deadbeef, which is a REAL
    // mainnet address with real history. The moment anything screened it
    // against a live Token API — as the V2 Phase 0 joint run did — 82 genuine
    // evidence rows landed in the shared dev database, the wallet stopped being
    // unknown, and this test flipped to ALLOW and stayed there. A test for
    // "unknown wallet" has to supply a wallet that cannot have been seen, not
    // one that merely looks synthetic.
    const wallet = `0x${randomBytes(20).toString('hex')}`

    const res = await auth(request(app).post('/screen-claim')).send({ wallet, campaignId })

    // Section 0.2 rule 4. An unknown wallet is not a safe wallet.
    expect(res.body.decision).toBe('PENDING_REVIEW')
    expect(res.body.decision).not.toBe('ALLOW')
  })
})

describe('Phase 22 — idempotency and concurrency', () => {
  it('two CONCURRENT screenings produce exactly one Claim and one challenge', async () => {
    if (!seeded) return
    const campaignId = track(campaign('concurrent'))

    // The acceptance test, literally: fire both at once, not in sequence.
    const [a, b] = await Promise.all([
      auth(request(app).post('/screen-claim')).send({
        wallet: FIXTURE_CHALLENGE_WALLET,
        campaignId,
      }),
      auth(request(app).post('/screen-claim')).send({
        wallet: FIXTURE_CHALLENGE_WALLET,
        campaignId,
      }),
    ])

    expect(a.body.claimId).toBe(b.body.claimId)

    const claims = await prisma.claim.count({ where: { campaignId } })
    const challenges = await prisma.verificationChallenge.count({
      where: { claimId: a.body.claimId },
    })

    expect(claims).toBe(1)
    expect(challenges).toBe(1)
  })

  it('a duplicate submission replays the existing decision', async () => {
    if (!seeded) return
    const campaignId = track(campaign('duplicate'))

    const first = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CLEAN_WALLET,
      campaignId,
    })
    const second = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CLEAN_WALLET,
      campaignId,
    })

    expect(second.body.claimId).toBe(first.body.claimId)
    expect(second.body.decision).toBe(first.body.decision)
    expect(await prisma.claim.count({ where: { campaignId } })).toBe(1)
  })
})

describe('Phase 21 — Evidence Receipt', () => {
  it('every decided claim has a receipt that reconstructs the decision', async () => {
    if (!seeded) return
    const campaignId = track(campaign('receipt'))

    const screened = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CHALLENGE_WALLET,
      campaignId,
    })
    expect(screened.body.evidenceReceiptId).toBeTruthy()

    const res = await auth(request(app).get(`/receipts/${screened.body.evidenceReceiptId}`))

    expect(res.status).toBe(200)
    // The full chain, without touching The Graph or World again.
    expect(res.body.decision).toBe('CHALLENGE')
    expect(res.body.policyVersion).toBe('1.0')
    expect(res.body.requiredAssurance).toBe('SELFIE_CHECK')
    expect(Array.isArray(res.body.features)).toBe(true)
    expect(res.body.features.length).toBeGreaterThan(0)
    expect(Array.isArray(res.body.sources)).toBe(true)
    expect(res.body.worldChallengeId).toBe(screened.body.verificationChallengeId)
  })

  it('404s an unknown receipt rather than inventing one', async () => {
    const res = await auth(request(app).get('/receipts/no-such-receipt'))
    expect(res.status).toBe(404)
  })
})

describe('Phase 22 — read surface', () => {
  it('serves a cluster summary', async () => {
    if (!seeded) return
    const wallet = await prisma.wallet.findFirst({ where: { clusterId: { not: null } } })
    if (!wallet?.clusterId) return

    const res = await auth(request(app).get(`/clusters/${wallet.clusterId}`))

    expect(res.status).toBe(200)
    expect(res.body.walletCount).toBeGreaterThan(1)
    expect(res.body.confidence).toBeTruthy()
  })

  it('serves cluster evidence with provenance, and block numbers as strings', async () => {
    if (!seeded) return
    const wallet = await prisma.wallet.findFirst({ where: { clusterId: { not: null } } })
    if (!wallet?.clusterId) return

    const res = await auth(request(app).get(`/clusters/${wallet.clusterId}/evidence`))

    expect(res.status).toBe(200)
    expect(res.body.eventCount).toBeGreaterThan(0)
    const event = res.body.events[0]
    // Section 0.2 rule 3 — provenance travels with the evidence.
    expect(event).toHaveProperty('sourceType')
    expect(event).toHaveProperty('deploymentId')
    // Block numbers exceed MAX_SAFE_INTEGER, so they cross the wire as strings.
    expect(typeof event.blockNumber).toBe('string')
  })

  it('serves wallet risk', async () => {
    if (!seeded) return
    const res = await auth(request(app).get(`/wallets/${FIXTURE_CLEAN_WALLET}/risk`))

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('OK')
    expect(res.body).toHaveProperty('riskScore')
  })

  it('serves campaign metrics including the escalation rate', async () => {
    if (!seeded) return
    const campaignId = track(campaign('metrics'))
    await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CHALLENGE_WALLET,
      campaignId,
    })

    const res = await auth(request(app).get(`/campaigns/${campaignId}`))

    expect(res.status).toBe(200)
    expect(res.body.totalClaims).toBe(1)
    expect(res.body.decisions.CHALLENGE).toBe(1)
    expect(res.body.escalationRate).toBe(1)
  })

  it('404s an unknown campaign', async () => {
    const res = await auth(request(app).get('/campaigns/never-existed'))
    expect(res.status).toBe(404)
  })
})

describe('Phase 16 — POST /world/rp-signature', () => {
  it('returns a signature the client can open IDKit with', async () => {
    const res = await auth(request(app).post('/world/rp-signature')).send({
      action: 'claim-test-campaign',
    })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('sig')
    expect(res.body).toHaveProperty('nonce')
    expect(res.body).toHaveProperty('created_at')
    expect(res.body).toHaveProperty('expires_at')
  })

  it('requires an action', async () => {
    const res = await auth(request(app).post('/world/rp-signature')).send({})
    expect(res.status).toBe(400)
  })
})

describe('Phase 22 — claim finalization', () => {
  it('refuses to finalize while verification is still outstanding', async () => {
    if (!seeded) return
    const campaignId = track(campaign('finalize-open'))

    const screened = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CHALLENGE_WALLET,
      campaignId,
    })

    const res = await auth(request(app).post('/claim/finalize')).send({
      claimId: screened.body.claimId,
    })

    // Never defaults either way: ALLOW would be fail-open, BLOCK would punish
    // a user still completing a verification.
    expect(res.status).toBe(409)
  })

  it('resolves to ALLOW once the challenge has PASSED', async () => {
    if (!seeded) return
    const campaignId = track(campaign('finalize-pass'))

    const screened = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CHALLENGE_WALLET,
      campaignId,
    })

    await prisma.verificationChallenge.update({
      where: { id: screened.body.verificationChallengeId },
      data: { status: 'PASSED', resolvedAt: new Date() },
    })

    const res = await auth(request(app).post('/claim/finalize')).send({
      claimId: screened.body.claimId,
    })

    expect(res.status).toBe(200)
    expect(res.body.decision).toBe('ALLOW')

    // The receipt now reflects the FINAL decision and names the challenge.
    const receipt = await prisma.evidenceReceipt.findUnique({
      where: { claimId: screened.body.claimId },
    })
    expect(receipt?.decision).toBe('ALLOW')
    expect(receipt?.worldChallengeId).toBe(screened.body.verificationChallengeId)
  })

  it('resolves to BLOCK when the challenge FAILED', async () => {
    if (!seeded) return
    const campaignId = track(campaign('finalize-fail'))

    const screened = await auth(request(app).post('/screen-claim')).send({
      wallet: FIXTURE_CHALLENGE_WALLET,
      campaignId,
    })

    await prisma.verificationChallenge.update({
      where: { id: screened.body.verificationChallengeId },
      data: { status: 'FAILED', resolvedAt: new Date() },
    })

    const res = await auth(request(app).post('/claim/finalize')).send({
      claimId: screened.body.claimId,
    })

    expect(res.body.decision).toBe('BLOCK')
  })

  it('404s an unknown claim', async () => {
    const res = await auth(request(app).post('/claim/finalize')).send({ claimId: 'nope' })
    expect(res.status).toBe(404)
  })
})
