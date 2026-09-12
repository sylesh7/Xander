/**
 * Actor domain types — Xander V2 spec sections 5.1 and 5.2.
 *
 * Pure. No database, no network. The string unions here are the exact values
 * the corresponding Prisma columns hold; Prisma stores them as `String` rather
 * than a native enum so a new actor kind is a code change in one file instead
 * of a migration that locks the table.
 */

/**
 * What kind of thing is acting.
 *
 * Invariant 3.4 — these do not collapse into each other:
 *   wallet != human, wallet != agent, agent != human,
 *   unique wallet != unique human, risk score != proof of identity.
 */
export const ACTOR_TYPES = ['HUMAN', 'WALLET', 'AGENT', 'ORGANIZATION'] as const
export type ActorType = (typeof ACTOR_TYPES)[number]

export const ACTOR_STATUSES = ['ACTIVE', 'RESTRICTED', 'FROZEN', 'REVOKED'] as const
export type ActorStatus = (typeof ACTOR_STATUSES)[number]

/**
 * Evidence sources an actor can be linked to.
 *
 * `ENS` is beyond the spec's section 5.2 list and is here deliberately, before
 * the first migration, so an ENS name is a first-class identity rather than an
 * `ALTER TABLE` later. It is the natural carrier for the agent-as-namespace
 * model — an agent as a subname whose PARENT is its human operator makes the
 * `AGENT_BACKED_BY` relationship an on-chain fact instead of a database claim.
 * Nothing resolves ENS yet; Phase 5 does, against verified contracts.
 */
export const IDENTITY_KINDS = ['WALLET', 'WORLD', 'ERC8004', 'EAS', 'ENS', 'OTHER'] as const
export type IdentityKind = (typeof IDENTITY_KINDS)[number]

/**
 * Whether the link has actually been proven.
 *
 * Observing that an address appears on-chain is not evidence anyone controls
 * it, so a wallet identity is born UNVERIFIED and only a real assurance flow
 * may promote it (invariant 3.3). Phase 1 never writes VERIFIED.
 */
export const IDENTITY_STATUSES = ['UNVERIFIED', 'VERIFIED', 'REVOKED'] as const
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number]

/** Recorded on every identity so a link's origin is never anonymous. */
export const IDENTITY_SOURCE_WALLET_ADDRESS = 'wallet-address' as const

/**
 * EVM addresses are case-insensitive; the mixed-case form is only a checksum.
 * Every read and write normalises through here so `0xAB…` and `0xab…` can never
 * resolve to two different Actors.
 */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase()
}

/** Shape of a 0x-prefixed 20-byte address. Validation, not checksum verification. */
export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS_PATTERN.test(value.trim())
}
