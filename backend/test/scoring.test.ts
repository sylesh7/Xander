import { describe, expect, it } from 'vitest'
import {
  PolicyError,
  RESERVE_WEIGHT,
  aggregateConfidence,
  bandFor,
  scoreFeatures,
  validateThresholds,
  validateWeights,
  type Threshold,
  type Weight,
} from '../src/risk/scoring.js'
import { mad, median, percentile, robustBaseline, robustZScore } from '../src/risk/robust.js'
import type { FeatureResult } from '../src/risk/types.js'

const WEIGHTS: Weight[] = [
  { feature: 'FUNDING_CORRELATION', weight: 0.25 },
  { feature: 'TIMING_CORRELATION', weight: 0.15 },
  { feature: 'WALLET_AGE_SIMILARITY', weight: 0.15 },
  { feature: 'SHARED_COUNTERPARTY', weight: 0.15 },
  { feature: 'PROTOCOL_BEHAVIOR_SIMILARITY', weight: 0.15 },
  { feature: RESERVE_WEIGHT, weight: 0.15 },
]

const THRESHOLDS: Threshold[] = [
  { band: 'ALLOW', minScore: 0, maxScore: 0.35 },
  { band: 'CHALLENGE', minScore: 0.35, maxScore: 0.7 },
  { band: 'BLOCK', minScore: 0.7, maxScore: 1 },
]

const POLICY = { weights: WEIGHTS, thresholds: THRESHOLDS }

const feat = (
  name: FeatureResult['name'],
  value: number,
  confidence: FeatureResult['confidence'] = 'HIGH',
): FeatureResult => ({ name, value, confidence, sourceEvidenceIds: ['e1'] })

const allFeatures = (v: number, c: FeatureResult['confidence'] = 'HIGH'): FeatureResult[] => [
  feat('FUNDING_CORRELATION', v, c),
  feat('TIMING_CORRELATION', v, c),
  feat('WALLET_AGE_SIMILARITY', v, c),
  feat('SHARED_COUNTERPARTY', v, c),
  feat('PROTOCOL_BEHAVIOR_SIMILARITY', v, c),
  feat(RESERVE_WEIGHT as FeatureResult['name'], 0, c),
]

// ---------------------------------------------------------------------------

describe('robust statistics', () => {
  it('median ignores extreme values that would drag a mean', () => {
    const values = [1, 2, 3, 4, 1000]
    expect(median(values)).toBe(3)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    expect(mean).toBeGreaterThan(200)
  })

  it('median averages the middle pair for an even sample', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('mad is unmoved by a handful of outliers', () => {
    expect(mad([10, 10, 10, 10, 10])).toBe(0)
    expect(mad([1, 2, 3, 4, 5])).toBe(1)
  })

  it('THE CONTAMINATION CASE: a mean baseline normalizes the attack, a median does not', () => {
    // 70% of a campaign is one Sybil ring, all scoring 0.9 on funding
    // correlation. The 30% honest users score 0.05.
    const campaign = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.05, 0.05, 0.05]
    const attacker = 0.9

    const mean = campaign.reduce((a, b) => a + b, 0) / campaign.length
    const stddev = Math.sqrt(campaign.reduce((s, v) => s + (v - mean) ** 2, 0) / campaign.length)
    const naiveZ = (attacker - mean) / stddev
    // Under a mean/stddev baseline the attacker looks barely above average.
    expect(Math.abs(naiveZ)).toBeLessThan(1)

    // Under median/MAD the attacker sits at the median because the ring IS the
    // majority — so MAD is 0 and the honest answer is "no usable spread",
    // rather than a confident z-score claiming the attacker is normal.
    expect(median(campaign)).toBe(0.9)
    expect(robustZScore(attacker, campaign)).toBe(0)
  })

  it('robustZScore returns 0 rather than dividing by zero when MAD is 0', () => {
    expect(robustZScore(0.5, [0.5, 0.5, 0.5])).toBe(0)
    expect(Number.isFinite(robustZScore(0.9, [0.5, 0.5, 0.5]))).toBe(true)
  })

  it('robustZScore is positive for a genuine outlier', () => {
    expect(robustZScore(0.9, [0.1, 0.12, 0.09, 0.11, 0.1])).toBeGreaterThan(3)
  })

  it('percentile interpolates', () => {
    expect(percentile([0, 10], 0.5)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5)
  })

  it('robustBaseline reports the sample it came from', () => {
    const b = robustBaseline(0.8, [0.1, 0.2, 0.3])
    expect(b.median).toBeCloseTo(0.2)
    expect(b.sampleSize).toBe(3)
  })

  it('empty populations do not crash', () => {
    expect(median([])).toBe(0)
    expect(mad([])).toBe(0)
    expect(robustZScore(0.5, [])).toBe(0)
  })
})

