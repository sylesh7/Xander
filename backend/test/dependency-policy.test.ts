/**
 * V2 Phase 12 — THE ACCEPTANCE CONDITION, as a table walk. Pure, no infra.
 *
 * "A failure in any external dependency produces a KNOWN SAFE STATE rather than
 *  an accidental authorization bypass."
 *
 * These tests do two things the codebase could not otherwise guarantee:
 *
 *  1. EVERY dependency has a written policy. A new integration added without
 *     one fails here rather than shipping with undefined degraded behaviour.
 *  2. No policy can claim a dependency both influences authorization and is
 *     safe to lose. That combination is the bypass, and it is checked
 *     structurally rather than reviewed by eye.
 */
import { describe, expect, it } from 'vitest'
import {
  authorizationCriticalDependencies,
  canAuthorizeWithout,
  DEPENDENCIES,
  DEGRADED_BEHAVIOURS,
  DEPENDENCY_POLICIES,
  policyFor,
} from '../src/hardening/dependency-policy.js'

describe('every dependency has a written policy', () => {
  it('covers the full dependency list with no gaps', () => {
    // The guard against a new integration shipping with undefined behaviour.
    for (const dependency of DEPENDENCIES) {
      expect(() => policyFor(dependency), `${dependency} has no policy`).not.toThrow()
    }
    expect(DEPENDENCY_POLICIES.length).toBe(DEPENDENCIES.length)
  })

  it('has no duplicate rows', () => {
    const seen = new Set(DEPENDENCY_POLICIES.map((p) => p.dependency))
    expect(seen.size).toBe(DEPENDENCY_POLICIES.length)
  })

  it('THROWS for an unknown dependency rather than defaulting', () => {
    // A permissive default here would be the exact hole this file closes.
    expect(() => policyFor('SOME_NEW_SERVICE')).toThrow(/no degradation policy/i)
  })

  it('gives every row a real rationale and a place it is enforced', () => {
    // A policy nobody can trace to code is a claim, not a control.
    for (const p of DEPENDENCY_POLICIES) {
      expect(p.rationale.length, `${p.dependency} rationale`).toBeGreaterThan(40)
      expect(p.enforcedIn.length, `${p.dependency} enforcedIn`).toBeGreaterThan(10)
      expect(DEGRADED_BEHAVIOURS).toContain(p.behaviour)
    }
  })
})

describe('NO DEPENDENCY FAILS OPEN', () => {
  it('has no behaviour that means "carry on regardless"', () => {
    // Every defined behaviour withholds or degrades something. There is
    // deliberately no IGNORE.
    expect(DEGRADED_BEHAVIOURS).not.toContain('IGNORE')
    expect(DEGRADED_BEHAVIOURS).not.toContain('ALLOW')
  })

  it('NEVER MARKS AN EVIDENCE SOURCE AS SAFE TO LOSE', () => {
    // The Arbitrum lesson in structural form: losing the evidence an
    // authorization rests on must never leave authorization possible.
    for (const dependency of ['GRAPH_TOKEN_API', 'GRAPH_SUBGRAPHS', 'SUBSTREAMS', 'POSTGRES']) {
      const policy = policyFor(dependency)
      expect(policy.canStillAuthorize, `${dependency} must block authorization`).toBe(false)
    }
  })

  it('never marks an enforcement boundary as safe to lose', () => {
    // Section 18.2: an unreachable boundary is UNKNOWN, and UNKNOWN is not
    // proof of authorization.
    expect(policyFor('ENS_RPC').canStillAuthorize).toBe(false)
    expect(policyFor('WORLD').canStillAuthorize).toBe(false)
    expect(policyFor('X402_FACILITATOR').canStillAuthorize).toBe(false)
  })

  it('only lets ADVISORY dependencies keep authorization working', () => {
    // The complete allowed list, written out. Anything else appearing here in
    // future is a deliberate decision somebody has to make consciously.
    const safe = DEPENDENCY_POLICIES.filter((p) => p.canStillAuthorize).map((p) => p.dependency)
    expect([...safe].sort()).toEqual(
      ['ANTHROPIC', 'ERC8004_RPC', 'REDIS', 'SUBGRAPH_MCP', 'TEMPORAL'].sort(),
    )
  })

  it('gives every authorization-critical dependency a restrictive behaviour', () => {
    for (const dependency of authorizationCriticalDependencies()) {
      const p = policyFor(dependency)
      expect(
        ['REFUSE_ALL', 'HOLD_FOR_REVIEW', 'REFUSE_ACTION'],
        `${dependency} is critical but degrades to ${p.behaviour}`,
      ).toContain(p.behaviour)
    }
  })

  it('never lets an advisory dependency claim a restrictive behaviour', () => {
    // The inverse consistency check: a dependency that can be lost safely must
    // not also claim it refuses everything.
    for (const p of DEPENDENCY_POLICIES.filter((x) => x.canStillAuthorize)) {
      expect(['DEGRADE_TO_UNKNOWN', 'DEGRADE_LOCAL_ONLY'], p.dependency).toContain(p.behaviour)
    }
  })
})

describe('canAuthorizeWithout', () => {
  it('allows authorization when only advisory dependencies are down', () => {
    const result = canAuthorizeWithout(['REDIS', 'SUBGRAPH_MCP', 'ANTHROPIC', 'TEMPORAL'])
    expect(result.canAuthorize).toBe(true)
    expect(result.blockedBy).toEqual([])
  })

  it('BLOCKS when the Graph is down — section 27.5', () => {
    const result = canAuthorizeWithout(['GRAPH_TOKEN_API'])
    expect(result.canAuthorize).toBe(false)
    expect(result.blockedBy).toContain('GRAPH_TOKEN_API')
    expect(result.reasons[0]).toContain('HOLD_FOR_REVIEW')
  })

  it('blocks when ANY critical dependency is down, even among safe ones', () => {
    const result = canAuthorizeWithout(['REDIS', 'ANTHROPIC', 'ENS_RPC'])
    expect(result.canAuthorize).toBe(false)
    expect(result.blockedBy).toEqual(['ENS_RPC'])
  })

  it('allows authorization when nothing is down', () => {
    expect(canAuthorizeWithout([]).canAuthorize).toBe(true)
  })

  it('blocks for EVERY critical dependency, one at a time', () => {
    // The exhaustive walk. If any critical dependency stops blocking, this
    // fails rather than waiting for someone to notice in production.
    for (const dependency of authorizationCriticalDependencies()) {
      const result = canAuthorizeWithout([dependency])
      expect(result.canAuthorize, `${dependency} did not block authorization`).toBe(false)
    }
  })

  it('throws rather than silently ignoring an unknown dependency', () => {
    expect(() => canAuthorizeWithout(['MYSTERY_SERVICE'])).toThrow()
  })
})
