/**
 * x402 v2 wire format — pure, no network. V2 Phase 9.
 *
 * These guard the checks that stand between Xander and losing money: a payload
 * that is perfectly signed but pays somebody else, underpays, or replays an old
 * authorization must be rejected BEFORE the facilitator is ever asked to settle
 * it. The facilitator validates the signature; only we can validate that the
 * client answered the question we actually asked.
 */
import { describe, expect, it } from 'vitest'
import {
  authorizationIsCurrent,
  caip2ForChainId,
  chainIdFromCaip2,
  decodeHeader,
  encodeHeader,
  paymentMatchesRequirements,
  X402_HEADERS,
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequirements,
} from '../src/x402/x402-types.js'

const REQUIREMENTS: PaymentRequirements = {
  scheme: 'exact',
  network: 'eip155:84532',
  amount: '1000',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  payTo: '0x6475a1E1360D6D9DB583B16D83c7dF6745FFb959',
  maxTimeoutSeconds: 60,
  extra: { name: 'USDC', version: '2' },
}

const payload = (over: Partial<PaymentPayload> = {}, auth: Record<string, string> = {}): PaymentPayload => ({
  x402Version: X402_VERSION,
  accepted: REQUIREMENTS,
  payload: {
    signature: '0xdeadbeef',
    authorization: {
      from: '0xCD8F91DC7929E973DDc071838904434297aB4673',
      to: REQUIREMENTS.payTo,
      value: '1000',
      validAfter: '1000',
      validBefore: '9999999999',
      nonce: `0x${'ab'.repeat(32)}`,
      ...auth,
    },
  },
  ...over,
})

describe('the v2 header names are the ones the live facilitator speaks', () => {
  it('uses PAYMENT-SIGNATURE, not v1’s X-PAYMENT', () => {
    // v1 and v2 are not wire-compatible. Getting this wrong means every request
    // silently looks unpaid.
    expect(X402_HEADERS.SIGNATURE).toBe('PAYMENT-SIGNATURE')
    expect(X402_HEADERS.REQUIRED).toBe('PAYMENT-REQUIRED')
    expect(X402_HEADERS.RESPONSE).toBe('PAYMENT-RESPONSE')
    expect(X402_VERSION).toBe(2)
  })
})

describe('header encoding', () => {
  it('round-trips base64 JSON', () => {
    const value = { x402Version: 2, accepts: [REQUIREMENTS] }
    expect(decodeHeader(encodeHeader(value))).toEqual(value)
  })

  it('RETURNS NULL rather than throwing on garbage', () => {
    // A malformed header is a client error to report, not an outage. If this
    // threw, every bad header would be a 500.
    expect(decodeHeader('not-base64!!')).toBeNull()
    expect(decodeHeader(Buffer.from('not json').toString('base64'))).toBeNull()
    expect(decodeHeader(undefined)).toBeNull()
    expect(decodeHeader('')).toBeNull()
  })

  it('returns null for JSON that is not an object', () => {
    expect(decodeHeader(Buffer.from('42').toString('base64'))).toBeNull()
    expect(decodeHeader(Buffer.from('null').toString('base64'))).toBeNull()
  })
})

describe('CAIP-2 networks', () => {
  it('reads the chain id out of an eip155 network', () => {
    expect(chainIdFromCaip2('eip155:84532')).toBe(84_532)
    expect(caip2ForChainId(84_532)).toBe('eip155:84532')
  })

  it('refuses a non-EVM or malformed network rather than guessing', () => {
    expect(chainIdFromCaip2('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')).toBeNull()
    expect(chainIdFromCaip2('base-sepolia')).toBeNull()
    expect(chainIdFromCaip2('eip155:')).toBeNull()
    expect(chainIdFromCaip2('eip155:0')).toBeNull()
  })
})

