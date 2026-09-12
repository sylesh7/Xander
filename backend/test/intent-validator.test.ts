/**
 * Intent hashing and expiry — pure, no infrastructure. V2 Phase 1.
 */
import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  defaultExpiry,
  hashDecisionPayload,
  hashEvidenceSnapshot,
  hashIntentParameters,
  isExpired,
} from '../src/intent/intent-validator.js'
import type { IntentParameters } from '../src/intent/intent-types.js'

const base: IntentParameters = {
  resourceType: 'campaign',
  resourceId: 'demo-campaign',
  actionType: 'CLAIM',
  chainId: 8453,
  targetAddress: '0x00000000000000000000000000000000000000aa',
  amount: '1000000',
  asset: 'USDC',
  protocol: 'seed-protocol',
}

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })

  it('does not confuse nested structures with flat ones', () => {
    expect(canonicalJson({ a: { b: 1 } })).not.toBe(canonicalJson({ 'a.b': 1 }))
  })

  it('drops undefined but keeps null, which mean different things', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(canonicalJson({ a: 1, b: null })).toBe('{"a":1,"b":null}')
  })

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })
})

describe('hashIntentParameters', () => {
  it('is deterministic', () => {
    expect(hashIntentParameters(base)).toBe(hashIntentParameters({ ...base }))
  })

  it('treats a checksummed address as the same intent', () => {
    // Address case is only a checksum, not identity. Two spellings of one
    // target must not produce two different hashes.
    const upper = { ...base, targetAddress: '0x00000000000000000000000000000000000000AA' }
    expect(hashIntentParameters(upper)).toBe(hashIntentParameters(base))
  })

  it('changes when any semantic field changes', () => {
    const fields: Array<Partial<IntentParameters>> = [
      { amount: '1000001' },
      { actionType: 'TRANSFER' },
      { chainId: 1 },
      { asset: 'DAI' },
      { resourceId: 'other-campaign' },
      { resourceType: 'treasury' },
      { protocol: 'aave-v3' },
      { targetAddress: '0x00000000000000000000000000000000000000bb' },
    ]
    const original = hashIntentParameters(base)
    for (const patch of fields) {
      expect(hashIntentParameters({ ...base, ...patch })).not.toBe(original)
    }
  })

  it('distinguishes a null field from an absent-looking empty string', () => {
    expect(hashIntentParameters({ ...base, asset: null })).not.toBe(
      hashIntentParameters({ ...base, asset: '' }),
    )
  })
})

describe('hashEvidenceSnapshot', () => {
  it('ignores ordering, which is a query artefact rather than a fact', () => {
    expect(hashEvidenceSnapshot(['b', 'a'])).toBe(hashEvidenceSnapshot(['a', 'b']))
  })

  it('changes when the evidence set changes', () => {
    expect(hashEvidenceSnapshot(['a'])).not.toBe(hashEvidenceSnapshot(['a', 'b']))
  })

  it('has a stable value for no evidence', () => {
    expect(hashEvidenceSnapshot([])).toBe(hashEvidenceSnapshot([]))
  })
})

describe('hashDecisionPayload', () => {
  const payload = {
    result: 'ALLOW' as const,
    reasonCode: 'RISK_WITHIN_ALLOW_BAND',
    policyVersion: '1.0',
    riskScore: 0.12,
    parametersHash: 'abc',
  }

  it('changes if the result is edited', () => {
    expect(hashDecisionPayload({ ...payload, result: 'BLOCK' })).not.toBe(
      hashDecisionPayload(payload),
    )
  })

  it('changes if the score is edited', () => {
    expect(hashDecisionPayload({ ...payload, riskScore: 0.85 })).not.toBe(
      hashDecisionPayload(payload),
    )
  })
})

describe('expiry', () => {
  const now = new Date('2026-01-01T00:00:00Z')

  it('is not expired before the boundary', () => {
    expect(isExpired(new Date(now.getTime() + 1000), now)).toBe(false)
  })

  it('is expired exactly at the boundary', () => {
    // Inclusive: an intent valid "until" T is not valid AT T.
    expect(isExpired(now, now)).toBe(true)
  })

  it('is expired after the boundary', () => {
    expect(isExpired(new Date(now.getTime() - 1), now)).toBe(true)
  })

  it('builds a default expiry from the configured ttl', () => {
    expect(defaultExpiry(now, 900).toISOString()).toBe('2026-01-01T00:15:00.000Z')
  })
})
