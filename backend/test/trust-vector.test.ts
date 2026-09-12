/**
 * Trust vector, bands and drift — pure, no infrastructure. V2 Phase 2.
 *
 * The bulk of this file defends one rule: absence of evidence is not low risk.
 */
import { describe, expect, it } from 'vitest'
import {
  bootstrapVector,
  classifyFreshness,
  deriveBand,
  freshnessToDimension,
  knownDimensionCount,
  vectorToJson,
  type FreshnessOptions,
  type TrustBandOptions,
} from '../src/trust/trust-vector.js'
import {
  dimension,
  notApplicable,
  unknown,
  isPositiveSignal,
  TRUST_DIMENSIONS,
  type TrustVector,
} from '../src/trust/trust-types.js'
import {
  detectDrift,
  hourDistance,
  meanHourOfDay,
  medianBigInt,
  type BehaviorEvent,
  type DriftOptions,
} from '../src/trust/trust-drift.js'

const BANDS: TrustBandOptions = {
  criticalCoordinationRisk: 0.7,
  highCoordinationRisk: 0.35,
  lowCoordinationRisk: 0.35,
  establishedHistoryStrength: 0.5,
  verifiedHumanAssurance: 1,
  minKnownDimensions: 2,
}

const FRESH: FreshnessOptions = {
  agingAfterSeconds: 21_600,
  staleAfterSeconds: 86_400,
  expiredAfterSeconds: 604_800,
}

/** A fully-measured, benign vector to mutate per test. */
function healthy(): TrustVector {
  return {
    behaviorIntegrity: dimension(0.9, 'consistent'),
    coordinationRisk: dimension(0.1, 'low'),
    historyStrength: dimension(0.8, 'long history'),
    humanAssurance: unknown('none'),
    agentReputation: unknown('phase 6'),
    evidenceFreshness: dimension(1, 'fresh'),
    investigationConfidence: unknown('none'),
  }
}

describe('dimension construction', () => {
  it('clamps a measured value into [0,1]', () => {
    expect(dimension(1.7, 'x').value).toBe(1)
    expect(dimension(-3, 'x').value).toBe(0)
  })

  it('never gives an unknown dimension a numeric value', () => {
    // The entire point. A 0 here would read as "measured, and clean".
    expect(unknown('x').value).toBeNull()
    expect(unknown('x').state).toBe('UNKNOWN')
    expect(notApplicable('x').value).toBeNull()
  })

  it('requires a stated basis for every dimension', () => {
    expect(dimension(0.5, 'because').basis).toBe('because')
    expect(unknown('no data').basis).toBe('no data')
  })
})

describe('cold start — invariant 3.2', () => {
  it('leaves every dimension unknown', () => {
    const v = bootstrapVector()
    for (const name of TRUST_DIMENSIONS) {
      expect(v[name].value).toBeNull()
      expect(v[name].state).toBe('UNKNOWN')
    }
    expect(knownDimensionCount(v)).toBe(0)
  })

  it('bands a brand-new actor as INSUFFICIENT_EVIDENCE, never a LOW band', () => {
    const band = deriveBand(bootstrapVector(), BANDS)
    expect(band).toBe('INSUFFICIENT_EVIDENCE')
    expect(band).not.toBe('ESTABLISHED_LOW')
    expect(band).not.toBe('VERIFIED_LOW')
  })

  it('does not call a cold-start actor merely UNCERTAIN', () => {
    // UNCERTAIN means "measured, and mixed". Conflating the two would let an
    // unassessed wallet read as ambiguous rather than unknown.
    expect(deriveBand(bootstrapVector(), BANDS)).not.toBe('UNCERTAIN')
  })

  it('stays INSUFFICIENT_EVIDENCE when coordination risk alone is unmeasurable', () => {
    const v = healthy()
    v.coordinationRisk = unknown('freshness guard held it')
    // Everything else looks great. It does not matter.
    expect(deriveBand(v, BANDS)).toBe('INSUFFICIENT_EVIDENCE')
  })

  it('stays INSUFFICIENT_EVIDENCE below the minimum measured dimensions', () => {
    const v = bootstrapVector()
    v.coordinationRisk = dimension(0.01, 'low')
    expect(knownDimensionCount(v)).toBe(1)
    expect(deriveBand(v, BANDS)).toBe('INSUFFICIENT_EVIDENCE')
  })
})