describe('a payload must answer the question we asked', () => {
  it('accepts a correct payment', () => {
    expect(paymentMatchesRequirements(payload(), REQUIREMENTS)).toEqual({ ok: true })
  })

  it('REJECTS A PAYMENT REDIRECTED TO SOMEONE ELSE', () => {
    // The dangerous one. Without this a client could settle a perfectly valid
    // transfer that pays itself and still be served.
    const attacker = '0x1111111111111111111111111111111111111111'
    const redirected = payload({ accepted: { ...REQUIREMENTS, payTo: attacker } })
    const result = paymentMatchesRequirements(redirected, REQUIREMENTS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('payTo')
  })

  it('rejects an authorization whose `to` differs from the quoted payTo', () => {
    // Even when `accepted` looks right, the SIGNED authorization is what moves
    // the money — so it is checked separately.
    const sneaky = payload({}, { to: '0x1111111111111111111111111111111111111111' })
    const result = paymentMatchesRequirements(sneaky, REQUIREMENTS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('wrong recipient')
  })

  it('REJECTS UNDERPAYMENT', () => {
    const cheap = payload({}, { value: '999' })
    const result = paymentMatchesRequirements(cheap, REQUIREMENTS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('below the required')
  })

  it('allows overpayment, which is the client’s business and not ours', () => {
    expect(paymentMatchesRequirements(payload({}, { value: '5000' }), REQUIREMENTS).ok).toBe(true)
  })

  it('compares amounts as BigInt, beyond float precision', () => {
    const huge = { ...REQUIREMENTS, amount: '100000000000000000000000001' }
    const justUnder = payload({ accepted: huge }, { value: '100000000000000000000000000' })
    // A float compare would call these equal and let the underpayment through.
    expect(paymentMatchesRequirements(justUnder, huge).ok).toBe(false)
  })

  it('rejects a mismatched scheme, network or asset', () => {
    expect(paymentMatchesRequirements(payload({ accepted: { ...REQUIREMENTS, scheme: 'upto' } }), REQUIREMENTS).ok).toBe(false)
    expect(paymentMatchesRequirements(payload({ accepted: { ...REQUIREMENTS, network: 'eip155:8453' } }), REQUIREMENTS).ok).toBe(false)
    expect(paymentMatchesRequirements(payload({ accepted: { ...REQUIREMENTS, asset: '0xdead' } }), REQUIREMENTS).ok).toBe(false)
  })

  it('is case-insensitive about addresses, which are checksummed inconsistently', () => {
    const lower = payload({
      accepted: { ...REQUIREMENTS, payTo: REQUIREMENTS.payTo.toLowerCase() },
    }, { to: REQUIREMENTS.payTo.toLowerCase() })
    expect(paymentMatchesRequirements(lower, REQUIREMENTS).ok).toBe(true)
  })

  it('rejects a v1 payload outright', () => {
    const v1 = payload({ x402Version: 1 })
    const result = paymentMatchesRequirements(v1, REQUIREMENTS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('x402Version')
  })

  it('rejects a malformed nonce', () => {
    expect(paymentMatchesRequirements(payload({}, { nonce: '0xabc' }), REQUIREMENTS).ok).toBe(false)
  })

  it('rejects an unparseable amount rather than reading it as zero', () => {
    const result = paymentMatchesRequirements(payload({}, { value: 'lots' }), REQUIREMENTS)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('unparseable')
  })
})

describe('the authorization validity window', () => {
  const auth = {
    from: '0xCD8F91DC7929E973DDc071838904434297aB4673',
    to: REQUIREMENTS.payTo,
    value: '1000',
    validAfter: '1000',
    validBefore: '2000',
    nonce: `0x${'ab'.repeat(32)}`,
  }

  it('accepts a time inside the window', () => {
    expect(authorizationIsCurrent(auth, new Date(1500 * 1000))).toEqual({ ok: true })
  })

  it('rejects an expired authorization', () => {
    const result = authorizationIsCurrent(auth, new Date(2500 * 1000))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('expired')
  })

  it('rejects one that is not yet valid', () => {
    const result = authorizationIsCurrent(auth, new Date(500 * 1000))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('not yet valid')
  })

  it('treats validBefore as exclusive', () => {
    // The token contract requires now < validBefore, so the boundary second is
    // already too late. Off by one here is a revert at settlement.
    expect(authorizationIsCurrent(auth, new Date(2000 * 1000)).ok).toBe(false)
    expect(authorizationIsCurrent(auth, new Date(1999 * 1000)).ok).toBe(true)
  })
})
