/**
 * ERC-8004 adapter — Xander V2 spec section 16, Phase 6.
 *
 * Xander CONSUMES these registries; it does not replace them (section 4.3).
 * Identity, Reputation and Validation are read as external evidence and become
 * one trust signal among seven — they influence policy, they are never the sole
 * basis for authorization (section 16.2).
 *
 * SIGNATURES CAME FROM THE DEPLOYED BYTECODE, NOT THE EIP TEXT. ERC-8004 is a
 * draft and the reference deployment has already diverged from it. Most
 * importantly, tags are `bytes32` on-chain where the EIP writes `string`:
 *
 *   EIP draft : getSummary(uint256, address[], string,  string)
 *   deployed  : getSummary(uint256, address[], bytes32, bytes32)
 *
 * Calling the documented signature reverts. Every selector below was confirmed
 * present in the deployed contract before it was written down, and the three
 * registries were cross-checked against each other — `ReputationRegistry
 * .getIdentityRegistry()` returns exactly the configured IdentityRegistry,
 * which is what proves they are one matched deployment rather than three
 * addresses that happen to exist.
 */
import { type Address } from 'viem'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { publicClient } from '../ens/ens-client.js'

export const erc8004Addresses = {
  identity: env.ERC8004_IDENTITY_REGISTRY as Address,
  reputation: env.ERC8004_REPUTATION_REGISTRY as Address,
  validation: env.ERC8004_VALIDATION_REGISTRY as Address,
} as const

/** Empty tag — "any tag", the unfiltered summary. */
const NO_TAG = `0x${'00'.repeat(32)}` as const

export const identityRegistryAbi = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'getMetadata',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'metadataKey', type: 'string' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const

export const reputationRegistryAbi = [
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'bytes32' },
      { name: 'tag2', type: 'bytes32' },
    ],
    // TWO outputs, not the EIP's three. The deployed contract returns exactly
    // 64 bytes — verified by raw eth_call — so `summaryValueDecimals` is absent
    // here. Decoding with the documented three-output shape throws
    // "Position 95 is out of bounds", which is how this was found.
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
    ],
  },
  {
    type: 'function',
    name: 'getClients',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getIdentityRegistry',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export const validationRegistryAbi = [
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'validatorAddresses', type: 'address[]' },
      { name: 'tag', type: 'bytes32' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'averageResponse', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'getAgentValidations',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    type: 'function',
    name: 'getIdentityRegistry',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export interface Erc8004Identity {
  agentId: string
  owner: Address
  agentUri: string | null
  exists: boolean
}

export interface Erc8004Reputation {
  /** How many distinct feedback entries. Zero means no evidence, not good news. */
  count: number
  /** Normalised to [0,1] from the registry's fixed-point value, or null when count is 0. */
  normalized: number | null
  rawValue: string
  decimals: number
  clients: number
}

export interface Erc8004Validation {
  count: number
  /** Registry reports 0-100; normalised here. Null when nothing was validated. */
  normalized: number | null
  averageResponse: number
}

export interface Erc8004Snapshot {
  identity: Erc8004Identity | null
  reputation: Erc8004Reputation | null
  validation: Erc8004Validation | null
  fetchedAt: Date
  /** Populated when a registry could not be read. Never silently empty. */
  errors: string[]
}

function errMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'shortMessage' in err) {
    return String((err as { shortMessage: unknown }).shortMessage)
  }
  return err instanceof Error ? err.message : String(err)
}

/** Reads the identity registry. A non-existent agentId reverts on ownerOf, which is not an error here. */
export async function readIdentity(agentId: bigint): Promise<Erc8004Identity | null> {
  try {
    const owner = await publicClient.readContract({
      address: erc8004Addresses.identity,
      abi: identityRegistryAbi,
      functionName: 'ownerOf',
      args: [agentId],
    })
    let agentUri: string | null = null
    try {
      agentUri = await publicClient.readContract({
        address: erc8004Addresses.identity,
        abi: identityRegistryAbi,
        functionName: 'tokenURI',
        args: [agentId],
      })
    } catch {
      // A registered agent with no URI is normal, not a failure.
    }
    return { agentId: agentId.toString(), owner, agentUri, exists: true }
  } catch {
    return null
  }
}

/**
 * Reads the reputation summary.
 *
 * ZERO FEEDBACK NORMALISES TO null, NOT TO ZERO OR TO ONE. An agent nobody has
 * ever rated has no reputation — that is the same cold-start rule the trust
 * vector applies everywhere else. Mapping it to 0 would read as "rated badly"
 * and mapping it to 1 would hand a brand-new agent a perfect score, which is
 * precisely the free-trust bug ERC-8004's tiered model exists to avoid.
 */
