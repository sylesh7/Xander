/**
 * Agent identity on ENSv2 — Xander V2 Phase 3.5.
 *
 * An agent is a SUBNAME under the operator's parent name, which is what makes
 * "agents as namespaces" more than a label:
 *
 *   - the subname carries an on-chain EXPIRY, so an agent identity is
 *     time-bound by the registry rather than by a database column;
 *   - the parent relationship IS the human-backing claim, so
 *     `AGENT_BACKED_BY` becomes a public fact instead of a private row;
 *   - EAC roles on the subname's resource mirror Xander capabilities, so
 *     revoking authority is a transaction anyone can verify.
 *
 * THE BOUNDARY, stated once and enforced everywhere below: EAC roles are
 * BOOLEAN. They express *who may act on what*, and nothing else. Amount
 * ceilings and rate limits have no on-chain representation and stay in
 * Xander's `Capability`. Nothing in this module should ever suggest otherwise.
 */
import type { Address, Hex } from 'viem'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import {
  agentRegistryAddress,
  eacAbi,
  ensAddresses,
  operatorAccount,
  publicClient,
  registryAbi,
  walletClient,
} from './ens-client.js'
import {
  actionsFromBitmap,
  agentRoleForAction,
  ALL_AGENT_ROLES,
  AGENT_REGISTRATION_ROLE_BITMAP,
  type AgentRoleName,
} from './eac-roles.js'
import { agentFqdn, canonicalTokenId, isValidAgentLabel } from './ens-names.js'

export class EnsAgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'EnsAgentError'
  }
}

function requireRegistry(): Address {
  if (!agentRegistryAddress) {
    throw new EnsAgentError('ENS_AGENT_REGISTRY is not configured — run ens:deploy-registry.', 503)
  }
  return agentRegistryAddress
}

export interface AgentNameState {
  label: string
  fqdn: string
  registered: boolean
  owner: Address | null
  expiresAt: Date | null
  tokenId: string
  /** Actions the holder currently has EAC roles for. */
  onChainActions: AgentRoleName[]
}

/**
 * Reads an agent's on-chain identity. Needs no operator key, so this works on a
 * read-only deployment.
 */
export async function readAgentName(label: string, holder?: Address): Promise<AgentNameState> {
  const registry = requireRegistry()
  const tokenId = canonicalTokenId(label)

  const [, expiry, owner] = await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: 'getState',
    args: [tokenId],
  })

  const registered = expiry > 0n
  let onChainActions: AgentRoleName[] = []
  const subject = holder ?? (registered ? owner : null)
  if (registered && subject && subject !== '0x0000000000000000000000000000000000000000') {
    const bitmap = await publicClient.readContract({
      address: registry,
      abi: eacAbi,
      functionName: 'roles',
      args: [tokenId, subject],
    })
    onChainActions = actionsFromBitmap(bitmap)
  }

  return {
    label,
    fqdn: agentFqdn(label, env.ENS_PARENT_LABEL),
    registered,
    owner: registered ? owner : null,
    expiresAt: registered ? new Date(Number(expiry) * 1000) : null,
    tokenId: tokenId.toString(),
    onChainActions,
  }
}

export interface RegisterAgentResult {
  label: string
  fqdn: string
  tokenId: string
  owner: Address
  expiresAt: Date
  txHash: Hex
  /** True when the name already existed and no transaction was sent. */
  alreadyRegistered: boolean
}

/**
 * Registers an agent subname.
 *
 * The expiry is real and short by default (30 days): an agent identity that
 * never lapses is a standing authority nobody has to renew, which is precisely
 * what section 7.3 argues against for anything high-value.
 *
 * Idempotent — an existing name owned by the intended holder returns rather
 * than reverting, so a retried agent creation does not fail the whole flow.
 */
