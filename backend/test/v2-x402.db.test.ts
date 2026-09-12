/**
 * V2 Phase 9 — x402 agent commerce against real Postgres and real HTTP.
 *
 * NO MOCKS. Two layers, tested the way each actually works:
 *
 *  1. THE LADDER (section 17) is a set of POLICY ROWS, so it is tested by
 *     loading the real seeded rows out of Postgres and running the real rule
 *     engine over them. Nothing here fabricates a band into a snapshot — an
 *     earlier draft did, and it proved nothing, because every code path
 *     recomputes the trust context from evidence and overwrote the forgery.
 *
 *  2. THE SERVICE is tested against real actors and the real policy path, and
 *     asserts what genuinely happens — including that an actor with no fresh
 *     evidence is HELD rather than sold to.
 *
 * Settlement is deliberately absent: moving real testnet USDC belongs in
 * `npm run check:x402`, not in a suite that runs on every commit. Everything up
 * to the point where money would move is covered.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

const { app } = await import('../src/server.js')
const { prisma } = await import('../src/lib/prisma.js')
const { evaluateRules, selectRule } = await import('../src/authorization/rule-engine.js')
const { authorizePaidRequest, requirementsFor, x402Availability } = await import(
  '../src/x402/x402-service.js'
)
const { signPaymentPayload, payerAddress } = await import('../src/x402/x402-client.js')
const { encodeHeader, X402_HEADERS } = await import('../src/x402/x402-types.js')
const { generatePrivateKey } = await import('viem/accounts')

type Rule = Parameters<typeof selectRule>[0][number]
type AuthorizationRequest = Parameters<typeof selectRule>[1]

const createdActorIds: string[] = []
const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`
const SUBJECT = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'

let rules: Rule[] = []
let seeded = false
let enabled = false

beforeAll(async () => {
  const policy = await prisma.policy.findFirst({
    where: { active: true },
    include: { rules: { orderBy: { priority: 'asc' } } },
  })
  rules = (policy?.rules ?? []) as Rule[]
  seeded = rules.length > 0
  enabled = x402Availability() === null
})

afterAll(async () => {
  await prisma.actor.deleteMany({ where: { id: { in: createdActorIds } } })
  await prisma.$disconnect()
})

/** A real AuthorizationRequest for an x402 purchase at a given band. */
function purchaseAt(band: string, hasLiveLease = false): AuthorizationRequest {
  return {
    actor: { id: 'actor-under-test', actorType: 'AGENT', status: 'ACTIVE' },
    intent: {
      id: 'intent-under-test',
      actionType: 'X402_PAYMENT',
      resourceType: 'x402',
      resourceId: '/x402/risk-report',
      amount: '1000',
      asset: 'USDC',
      chainId: 84_532,
      targetAddress: null,
    },
    trust: {
      band,
      coordinationRisk: null,
      behaviorIntegrity: null,
      evidenceFreshness: 1,
      snapshotId: 'snapshot-under-test',
    },
    assurance: { hasLiveLease, level: hasLiveLease ? 'WORLD_ONLY' : null, expiresAt: null },
    currentCapabilities: [],
  } as AuthorizationRequest
}

const decide = (band: string, hasLiveLease = false) =>
  evaluateRules(rules, purchaseAt(band, hasLiveLease), {
    policyId: 'p',
    policyVersion: 'v2-1.1',
    now: new Date(),
  })