// ---------------------------------------------------------------------------

describe('policy validation', () => {
  it('accepts weights summing to 1.0', () => {
    expect(() => validateWeights(WEIGHTS)).not.toThrow()
  })

  it('rejects weights that do not sum to 1.0', () => {
    // A policy summing to 0.9 deflates every score by 10% and silently moves
    // every wallet a band towards ALLOW.
    expect(() => validateWeights([{ feature: 'A', weight: 0.9 }])).toThrow(PolicyError)
  })

  it('rejects a negative weight', () => {
    expect(() =>
      validateWeights([
        { feature: 'A', weight: 1.5 },
        { feature: 'B', weight: -0.5 },
      ]),
    ).toThrow(/invalid weight/)
  })

  it('rejects an empty policy rather than scoring with nothing', () => {
    expect(() => validateWeights([])).toThrow(/not seeded/)
  })

  it('rejects thresholds with a gap', () => {
    // A gap means some score maps to no band and the claim falls through.
    expect(() =>
      validateThresholds([
        { band: 'ALLOW', minScore: 0, maxScore: 0.3 },
        { band: 'BLOCK', minScore: 0.5, maxScore: 1 },
      ]),
    ).toThrow(/gap or overlap/)
  })

  it('rejects overlapping thresholds', () => {
    // An overlap makes the band depend on row ordering.
    expect(() =>
      validateThresholds([
        { band: 'ALLOW', minScore: 0, maxScore: 0.6 },
        { band: 'BLOCK', minScore: 0.4, maxScore: 1 },
      ]),
    ).toThrow(/gap or overlap/)
  })

  it('rejects thresholds that do not cover [0, 1]', () => {
    expect(() => validateThresholds([{ band: 'X', minScore: 0.1, maxScore: 1 }])).toThrow(/not 0/)
    expect(() => validateThresholds([{ band: 'X', minScore: 0, maxScore: 0.9 }])).toThrow(/not 1/)
  })
})

describe('bandFor', () => {
  it('maps scores to the seeded bands', () => {
    expect(bandFor(0, THRESHOLDS)).toBe('ALLOW')
    expect(bandFor(0.2, THRESHOLDS)).toBe('ALLOW')
    expect(bandFor(0.5, THRESHOLDS)).toBe('CHALLENGE')
    expect(bandFor(0.8, THRESHOLDS)).toBe('BLOCK')
  })

  it('treats a boundary as the START of the higher band, not the end of the lower', () => {
    // Half-open [min, max): exactly one band owns any given score.
    expect(bandFor(0.35, THRESHOLDS)).toBe('CHALLENGE')
    expect(bandFor(0.7, THRESHOLDS)).toBe('BLOCK')
  })

  it('includes 1.0 in the top band', () => {
    // Half-open everywhere would leave a perfect 1.0 matching nothing.
    expect(bandFor(1, THRESHOLDS)).toBe('BLOCK')
  })
})

// ---------------------------------------------------------------------------

describe('scoreFeatures', () => {
  it('is the weighted sum, nothing cleverer', () => {
    const r = scoreFeatures(allFeatures(1), POLICY)
    // 0.25 + 0.15*4 = 0.85. RESERVE contributes 0 by design.
    expect(r.score).toBeCloseTo(0.85)
    expect(r.band).toBe('BLOCK')
  })

  it('scores an all-zero feature set as ALLOW', () => {
    const r = scoreFeatures(allFeatures(0), POLICY)
    expect(r.score).toBe(0)
    expect(r.band).toBe('ALLOW')
  })

  it('cannot reach 1.0 — RESERVE is unallocated headroom', () => {
    // Documented rather than hidden: "why does nothing score 1.0?" has a row.
    expect(scoreFeatures(allFeatures(1), POLICY).score).toBeLessThan(1)
  })

  it('records each feature contribution for the receipt', () => {
    const r = scoreFeatures(allFeatures(1), POLICY)
    const funding = r.features.find((f) => f.name === 'FUNDING_CORRELATION')!
    expect(funding.weight).toBe(0.25)
    expect(funding.contribution).toBeCloseTo(0.25)
    expect(r.features.reduce((s, f) => s + f.contribution, 0)).toBeCloseTo(r.score)
  })

  it('throws on a feature with no weight row instead of silently scoring it 0', () => {
    // Silently dropping a signal is the failure mode this guards.
    const partial = { weights: [{ feature: 'ONLY_ONE', weight: 1 }], thresholds: THRESHOLDS }
    expect(() => scoreFeatures([feat('FUNDING_CORRELATION', 1)], partial)).toThrow(
      /has no RiskWeight row/,
    )
  })

  it('attaches a robust baseline when a campaign population is supplied', () => {
    const r = scoreFeatures(allFeatures(0.9), POLICY, {
      FUNDING_CORRELATION: [0.1, 0.1, 0.15, 0.12],
    })
    const funding = r.features.find((f) => f.name === 'FUNDING_CORRELATION')!
    expect(funding.baseline?.median).toBeCloseTo(0.11)
    expect(funding.baseline?.zScore).toBeGreaterThan(0)
  })

  it('the baseline does NOT change the score', () => {
    // Re-baselining the score would make a decision depend on which other
    // claims happened to be in flight at the time.
    const without = scoreFeatures(allFeatures(0.9), POLICY)
    const with_ = scoreFeatures(allFeatures(0.9), POLICY, {
      FUNDING_CORRELATION: [0.01, 0.02, 0.01],
    })
    expect(with_.score).toBe(without.score)
  })
})

