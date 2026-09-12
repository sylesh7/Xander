/**
 * ENSv2 name and token-id arithmetic — Xander V2 Phase 3.5.
 *
 * Pure. No chain, no database.
 */
import { labelhash, namehash } from 'viem'

/**
 * Width of the version field in the low bits of a token id.
 *
 * MUTABLE TOKEN IDS, and the single most expensive thing to get wrong here.
 * An ENSv2 token id is NOT the labelhash. It is the labelhash with its low 32
 * bits replaced by a version counter, which the registry increments when a
 * permission change would otherwise leak authority to a stale id.
 *
 * Verified on-chain 2026-09-12 by registering xander.eth and reading the
 * TransferSingle log:
 *
 *   labelhash("xander") = 0x5402...5b9633b981a4
 *   actual token id     = 0x5402...5b9600000000
 *
 * Getting this wrong is silent, not loud: `ownerOf(labelhash)` returns the zero
 * address and `getState(labelhash)` returns zeroes, so a freshly registered
 * name reads back as unregistered and every ownership check quietly fails open.
 * That is exactly what happened on the first run of the registration script.
 */
export const TOKEN_ID_VERSION_BITS = 32n

const VERSION_MASK = (1n << TOKEN_ID_VERSION_BITS) - 1n

/**
 * The canonical (version-zero) token id for a label.
 *
 * `getState` accepts this form. For `ownerOf` prefer the versioned id the
 * registry currently holds — `getState` returns it — because a bumped version
 * makes the canonical id stale.
 */
export function canonicalTokenId(label: string): bigint {
  return (BigInt(labelhash(label)) >> TOKEN_ID_VERSION_BITS) << TOKEN_ID_VERSION_BITS
}

/** The version encoded in a token id. */
export function tokenIdVersion(tokenId: bigint): number {
  return Number(tokenId & VERSION_MASK)
}

/** Applies a version to a canonical id. */
export function withTokenIdVersion(canonical: bigint, version: number): bigint {
  return ((canonical >> TOKEN_ID_VERSION_BITS) << TOKEN_ID_VERSION_BITS) | BigInt(version)
}

/**
 * EAC resource id for a name within its registry.
 *
 * Registries scope roles by labelhash-derived resource, so the canonical token
 * id is what a grant is addressed to.
 */
export function resourceForLabel(label: string): bigint {
  return canonicalTokenId(label)
}

/** `alpha` + `xander` -> `alpha.xander.eth`. Lowercased; ENS names are case-insensitive. */
export function agentFqdn(agentLabel: string, parentLabel: string): string {
  return `${agentLabel}.${parentLabel}.eth`.toLowerCase()
}

/** Full namehash of a name, for resolver-scoped operations. */
export function nameHash(fqdn: string): `0x${string}` {
  return namehash(fqdn.toLowerCase())
}

/**
 * Labels usable as an agent subname.
 *
 * Deliberately stricter than ENS itself allows: lowercase a-z, 0-9 and hyphen,
 * 3-63 characters, no leading or trailing hyphen. Emoji and mixed scripts are
 * valid ENS but invite homograph confusion between two agents whose names look
 * identical, and an agent identity nobody can visually distinguish is worse
 * than no name at all.
 */
export const AGENT_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/

export function isValidAgentLabel(label: string): boolean {
  return AGENT_LABEL_PATTERN.test(label)
}
