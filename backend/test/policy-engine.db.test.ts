/**
 * Policy Engine — Backend-Sylesh.md Phase 20 acceptance test.
 *
 * Needs the seeded PolicyVersion 1.0 (ALLOW [0, 0.35), CHALLENGE [0.35, 0.7),
 * BLOCK [0.7, 1]). Run `npm run db:seed` first.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma.js'
import { decide } from '../src/policy/policy-engine.js'
import type { ClusterRisk } from '../src/interfaces/evidence-risk-api.js'

function risk(overrides: Partial<ClusterRisk>): ClusterRisk {
  return {
    clusterId: 'cluster-1',
    riskScore: 0,
    confidence: 'HIGH',
    policyVersion: '1.0',
    features: [{ name: 'FUNDING_CORRELATION', value: 0.5 }],
    sources: [{ type: 'token-api', deployment: null, block: '123' }],
    status: 'OK',
    ...overrides,
  }
}

let seeded = false

beforeAll(async () => {
  seeded = (await prisma.policyVersion.count({ where: { version: '1.0' } })) > 0
})

describe('Phase 20 — the PENDING_REVIEW branch', () => {
  it('holds a PENDING_REVIEW assessment instead of reading its score', async () => {
    // THE most damaging integration bug available in this codebase, per both
    // specs. PENDING_REVIEW carries riskScore 0, which sits squarely in the
    // ALLOW band — so a missing status check does not fail loudly, it silently
    // approves precisely the claims the system was least sure about.
    const decision = await decide(risk({ status: 'PENDING_REVIEW', riskScore: 0 }))

    expect(decision.decision).toBe('PENDING_REVIEW')
    expect(decision.requiredAssurance).toBeNull()
    expect(decision.decision).not.toBe('ALLOW')
  })

  it('holds without needing a policy at all', async () => {
    // The status check happens before any threshold lookup, so a held claim
    // does not additionally depend on the policy tables being readable.
    const decision = await decide(
      risk({ status: 'PENDING_REVIEW', policyVersion: 'no-such-version' }),
    )
    expect(decision.decision).toBe('PENDING_REVIEW')
  })
})

describe('Phase 20 — band mapping', () => {
  it('maps a clean score to ALLOW and requires no assurance', async () => {
    if (!seeded) return
    const decision = await decide(risk({ riskScore: 0.0825 }))

    expect(decision.decision).toBe('ALLOW')
    // The entire adaptive thesis: a low-risk wallet never sees Selfie Check.
    expect(decision.requiredAssurance).toBeNull()
  })

  it('maps a mid-band score to CHALLENGE and requires SELFIE_CHECK', async () => {
    if (!seeded) return
    const decision = await decide(risk({ riskScore: 0.5 }))

    expect(decision.decision).toBe('CHALLENGE')
    expect(decision.requiredAssurance).toBe('SELFIE_CHECK')
  })

  it('maps a high score to BLOCK', async () => {
    if (!seeded) return
    const decision = await decide(risk({ riskScore: 0.8465 }))

    expect(decision.decision).toBe('BLOCK')
    expect(decision.requiredAssurance).toBeNull()
  })

  it('treats bands as half-open so a boundary score lands in exactly one', async () => {
    if (!seeded) return
    // 0.35 is CHALLENGE's min and ALLOW's max. Half-open [min, max) means the
    // upper band wins; an overlap would make the answer depend on row order.
    expect((await decide(risk({ riskScore: 0.35 }))).decision).toBe('CHALLENGE')
    expect((await decide(risk({ riskScore: 0.7 }))).decision).toBe('BLOCK')
  })

  it('closes the top band so a perfect score still bands', async () => {
    if (!seeded) return
    expect((await decide(risk({ riskScore: 1 }))).decision).toBe('BLOCK')
  })

  it('records the policy version that decided, for the receipt', async () => {
    if (!seeded) return
    const decision = await decide(risk({ riskScore: 0.5 }))
    expect(decision.policyVersion).toBe('1.0')
    expect(decision.reason).toContain('1.0')
  })
})

describe('Phase 20 — degradation', () => {
  it('holds rather than guessing when a score matches no band', async () => {
    if (!seeded) return
    // Out-of-range input cannot be banded. Picking the nearest band would be a
    // confident invented decision (Section 0.2 rule 4).
    const decision = await decide(risk({ riskScore: 42 }))
    expect(decision.decision).toBe('PENDING_REVIEW')
    expect(decision.reason).toContain('no configured policy band')
  })

  it('falls back to the active version when the scoring version is missing', async () => {
    if (!seeded) return
    const decision = await decide(risk({ riskScore: 0.5, policyVersion: 'retired-9.9' }))
    // Still decides, but from a policy that actually exists.
    expect(decision.decision).toBe('CHALLENGE')
  })
})
