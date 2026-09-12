/**
 * Incident rules — pure, no infrastructure. V2 Phase 10.
 *
 * The centre of this file is `reconcileRecommendation`, which enforces spec
 * section 15.3: the AI may recommend, but "the recommendation is passed back
 * into deterministic policy evaluation. It is not itself the authorization
 * authority."
 *
 * If any test in this file can be made to pass with an AI recommendation
 * LOOSENING a deterministic decision, the product has an authorization bypass
 * reachable by prompt injection.
 */
import { describe, expect, it } from 'vitest'
import {
  actionRank,
  atLeastAsRestrictive,
  canTransition,
  deterministicAction,
  initialMitigation,
  isClosed,
  reconcileRecommendation,
  severityRank,
  RECOMMENDED_ACTIONS,
} from '../src/incidents/incident-types.js'

describe('SECTION 15.3 — the AI is advisory, never the authority', () => {
  it('LETS THE AI TIGHTEN a deterministic decision', () => {
    // Escalation is the useful direction: the investigator can see things the
    // deterministic features missed, and a false escalation costs a review.
    const r = reconcileRecommendation('LIMIT', 'BLOCK')
    expect(r.action).toBe('BLOCK')
    expect(r.aiChangedOutcome).toBe(true)
    expect(r.aiAttemptedToWiden).toBe(false)
  })

  it('NEVER LETS THE AI LOOSEN A DETERMINISTIC DECISION', () => {
    // THE test. An investigator that can de-escalate is an authorization
    // bypass: anyone who can get text into the evidence the model reads can
    // then argue their way out of a block.
    const r = reconcileRecommendation('BLOCK', 'ALLOW')
    expect(r.action).toBe('BLOCK')
    expect(r.aiChangedOutcome).toBe(false)
    expect(r.aiAttemptedToWiden).toBe(true)
    expect(r.reason).toContain('IGNORED')
  })

  it('refuses every downgrade, not just the extreme one', () => {
    const downgrades: [string, string][] = [
      ['BLOCK', 'REVIEW'],
      ['BLOCK', 'LIMIT'],
      ['BLOCK', 'ALLOW'],
      ['REVIEW', 'LIMIT'],
      ['REVIEW', 'ALLOW'],
      ['LIMIT', 'ALLOW'],
    ]
    for (const [deterministic, ai] of downgrades) {
      const r = reconcileRecommendation(deterministic, ai)
      expect(r.action).toBe(deterministic)
      expect(r.aiAttemptedToWiden).toBe(true)
    }
  })

  it('treats a GARBLED recommendation as the most restrictive thing it could mean', () => {
    // A model returning prose, an empty string, or a hallucinated verb must
    // never read as ALLOW. `actionRank` defaults unknown input to BLOCK.
    for (const junk of ['', 'allow please', 'PERMIT', 'yes', '{"action":"ALLOW"}']) {
      expect(actionRank(junk)).toBe(actionRank('BLOCK'))
      // Against a BLOCK floor it agrees; against a weaker floor it escalates.
      expect(reconcileRecommendation('LIMIT', junk).action).toBe('BLOCK')
    }
  })

  it('falls back to the deterministic decision when there is no AI finding', () => {
    // The timeout path. An investigation that never arrives must not stall or
    // weaken the response.
    const r = reconcileRecommendation('REVIEW', null)
    expect(r.action).toBe('REVIEW')
    expect(r.aiChangedOutcome).toBe(false)
    expect(r.aiAttemptedToWiden).toBe(false)
  })

  it('records agreement without claiming the AI changed anything', () => {
    const r = reconcileRecommendation('LIMIT', 'LIMIT')
    expect(r.action).toBe('LIMIT')
    expect(r.aiChangedOutcome).toBe(false)
    expect(r.aiAttemptedToWiden).toBe(false)
    expect(r.reason).toContain('agreed')
  })

  it('never returns an action weaker than the floor, for ANY pair', () => {
    // Exhaustive over the whole action set — the property, not examples.
    for (const deterministic of RECOMMENDED_ACTIONS) {
      for (const ai of RECOMMENDED_ACTIONS) {
        const r = reconcileRecommendation(deterministic, ai)
        expect(atLeastAsRestrictive(r.action, deterministic)).toBe(true)
      }
    }
  })

  it('treats an unrecognised deterministic floor as BLOCK', () => {
    // A severity we do not understand must not produce a permissive floor.
    expect(reconcileRecommendation('SOMETHING_NEW', 'ALLOW').action).toBe('BLOCK')
  })
})

