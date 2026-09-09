/**
 * World backend verification — Backend-Sylesh.md Phase 18.
 *
 * NEVER VERIFY CLIENT-SIDE. That is IDKit's own explicit warning and a real
 * security requirement: a client that verifies its own proof is a client that
 * can decide it passed.
 *
 * One endpoint handles both World ID 4.0 proofs and legacy 3.0 proofs, and the
 * IDKit result is forwarded EXACTLY as received — no field remapping. Remapping
 * is the most common way this call fails, and the resulting error does not point
 * at the remapping.
 *
 * `verifyCloudProof` from `@worldcoin/minikit-js` is deliberately not used: it
 * is documented as deprecated in favour of calling this endpoint directly.
 */
import { env, requireWorldRpId } from '../config/env.js'
import { logger } from '../lib/logger.js'

/**
 * Three outcomes, not two.
 *
 * Collapsing UNAVAILABLE into REJECTED would fail a legitimate user because
 * World had a bad minute, and collapsing it into VERIFIED is the fail-open bug
 * the whole system is built to avoid. Phase 23's matrix requires a timed-out
 * verification to leave the challenge ISSUED and retryable — which is only
 * expressible if "we could not ask" is its own answer.
 */
export type VerifyOutcome =
  | { kind: 'VERIFIED'; body: Record<string, unknown> }
  | { kind: 'REJECTED'; status: number; body: unknown; reason: string }
  | { kind: 'UNAVAILABLE'; reason: string }

const isTransientStatus = (status: number): boolean => status >= 500 || status === 429

function describeError(err: unknown): string {
  if (err instanceof Error) return err.name === 'TimeoutError' ? 'verify request timed out' : err.message
  return String(err)
}

async function attemptVerify(rpId: string, idkitResponse: unknown): Promise<VerifyOutcome> {
  const url = `${env.WORLD_VERIFY_BASE_URL}/api/v4/verify/${rpId}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Forward as-is. Confirmed from the live IDKit integrate guide.
      body: JSON.stringify(idkitResponse),
      signal: AbortSignal.timeout(env.WORLD_VERIFY_TIMEOUT_MS),
    })
  } catch (err) {
    return { kind: 'UNAVAILABLE', reason: describeError(err) }
  }

  const body: unknown = await response.json().catch(() => null)

  if (response.ok) {
    return { kind: 'VERIFIED', body: (body ?? {}) as Record<string, unknown> }
  }

  if (isTransientStatus(response.status)) {
    return { kind: 'UNAVAILABLE', reason: `World responded ${response.status}` }
  }

  // A 4xx is World's considered answer that this proof is not valid. Treating
  // it as retryable would hammer the endpoint and still never succeed.
  return {
    kind: 'REJECTED',
    status: response.status,
    body,
    reason: `World rejected the proof (${response.status})`,
  }
}

/**
 * Verifies a proof, retrying only genuinely transient failures.
 *
 * The backoff is deliberately short and bounded: this runs inside an HTTP
 * request a user is waiting on, and an unanswered verification is recoverable —
 * the challenge stays ISSUED and the client can retry.
 */
export async function verifyWorldProof(params: {
  idkitResponse: unknown
  rpId?: string
}): Promise<VerifyOutcome> {
  const rpId = params.rpId ?? requireWorldRpId()

  let last: VerifyOutcome = { kind: 'UNAVAILABLE', reason: 'no attempt made' }

  for (let attempt = 1; attempt <= env.WORLD_VERIFY_MAX_ATTEMPTS; attempt++) {
    last = await attemptVerify(rpId, params.idkitResponse)
    if (last.kind !== 'UNAVAILABLE') return last

    if (attempt < env.WORLD_VERIFY_MAX_ATTEMPTS) {
      const backoffMs = 250 * 2 ** (attempt - 1)
      logger.warn(
        { attempt, backoffMs, reason: last.reason },
        'World verify unavailable — retrying with backoff',
      )
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }

  return last
}

/**
 * Pulls `nullifier` and `signal_hash` out of the proof.
 *
 * They are read from the IDKit response and, preferentially, from World's own
 * verify response when it echoes them — a value World returned after checking
 * the proof is worth more than the same value read from the payload the client
 * handed us.
 *
 * Field naming is tolerant across snake_case and camelCase because the two
 * generations of this API differ, and a missing nullifier is fatal rather than
 * skippable: replay protection (Phase 19) cannot be enforced without it, and
 * proceeding would mean accepting an unrepeatable-once proof an unlimited
 * number of times.
 */
export function extractProofFields(
  verifyBody: Record<string, unknown>,
  idkitResponse: unknown,
): { nullifier: string; signalHash: string } {
  const payload = (typeof idkitResponse === 'object' && idkitResponse !== null
    ? (idkitResponse as Record<string, unknown>)
    : {}) as Record<string, unknown>

  const pick = (...keys: string[]): string | undefined => {
    for (const source of [verifyBody, payload]) {
      for (const key of keys) {
        const value = source[key]
        if (typeof value === 'string' && value.length > 0) return value
      }
    }
    return undefined
  }

  const nullifier = pick('nullifier', 'nullifier_hash', 'nullifierHash')
  const signalHash = pick('signal_hash', 'signalHash')

  if (!nullifier) {
    throw new Error(
      'Verified proof carried no nullifier. Replay protection cannot be enforced without ' +
        'one, so the proof is not accepted (Phase 19).',
    )
  }
  if (!signalHash) {
    throw new Error(
      'Verified proof carried no signal_hash. Wallet/claim binding cannot be checked ' +
        'without it, so the proof is not accepted (Phase 19).',
    )
  }

  return { nullifier, signalHash }
}
