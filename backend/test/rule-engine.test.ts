/**
 * The policy rule engine and capability attenuation — pure. V2 Phase 3.
 */
import { describe, expect, it } from 'vitest'
import { applyRule, evaluateRules, ruleMatches, selectRule, type Rule } from '../src/authorization/rule-engine.js'
import type { AuthorizationRequest } from '../src/authorization/policy-evaluator.js'
import {
  attenuateAmount,
  isCapabilityLive,
  isLeaseLive,
  parseAmount,
  targetAllowed,
  withinAmountLimit,
} from '../src/capabilities/capability-types.js'

const NOW = new Date('2026-01-01T00:00:00Z')
const CTX = { policyId: 'pol_1', policyVersion: 'v2-1.0', now: NOW }

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'r1',
    priority: 10,
    name: 'test rule',
    actionType: null,
    minAmount: null,
    maxAmount: null,
    trustBands: [],
    maxCoordinationRisk: null,
    minBehaviorIntegrity: null,
    requiresLiveAssurance: null,
    effect: 'ALLOW',
    reasonCode: 'TEST',
    limitAmount: null,
    limitFrequency: null,
    limitWindowSeconds: null,
    capabilityTtlSeconds: null,
    ...over,
  }
}

function request(over: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    actor: { id: 'a1', actorType: 'WALLET', status: 'ACTIVE' },
    intent: {
      id: 'i1',
      actionType: 'CLAIM',
      resourceType: 'campaign',
      resourceId: 'c1',
      amount: null,
      asset: null,
      chainId: null,
      targetAddress: null,
    },
    trust: {
      band: 'ESTABLISHED_LOW',
      coordinationRisk: 0.1,
      behaviorIntegrity: 0.9,
      evidenceFreshness: 1,
      snapshotId: 's1',
    },
    assurance: { hasLiveLease: false, level: null, expiresAt: null },
    currentCapabilities: [],
    ...over,
  }
}

describe('rule matching', () => {
  it('matches an unconstrained rule against anything', () => {
    expect(ruleMatches(rule(), request())).toBe(true)
  })

  it('constrains only what it names', () => {
    expect(ruleMatches(rule({ actionType: 'CLAIM' }), request())).toBe(true)
    expect(ruleMatches(rule({ actionType: 'TRADE' }), request())).toBe(false)
  })

  it('matches on trust band', () => {
    expect(ruleMatches(rule({ trustBands: ['ESTABLISHED_LOW'] }), request())).toBe(true)
    expect(ruleMatches(rule({ trustBands: ['CRITICAL'] }), request())).toBe(false)
  })

  it('compares amounts as BigInt, beyond float precision', () => {
    const huge = '99999999999999999999999999'
    const r = rule({ minAmount: '99999999999999999999999998' })
    expect(ruleMatches(r, request({ intent: { ...request().intent, amount: huge } }))).toBe(true)
  })

  it('respects inclusive amount bounds', () => {
    const req = (amount: string) => request({ intent: { ...request().intent, amount } })
    const r = rule({ minAmount: '100', maxAmount: '200' })
    expect(ruleMatches(r, req('99'))).toBe(false)
    expect(ruleMatches(r, req('100'))).toBe(true)
    expect(ruleMatches(r, req('200'))).toBe(true)
    expect(ruleMatches(r, req('201'))).toBe(false)
  })

  it('matches on assurance presence', () => {
    expect(ruleMatches(rule({ requiresLiveAssurance: false }), request())).toBe(true)
    expect(ruleMatches(rule({ requiresLiveAssurance: true }), request())).toBe(false)
  })
})

describe('a null trust dimension NEVER satisfies a threshold', () => {
  // The cold-start invariant carried into policy. Without this, an actor we
  // could not measure satisfies every upper-bound rule and falls straight
  // through to the most permissive one.
  it('does not clear a maxCoordinationRisk bound when risk is unknown', () => {
    const req = request({ trust: { ...request().trust, coordinationRisk: null } })
    expect(ruleMatches(rule({ maxCoordinationRisk: 0.3 }), req)).toBe(false)
  })

  it('does not clear a minBehaviorIntegrity bound when integrity is unknown', () => {
    const req = request({ trust: { ...request().trust, behaviorIntegrity: null } })
    expect(ruleMatches(rule({ minBehaviorIntegrity: 0.8 }), req)).toBe(false)
  })

  it('does not clear an amount bound when no amount was supplied', () => {
    expect(ruleMatches(rule({ maxAmount: '1000' }), request())).toBe(false)
  })
})

