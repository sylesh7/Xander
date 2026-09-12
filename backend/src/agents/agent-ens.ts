/**
 * The bridge between an agent's lifecycle and its ENS identity — Phase 5.5.
 *
 * Phase 3.5 built the ENS primitives and proved them on-chain; Phase 5 built
 * the agent lifecycle. This is the seam that makes them one thing:
 *
 *   createAgent        -> mint <label>.xander.eth with a real on-chain expiry
 *   establishAssurance -> grant EAC roles matching the capability envelope
 *   freeze / revoke    -> revoke those roles with a real transaction
 *
 * TWO RULES GOVERN EVERYTHING HERE.
 *
 * 1. THE DATABASE IS AUTHORITATIVE FOR SECURITY, THE CHAIN IS THE PUBLIC
 *    MIRROR. A freeze must take effect even if Sepolia is unreachable, so
 *    capabilities are always suspended locally first and the chain is a
 *    best-effort echo. Making revocation depend on a healthy RPC would mean an
 *    RPC outage becomes an inability to stop a misbehaving agent.
 *
 * 2. NEVER REPORT AN ON-CHAIN ACTION THAT DID NOT HAPPEN. Section 18.2. Every
 *    function below returns what actually settled, and a failure is reported as
 *    a failure rather than swallowed — a caller that believes authority was
 *    revoked on-chain when it was not is worse off than one told plainly that
 *    it wasn't.
 */
import type { Agent } from '@prisma/client'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { env } from '../config/env.js'
import { agentRegistryAddress, isEnsWritable, operatorAccount } from '../ens/ens-client.js'
import {
  grantAgentRoles,
  readAgentName,
  registerAgentName,
  revokeAgentRoles,
} from '../ens/agent-identity.js'
import { agentFqdn, isValidAgentLabel } from '../ens/ens-names.js'

/** Why an ENS step did not run. Reported, never hidden. */
export type EnsSkipReason =
  | 'ENS_DISABLED'
  | 'NO_OPERATOR_KEY'
  | 'NO_AGENT_REGISTRY'
  | 'NO_ENS_NAME'
  | null

export interface EnsOutcome {
  attempted: boolean
  succeeded: boolean
  skipReason: EnsSkipReason
  txHash: string | null
  detail: string
}

const skipped = (reason: Exclude<EnsSkipReason, null>, detail: string): EnsOutcome => ({
  attempted: false,
  succeeded: false,
  skipReason: reason,
  txHash: null,
  detail,
})

/**
 * Whether the ENS path is usable at all right now.
 *
 * Checked before every write so a deployment with no key behaves predictably —
 * agents still work, they simply have no on-chain identity, and the response
 * says so instead of implying one exists.
 */
export function ensAvailability(): Exclude<EnsSkipReason, null> | null {
  if (!env.ENS_ENABLED) return 'ENS_DISABLED'
  if (!isEnsWritable() || !operatorAccount) return 'NO_OPERATOR_KEY'
  if (!agentRegistryAddress) return 'NO_AGENT_REGISTRY'
  return null
}

export interface MintResult extends EnsOutcome {
  fqdn: string | null
  tokenId: string | null
  expiresAt: Date | null
}

/**
 * Mints the agent's subname.
 *
 * The name is registered to the OPERATOR, not to some address the agent
 * controls. That is deliberate: the operator is the human backing this agent,
 * and the whole point of the parent/child relationship is that the human holds
 * the child name. An agent that owned its own name outright could transfer it
 * away from the person accountable for it.
 */
export async function mintAgentIdentity(args: {
  agentId: string
  label: string
}): Promise<MintResult> {
  const unavailable = ensAvailability()
  if (unavailable) {
    return { ...skipped(unavailable, 'ENS identity not minted'), fqdn: null, tokenId: null, expiresAt: null }
  }
  if (!isValidAgentLabel(args.label)) {
    throw new Error(`"${args.label}" is not a valid agent label.`)
  }

  const registered = await registerAgentName({
    label: args.label,
    owner: operatorAccount!.address,
  })

  await prisma.agent.update({
    where: { id: args.agentId },
    data: { ensName: registered.fqdn, ensTokenId: registered.tokenId },
  })

  logger.info(
    { agentId: args.agentId, fqdn: registered.fqdn, txHash: registered.txHash },
    'agent ENS identity minted',
  )

  return {
    attempted: true,
    succeeded: true,
    skipReason: null,
    txHash: registered.alreadyRegistered ? null : registered.txHash,
    detail: registered.alreadyRegistered
      ? `${registered.fqdn} already existed`
      : `${registered.fqdn} registered`,
    fqdn: registered.fqdn,
    tokenId: registered.tokenId,
    expiresAt: registered.expiresAt,
  }
}