describe('aggregateConfidence', () => {
  it('is HIGH when every weighted feature is HIGH', () => {
    expect(scoreFeatures(allFeatures(0.5, 'HIGH'), POLICY).confidence).toBe('HIGH')
  })

  it('is LOW when every feature is LOW', () => {
    expect(scoreFeatures(allFeatures(0.5, 'LOW'), POLICY).confidence).toBe('LOW')
  })

  it('weights confidence by influence, not by count', () => {
    // One LOW feature carrying 25% should matter more than one carrying 5%.
    const heavy = aggregateConfidence([
      {
        name: 'FUNDING_CORRELATION',
        value: 1,
        weight: 0.9,
        contribution: 0.9,
        confidence: 'LOW',
        sourceEvidenceIds: [],
      },
      {
        name: 'TIMING_CORRELATION',
        value: 1,
        weight: 0.1,
        contribution: 0.1,
        confidence: 'HIGH',
        sourceEvidenceIds: [],
      },
    ])
    const light = aggregateConfidence([
      {
        name: 'FUNDING_CORRELATION',
        value: 1,
        weight: 0.1,
        contribution: 0.1,
        confidence: 'LOW',
        sourceEvidenceIds: [],
      },
      {
        name: 'TIMING_CORRELATION',
        value: 1,
        weight: 0.9,
        contribution: 0.9,
        confidence: 'HIGH',
        sourceEvidenceIds: [],
      },
    ])
    expect(heavy).toBe('LOW')
    expect(light).toBe('HIGH')
  })
})

describe('THE PHASE 8 ACCEPTANCE TEST', () => {
  it('a coordinated cluster scores CHALLENGE or higher', () => {
    const coordinated: FeatureResult[] = [
      feat('FUNDING_CORRELATION', 1),
      feat('TIMING_CORRELATION', 0.95),
      feat('WALLET_AGE_SIMILARITY', 0.9),
      feat('SHARED_COUNTERPARTY', 1),
      feat('PROTOCOL_BEHAVIOR_SIMILARITY', 1),
      feat(RESERVE_WEIGHT as FeatureResult['name'], 0),
    ]
    const r = scoreFeatures(coordinated, POLICY)
    expect(r.score).toBeGreaterThanOrEqual(0.35)
    expect(['CHALLENGE', 'BLOCK']).toContain(r.band)
  })

  it('a clean wallet set scores ALLOW', () => {
    const clean: FeatureResult[] = [
      feat('FUNDING_CORRELATION', 0),
      feat('TIMING_CORRELATION', 0.02),
      feat('WALLET_AGE_SIMILARITY', 0.05),
      feat('SHARED_COUNTERPARTY', 0.03),
      feat('PROTOCOL_BEHAVIOR_SIMILARITY', 0.11),
      feat(RESERVE_WEIGHT as FeatureResult['name'], 0),
    ]
    const r = scoreFeatures(clean, POLICY)
    expect(r.score).toBeLessThan(0.35)
    expect(r.band).toBe('ALLOW')
  })

  it('the same features and policy always reproduce the same score', () => {
    // This is what makes an Evidence Receipt replayable months later.
    const f = allFeatures(0.6)
    expect(scoreFeatures(f, POLICY).score).toBe(scoreFeatures(f, POLICY).score)
  })

  it('a retuned policy changes the score, which is why the version is pinned', () => {
    const f = allFeatures(0.6)
    const retuned = {
      weights: [
        { feature: 'FUNDING_CORRELATION', weight: 0.6 },
        { feature: 'TIMING_CORRELATION', weight: 0.1 },
        { feature: 'WALLET_AGE_SIMILARITY', weight: 0.1 },
        { feature: 'SHARED_COUNTERPARTY', weight: 0.1 },
        { feature: 'PROTOCOL_BEHAVIOR_SIMILARITY', weight: 0.1 },
        { feature: RESERVE_WEIGHT, weight: 0 },
      ],
      thresholds: THRESHOLDS,
    }
    expect(scoreFeatures(f, retuned).score).not.toBeCloseTo(scoreFeatures(f, POLICY).score)
  })
})
