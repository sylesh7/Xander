/**
 * Live trust mutation rules — pure, no infrastructure. V2 Phase 7.
 */
import { describe, expect, it } from 'vitest'
import {
  attenuatedLimit,
  bandSeverity,
  decideConsequence,
  isDegradation,
} from '../src/trust/trust-mutation.js'

describe('band severity ordering', () => {
  it('orders the low bands below the risky ones', () => {
    expect(bandSeverity('VERIFIED_LOW')).toBeLessThan(bandSeverity('ESTABLISHED_LOW'))
    expect(bandSeverity('ESTABLISHED_LOW')).toBeLessThan(bandSeverity('UNCERTAIN'))
    expect(bandSeverity('HIGH_RISK')).toBeLessThan(bandSeverity('CRITICAL'))
  })

  it('places INSUFFICIENT_EVIDENCE above UNCERTAIN but below HIGH_RISK', () => {
    // Losing the ability to measure an actor is worse than having measured
    // them as ambiguous — we can no longer justify what they hold. But it is
    // not evidence of coordination, so it must not rank with a real finding.
    expect(bandSeverity('INSUFFICIENT_EVIDENCE')).toBeGreaterThan(bandSeverity('UNCERTAIN'))
    expect(bandSeverity('INSUFFICIENT_EVIDENCE')).toBeLessThan(bandSeverity('HIGH_RISK'))
  })

  it('treats an unrecognised band as unmeasurable rather than safe', () => {
    // A band we do not know about must never sort as harmless.
    expect(bandSeverity('SOMETHING_NEW')).toBe(bandSeverity('INSUFFICIENT_EVIDENCE'))
    expect(bandSeverity('SOMETHING_NEW')).toBeGreaterThan(bandSeverity('ESTABLISHED_LOW'))
  })
})

describe('degradation detection', () => {
  it('detects a fall', () => {
    expect(isDegradation('ESTABLISHED_LOW', 'HIGH_RISK')).toBe(true)
    expect(isDegradation('UNCERTAIN', 'CRITICAL')).toBe(true)
  })

  it('does not treat an improvement or a hold as degradation', () => {
    expect(isDegradation('HIGH_RISK', 'ESTABLISHED_LOW')).toBe(false)
    expect(isDegradation('UNCERTAIN', 'UNCERTAIN')).toBe(false)
  })

  it('treats going unmeasurable as a fall', () => {
    // An actor who goes quiet until their evidence goes stale must not escape
    // scrutiny by doing so.
    expect(isDegradation('ESTABLISHED_LOW', 'INSUFFICIENT_EVIDENCE')).toBe(true)
  })
})

describe('consequences', () => {
  it('revokes at CRITICAL', () => {
    expect(decideConsequence('ESTABLISHED_LOW', 'CRITICAL')).toBe('REVOKE')
  })

  it('suspends at HIGH_RISK', () => {
    expect(decideConsequence('ESTABLISHED_LOW', 'HIGH_RISK')).toBe('SUSPEND')
  })

  it('SUSPENDS RATHER THAN REVOKES when evidence runs out', () => {
    // Reversible on purpose: absence of evidence is not proof of wrongdoing,
    // and a revoke could not be undone if the actor becomes measurable again.
    expect(decideConsequence('VERIFIED_LOW', 'INSUFFICIENT_EVIDENCE')).toBe('SUSPEND')
  })

  it('ATTENUATES rather than stripping authority at UNCERTAIN', () => {
    // An actor who became merely ambiguous has done nothing wrong. Removing
    // everything for ambiguity is the false-positive behaviour this whole
    // project exists to avoid.
    expect(decideConsequence('ESTABLISHED_LOW', 'UNCERTAIN')).toBe('ATTENUATE')
  })

  it('DOES NOTHING when trust improves', () => {
    // Rising trust is a reason to grant more on the NEXT request, judged by
    // policy against the actual action — never a reason to retroactively widen
    // a grant nobody re-evaluated.
    expect(decideConsequence('CRITICAL', 'ESTABLISHED_LOW')).toBe('NONE')
    expect(decideConsequence('HIGH_RISK', 'UNCERTAIN')).toBe('NONE')
  })

  it('does nothing when the band is unchanged', () => {
    for (const band of ['VERIFIED_LOW', 'UNCERTAIN', 'HIGH_RISK', 'CRITICAL']) {
      expect(decideConsequence(band, band)).toBe('NONE')
    }
  })

  it('is driven by where the actor IS, not how far they fell', () => {
    // A two-band drop into UNCERTAIN is the same situation as a gentle drift
    // into it.
    expect(decideConsequence('VERIFIED_LOW', 'UNCERTAIN')).toBe(
      decideConsequence('ESTABLISHED_LOW', 'UNCERTAIN'),
    )
  })
})

describe('attenuation arithmetic', () => {
  it('halves a ceiling', () => {
    expect(attenuatedLimit('1000', 2)).toBe('500')
  })

  it('stays exact on values beyond float precision', () => {
    // Base units are uint256. A float divide would corrupt this.
    expect(attenuatedLimit('100000000000000000000000001', 2)).toBe('50000000000000000000000000')
  })

  it('leaves an unbounded capability unbounded', () => {
    // Null means "no amount bound", not "a bound of zero".
    expect(attenuatedLimit(null, 2)).toBeNull()
  })

  it('never widens a ceiling, even with a nonsense divisor', () => {
    // A divisor below 2 would otherwise multiply the limit.
    expect(BigInt(attenuatedLimit('1000', 1)!)).toBeLessThanOrEqual(1000n)
    expect(BigInt(attenuatedLimit('1000', 0)!)).toBeLessThanOrEqual(1000n)
    expect(BigInt(attenuatedLimit('1000', -5)!)).toBeLessThanOrEqual(1000n)
  })

  it('returns a malformed amount unchanged rather than guessing', () => {
    expect(attenuatedLimit('not-a-number', 2)).toBe('not-a-number')
  })
})
