/**
 * Operator authentication primitives — pure, no infrastructure. V2 Phase 11.
 *
 * Section 19.2 lists eight requirements for the control plane. These tests
 * cover the ones that are decidable without a database: device binding,
 * explicit action binding, scope, and the step-up rule.
 *
 * Every failure mode here is an authority bypass if it goes the wrong way, so
 * the tests are written as "what must be REFUSED" rather than "what works".
 */
import { describe, expect, it } from 'vitest'
import {
  authorizeOperatorAction,
  checkSession,
  computeBindingHash,
  CRITICAL_COMMANDS,
  deriveSecretHash,
  generateSalt,
  generateToken,
  hashToken,
  isAllowedDecision,
  isInScope,
  requiresStepUp,
  secretsMatch,
} from '../src/control/operator-auth.js'

describe('tokens are never stored in the clear', () => {
  it('hashes deterministically and irreversibly', () => {
    const token = generateToken()
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).not.toBe(token)
    expect(hashToken(token)).toHaveLength(64)
  })

  it('generates distinct, high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken()))
    expect(tokens.size).toBe(200)
    // 32 bytes base64url.
    expect(generateToken().length).toBeGreaterThanOrEqual(43)
  })

  it('derives a salted secret hash that differs per salt', () => {
    const secret = 'the-enrolment-secret'
    const a = deriveSecretHash(secret, generateSalt())
    const b = deriveSecretHash(secret, generateSalt())
    // Two operators with the SAME secret must not share a hash, or one leaked
    // hash would reveal the other.
    expect(a).not.toBe(b)
  })

  it('is stable for the same secret and salt', () => {
    const salt = generateSalt()
    expect(deriveSecretHash('s', salt)).toBe(deriveSecretHash('s', salt))
  })
})

describe('constant-time comparison', () => {
  it('matches equal strings and rejects different ones', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true)
    expect(secretsMatch('abc', 'abd')).toBe(false)
  })

  it('returns false on a length mismatch rather than throwing', () => {
    // timingSafeEqual throws on unequal lengths; a throw here would turn a bad
    // credential into a 500.
    expect(secretsMatch('short', 'muchlonger')).toBe(false)
    expect(secretsMatch('', 'x')).toBe(false)
  })
})

describe('SECTION 19.2 — device binding', () => {
  const live = { status: 'ACTIVE', expiresAt: new Date(2_000_000), deviceId: 'device-a' }
  const now = new Date(1_000_000)

  it('accepts the bound device', () => {
    expect(checkSession(live, 'device-a', now)).toEqual({ valid: true, reason: 'ok' })
  })

  it('REFUSES A VALID TOKEN FROM A DIFFERENT DEVICE', () => {
    // The point of device binding: exfiltrating the token alone is not enough.
    const result = checkSession(live, 'device-b', now)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('device mismatch')
  })

  it('refuses an expired session', () => {
    const result = checkSession(live, 'device-a', new Date(3_000_000))
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('session expired')
  })

  it('treats the expiry instant as already expired', () => {
    expect(checkSession(live, 'device-a', new Date(2_000_000)).valid).toBe(false)
  })

  it('refuses a revoked session even before expiry', () => {
    const revoked = { ...live, status: 'REVOKED' }
    expect(checkSession(revoked, 'device-a', now).valid).toBe(false)
  })

  it('refuses a session that does not exist', () => {
    expect(checkSession(null, 'device-a', now)).toEqual({
      valid: false,
      reason: 'no such session',
    })
  })

  it('names ONE reason for every refusal', () => {
    // "Unauthorized" with no cause is unactionable for the operator whose phone
    // just stopped working.
    for (const [session, device] of [
      [null, 'd'],
      [{ ...live, status: 'REVOKED' }, 'device-a'],
      [live, 'wrong'],
    ] as const) {
      const r = checkSession(session, device, now)
      expect(r.reason.length).toBeGreaterThan(0)
      expect(r.reason).not.toBe('ok')
    }
  })
})