describe('band derivation', () => {
  it('CRITICAL at or above the critical threshold', () => {
    const v = healthy()
    v.coordinationRisk = dimension(0.7, 'ring')
    expect(deriveBand(v, BANDS)).toBe('CRITICAL')
  })

  it('HIGH_RISK between high and critical', () => {
    const v = healthy()
    v.coordinationRisk = dimension(0.5, 'suspicious')
    expect(deriveBand(v, BANDS)).toBe('HIGH_RISK')
  })

  it('ESTABLISHED_LOW for a low-risk actor with real history', () => {
    expect(deriveBand(healthy(), BANDS)).toBe('ESTABLISHED_LOW')
  })

  it('VERIFIED_LOW once human assurance is present', () => {
    const v = healthy()
    v.humanAssurance = dimension(1, 'World PASSED')
    expect(deriveBand(v, BANDS)).toBe('VERIFIED_LOW')
  })

  it('UNCERTAIN for a low-risk actor with thin history and no assurance', () => {
    const v = healthy()
    v.historyStrength = dimension(0.1, 'barely any history')
    expect(deriveBand(v, BANDS)).toBe('UNCERTAIN')
  })

  it('RISK CANNOT BE AVERAGED AWAY by strong other dimensions', () => {
    // The reason banding is ordered rather than weighted. A World-verified,
    // long-lived, perfectly-behaved actor inside a confirmed ring is still in
    // a ring.
    const v: TrustVector = {
      behaviorIntegrity: dimension(1, 'perfect'),
      coordinationRisk: dimension(0.85, 'confirmed ring'),
      historyStrength: dimension(1, 'years'),
      humanAssurance: dimension(1, 'World PASSED'),
      agentReputation: dimension(1, 'flawless'),
      evidenceFreshness: dimension(1, 'fresh'),
      investigationConfidence: dimension(1, 'thorough'),
    }
    expect(deriveBand(v, BANDS)).toBe('CRITICAL')
  })
})

describe('freshness classes', () => {
  it('classifies across every boundary', () => {
    expect(classifyFreshness(0, FRESH)).toBe('FRESH')
    expect(classifyFreshness(21_599, FRESH)).toBe('FRESH')
    expect(classifyFreshness(21_600, FRESH)).toBe('AGING')
    expect(classifyFreshness(86_400, FRESH)).toBe('STALE')
    expect(classifyFreshness(604_800, FRESH)).toBe('EXPIRED')
    expect(classifyFreshness(9_999_999, FRESH)).toBe('EXPIRED')
  })

  it('maps expired evidence to zero confidence, not to unknown', () => {
    // Expired is a measurement — we know the evidence is too old. That is
    // different from never having looked.
    const d = freshnessToDimension('EXPIRED')
    expect(d.value).toBe(0)
    expect(d.state).toBe('KNOWN')
  })
})