export async function readReputation(agentId: bigint): Promise<Erc8004Reputation | null> {
  const [count, summaryValue] = await publicClient.readContract({
    address: erc8004Addresses.reputation,
    abi: reputationRegistryAbi,
    functionName: 'getSummary',
    args: [agentId, [], NO_TAG, NO_TAG],
  })
  // The deployed summary omits the scale, so it is configured rather than read.
  // UNVERIFIED: no agent on this testnet deployment has any feedback yet, so
  // there is no real value to calibrate against. Documented rather than
  // guessed at — if this deployment starts carrying feedback, confirm the scale
  // against readFeedback (which does return valueDecimals) before trusting the
  // normalised number.
  const decimals = env.ERC8004_SUMMARY_VALUE_DECIMALS

  let clients = 0
  try {
    clients = (
      await publicClient.readContract({
        address: erc8004Addresses.reputation,
        abi: reputationRegistryAbi,
        functionName: 'getClients',
        args: [agentId],
      })
    ).length
  } catch {
    // Optional detail; its absence must not lose the summary.
  }

  const feedbackCount = Number(count)
  if (feedbackCount === 0) {
    return { count: 0, normalized: null, rawValue: '0', decimals, clients }
  }

  // Fixed-point: value / 10^decimals, then clamped into [0,1]. The registry
  // permits negative values, and a negative reputation is a real signal — it
  // floors at 0 rather than being discarded.
  const scale = 10 ** decimals
  const normalized = Math.min(1, Math.max(0, Number(summaryValue) / (scale || 1)))

  return { count: feedbackCount, normalized, rawValue: summaryValue.toString(), decimals, clients }
}

/** Reads the validation summary. `averageResponse` is 0-100 in the reference implementation. */
export async function readValidation(agentId: bigint): Promise<Erc8004Validation | null> {
  const [count, averageResponse] = await publicClient.readContract({
    address: erc8004Addresses.validation,
    abi: validationRegistryAbi,
    functionName: 'getSummary',
    args: [agentId, [], NO_TAG],
  })

  const validationCount = Number(count)
  return {
    count: validationCount,
    normalized: validationCount === 0 ? null : Math.min(1, Number(averageResponse) / 100),
    averageResponse: Number(averageResponse),
  }
}

/**
 * The full external picture for one agent id.
 *
 * Every registry is read independently and a failure in one is recorded rather
 * than aborting the others — partial external evidence is still evidence, and
 * losing a good reputation read because the validation registry hiccuped would
 * make the trust vector needlessly blind.
 */
export async function readErc8004Snapshot(agentId: bigint): Promise<Erc8004Snapshot> {
  const errors: string[] = []

  const identity = await readIdentity(agentId).catch((err: unknown) => {
    errors.push(`identity: ${errMessage(err)}`)
    return null
  })

  const reputation = await readReputation(agentId).catch((err: unknown) => {
    errors.push(`reputation: ${errMessage(err)}`)
    return null
  })

  const validation = await readValidation(agentId).catch((err: unknown) => {
    errors.push(`validation: ${errMessage(err)}`)
    return null
  })

  if (errors.length > 0) {
    logger.warn({ agentId: agentId.toString(), errors }, 'ERC-8004 read partially failed')
  }

  return { identity, reputation, validation, fetchedAt: new Date(), errors }
}

/**
 * Collapses the snapshot into the single `agentReputation` trust dimension.
 *
 * Returns null — meaning UNKNOWN — whenever there is nothing real to measure:
 * no linked agent id, an id not present in the registry, or an agent with no
 * feedback and no validations. Section 16.2 says these inputs influence policy;
 * an invented number would influence it wrongly.
 *
 * When both signals exist, validation is weighted above raw feedback: feedback
 * is an opinion anyone can post, a validation is a check a validator contract
 * actually performed.
 */
export function toAgentReputationValue(snapshot: Erc8004Snapshot): {
  value: number | null
  basis: string
} {
  if (!snapshot.identity?.exists) {
    return { value: null, basis: 'no ERC-8004 identity found for this agent' }
  }

  const rep = snapshot.reputation
  const val = snapshot.validation
  const haveRep = rep !== null && rep.normalized !== null
  const haveVal = val !== null && val.normalized !== null

  if (!haveRep && !haveVal) {
    return {
      value: null,
      basis: `ERC-8004 agent ${snapshot.identity.agentId} is registered but has no feedback or validations`,
    }
  }

  if (haveRep && haveVal) {
    const value = rep!.normalized! * 0.4 + val!.normalized! * 0.6
    return {
      value,
      basis: `ERC-8004: ${rep!.count} feedback (${rep!.normalized!.toFixed(2)}), ${val!.count} validations (${val!.normalized!.toFixed(2)})`,
    }
  }

  if (haveVal) {
    return {
      value: val!.normalized!,
      basis: `ERC-8004: ${val!.count} validations (${val!.normalized!.toFixed(2)}), no feedback`,
    }
  }

  return {
    value: rep!.normalized!,
    basis: `ERC-8004: ${rep!.count} feedback from ${rep!.clients} clients (${rep!.normalized!.toFixed(2)}), no validations`,
  }
}