describe('SECTION 19.2 — explicit action binding', () => {
  const action = {
    subjectType: 'INTENT',
    subjectId: 'intent-1',
    summary: 'approve a payment',
    amount: '10',
  }

  it('is stable for identical facts', () => {
    expect(computeBindingHash(action)).toBe(computeBindingHash({ ...action }))
  })

  it('CHANGES WHEN THE AMOUNT CHANGES', () => {
    // The whole point. A decision captured approving 10 must not be replayable
    // against an otherwise identical action for 10000.
    expect(computeBindingHash({ ...action, amount: '10000' })).not.toBe(computeBindingHash(action))
  })

  it('changes when the subject changes', () => {
    expect(computeBindingHash({ ...action, subjectId: 'intent-2' })).not.toBe(
      computeBindingHash(action),
    )
    expect(computeBindingHash({ ...action, subjectType: 'AGENT' })).not.toBe(
      computeBindingHash(action),
    )
  })

  it('changes when the summary changes', () => {
    expect(computeBindingHash({ ...action, summary: 'approve something else' })).not.toBe(
      computeBindingHash(action),
    )
  })

  it('CANNOT BE COLLIDED BY SHIFTING TEXT ACROSS FIELD BOUNDARIES', () => {
    // A naive `a + b + c` concatenation would make these two identical. The
    // NUL separator cannot appear in a cuid, a type or an amount.
    const a = computeBindingHash({ subjectType: 'INTENT', subjectId: 'ab', summary: 'c', amount: null })
    const b = computeBindingHash({ subjectType: 'INTENT', subjectId: 'a', summary: 'bc', amount: null })
    expect(a).not.toBe(b)
  })

  it('distinguishes a null amount from an empty one', () => {
    const withNull = computeBindingHash({ ...action, amount: null })
    const withValue = computeBindingHash({ ...action, amount: '0' })
    expect(withNull).not.toBe(withValue)
  })
})

describe('SECTION 27.2 — operator, actor and action scope', () => {
  const unrestricted = { status: 'ACTIVE', actorScope: [], actionScope: [] }

  it('an empty scope means unrestricted', () => {
    expect(isInScope([], 'anything')).toBe(true)
    expect(authorizeOperatorAction(unrestricted, { command: 'REVOKE', actorId: 'a' }).allowed).toBe(
      true,
    )
  })

  it('refuses a command outside the action scope', () => {
    const limited = { ...unrestricted, actionScope: ['APPROVE', 'DENY'] }
    expect(authorizeOperatorAction(limited, { command: 'APPROVE' }).allowed).toBe(true)
    const denied = authorizeOperatorAction(limited, { command: 'REVOKE' })
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toContain('REVOKE')
  })

  it('refuses an actor outside the actor scope', () => {
    const scoped = { ...unrestricted, actorScope: ['actor-1'] }
    expect(authorizeOperatorAction(scoped, { command: 'DENY', actorId: 'actor-1' }).allowed).toBe(
      true,
    )
    expect(authorizeOperatorAction(scoped, { command: 'DENY', actorId: 'actor-2' }).allowed).toBe(
      false,
    )
  })

  it('REFUSES A SCOPED OPERATOR ACTING ON AN UNNAMED ACTOR', () => {
    // "No actor named" must not become "any actor". Without this, an
    // actor-scoped operator could act on anything by omitting the field.
    const scoped = { ...unrestricted, actorScope: ['actor-1'] }
    const result = authorizeOperatorAction(scoped, { command: 'DENY', actorId: null })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('names no actor')
  })

  it('refuses a suspended operator regardless of scope', () => {
    const suspended = { status: 'SUSPENDED', actorScope: [], actionScope: [] }
    expect(authorizeOperatorAction(suspended, { command: 'APPROVE' }).allowed).toBe(false)
  })
})

describe('SECTION 19.2 — World step-up for critical operations', () => {
  it('demands step-up for REVOKE and FREEZE when enabled', () => {
    expect(CRITICAL_COMMANDS.has('REVOKE')).toBe(true)
    expect(CRITICAL_COMMANDS.has('FREEZE')).toBe(true)
    expect(requiresStepUp('REVOKE', true)).toBe(true)
    expect(requiresStepUp('FREEZE', true)).toBe(true)
  })

  it('does not demand it for routine commands', () => {
    expect(requiresStepUp('APPROVE', true)).toBe(false)
    expect(requiresStepUp('LIMIT', true)).toBe(false)
  })

  it('is off when the deployment disables it', () => {
    expect(requiresStepUp('REVOKE', false)).toBe(false)
  })
})

describe('a decision must be a legal answer', () => {
  it('accepts a listed command', () => {
    expect(isAllowedDecision(['APPROVE', 'DENY'], 'APPROVE')).toBe(true)
  })

  it('refuses an unlisted one', () => {
    expect(isAllowedDecision(['APPROVE', 'DENY'], 'REVOKE')).toBe(false)
  })

  it('AN EMPTY ALLOW-LIST ACCEPTS NOTHING', () => {
    // The opposite convention to scope, and deliberately so: defaulting an
    // empty list to "anything goes" would make a malformed action maximally
    // permissive, which is exactly backwards.
    expect(isAllowedDecision([], 'APPROVE')).toBe(false)
    expect(isAllowedDecision([], 'REVOKE')).toBe(false)
  })
})
