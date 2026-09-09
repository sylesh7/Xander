/**
 * Wallet + claim binding — Backend-Sylesh.md Phase 19.
 *
 * First-class architecture, not a security appendix: a Sybil firewall whose own
 * verification step can be lifted from one claim to another is not a Sybil
 * firewall.
 *
 * THE SIGNAL BINDS BOTH THE WALLET AND THE CLAIM. Phase 17 of the spec says to
 * set the signal to the wallet address; this binds `wallet:claimId` instead,
 * which is strictly stronger and is what the product README describes. Binding
 * the wallet alone leaves a real hole: a flagged wallet that legitimately passes
 * Selfie Check for claim A could replay that same proof against its own later
 * claim B on a different campaign, because the signal — and therefore the
 * nullifier's action scope — would be identical. Including the claim id closes
 * that without weakening the wallet binding at all.
 */
import { hashSignal } from '@worldcoin/idkit-core/hashing'

export class WalletBindingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WalletBindingError'
  }
}

/**
 * The exact string the client must pass to IDKit as `signal`.
 *
 * The frontend and this module must agree byte for byte — a mismatch here
 * surfaces as "every proof is rejected", so the derivation lives in one place
 * and the API contract documents it rather than restating it.
 */
export function buildSignal(wallet: string, claimId: string): string {
  return `${wallet.toLowerCase()}:${claimId}`
}

/** What `signal_hash` must equal for a proof to belong to this wallet's claim. */
export function expectedSignalHash(wallet: string, claimId: string): string {
  return hashSignal(buildSignal(wallet, claimId))
}

/**
 * Compares two field elements by value, not by string.
 *
 * Hex encodings of the same field element can differ in zero padding and case
 * depending on which side produced them. A string compare would reject valid
 * proofs intermittently, which is the worst possible failure mode: it looks
 * like flaky infrastructure rather than a bug.
 */
function sameFieldElement(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

/**
 * Rejects a proof presented against the wrong wallet or the wrong claim.
 *
 * The Developer Portal confirms only that a proof is cryptographically valid.
 * Checking that it was issued for THIS wallet and THIS claim is documented as
 * the backend's job, and nothing upstream does it for us.
 */
export function assertSignalBinding(params: {
  wallet: string
  claimId: string
  signalHash: string
}): void {
  const expected = expectedSignalHash(params.wallet, params.claimId)

  if (!sameFieldElement(expected, params.signalHash)) {
    throw new WalletBindingError(
      'Proof signal_hash does not match this wallet and claim. A valid proof issued for a ' +
        'different wallet or claim cannot be redeemed here.',
    )
  }
}
