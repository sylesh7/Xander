/**
 * ERC-8004 trust derivation — pure, no RPC. V2 Phase 6.
 *
 * Guards the one rule that matters here: external reputation must never be
 * INVENTED. Section 16.2 makes these inputs advisory, and an advisory input
 * that quietly defaults to a number influences policy on the strength of
 * nothing.
 */
import { describe, expect, it } from 'vitest'
import {
  toAgentReputationValue,
  type Erc8004Snapshot,
} from '../src/agents/erc8004.js'

const snapshot = (over: Partial<Erc8004Snapshot> = {}): Erc8004Snapshot => ({
  identity: {
    agentId: '1',
    owner: '0x0000000000000000000000000000000000000001',
    agentUri: null,
    exists: true,
  },
  reputation: { count: 0, normalized: null, rawValue: '0', decimals: 0, clients: 0 },
  validation: { count: 0, normalized: null, averageResponse: 0 },
  fetchedAt: new Date(),
  errors: [],
  ...over,
})

describe('an unmeasurable reputation is UNKNOWN, never a number', () => {
  it('returns null when the agent is not in the registry', () => {
    const result = toAgentReputationValue(snapshot({ identity: null }))
    expect(result.value).toBeNull()
    expect(result.basis).toContain('no ERC-8004 identity')
  })

  it('RETURNS NULL FOR A REGISTERED AGENT WITH NO FEEDBACK', () => {
    // The important one. Zero feedback is not zero reputation and it is not
    // perfect reputation — it is an absence of evidence, and mapping it either
    // way is the free-trust bug ERC-8004's tiered model exists to avoid.
    const result = toAgentReputationValue(snapshot())
    expect(result.value).toBeNull()
    expect(result.value).not.toBe(0)
    expect(result.value).not.toBe(1)
    expect(result.basis).toContain('no feedback or validations')
  })

  it('does not invent a value when only the identity read succeeded', () => {
    const result = toAgentReputationValue(
      snapshot({ reputation: null, validation: null, errors: ['reputation: timeout'] }),
    )
    expect(result.value).toBeNull()
  })
})

describe('measured reputation', () => {
  it('uses feedback alone when there are no validations', () => {
    const result = toAgentReputationValue(
      snapshot({
        reputation: { count: 4, normalized: 0.8, rawValue: '8', decimals: 1, clients: 3 },
      }),
    )
    expect(result.value).toBeCloseTo(0.8)
    expect(result.basis).toContain('4 feedback')
  })

  it('uses validations alone when there is no feedback', () => {
    const result = toAgentReputationValue(
      snapshot({ validation: { count: 2, normalized: 0.5, averageResponse: 50 } }),
    )
    expect(result.value).toBeCloseTo(0.5)
    expect(result.basis).toContain('no feedback')
  })

  it('WEIGHTS VALIDATIONS ABOVE FEEDBACK when both exist', () => {
    // Feedback is an opinion anyone can post; a validation is a check a
    // validator contract actually performed. Weighting them equally would let
    // a pile of self-issued praise outrank a real verification.
    const result = toAgentReputationValue(
      snapshot({
        reputation: { count: 10, normalized: 1, rawValue: '10', decimals: 1, clients: 1 },
        validation: { count: 1, normalized: 0, averageResponse: 0 },
      }),
    )
    // 1.0 * 0.4 + 0.0 * 0.6 = 0.4 — a failed validation drags a perfect
    // feedback score below halfway.
    expect(result.value).toBeCloseTo(0.4)
    expect(result.value).toBeLessThan(0.5)
  })

  it('reports both counts in the basis, so a number can be accounted for', () => {
    const result = toAgentReputationValue(
      snapshot({
        reputation: { count: 3, normalized: 0.6, rawValue: '6', decimals: 1, clients: 2 },
        validation: { count: 5, normalized: 0.9, averageResponse: 90 },
      }),
    )
    expect(result.basis).toContain('3 feedback')
    expect(result.basis).toContain('5 validations')
  })

  it('never exceeds the [0,1] range the trust vector expects', () => {
    const result = toAgentReputationValue(
      snapshot({
        reputation: { count: 1, normalized: 1, rawValue: '1', decimals: 0, clients: 1 },
        validation: { count: 1, normalized: 1, averageResponse: 100 },
      }),
    )
    expect(result.value).toBeLessThanOrEqual(1)
    expect(result.value).toBeGreaterThanOrEqual(0)
  })
})
