/**
 * World integration units — Backend-Sylesh.md Phases 16-19.
 *
 * No network and no database: RP signing, signal derivation, binding checks and
 * nullifier conversion are all pure, and they are the parts that must be right
 * before a single real proof is ever exchanged.
 */
import { describe, expect, it } from 'vitest'
import { generateRpSignature } from '../src/world/rp-signature.js'
import {
  assertSignalBinding,
  buildSignal,
  expectedSignalHash,
  WalletBindingError,
} from '../src/world/wallet-binding.js'
import { nullifierToDecimalString, ReplayError } from '../src/world/replay-protection.js'
import {
  buildIdKitRequestConfig,
  buildWorldAction,
  SELFIE_CHECK_PRESET,
} from '../src/world/idkit-request-config.js'

const WALLET_A = '0x0000000000000000000000000000000000000c1e'
const WALLET_B = '0x00000000000000000000000000000000000c1057'

describe('Phase 16 — RP signature', () => {
  it('returns sig, nonce, created_at and expires_at for a valid action', () => {
    const sig = generateRpSignature('claim-campaign-1')

    // The acceptance test names snake_case; IDKit's own type is camelCase.
    // Both are returned so neither client has to remap.
    expect(sig).toHaveProperty('sig')
    expect(sig).toHaveProperty('nonce')
    expect(sig).toHaveProperty('created_at')
    expect(sig).toHaveProperty('expires_at')
    expect(sig.created_at).toBe(sig.createdAt)
    expect(sig.expires_at).toBe(sig.expiresAt)
  })

  it('signs, rather than returning a placeholder', () => {
    const sig = generateRpSignature('claim-campaign-1')
    expect(typeof sig.sig).toBe('string')
    expect(sig.sig.length).toBeGreaterThan(64)
    expect(sig.expiresAt).toBeGreaterThan(sig.createdAt)
  })

  it('produces a fresh nonce per call — a reused nonce would be replayable', () => {
    const a = generateRpSignature('claim-campaign-1')
    const b = generateRpSignature('claim-campaign-1')
    expect(a.nonce).not.toBe(b.nonce)
  })
})

describe('Phase 17 — IDKit request contract', () => {
  it('scopes the action to the campaign', () => {
    expect(buildWorldAction('airdrop-2026')).toBe('claim-airdrop-2026')
  })

  it('requests the Selfie Check preset, not the generic proof-of-human one', () => {
    expect(SELFIE_CHECK_PRESET).toBe('selfieCheckLegacy')
  })

  it('hands the client a config the real IDKit SDK can build a request from', () => {
    const config = buildIdKitRequestConfig({
      wallet: WALLET_A,
      claimId: 'claim-1',
      campaignId: 'airdrop-2026',
    })
    expect(config.action).toBe('claim-airdrop-2026')
    expect(config.preset).toBe('selfieCheckLegacy')
    expect(config.signal).toBe(buildSignal(WALLET_A, 'claim-1'))
    // Required top-level fields on the installed @worldcoin/idkit-core
    // IDKitRequestConfig — app_id is a separate field from rp_id, and
    // allow_legacy_proofs is required (non-optional) because selfieCheckLegacy
    // only returns World ID 3.0 proofs. Missing either means the client cannot
    // construct a request at all.
    expect(config.app_id).toMatch(/^app_/)
    expect(config.rp_id).toBeTruthy()
    expect(config.allow_legacy_proofs).toBe(true)
  })
})

describe('Phase 19 — wallet + claim binding', () => {
  it('binds the claim as well as the wallet', () => {
    // Binding the wallet alone would let one wallet reuse a proof across its
    // own claims on different campaigns.
    expect(buildSignal(WALLET_A, 'claim-1')).not.toBe(buildSignal(WALLET_A, 'claim-2'))
    expect(buildSignal(WALLET_A, 'claim-1')).not.toBe(buildSignal(WALLET_B, 'claim-1'))
  })

  it('is case-insensitive on the address', () => {
    expect(buildSignal(WALLET_A.toUpperCase().replace('0X', '0x'), 'c')).toBe(
      buildSignal(WALLET_A, 'c'),
    )
  })

  it('accepts a proof whose signal_hash matches this wallet and claim', () => {
    const hash = expectedSignalHash(WALLET_A, 'claim-1')
    expect(() =>
      assertSignalBinding({ wallet: WALLET_A, claimId: 'claim-1', signalHash: hash }),
    ).not.toThrow()
  })

  it('REJECTS a valid proof for wallet A replayed against wallet B — acceptance test', () => {
    const hashForA = expectedSignalHash(WALLET_A, 'claim-1')
    expect(() =>
      assertSignalBinding({ wallet: WALLET_B, claimId: 'claim-1', signalHash: hashForA }),
    ).toThrow(WalletBindingError)
  })

  it('rejects a proof lifted onto a different claim by the same wallet', () => {
    const hashForClaim1 = expectedSignalHash(WALLET_A, 'claim-1')
    expect(() =>
      assertSignalBinding({ wallet: WALLET_A, claimId: 'claim-2', signalHash: hashForClaim1 }),
    ).toThrow(WalletBindingError)
  })

  it('compares field elements by value, so zero-padding differences still match', () => {
    const hash = expectedSignalHash(WALLET_A, 'claim-1')
    const unpadded = `0x${hash.replace(/^0x0*/, '')}`
    expect(() =>
      assertSignalBinding({ wallet: WALLET_A, claimId: 'claim-1', signalHash: unpadded }),
    ).not.toThrow()
  })
})

describe('Phase 19 — nullifier conversion', () => {
  it('converts a 0x-hex nullifier to a decimal string', () => {
    expect(nullifierToDecimalString('0xff')).toBe('255')
    expect(nullifierToDecimalString('0x0')).toBe('0')
  })

  it('normalizes encodings of the same nullifier to one value', () => {
    // If these produced different stored values the same proof could be
    // replayed simply by re-encoding it.
    expect(nullifierToDecimalString('0x0a')).toBe(nullifierToDecimalString('0xA'))
  })

  it('handles a full 256-bit nullifier without precision loss', () => {
    const max = `0x${'f'.repeat(64)}`
    expect(nullifierToDecimalString(max)).toBe((2n ** 256n - 1n).toString(10))
  })

  it('rejects a non-integer nullifier rather than storing garbage', () => {
    expect(() => nullifierToDecimalString('not-a-number')).toThrow(ReplayError)
  })
})
