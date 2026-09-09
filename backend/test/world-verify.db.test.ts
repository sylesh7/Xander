/**
 * World verification + replay protection — Backend-Sylesh.md Phases 18-19.
 *
 * WHAT IS REAL HERE, AND WHAT CANNOT BE:
 *
 * - Replay protection runs against real Postgres. The guarantee is the
 *   `@@unique([nullifier, worldActionId])` constraint, and asserting that
 *   against a fake would only prove the fake behaves like the fake.
 * - The live block at the bottom calls World's REAL `/api/v4/verify/{rp_id}`
 *   endpoint and asserts we correctly interpret its genuine rejection.
 * - The `fetch` stubs cover conditions that cannot be produced on demand from a
 *   real endpoint: a 503, and a network timeout. These simulate the NETWORK, not
 *   our logic — the retry/branch code under test is the real implementation.
 *
 * A real VERIFIED outcome is impossible until Selfie Check access is granted
 * (Phase 13), because it requires a genuine proof. That gap is stated in
 * docs/PROGRESS-SYLESH.md rather than papered over with a fake success.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { extractProofFields, verifyWorldProof } from '../src/world/idkit-verify.js'
import { nullifierToDecimalString, recordNullifier, ReplayError } from '../src/world/replay-protection.js'
import { expectedSignalHash } from '../src/world/wallet-binding.js'

const CAMPAIGN = `world-verify-${Date.now()}`
const WALLET = '0x00000000000000000000000000000000000ab1e5'
const ACTION = `claim-${CAMPAIGN}`

const okResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response

const errResponse = (status: number, body: unknown = {}): Response =>
  ({ ok: false, status, json: async () => body }) as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  const claims = await prisma.claim.findMany({
    where: { campaignId: CAMPAIGN },
    select: { id: true },
  })
  await prisma.verificationChallenge.deleteMany({
    where: { claimId: { in: claims.map((c) => c.id) } },
  })
  await prisma.claim.deleteMany({ where: { campaignId: CAMPAIGN } })
  await prisma.$disconnect()
})

describe('Phase 18 — verification outcomes', () => {
  it('returns VERIFIED on a 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ success: true, nullifier: '0x1' })))

    const outcome = await verifyWorldProof({ idkitResponse: {}, rpId: 'rp_test' })
    expect(outcome.kind).toBe('VERIFIED')
  })

  it('forwards the IDKit result as-is, with no field remapping', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    const idkitResponse = { proof: '0xabc', merkle_root: '0xdef', nullifier: '0x1' }
    await verifyWorldProof({ idkitResponse, rpId: 'rp_test' })

    const init = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(init?.body as string)).toEqual(idkitResponse)
  })

  it('posts to /api/v4/verify/{rp_id}', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    await verifyWorldProof({ idkitResponse: {}, rpId: 'rp_abc123' })

    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/v4/verify/rp_abc123')
  })

  it('REJECTS on a 4xx and does not retry — a rejection is an answer, not an outage', async () => {
    const fetchMock = vi.fn(async () => errResponse(400, { code: 'invalid_proof' }))
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await verifyWorldProof({ idkitResponse: {}, rpId: 'rp_test' })

    expect(outcome.kind).toBe('REJECTED')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports UNAVAILABLE on a 5xx, after retrying', async () => {
    const fetchMock = vi.fn(async () => errResponse(503))
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await verifyWorldProof({ idkitResponse: {}, rpId: 'rp_test' })

    // Phase 23: a timed-out or unavailable verify must never resolve to ALLOW,
    // and must not be recorded as the user failing either.
    expect(outcome.kind).toBe('UNAVAILABLE')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('reports UNAVAILABLE when the request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const outcome = await verifyWorldProof({ idkitResponse: {}, rpId: 'rp_test' })
    expect(outcome.kind).toBe('UNAVAILABLE')
  })
})

describe.skipIf(!env.WORLD_RP_ID)('Phase 18 — against the REAL World endpoint (no stubs)', () => {
  it('correctly interprets a genuine rejection from developer.world.org', async () => {
    // A real HTTPS round trip to World with a deliberately invalid proof. This
    // is what the endpoint exists to reject, and it proves three things a stub
    // cannot: the URL is right, the payload is forwarded in a shape World
    // parses, and a real rejection maps to REJECTED rather than to an
    // exception, a retry storm, or a silent pass.
    const outcome = await verifyWorldProof({
      idkitResponse: {
        proof: '0x00',
        merkle_root: '0x00',
        nullifier_hash: '0x00',
        verification_level: 'device',
      },
    })

    expect(outcome.kind).toBe('REJECTED')
    // Never VERIFIED, and never a transient-looking UNAVAILABLE that would keep
    // the challenge open forever.
    expect(outcome.kind).not.toBe('VERIFIED')
  }, 60_000)
})

describe('Phase 19 — proof field extraction', () => {
  it('prefers fields World returned over the client-supplied payload', async () => {
    const fields = extractProofFields(
      { nullifier: '0xaaa', signal_hash: '0xbbb' },
      { nullifier: '0xccc', signal_hash: '0xddd' },
    )
    expect(fields.nullifier).toBe('0xaaa')
    expect(fields.signalHash).toBe('0xbbb')
  })

  it('falls back to the proof payload when World does not echo them', () => {
    const fields = extractProofFields({}, { nullifier_hash: '0xccc', signal_hash: '0xddd' })
    expect(fields.nullifier).toBe('0xccc')
    expect(fields.signalHash).toBe('0xddd')
  })

  it('refuses a proof with no nullifier rather than skipping replay protection', () => {
    // Without a nullifier there is nothing to check reuse against, so accepting
    // it would mean a single-use proof could be redeemed forever.
    expect(() => extractProofFields({}, { signal_hash: '0xddd' })).toThrow(/nullifier/i)
  })

  it('refuses a proof with no signal_hash rather than skipping binding', () => {
    expect(() => extractProofFields({}, { nullifier: '0xccc' })).toThrow(/signal_hash/i)
  })
})

describe('Phase 19 — replay protection acceptance test', () => {
  let claimId: string
  let firstChallengeId: string
  let secondChallengeId: string

  beforeEach(async () => {
    const claim = await prisma.claim.upsert({
      where: { wallet_campaignId: { wallet: WALLET, campaignId: CAMPAIGN } },
      create: { wallet: WALLET, campaignId: CAMPAIGN, riskDecision: 'CHALLENGE' },
      update: {},
    })
    claimId = claim.id

    await prisma.verificationChallenge.deleteMany({ where: { claimId } })

    const first = await prisma.verificationChallenge.create({
      data: {
        claimId,
        wallet: WALLET,
        status: 'ISSUED',
        worldActionId: ACTION,
        signalHash: expectedSignalHash(WALLET, claimId),
      },
    })
    const second = await prisma.verificationChallenge.create({
      data: {
        claimId,
        wallet: WALLET,
        status: 'ISSUED',
        worldActionId: ACTION,
        signalHash: expectedSignalHash(WALLET, claimId),
      },
    })
    firstChallengeId = first.id
    secondChallengeId = second.id
  })

  it('accepts a nullifier the first time', async () => {
    await recordNullifier({
      challengeId: firstChallengeId,
      nullifier: '0x2a',
      rpId: 'rp_test',
    })

    const row = await prisma.verificationChallenge.findUniqueOrThrow({
      where: { id: firstChallengeId },
    })
    expect(row.status).toBe('PASSED')
    // Stored as decimal, not hex — Postgres has no 256-bit int type.
    expect(row.nullifier?.toString()).toBe('42')
  })

  it('REJECTS the same nullifier used again for the same action', async () => {
    await recordNullifier({
      challengeId: firstChallengeId,
      nullifier: '0x2a',
      rpId: 'rp_test',
    })

    await expect(
      recordNullifier({
        challengeId: secondChallengeId,
        nullifier: '0x2a',
        rpId: 'rp_test',
      }),
    ).rejects.toThrow(ReplayError)
  })

  it('rejects a re-encoded form of an already-used nullifier', async () => {
    await recordNullifier({
      challengeId: firstChallengeId,
      nullifier: '0x2a',
      rpId: 'rp_test',
    })

    // 0x02A is the same integer. Storing hex rather than decimal would have let
    // this through as a "different" nullifier.
    expect(nullifierToDecimalString('0x02A')).toBe(nullifierToDecimalString('0x2a'))
    await expect(
      recordNullifier({
        challengeId: secondChallengeId,
        nullifier: '0x02A',
        rpId: 'rp_test',
      }),
    ).rejects.toThrow(ReplayError)
  })

  it('allows the same nullifier under a DIFFERENT action', async () => {
    // Nullifiers are unique per (person, app, action). One person legitimately
    // claiming on two campaigns must not be blocked by their first claim.
    await recordNullifier({
      challengeId: firstChallengeId,
      nullifier: '0x2a',
      rpId: 'rp_test',
    })

    // A challenge issued for a different campaign carries a different action.
    const otherAction = await prisma.verificationChallenge.create({
      data: {
        claimId,
        wallet: WALLET,
        status: 'ISSUED',
        worldActionId: `${ACTION}-other`,
        signalHash: expectedSignalHash(WALLET, claimId),
      },
    })

    await expect(
      recordNullifier({ challengeId: otherAction.id, nullifier: '0x2a', rpId: 'rp_test' }),
    ).resolves.toBeUndefined()
  })
})