/** The ENS label embedded in a stored fqdn, or null. */
function labelFromAgent(agent: Agent): string | null {
  if (!agent.ensName) return null
  const suffix = `.${env.ENS_PARENT_LABEL}.eth`
  return agent.ensName.endsWith(suffix) ? agent.ensName.slice(0, -suffix.length) : null
}

/**
 * Mirrors an agent's granted capabilities onto EAC roles.
 *
 * Only the ACTION TYPES cross the boundary. EAC roles are boolean, so an amount
 * ceiling or a rate limit has no on-chain representation and stays in
 * Xander's Capability — the chain says *what* this agent may do, the database
 * says *how much and how often*.
 */
export async function syncAgentRolesOnChain(agentId: string): Promise<EnsOutcome> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) throw new Error(`No agent ${agentId}`)

  const unavailable = ensAvailability()
  if (unavailable) return skipped(unavailable, 'roles not mirrored on-chain')

  const label = labelFromAgent(agent)
  if (!label) return skipped('NO_ENS_NAME', 'agent has no ENS identity to grant roles on')

  const capabilities = await prisma.capability.findMany({
    where: { actorId: agent.actorId, status: 'ACTIVE' },
    select: { actionType: true },
    distinct: ['actionType'],
  })
  const actionTypes = capabilities.map((c) => c.actionType)
  if (actionTypes.length === 0) {
    return { attempted: false, succeeded: true, skipReason: null, txHash: null, detail: 'no active capabilities to mirror' }
  }

  const result = await grantAgentRoles({
    label,
    holder: operatorAccount!.address,
    actionTypes,
  })

  return {
    attempted: true,
    succeeded: true,
    skipReason: null,
    txHash: result.txHash,
    // Unsupported actions are surfaced, not dropped. A caller must be able to
    // see that TRANSFER was granted in Xander but has no on-chain counterpart.
    detail:
      result.unsupported.length > 0
        ? `granted ${result.granted.join(', ')}; no on-chain role for ${result.unsupported.join(', ')}`
        : `granted ${result.granted.join(', ')}`,
  }
}

/**
 * Revokes the agent's on-chain roles — the public half of a freeze.
 *
 * Returns rather than throws when the chain is unreachable. The local
 * suspension has already happened and IS the enforcement; this is the mirror,
 * and letting an RPC failure throw would roll a successful freeze back into an
 * error the caller might retry or ignore.
 */
export async function revokeAgentRolesOnChain(agentId: string): Promise<EnsOutcome> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) throw new Error(`No agent ${agentId}`)

  const unavailable = ensAvailability()
  if (unavailable) return skipped(unavailable, 'on-chain roles not revoked')

  const label = labelFromAgent(agent)
  if (!label) return skipped('NO_ENS_NAME', 'agent has no ENS identity')

  try {
    const result = await revokeAgentRoles({ label, holder: operatorAccount!.address })
    logger.info({ agentId, txHash: result.txHash }, 'agent ENS roles revoked')
    return {
      attempted: true,
      succeeded: true,
      skipReason: null,
      txHash: result.txHash,
      detail: `revoked ${result.revoked.join(', ')}`,
    }
  } catch (err) {
    // Reported as a failure, never as a success. The operator needs to know the
    // public record still shows authority this agent no longer has.
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ agentId, err }, 'on-chain role revocation FAILED — local suspension stands')
    return {
      attempted: true,
      succeeded: false,
      skipReason: null,
      txHash: null,
      detail: `on-chain revocation failed: ${message}`,
    }
  }
}

/** The agent's on-chain identity as it actually reads right now. */
export async function readAgentEnsState(agentId: string): Promise<{
  fqdn: string | null
  registered: boolean
  expiresAt: Date | null
  onChainActions: string[]
} | null> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } })
  if (!agent) return null

  const label = labelFromAgent(agent)
  if (!label || ensAvailability() === 'ENS_DISABLED' || !agentRegistryAddress) {
    return {
      fqdn: agent.ensName,
      registered: false,
      expiresAt: null,
      onChainActions: [],
    }
  }

  const state = await readAgentName(label, operatorAccount?.address)
  return {
    fqdn: agent.ensName ?? agentFqdn(label, env.ENS_PARENT_LABEL),
    registered: state.registered,
    expiresAt: state.expiresAt,
    onChainActions: state.onChainActions,
  }
}