describe('drift detection', () => {
  const OPTS: DriftOptions = {
    minBaselineEvents: 5,
    unusualAmountMultiple: 10,
    timingRegimeShiftHours: 6,
    clusterExpansionMultiple: 2,
  }

  const at = (iso: string): Date => new Date(iso)
  const ev = (over: Partial<BehaviorEvent> = {}): BehaviorEvent => ({
    counterparty: '0xaaa',
    eventType: 'transfer',
    protocolType: 'lending-cdp',
    amount: '1000',
    timestamp: at('2026-01-01T10:00:00Z'),
    ...over,
  })

  const baseline = Array.from({ length: 6 }, () => ev())

  it('reports no baseline rather than "no drift" when history is too thin', () => {
    // A brand-new actor has not stopped behaving normally — there is nothing to
    // have deviated from. Reporting that as clean is the cold-start mistake in
    // a different costume.
    const r = detectDrift([ev()], [ev()], OPTS)
    expect(r.hadBaseline).toBe(false)
    expect(r.signals).toHaveLength(0)
  })

  it('finds nothing when behaviour is unchanged', () => {
    const r = detectDrift(baseline, [ev()], OPTS)
    expect(r.hadBaseline).toBe(true)
    expect(r.signals).toHaveLength(0)
    expect(r.peakMagnitude).toBe(0)
  })

  it('flags a new counterparty', () => {
    const r = detectDrift(baseline, [ev({ counterparty: '0xnew' })], OPTS)
    expect(r.signals.map((s) => s.name)).toContain('NEW_COUNTERPARTY')
  })

  it('flags an unusual amount without losing precision on huge values', () => {
    // 1e21 base units — far beyond Number.MAX_SAFE_INTEGER. The comparison is
    // done in bigint, so the decision cannot be corrupted by a float round.
    const r = detectDrift(baseline, [ev({ amount: '1000000000000000000000' })], OPTS)
    expect(r.signals.map((s) => s.name)).toContain('UNUSUAL_AMOUNT')
  })

  it('does not flag an amount just under the multiple', () => {
    const r = detectDrift(baseline, [ev({ amount: '9000' })], OPTS)
    expect(r.signals.map((s) => s.name)).not.toContain('UNUSUAL_AMOUNT')
  })

  it('flags a new protocol category', () => {
    const r = detectDrift(baseline, [ev({ protocolType: 'dex-amm' })], OPTS)
    expect(r.signals.map((s) => s.name)).toContain('NEW_PROTOCOL_CATEGORY')
  })

  it('flags a new timing regime', () => {
    const r = detectDrift(baseline, [ev({ timestamp: at('2026-01-02T22:00:00Z') })], OPTS)
    expect(r.signals.map((s) => s.name)).toContain('NEW_TIMING_REGIME')
  })

  it('flags an unseen action type', () => {
    const r = detectDrift(baseline, [ev({ eventType: 'borrow' })], OPTS)
    expect(r.signals.map((s) => s.name)).toContain('BEHAVIOR_SEQUENCE_DEVIATION')
  })

  it('flags sudden cluster expansion', () => {
    const r = detectDrift(baseline, [ev()], OPTS, { baseline: 2, current: 9 })
    expect(r.signals.map((s) => s.name)).toContain('SUDDEN_CLUSTER_EXPANSION')
  })

  it('never returns a verdict — only signals and magnitudes', () => {
    // Section 6.3: drift is a signal, not proof of abuse. If this type ever
    // grows a `verdict` or `abusive` field, that rule has been broken.
    const r = detectDrift(baseline, [ev({ counterparty: '0xnew' })], OPTS)
    expect(Object.keys(r).sort()).toEqual(['hadBaseline', 'peakMagnitude', 'signals'])
    for (const s of r.signals) {
      expect(s.magnitude).toBeGreaterThanOrEqual(0)
      expect(s.magnitude).toBeLessThanOrEqual(1)
    }
  })
})

describe('drift maths helpers', () => {
  it('takes a median rather than a mean, so one outlier cannot hide the rest', () => {
    expect(medianBigInt([1n, 2n, 3n, 1000000n])).toBe(2n)
  })

  it('returns null for an empty series', () => {
    expect(medianBigInt([])).toBeNull()
  })

  it('measures hour distance on the circle', () => {
    expect(hourDistance(23, 1)).toBe(2)
    expect(hourDistance(1, 23)).toBe(2)
    expect(hourDistance(0, 12)).toBe(12)
  })

  it('averages hours on the circle, so 23:00 and 01:00 average to midnight', () => {
    const mean = meanHourOfDay([
      { counterparty: null, eventType: 't', protocolType: null, amount: null, timestamp: new Date('2026-01-01T23:00:00Z') },
      { counterparty: null, eventType: 't', protocolType: null, amount: null, timestamp: new Date('2026-01-02T01:00:00Z') },
    ])
    expect(mean).not.toBeNull()
    expect(hourDistance(mean!, 0)).toBeLessThan(0.5)
  })
})

describe('trust signals', () => {
  it('classifies positive and negative kinds', () => {
    expect(isPositiveSignal('SUCCESSFUL_CHALLENGE')).toBe(true)
    expect(isPositiveSignal('CLEAN_BEHAVIOR')).toBe(true)
    expect(isPositiveSignal('POLICY_VIOLATION')).toBe(false)
    expect(isPositiveSignal('CONFIRMED_COORDINATED_CLUSTER')).toBe(false)
  })
})

describe('serialisation', () => {
  it('preserves null values and states through JSON', () => {
    const json = vectorToJson(bootstrapVector()) as Record<
      string,
      { value: number | null; state: string }
    >
    // A round trip must not turn "unknown" into 0.
    for (const name of TRUST_DIMENSIONS) {
      expect(json[name]!.value).toBeNull()
      expect(json[name]!.state).toBe('UNKNOWN')
    }
  })
})