describe('severity', () => {
  it('orders low below critical', () => {
    expect(severityRank('LOW')).toBeLessThan(severityRank('MEDIUM'))
    expect(severityRank('MEDIUM')).toBeLessThan(severityRank('HIGH'))
    expect(severityRank('HIGH')).toBeLessThan(severityRank('CRITICAL'))
  })

  it('TREATS AN UNKNOWN SEVERITY AS CRITICAL, not harmless', () => {
    expect(severityRank('WEIRD')).toBe(severityRank('CRITICAL'))
  })

  it('maps severity to a deterministic action', () => {
    expect(deterministicAction('CRITICAL')).toBe('BLOCK')
    expect(deterministicAction('HIGH')).toBe('REVIEW')
    expect(deterministicAction('MEDIUM')).toBe('LIMIT')
    expect(deterministicAction('LOW')).toBe('ALLOW')
  })
})

describe('containment before understanding', () => {
  it('revokes at CRITICAL and restricts at HIGH, before any investigation', () => {
    // Section 14.1 puts "freeze financial capability" first. An agent draining
    // funds while a model writes a paragraph is the failure this prevents.
    expect(initialMitigation('CRITICAL')).toBe('REVOKE')
    expect(initialMitigation('HIGH')).toBe('RESTRICT')
  })

  it('does NOT contain on low or medium severity', () => {
    // Containment costs the actor real authority. Applying it to every incident
    // would make the product unusable and train operators to ignore incidents.
    expect(initialMitigation('MEDIUM')).toBe('NONE')
    expect(initialMitigation('LOW')).toBe('NONE')
  })

  it('contains an unrecognised severity rather than ignoring it', () => {
    expect(initialMitigation('WHO_KNOWS')).toBe('REVOKE')
  })
})

describe('incident status transitions', () => {
  it('allows the normal path', () => {
    expect(canTransition('OPEN', 'INVESTIGATING')).toBe(true)
    expect(canTransition('INVESTIGATING', 'MITIGATED')).toBe(true)
    expect(canTransition('MITIGATED', 'RESOLVED')).toBe(true)
  })

  it('REFUSES TO REOPEN A CLOSED INCIDENT', () => {
    // An incident log that can be rewritten is not an audit trail. A closed
    // incident carrying two contradictory conclusions is worse than no log.
    for (const closed of ['RESOLVED', 'FALSE_POSITIVE']) {
      for (const target of ['OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED']) {
        expect(canTransition(closed, target)).toBe(false)
      }
    }
  })

  it('does not treat MITIGATED as closed', () => {
    // Contained is not explained. An incident whose cause is unknown still
    // needs a human.
    expect(isClosed('MITIGATED')).toBe(false)
    expect(isClosed('RESOLVED')).toBe(true)
    expect(isClosed('FALSE_POSITIVE')).toBe(true)
  })

  it('refuses a transition from an unknown status', () => {
    expect(canTransition('MADE_UP', 'RESOLVED')).toBe(false)
  })

  it('does not allow skipping straight back to OPEN', () => {
    expect(canTransition('INVESTIGATING', 'OPEN')).toBe(false)
    expect(canTransition('MITIGATED', 'INVESTIGATING')).toBe(false)
  })
})