export async function registerAgentName(args: {
  label: string
  owner: Address
  durationSeconds?: number
}): Promise<RegisterAgentResult> {
  const registry = requireRegistry()
  if (!operatorAccount) throw new EnsAgentError('ENS operator key is not configured.', 503)

  const { label, owner } = args
  if (!isValidAgentLabel(label)) {
    throw new EnsAgentError(
      `"${label}" is not a valid agent label (lowercase a-z, 0-9, hyphen; 3-63 chars).`,
      400,
    )
  }

  const existing = await readAgentName(label)
  if (existing.registered) {
    if (existing.owner?.toLowerCase() !== owner.toLowerCase()) {
      throw new EnsAgentError(
        `${existing.fqdn} is already held by ${existing.owner}, not ${owner}.`,
        409,
      )
    }
    return {
      label,
      fqdn: existing.fqdn,
      tokenId: existing.tokenId,
      owner,
      expiresAt: existing.expiresAt!,
      txHash: '0x' as Hex,
      alreadyRegistered: true,
    }
  }

  const duration = BigInt(args.durationSeconds ?? env.ENS_AGENT_DURATION_SECONDS)
  const expires = BigInt(Math.floor(Date.now() / 1000)) + duration

  const wallet = walletClient()
  const txHash = await wallet.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: 'register',
    args: [
      label,
      owner,
      // No sub-subregistry: an agent does not need to mint names beneath
      // itself, and granting that would let it create authority we never
      // reasoned about.
      '0x0000000000000000000000000000000000000000',
      ensAddresses.permissionedResolverImpl,
      AGENT_REGISTRATION_ROLE_BITMAP,
      expires,
    ],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    throw new EnsAgentError(`Agent name registration reverted (${txHash}).`, 502)
  }

  const state = await readAgentName(label)
  logger.info({ label, fqdn: state.fqdn, owner, txHash }, 'agent subname registered')

  return {
    label,
    fqdn: state.fqdn,
    tokenId: state.tokenId,
    owner,
    expiresAt: state.expiresAt ?? new Date(Number(expires) * 1000),
    txHash,
    alreadyRegistered: false,
  }
}

/**
 * Grants the EAC roles matching a set of Xander action types.
 *
 * Actions with no on-chain analogue are reported back rather than silently
 * dropped — a caller that asked for authority we did not grant must be able to
 * tell, or it will assume the grant succeeded in full.
 */
export async function grantAgentRoles(args: {
  label: string
  holder: Address
  actionTypes: readonly string[]
}): Promise<{ txHash: Hex | null; granted: string[]; unsupported: string[] }> {
  const registry = requireRegistry()
  if (!operatorAccount) throw new EnsAgentError('ENS operator key is not configured.', 503)

  const granted: string[] = []
  const unsupported: string[] = []
  let bitmap = 0n

  for (const action of args.actionTypes) {
    const role = agentRoleForAction(action)
    if (role === null) unsupported.push(action)
    else {
      bitmap |= role
      granted.push(action)
    }
  }

  if (bitmap === 0n) return { txHash: null, granted, unsupported }

  const wallet = walletClient()
  const txHash = await wallet.writeContract({
    address: registry,
    abi: eacAbi,
    functionName: 'grantRoles',
    args: [canonicalTokenId(args.label), bitmap, args.holder],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    throw new EnsAgentError(`grantRoles reverted (${txHash}).`, 502)
  }

  logger.info({ label: args.label, granted, txHash }, 'agent EAC roles granted')
  return { txHash, granted, unsupported }
}

/**
 * Revokes roles — the freeze path.
 *
 * With no `actionTypes` this revokes every agent role, which is what an agent
 * freeze means on-chain: section 19.3 insists freeze is a capability state
 * transition rather than a UI flag, and this is that transition made public.
 */
export async function revokeAgentRoles(args: {
  label: string
  holder: Address
  actionTypes?: readonly string[]
}): Promise<{ txHash: Hex; revoked: string[] }> {
  const registry = requireRegistry()
  if (!operatorAccount) throw new EnsAgentError('ENS operator key is not configured.', 503)

  let bitmap = ALL_AGENT_ROLES
  let revoked: string[] = actionsFromBitmap(ALL_AGENT_ROLES)
  if (args.actionTypes && args.actionTypes.length > 0) {
    bitmap = 0n
    revoked = []
    for (const action of args.actionTypes) {
      const role = agentRoleForAction(action)
      if (role !== null) {
        bitmap |= role
        revoked.push(action)
      }
    }
  }

  const wallet = walletClient()
  const txHash = await wallet.writeContract({
    address: registry,
    abi: eacAbi,
    functionName: 'revokeRoles',
    args: [canonicalTokenId(args.label), bitmap, args.holder],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    throw new EnsAgentError(`revokeRoles reverted (${txHash}).`, 502)
  }

  logger.info({ label: args.label, revoked, txHash }, 'agent EAC roles revoked')
  return { txHash, revoked }
}

/** Does this holder currently hold the on-chain role for this action? */
export async function hasOnChainRole(
  label: string,
  holder: Address,
  actionType: string,
): Promise<boolean> {
  const registry = requireRegistry()
  const role = agentRoleForAction(actionType)
  if (role === null) return false
  return publicClient.readContract({
    address: registry,
    abi: eacAbi,
    functionName: 'hasRoles',
    args: [canonicalTokenId(label), role, holder],
  })
}
