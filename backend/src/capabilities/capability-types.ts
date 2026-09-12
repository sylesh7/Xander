/**
 * Capability types and attenuation — Xander V2 spec sections 5.8 and 7.
 *
 * Pure. No database, no network, no clock (times arrive as arguments).
 */

export const CAPABILITY_TYPES = ['GRANT', 'ATTENUATED_GRANT'] as const
export type CapabilityType = (typeof CAPABILITY_TYPES)[number]

export const CAPABILITY_STATUSES = ['ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED'] as const
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number]

export const ASSURANCE_LEVELS = ['WORLD_ONLY', 'WORLD_PLUS_ACTIVE'] as const
export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number]

/** The bounds a capability carries. Amounts are base-unit strings, never floats. */
export interface CapabilityLimits {
  amountLimit: string | null
  frequencyLimit: number | null
  frequencyWindowSeconds: number | null
  allowedTargets: string[]
  expiresAt: Date | null
}

/** Why a capability could not be exercised. */
export const CAPABILITY_DENIALS = {
  NOT_FOUND: 'NO_MATCHING_CAPABILITY',
  EXPIRED: 'CAPABILITY_EXPIRED',
  REVOKED: 'CAPABILITY_REVOKED',
  SUSPENDED: 'CAPABILITY_SUSPENDED',
  AMOUNT_EXCEEDED: 'AMOUNT_EXCEEDS_LIMIT',
  FREQUENCY_EXCEEDED: 'FREQUENCY_LIMIT_REACHED',
  TARGET_NOT_ALLOWED: 'TARGET_NOT_ALLOWED',
  ASSURANCE_EXPIRED: 'ASSURANCE_LEASE_EXPIRED',
} as const
export type CapabilityDenial = (typeof CAPABILITY_DENIALS)[keyof typeof CAPABILITY_DENIALS]

/**
 * Parses a base-unit amount string to BigInt.
 *
 * Returns null for anything that is not a non-negative integer. A caller must
 * treat null as "unparseable", never as zero — silently reading a malformed
 * amount as 0 would slip it under every ceiling.
 */
export function parseAmount(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || !/^\d+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

/**
 * Attenuation — spec section 7.2.
 *
 * `requested 5000, ceiling 500 -> granted 500`. This is the function that makes
 * LIMIT meaningful rather than a relabelled BLOCK: the actor gets a real, usable
 * grant, just a smaller one than asked for.
 *
 * An unparseable requested amount attenuates to the ceiling rather than
 * throwing, because the ceiling is the safe answer either way.
 */
export function attenuateAmount(requested: string | null, ceiling: string | null): string | null {
  if (ceiling === null) return requested
  const ceilingValue = parseAmount(ceiling)
  if (ceilingValue === null) return requested

  const requestedValue = parseAmount(requested)
  if (requestedValue === null) return ceiling

  return requestedValue <= ceilingValue ? requested : ceiling
}

/** True when the requested amount fits inside the ceiling. */
export function withinAmountLimit(requested: string | null, ceiling: string | null): boolean {
  if (ceiling === null) return true
  const ceilingValue = parseAmount(ceiling)
  if (ceilingValue === null) return true
  const requestedValue = parseAmount(requested)
  // An amount we cannot parse is not an amount we can clear.
  if (requestedValue === null) return requested === null
  return requestedValue <= ceilingValue
}

/** True when the target is permitted. An empty allow-list means unrestricted. */
export function targetAllowed(target: string | null, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true
  if (target === null) return false
  return allowed.includes(target.toLowerCase())
}

/** A capability is live only if ACTIVE and not past its expiry. */
export function isCapabilityLive(
  capability: { status: string; expiresAt: Date | null },
  now: Date,
): boolean {
  if (capability.status !== 'ACTIVE') return false
  if (capability.expiresAt === null) return true
  return capability.expiresAt.getTime() > now.getTime()
}

/** A lease is live only if ACTIVE and not past its expiry. Same rule, stated once. */
export function isLeaseLive(
  lease: { status: string; expiresAt: Date } | null,
  now: Date,
): boolean {
  if (!lease) return false
  if (lease.status !== 'ACTIVE') return false
  return lease.expiresAt.getTime() > now.getTime()
}

/**
 * How long an assurance lease should last for a given trust band.
 *
 * Rotation cadence is a function of trust, not a constant: a verified,
 * established actor can hold assurance far longer than one we are unsure about.
 * Returning 0 means "no lease may be issued at this band".
 */
export function leaseTtlForBand(band: string, ttls: Record<string, number>): number {
  return ttls[band] ?? 0
}
