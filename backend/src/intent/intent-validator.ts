/**
 * Intent hashing and validation — pure functions, Xander V2 spec section 5.7.
 *
 * No database, no network, no clock: every time-dependent function takes `now`
 * explicitly so tests pin it rather than racing it. Same discipline as the
 * risk feature extractors.
 */
import { createHash } from 'node:crypto'
import { normalizeAddress } from '../actor/actor-types.js'
import type { AuthorizationResult, IntentParameters } from './intent-types.js'

/**
 * Canonical JSON: keys sorted, no incidental whitespace.
 *
 * Two intents that mean the same thing must hash the same regardless of the
 * key order a client happened to serialise. `JSON.stringify` preserves
 * insertion order, so hashing its output directly would make the digest depend
 * on how the request was typed — which would silently defeat both the
 * idempotency check and the tamper check the hash exists for.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)

  return `{${entries.join(',')}}`
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * Deterministic digest of what an intent actually asks for.
 *
 * Addresses are lowercased first so a checksummed and an unchecksummed spelling
 * of the same target do not produce two different hashes.
 */
export function hashIntentParameters(params: IntentParameters): string {
  return sha256(
    canonicalJson({
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      actionType: params.actionType,
      chainId: params.chainId,
      targetAddress: params.targetAddress === null ? null : normalizeAddress(params.targetAddress),
      amount: params.amount,
      asset: params.asset,
      protocol: params.protocol,
    }),
  )
}

/**
 * Pins the evidence an authorization rested on.
 *
 * Sorted before hashing because evidence-id ordering is an artefact of query
 * execution, not a fact about the decision — an unsorted hash would report
 * tampering every time Postgres returned the same rows in a different order.
 */
export function hashEvidenceSnapshot(evidenceIds: readonly string[]): string {
  return sha256(canonicalJson([...evidenceIds].sort()))
}

/** Pins the decision payload itself, so a stored decision cannot be edited unnoticed. */
export function hashDecisionPayload(payload: {
  result: AuthorizationResult
  reasonCode: string
  policyVersion: string
  riskScore: number
  parametersHash: string
}): string {
  return sha256(canonicalJson(payload))
}

/** An intent is expired once `expiresAt` is in the past. Boundary is inclusive of "still valid". */
export function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime()
}

/** Default expiry for an intent that did not request one. */
export function defaultExpiry(now: Date, ttlSeconds: number): Date {
  return new Date(now.getTime() + ttlSeconds * 1000)
}