describe('rule selection', () => {
  it('takes the first match by ascending priority, not declaration order', () => {
    const rules = [
      rule({ id: 'late', priority: 50, effect: 'ALLOW' }),
      rule({ id: 'early', priority: 10, effect: 'BLOCK' }),
    ]
    expect(selectRule(rules, request())?.id).toBe('early')
  })

  it('skips non-matching rules to reach a later one', () => {
    const rules = [
      rule({ id: 'no', priority: 10, actionType: 'TRADE' }),
      rule({ id: 'yes', priority: 20, actionType: 'CLAIM' }),
    ]
    expect(selectRule(rules, request())?.id).toBe('yes')
  })

  it('returns null when nothing matches', () => {
    expect(selectRule([rule({ actionType: 'BORROW' })], request())).toBeNull()
  })
})

describe('fail-closed defaults', () => {
  it('holds for REVIEW when no rule matches — never ALLOW', () => {
    // Section 27.5. An action no rule anticipated is an action nobody authorised.
    const outcome = applyRule(null, request(), CTX)
    expect(outcome.result).toBe('REVIEW')
    expect(outcome.result).not.toBe('ALLOW')
    expect(outcome.reasonCode).toBe('NO_MATCHING_POLICY_RULE')
    expect(outcome.limits).toBeNull()
  })

  it('holds for REVIEW on a misconfigured effect', () => {
    const outcome = applyRule(rule({ effect: 'YOLO' }), request(), CTX)
    expect(outcome.result).toBe('REVIEW')
    expect(outcome.reasonCode).toBe('UNKNOWN_RULE_EFFECT')
  })

  it('grants nothing for CHALLENGE, REVIEW or BLOCK', () => {
    for (const effect of ['CHALLENGE', 'REVIEW', 'BLOCK']) {
      const outcome = applyRule(rule({ effect }), request(), CTX)
      expect(outcome.limits, effect).toBeNull()
    }
  })
})

describe('LIMIT — attenuation, spec section 7.2', () => {
  it('reduces the grant instead of rejecting it', () => {
    // The spec's own example: requested 5000, policy says LIMIT, allowed 500.
    const req = request({ intent: { ...request().intent, actionType: 'TRANSFER', amount: '5000' } })
    const outcome = applyRule(rule({ effect: 'LIMIT', limitAmount: '500' }), req, CTX)

    expect(outcome.result).toBe('LIMIT')
    expect(outcome.limits?.amountLimit).toBe('500')
    expect(outcome.attenuated).toBe(true)
    expect(outcome.reasonSummary).toContain('500')
  })

  it('is not marked attenuated when the request already fits', () => {
    const req = request({ intent: { ...request().intent, amount: '100' } })
    const outcome = applyRule(rule({ effect: 'LIMIT', limitAmount: '500' }), req, CTX)
    expect(outcome.attenuated).toBe(false)
    expect(outcome.result).toBe('LIMIT')
  })

  it('carries frequency bounds and an expiry onto the grant', () => {
    const outcome = applyRule(
      rule({
        effect: 'LIMIT',
        limitAmount: '500',
        limitFrequency: 20,
        limitWindowSeconds: 86_400,
        capabilityTtlSeconds: 3600,
      }),
      request(),
      CTX,
    )
    expect(outcome.limits?.frequencyLimit).toBe(20)
    expect(outcome.limits?.expiresAt?.toISOString()).toBe('2026-01-01T01:00:00.000Z')
  })
})

