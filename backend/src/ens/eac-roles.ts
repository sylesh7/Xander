/**
 * Enhanced Access Control role bitmaps — Xander V2 Phase 3.5.
 *
 * Pure. No chain, no database. Bitmap arithmetic only, so it is unit-testable
 * with no RPC.
 *
 * THE MODEL, from the ENSv2 architecture docs and verified against the live
 * Sepolia contracts: a `uint256` split in half. Bits 0-127 carry 32 regular
 * roles as 4-bit nybbles; bits 128-255 carry the 32 matching ADMIN roles, where
 * the admin of role N controls who may grant or revoke role N. Up to 15 holders
 * per role, which is why each slot is a nybble rather than a bit.
 *
 * WHAT EAC CAN AND CANNOT EXPRESS — the honest boundary this whole integration
 * rests on:
 *
 *   CAN: who may act on which resource, and revocation of that authority.
 *   CANNOT: how much, how often, or for how long a role lasts.
 *
 * EAC roles are boolean. They carry no amount ceiling, no rate limit and no
 * expiry of their own (a NAME expires, a role does not). So Xander's
 * `Capability.amountLimit` and `frequencyLimit` have no on-chain counterpart
 * and stay enforced in Xander. Claiming EAC enforces them would be false, and
 * anyone reading the EAC docs would catch it.
 *
 * What ENS genuinely contributes is the half Xander could not do alone:
 * authority that exists on a public chain, revocable by a real transaction
 * rather than a database flag, under a name whose expiry is itself on-chain.
 */

/** Bits 0-127 are regular roles; 128-255 are their admins. */
export const ADMIN_ROLE_OFFSET = 128n

/** 32 regular roles, each a 4-bit nybble. */
export const MAX_REGULAR_ROLES = 32

/**
 * Builds the bitmap for one role index.
 *
 * A role occupies a NYBBLE, not a bit — `1 << (index * 4)` — because the
 * contract stores a 0-15 holder count in each slot. Using `1 << index` would
 * silently address the wrong role for every index above 0.
 */
export function roleBit(index: number): bigint {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_REGULAR_ROLES) {
    throw new RangeError(`role index must be 0..${MAX_REGULAR_ROLES - 1}, got ${index}`)
  }
  return 1n << (BigInt(index) * 4n)
}

/** The admin counterpart of a regular role. */
export function adminRoleBit(index: number): bigint {
  return roleBit(index) << ADMIN_ROLE_OFFSET
}

/** Combines role bitmaps. */
export function combineRoles(...bitmaps: bigint[]): bigint {
  return bitmaps.reduce((acc, b) => acc | b, 0n)
}

/** True when `bitmap` contains every role in `required`. */
export function hasAllRoles(bitmap: bigint, required: bigint): boolean {
  return (bitmap & required) === required
}

/** Removes roles from a bitmap. */
export function withoutRoles(bitmap: bigint, remove: bigint): bigint {
  return bitmap & ~remove
}

/**
 * Registry roles, from the ENSv2 contract-developer tutorial.
 *
 * `ROLE_REGISTRAR` (bit 0) and `ROLE_RENEW` (bit 16) are documented with their
 * positions, and the tutorial grants them at ROOT to authorise a registrar.
 * Note the tutorial writes these as `1 << 0` and `1 << 16` — raw BIT positions
 * for the root-authorisation case — so they are expressed literally here rather
 * than run through `roleBit`, which would move them.
 */
export const REGISTRY_ROLES = {
  ROLE_REGISTRAR: 1n << 0n,
  ROLE_RENEW: 1n << 16n,
} as const

/**
 * The role set a freshly registered name is given, per the tutorial's
 * REGISTRATION_ROLE_BITMAP: set-subregistry, set-resolver, their admins, and
 * transfer-admin.
 *
 * Indices are the tutorial's documented order. They are named here so a wrong
 * one is a visible constant rather than a magic number buried in a call.
 */
export const REGISTRATION_ROLE_INDEX = {
  SET_SUBREGISTRY: 0,
  SET_RESOLVER: 1,
  CAN_TRANSFER: 2,
} as const

export const REGISTRATION_ROLE_BITMAP = combineRoles(
  roleBit(REGISTRATION_ROLE_INDEX.SET_SUBREGISTRY),
  adminRoleBit(REGISTRATION_ROLE_INDEX.SET_SUBREGISTRY),
  roleBit(REGISTRATION_ROLE_INDEX.SET_RESOLVER),
  adminRoleBit(REGISTRATION_ROLE_INDEX.SET_RESOLVER),
  adminRoleBit(REGISTRATION_ROLE_INDEX.CAN_TRANSFER),
)

/**
 * Xander's own role vocabulary for an agent's subname.
 *
 * These are OUR roles on OUR registry — a registry owner defines what its roles
 * mean, and these mean "this agent is permitted this class of action". They are
 * the on-chain shadow of a Xander `Capability`: presence mirrors an active
 * grant, absence mirrors a revoked or never-granted one.
 *
 * Indices are chosen to leave 0-2 free for the registration roles above, so an
 * agent role can never collide with a name-management role on the same
 * resource.
 */
export const AGENT_ROLE_INDEX = {
  CLAIM: 8,
  TRADE: 9,
  TRANSFER: 10,
  BORROW: 11,
  API_REQUEST: 12,
  VOTE: 13,
  X402_PAYMENT: 14,
} as const

export type AgentRoleName = keyof typeof AGENT_ROLE_INDEX

/** Maps a Xander actionType onto an agent role, or null when it has no on-chain analogue. */
export function agentRoleForAction(actionType: string): bigint | null {
  const index = (AGENT_ROLE_INDEX as Record<string, number | undefined>)[actionType]
  return index === undefined ? null : roleBit(index)
}

/**
 * The bitmap an agent subname is registered with.
 *
 * Name-management roles PLUS the ADMIN counterpart of every agent role.
 *
 * The admin half is not optional and its absence is not obvious. EAC pairs each
 * role with an admin role that controls who may grant or revoke it, so holding
 * a name is NOT sufficient to grant roles on it — the caller needs the admin
 * bit for each specific role. Registering `alpha.xander.eth` without these made
 * the subsequent grantRoles revert with 0xd1a3b355, a custom error absent from
 * 4byte and from the ABI, which is a genuinely opaque way to learn the rule.
 *
 * Granting the admin bits at registration is also the least-privilege ordering:
 * the authority to hand out agent roles is scoped to this one subname's
 * resource rather than taken at ROOT, where it would apply to every name in
 * the registry.
 */
export const AGENT_REGISTRATION_ROLE_BITMAP = combineRoles(
  REGISTRATION_ROLE_BITMAP,
  ...Object.values(AGENT_ROLE_INDEX).map((i) => adminRoleBit(i)),
)

/** Every agent role — the bitmap revoked when an agent is frozen outright. */
export const ALL_AGENT_ROLES = combineRoles(
  ...Object.values(AGENT_ROLE_INDEX).map((i) => roleBit(i)),
)

/** Decodes a bitmap back into the action names it grants. Read paths and audit. */
export function actionsFromBitmap(bitmap: bigint): AgentRoleName[] {
  return (Object.keys(AGENT_ROLE_INDEX) as AgentRoleName[]).filter((name) =>
    hasAllRoles(bitmap, roleBit(AGENT_ROLE_INDEX[name])),
  )
}