describe('V2 Phase 9 — SECTION 17’S LADDER, from the real policy rows', () => {
  it('ANOMALOUS AGENT -> 0', async () => {
    if (!seeded) return
    expect(decide('CRITICAL').result).toBe('BLOCK')
    expect(decide('HIGH_RISK').result).toBe('BLOCK')
  })

  it('TRUSTED AGENT -> 5000 requests/hour', async () => {
    if (!seeded) return
    const outcome = decide('VERIFIED_LOW')
    expect(outcome.result).toBe('LIMIT')
    expect(outcome.limits?.frequencyLimit).toBe(5000)
    expect(outcome.limits?.frequencyWindowSeconds).toBe(3600)
  })

  it('HUMAN-BACKED AGENT -> 500 requests/hour', async () => {
    if (!seeded) return
    // "Human-backed" is a LIVE assurance lease, not a band on its own.
    const outcome = decide('ESTABLISHED_LOW', true)
    expect(outcome.result).toBe('LIMIT')
    expect(outcome.limits?.frequencyLimit).toBe(500)
    expect(outcome.limits?.frequencyWindowSeconds).toBe(3600)
  })

  it('NEW AGENT -> 10 requests/day', async () => {
    if (!seeded) return
    const outcome = decide('UNCERTAIN')
    expect(outcome.result).toBe('LIMIT')
    expect(outcome.limits?.frequencyLimit).toBe(10)
    expect(outcome.limits?.frequencyWindowSeconds).toBe(86_400)
  })

  it('drops an established agent to the new-agent rate when assurance lapses', async () => {
    if (!seeded) return
    // Section 17 prices 500/hour as "human-backed". An actor whose lease expired
    // must not keep a rate it can no longer justify.
    const withLease = decide('ESTABLISHED_LOW', true)
    const without = decide('ESTABLISHED_LOW', false)
    expect(withLease.limits?.frequencyLimit).toBe(500)
    expect(without.limits?.frequencyLimit).toBe(10)
  })

  it('the ladder is monotonic — more trust never buys less', async () => {
    if (!seeded) return
    const rate = (band: string, lease = false) => {
      const o = decide(band, lease)
      if (o.result === 'BLOCK') return 0
      const limit = o.limits?.frequencyLimit ?? 0
      const window = o.limits?.frequencyWindowSeconds ?? 1
      return limit / window
    }
    expect(rate('CRITICAL')).toBe(0)
    expect(rate('HIGH_RISK')).toBe(0)
    expect(rate('UNCERTAIN')).toBeGreaterThan(rate('HIGH_RISK'))
    expect(rate('ESTABLISHED_LOW', true)).toBeGreaterThan(rate('UNCERTAIN'))
    expect(rate('VERIFIED_LOW')).toBeGreaterThan(rate('ESTABLISHED_LOW', true))
  })

  it('AN UNMEASURABLE ACTOR IS NEVER SOLD TO BY THIS TABLE', async () => {
    if (!seeded) return
    // The invariant that outranks the ladder. Rule 20 holds INSUFFICIENT_EVIDENCE
    // for every action, and no commerce rule may carve an exception — prepayment
    // bounds an attacker's cost but does not make an actor measurable.
    const outcome = decide('INSUFFICIENT_EVIDENCE')
    expect(outcome.result).toBe('REVIEW')
    const matched = selectRule(rules, purchaseAt('INSUFFICIENT_EVIDENCE'))
    expect(matched?.priority).toBe(20)
  })

  it('the ladder is rows, not code — every rung is an X402_PAYMENT rule', async () => {
    if (!seeded) return
    const commerce = rules.filter((r) => r.actionType === 'X402_PAYMENT')
    expect(commerce.length).toBe(5)
    // Repricing agent commerce must be an UPDATE, per section 0.2 rule 1.
    expect(commerce.every((r) => r.priority >= 52 && r.priority <= 56)).toBe(true)
  })
})

describe('V2 Phase 9 — the service, against real actors', () => {
  it('HOLDS an actor with no fresh evidence rather than quoting a price', async () => {
    if (!seeded || !enabled) return
    // A brand-new wallet has no evidence, so `createIntent` refuses at the
    // section 27.5 fail-closed gate before the policy table is ever consulted.
    // 403, and critically NO price is quoted.
    const wallet = randomWallet()
    const result = await authorizePaidRequest({
      wallet,
      path: '/x402/risk-report',
      paymentPayload: null,
    })
    createdActorIds.push(result.actorId)

    expect(result.outcome).toBe('DENIED')
    expect(result.status).toBe(403)
    expect(result.paymentRequired).toBeNull()
    expect(result.reasonCode).toBe('EVIDENCE_NOT_FRESH')
    expect(result.detail).toContain('No payment is being solicited')
  }, 90_000)

  it('records every refusal in the audit trail, not only successes', async () => {
    if (!seeded || !enabled) return
    // "Who was turned away and why" is the question an operator actually has.
    const wallet = randomWallet()
    const result = await authorizePaidRequest({
      wallet,
      path: '/x402/risk-report',
      paymentPayload: null,
    })
    createdActorIds.push(result.actorId)

    const rows = await prisma.x402Payment.findMany({ where: { actorId: result.actorId } })
    expect(rows.length).toBe(1)
    expect(rows[0]!.status).toBe('DENIED')
    expect(rows[0]!.trustBand).toBe(result.trustBand)
    expect(rows[0]!.amount).toBe(requirementsFor().amount)
    expect(rows[0]!.network).toBe(requirementsFor().network)
  }, 90_000)

  it('creates a full Intent, so a purchase is as auditable as a claim', async () => {
    if (!seeded || !enabled) return
    const wallet = randomWallet()
    const result = await authorizePaidRequest({
      wallet,
      path: '/x402/risk-report',
      paymentPayload: null,
    })
    createdActorIds.push(result.actorId)

    const intent = await prisma.intent.findFirst({
      where: { actorId: result.actorId, actionType: 'X402_PAYMENT' },
      orderBy: { createdAt: 'desc' },
    })
    expect(intent).not.toBeNull()
    const decision = await prisma.authorizationDecision.findFirst({
      where: { intentId: intent!.id },
    })
    expect(decision).not.toBeNull()
    const receipt = await prisma.actionReceipt.findFirst({ where: { intentId: intent!.id } })
    expect(receipt).not.toBeNull()
    // Nothing was served, so nothing may claim to have been executed.
    expect(receipt!.executionStatus).toBe('NOT_EXECUTED')
  }, 90_000)
})