describe('the seeded-policy shape, evaluated end to end', () => {
  const rules: Rule[] = [
    rule({ id: 'critical', priority: 10, trustBands: ['CRITICAL'], effect: 'BLOCK', reasonCode: 'TRUST_BAND_CRITICAL' }),
    rule({ id: 'insufficient', priority: 20, trustBands: ['INSUFFICIENT_EVIDENCE'], effect: 'REVIEW', reasonCode: 'INSUFFICIENT_EVIDENCE' }),
    rule({ id: 'trade-uncertain', priority: 40, actionType: 'TRADE', trustBands: ['UNCERTAIN'], effect: 'LIMIT', limitAmount: '500000000', reasonCode: 'TRADE_LIMITED' }),
    rule({ id: 'claim-small', priority: 60, actionType: 'CLAIM', maxAmount: '100000000', maxCoordinationRisk: 0.3, effect: 'ALLOW', reasonCode: 'CLAIM_OK' }),
    rule({ id: 'catch-all', priority: 99, effect: 'REVIEW', reasonCode: 'NO_SPECIFIC_RULE' }),
  ]

  it('THE SAME ACTOR GETS DIFFERENT ANSWERS FOR DIFFERENT ACTIONS', () => {
    // Phase 3's acceptance condition, in one assertion.
    const base = request({ trust: { ...request().trust, band: 'UNCERTAIN' } })

    const claim = evaluateRules(
      rules,
      { ...base, intent: { ...base.intent, actionType: 'CLAIM', amount: '50000000' } },
      CTX,
    )
    const trade = evaluateRules(
      rules,
      { ...base, intent: { ...base.intent, actionType: 'TRADE', amount: '5000000000' } },
      CTX,
    )
    const borrow = evaluateRules(
      rules,
      { ...base, intent: { ...base.intent, actionType: 'BORROW', amount: '1000' } },
      CTX,
    )

    expect(claim.result).toBe('ALLOW')
    expect(trade.result).toBe('LIMIT')
    expect(trade.limits?.amountLimit).toBe('500000000')
    expect(borrow.result).toBe('REVIEW')
    expect(new Set([claim.result, trade.result, borrow.result]).size).toBe(3)
  })

  it('a CRITICAL actor is blocked regardless of how small the action is', () => {
    const req = request({
      trust: { ...request().trust, band: 'CRITICAL' },
      intent: { ...request().intent, actionType: 'CLAIM', amount: '1' },
    })
    expect(evaluateRules(rules, req, CTX).result).toBe('BLOCK')
  })

  it('an unmeasurable actor is held, not allowed', () => {
    const req = request({
      trust: { band: 'INSUFFICIENT_EVIDENCE', coordinationRisk: null, behaviorIntegrity: null, evidenceFreshness: null, snapshotId: null },
      intent: { ...request().intent, actionType: 'CLAIM', amount: '1' },
    })
    const outcome = evaluateRules(rules, req, CTX)
    expect(outcome.result).toBe('REVIEW')
    expect(outcome.result).not.toBe('ALLOW')
  })
})

describe('capability primitives', () => {
  it('parses only non-negative integer strings', () => {
    expect(parseAmount('100')).toBe(100n)
    expect(parseAmount('-1')).toBeNull()
    expect(parseAmount('1.5')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount(null)).toBeNull()
  })

  it('attenuates down to the ceiling and leaves smaller requests alone', () => {
    expect(attenuateAmount('5000', '500')).toBe('500')
    expect(attenuateAmount('100', '500')).toBe('100')
    expect(attenuateAmount('5000', null)).toBe('5000')
  })

  it('treats an unparseable requested amount as not clearing a ceiling', () => {
    // Reading a malformed amount as 0 would slip it under every limit.
    expect(withinAmountLimit('not-a-number', '500')).toBe(false)
    expect(attenuateAmount('not-a-number', '500')).toBe('500')
  })

  it('allows any target when the allow-list is empty, and only listed ones otherwise', () => {
    expect(targetAllowed('0xAAA', [])).toBe(true)
    expect(targetAllowed('0xAAA', ['0xaaa'])).toBe(true)
    expect(targetAllowed('0xBBB', ['0xaaa'])).toBe(false)
    expect(targetAllowed(null, ['0xaaa'])).toBe(false)
  })

  it('treats a non-ACTIVE or expired capability as not live', () => {
    const future = new Date(NOW.getTime() + 1000)
    const past = new Date(NOW.getTime() - 1000)
    expect(isCapabilityLive({ status: 'ACTIVE', expiresAt: future }, NOW)).toBe(true)
    expect(isCapabilityLive({ status: 'ACTIVE', expiresAt: null }, NOW)).toBe(true)
    expect(isCapabilityLive({ status: 'ACTIVE', expiresAt: past }, NOW)).toBe(false)
    expect(isCapabilityLive({ status: 'REVOKED', expiresAt: future }, NOW)).toBe(false)
    expect(isCapabilityLive({ status: 'SUSPENDED', expiresAt: future }, NOW)).toBe(false)
  })

  it('treats a missing or expired lease as not live', () => {
    expect(isLeaseLive(null, NOW)).toBe(false)
    expect(isLeaseLive({ status: 'ACTIVE', expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(false)
    expect(isLeaseLive({ status: 'REVOKED', expiresAt: new Date(NOW.getTime() + 1000) }, NOW)).toBe(false)
    expect(isLeaseLive({ status: 'ACTIVE', expiresAt: new Date(NOW.getTime() + 1000) }, NOW)).toBe(true)
  })
})
