/**
 * EAC role bitmaps and ENSv2 token-id arithmetic — pure, no RPC. V2 Phase 3.5.
 *
 * These guard two rules that fail SILENTLY on-chain rather than loudly, which
 * is why they are worth unit tests: a role addressed with the wrong shift hits
 * a different role, and a token id built from a raw labelhash reads a
 * registered name back as unregistered.
 */
import { describe, expect, it } from 'vitest'
import { labelhash } from 'viem'
import {
  actionsFromBitmap,
  adminRoleBit,
  ADMIN_ROLE_OFFSET,
  AGENT_REGISTRATION_ROLE_BITMAP,
  AGENT_ROLE_INDEX,
  agentRoleForAction,
  ALL_AGENT_ROLES,
  combineRoles,
  hasAllRoles,
  MAX_REGULAR_ROLES,
  REGISTRATION_ROLE_BITMAP,
  roleBit,
  withoutRoles,
} from '../src/ens/eac-roles.js'
import {
  agentFqdn,
  canonicalTokenId,
  isValidAgentLabel,
  tokenIdVersion,
  withTokenIdVersion,
} from '../src/ens/ens-names.js'

describe('role bitmaps', () => {
  it('places each role on a 4-bit nybble, not a single bit', () => {
    // The contract stores a 0-15 holder count per role, so a role occupies a
    // nybble. `1 << index` would address a different role for every index > 0.
    expect(roleBit(0)).toBe(1n)
    expect(roleBit(1)).toBe(0x10n)
    expect(roleBit(2)).toBe(0x100n)
    expect(roleBit(8)).toBe(0x100000000n)
  })

  it('rejects an out-of-range role index', () => {
    expect(() => roleBit(-1)).toThrow(RangeError)
    expect(() => roleBit(MAX_REGULAR_ROLES)).toThrow(RangeError)
    expect(() => roleBit(1.5)).toThrow(RangeError)
  })

  it('puts admin roles in the upper half', () => {
    expect(adminRoleBit(0)).toBe(1n << ADMIN_ROLE_OFFSET)
    expect(adminRoleBit(3)).toBe(roleBit(3) << ADMIN_ROLE_OFFSET)
    // An admin bit must never collide with any regular role.
    for (let i = 0; i < MAX_REGULAR_ROLES; i++) {
      expect(adminRoleBit(i) & ((1n << ADMIN_ROLE_OFFSET) - 1n)).toBe(0n)
    }
  })

  it('combines and removes roles', () => {
    const both = combineRoles(roleBit(0), roleBit(1))
    expect(hasAllRoles(both, roleBit(0))).toBe(true)
    expect(hasAllRoles(both, roleBit(2))).toBe(false)
    expect(hasAllRoles(withoutRoles(both, roleBit(0)), roleBit(0))).toBe(false)
  })
})

describe('agent roles', () => {
  it('maps known action types and reports unknown ones as null', () => {
    expect(agentRoleForAction('TRADE')).toBe(roleBit(AGENT_ROLE_INDEX.TRADE))
    // An action with no on-chain analogue must be null, not silently role 0 —
    // that would grant CLAIM to anything unrecognised.
    expect(agentRoleForAction('TREASURY_TRANSFER')).toBeNull()
    expect(agentRoleForAction('')).toBeNull()
  })

  it('round-trips a bitmap back to action names', () => {
    const bitmap = combineRoles(agentRoleForAction('CLAIM')!, agentRoleForAction('BORROW')!)
    expect(actionsFromBitmap(bitmap).sort()).toEqual(['BORROW', 'CLAIM'])
  })

  it('never collides an agent role with a name-management role', () => {
    // Registration roles occupy 0-2; agent roles start at 8. An overlap would
    // mean granting an agent TRADE also granted it the right to repoint the
    // name's resolver.
    const registrationRegular = REGISTRATION_ROLE_BITMAP & ((1n << ADMIN_ROLE_OFFSET) - 1n)
    expect(ALL_AGENT_ROLES & registrationRegular).toBe(0n)
  })

  it('registers agents with ADMIN rights over every agent role', () => {
    // Without these the owner holds the name but cannot grant roles on it, and
    // grantRoles reverts with an opaque custom error. Learned the hard way.
    for (const index of Object.values(AGENT_ROLE_INDEX)) {
      expect(hasAllRoles(AGENT_REGISTRATION_ROLE_BITMAP, adminRoleBit(index))).toBe(true)
    }
  })

  it('does NOT give the agent the regular roles at registration', () => {
    // Registration conveys the authority to grant, not the authority itself —
    // capabilities are granted per action after policy decides, never implied
    // by merely holding a name.
    for (const index of Object.values(AGENT_ROLE_INDEX)) {
      expect(hasAllRoles(AGENT_REGISTRATION_ROLE_BITMAP, roleBit(index))).toBe(false)
    }
  })
})

describe('token ids — mutable version bits', () => {
  it('zeroes the low 32 bits of the labelhash', () => {
    // Verified against the live chain: registering xander.eth produced token id
    // 0x5402...5b9600000000 while labelhash is 0x5402...5b9633b981a4.
    const label = 'xander'
    const canonical = canonicalTokenId(label)
    const raw = BigInt(labelhash(label))
    expect(canonical).not.toBe(raw)
    expect(canonical & 0xffffffffn).toBe(0n)
    expect(canonical >> 32n).toBe(raw >> 32n)
  })

  it('matches the token id observed on-chain for xander.eth', () => {
    expect(canonicalTokenId('xander')).toBe(
      37998485260731131055651011308272259332217578741793977900439074850499333193728n,
    )
  })

  it('reads and applies a version', () => {
    const canonical = canonicalTokenId('alpha')
    expect(tokenIdVersion(canonical)).toBe(0)
    const v7 = withTokenIdVersion(canonical, 7)
    expect(tokenIdVersion(v7)).toBe(7)
    // Bumping a version must not disturb the label half.
    expect(v7 >> 32n).toBe(canonical >> 32n)
  })
})

describe('agent labels', () => {
  it('accepts ordinary labels', () => {
    expect(isValidAgentLabel('alpha')).toBe(true)
    expect(isValidAgentLabel('agent-01')).toBe(true)
  })

  it('rejects labels that invite homograph confusion or break DNS shape', () => {
    // Stricter than ENS allows, on purpose: two agents whose names look
    // identical are worse than agents with no names.
    expect(isValidAgentLabel('Alpha')).toBe(false)
    expect(isValidAgentLabel('ag')).toBe(false)
    expect(isValidAgentLabel('-alpha')).toBe(false)
    expect(isValidAgentLabel('alpha-')).toBe(false)
    expect(isValidAgentLabel('al pha')).toBe(false)
    expect(isValidAgentLabel('agent.one')).toBe(false)
    expect(isValidAgentLabel('🤖')).toBe(false)
  })

  it('builds a lowercase fqdn', () => {
    expect(agentFqdn('Alpha', 'Xander')).toBe('alpha.xander.eth')
  })
})