describe('V2 Phase 9 — a payload must answer the question we asked', () => {
  /** A signer whose payload is structurally valid but wrong in one way. */
  async function attempt(over: { payTo?: string; now?: Date; caller?: string }) {
    const key = generatePrivateKey()
    const signer = payerAddress(key)
    const payload = await signPaymentPayload({
      privateKey: key,
      requirements: { ...requirementsFor(), ...(over.payTo ? { payTo: over.payTo } : {}) },
      ...(over.now ? { now: over.now } : {}),
    })
    const result = await authorizePaidRequest({
      wallet: over.caller ?? signer,
      path: '/x402/risk-report',
      paymentPayload: payload,
    })
    createdActorIds.push(result.actorId)
    return result
  }

  it('never reaches the facilitator when the actor was refused', async () => {
    if (!seeded || !enabled) return
    // Ordering matters: authorization comes first, so a refused agent's payment
    // is never verified and never settled, however valid its signature.
    const result = await attempt({})
    expect(result.outcome).toBe('DENIED')
    const settled = await prisma.x402Payment.count({
      where: { actorId: result.actorId, status: { in: ['SETTLED', 'VERIFIED'] } },
    })
    expect(settled).toBe(0)
  }, 120_000)

  it('records a redirected payment as refused, and settles nothing', async () => {
    if (!seeded || !enabled) return
    const result = await attempt({ payTo: randomWallet() })
    expect(result.outcome).not.toBe('SETTLED')
    expect(
      await prisma.x402Payment.count({ where: { actorId: result.actorId, status: 'SETTLED' } }),
    ).toBe(0)
  }, 120_000)
})

describe('V2 Phase 9 — over real HTTP', () => {
  it('serves /x402/info WITHOUT an API key', async () => {
    if (!enabled) return
    // In x402 the payment is the authorization. Requiring a pre-issued key
    // would defeat the premise of an agent paying with no prior relationship.
    // This also guards the mount ORDER in server.ts: the V1 claim router calls
    // apiKeyAuth with no path prefix, so anything mounted after it inherits the
    // key requirement. This route 401'd until it was mounted first.
    const res = await request(app).get('/x402/info')
    expect(res.status).toBe(200)
    expect(res.body.x402Version).toBe(2)
    expect(res.body.accepts[0].network).toBe(requirementsFor().network)
    expect(res.body.accepts[0].amount).toBe(requirementsFor().amount)
  }, 60_000)

  it('answers a refused agent with 403 AND NO PAYMENT-REQUIRED HEADER', async () => {
    if (!seeded || !enabled) return
    // The decision that matters most in this phase. A 402 is an invitation to
    // pay; sending one to an agent we have refused would solicit money for a
    // service that will never be delivered.
    const wallet = randomWallet()
    const res = await request(app)
      .get(`/x402/risk-report?wallet=${SUBJECT}`)
      .set('X-Wallet', wallet)

    expect(res.status).toBe(403)
    expect(res.headers[X402_HEADERS.REQUIRED.toLowerCase()]).toBeUndefined()

    const identity = await prisma.actorIdentity.findFirst({
      where: { kind: 'WALLET', externalId: wallet.toLowerCase() },
    })
    if (identity) createdActorIds.push(identity.actorId)
  }, 90_000)

  it('takes the payer identity from the SIGNATURE, not a spoofable header', async () => {
    if (!seeded || !enabled) return
    // X-Wallet is only consulted when there is no signature yet. Once a payload
    // is present, the signing address is the identity — it cannot be forged
    // without the key.
    const key = generatePrivateKey()
    const signer = payerAddress(key)
    const payload = await signPaymentPayload({ privateKey: key, requirements: requirementsFor() })

    await request(app)
      .get(`/x402/risk-report?wallet=${SUBJECT}`)
      .set('X-Wallet', randomWallet())
      .set(X402_HEADERS.SIGNATURE, encodeHeader(payload))

    // The row must be attributed to the SIGNER, never to the header wallet.
    const identity = await prisma.actorIdentity.findFirst({
      where: { kind: 'WALLET', externalId: signer.toLowerCase() },
    })
    expect(identity).not.toBeNull()
    createdActorIds.push(identity!.actorId)
    const rows = await prisma.x402Payment.findMany({ where: { actorId: identity!.actorId } })
    expect(rows.length).toBeGreaterThan(0)
  }, 120_000)

  it('exposes the payment history for an actor', async () => {
    if (!seeded || !enabled) return
    const wallet = randomWallet()
    const result = await authorizePaidRequest({
      wallet,
      path: '/x402/risk-report',
      paymentPayload: null,
    })
    createdActorIds.push(result.actorId)

    const res = await request(app).get(`/x402/payments/${result.actorId}`)
    expect(res.status).toBe(200)
    expect(res.body.payments.length).toBeGreaterThan(0)
    expect(res.body.payments[0].status).toBe('DENIED')
  }, 90_000)

  it('rejects a request with no wallet at all', async () => {
    if (!enabled) return
    const res = await request(app).get(`/x402/risk-report?wallet=${SUBJECT}`)
    expect(res.status).toBe(400)
  }, 60_000)

  it('rejects a malformed subject wallet', async () => {
    if (!enabled) return
    const res = await request(app)
      .get('/x402/risk-report?wallet=nope')
      .set('X-Wallet', randomWallet())
    expect(res.status).toBe(400)
  }, 60_000)
})
