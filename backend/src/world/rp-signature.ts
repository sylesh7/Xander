/**
 * RP request signing — Backend-Sylesh.md Phase 16.
 *
 * The step that is easiest to miss entirely: before a client can even OPEN
 * IDKit, the backend has to sign the request. Miss it and IDKit simply does not
 * open — there is no error pointing at a missing signature.
 *
 * `signingKeyHex` never leaves this process. That is the entire reason this is
 * a backend route instead of a client-side call, and it is IDKit's own
 * explicit instruction.
 */
import { signRequest, type RpSignature } from '@worldcoin/idkit-core/signing'
import { requireWorldRpSigningKey } from '../config/env.js'

/**
 * The response shape the frontend receives.
 *
 * Both casings are returned deliberately. Phase 16's acceptance test names
 * `{ sig, nonce, created_at, expires_at }` while the SDK's own `RpSignature`
 * type — and therefore every client that passes the result straight back into
 * IDKit — uses `createdAt`/`expiresAt`. Emitting both means neither side has to
 * remap fields, and remapping is where this flow usually breaks.
 */
export interface RpSignatureResponse extends RpSignature {
  created_at: number
  expires_at: number
}

export function generateRpSignature(action: string): RpSignatureResponse {
  const signature = signRequest({
    signingKeyHex: requireWorldRpSigningKey(),
    action,
  })

  return {
    ...signature,
    created_at: signature.createdAt,
    expires_at: signature.expiresAt,
  }
}
