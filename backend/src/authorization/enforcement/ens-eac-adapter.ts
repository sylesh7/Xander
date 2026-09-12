/**
 * On-chain enforcement over ENSv2 Enhanced Access Control — spec section 18.1,
 * implementation order 3 ("one concrete onchain enforcement demo").
 *
 * The spec names Safe or OpenZeppelin AccessManager as candidates. We use the
 * EAC registry Phase 3.5 already deployed and funded on Sepolia
 * (ENS_AGENT_REGISTRY), because it is a real, live, role-gated permission
 * surface we control — the alternative would have been deploying a second
 * contract to demonstrate the same property. The seam in enforcement-adapter.ts
 * is what keeps that a swappable decision rather than a coupling.
 *
 * WHAT CROSSES THE BOUNDARY: action types only. EAC roles are single bits, so
 * an amount ceiling or a rate limit has no on-chain representation. The chain
 * says *what* an agent may do; the local adapter says *how much and how often*.
 * That is why an attenuation here is a no-op that reports UNKNOWN rather than
 * CONFIRMED — claiming to have narrowed an on-chain limit that has no on-chain
 * existence is exactly the lie section 18.2 forbids.
 */
import type { Address } from 'viem'
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'
import { env } from '../../config/env.js'
import { operatorAccount } from '../../ens/ens-client.js'
import { grantAgentRoles, hasOnChainRole, revokeAgentRoles } from '../../ens/agent-identity.js'
import { agentRoleForAction } from '../../ens/eac-roles.js'
import { ensAvailability } from '../../agents/agent-ens.js'
import type {
  CapabilityState,
  EnforcementAdapter,
  EnforcementResult,
} from './enforcement-adapter.js'

/** The on-chain identity a capability hangs from, when it has one. */
export interface EnsTarget {
  label: string
  holder: Address
  agentId: string
}

/**
 * Finds the ENS label enforcing this capability, or null.
 *
 * Null is not a failure — most actors are wallets with no agent and no name,
 * and for those this boundary simply does not exist. The enforcement service
 * uses null to decide the adapter does not apply, which is different from the
 * adapter running and being unable to answer.
 */
export async function resolveEnsTarget(actorId: string): Promise<EnsTarget | null> {
  if (ensAvailability() !== null || !operatorAccount) return null

  const agent = await prisma.agent.findFirst({
    where: { actorId, ensName: { not: null } },
    orderBy: { createdAt: 'desc' },
  })
  if (!agent?.ensName) return null

  const suffix = `.${env.ENS_PARENT_LABEL}.eth`
  if (!agent.ensName.endsWith(suffix)) return null
  const label = agent.ensName.slice(0, -suffix.length)
  if (label.length === 0) return null

  return { label, holder: operatorAccount.address, agentId: agent.id }
}

export class EnsEacEnforcementAdapter implements EnforcementAdapter {
  readonly name = 'ens-eac'

  async grant(args: {
    capabilityId: string
    actorId: string
    actionType: string
  }): Promise<EnforcementResult> {
    const target = await resolveEnsTarget(args.actorId)
    if (!target) return this.notApplicable('no ENS identity for this actor')

    if (agentRoleForAction(args.actionType) === null) {
      // Honest FAILED, not UNKNOWN: the boundary definitively has no bit for
      // this action, so it can never enforce it. An operator must see that.
      return {
        outcome: 'FAILED',
        adapter: this.name,
        reference: null,
        detail: `no EAC role exists for ${args.actionType}`,
      }
    }

    try {
      const result = await grantAgentRoles({
        label: target.label,
        holder: target.holder,
        actionTypes: [args.actionType],
      })
      // Re-read rather than trusting the receipt. A successful transaction that
      // did not set the bit is indistinguishable from a failed one for our
      // purposes, and only the read proves the grant.
      const held = await hasOnChainRole(target.label, target.holder, args.actionType)
      return {
        outcome: held ? 'CONFIRMED' : 'FAILED',
        adapter: this.name,
        reference: result.txHash,
        detail: held
          ? `${target.label} holds the ${args.actionType} role on-chain`
          : `grant transaction landed but ${target.label} does not hold the role`,
      }
    } catch (err) {
      return this.unknown(err, `granting ${args.actionType} to ${target.label}`)
    }
  }

  async revoke(args: {
    capabilityId: string
    actorId: string
    actionType: string
  }): Promise<EnforcementResult> {
    const target = await resolveEnsTarget(args.actorId)
    if (!target) return this.notApplicable('no ENS identity for this actor')

    if (agentRoleForAction(args.actionType) === null) {
      // Nothing on-chain grants this action, so nothing on-chain can permit it.
      // The desired end state already holds.
      return {
        outcome: 'CONFIRMED',
        adapter: this.name,
        reference: null,
        detail: `no EAC role for ${args.actionType}; nothing to revoke`,
      }
    }

    try {
      const result = await revokeAgentRoles({
        label: target.label,
        holder: target.holder,
        actionTypes: [args.actionType],
      })
      const stillHeld = await hasOnChainRole(target.label, target.holder, args.actionType)
      return {
        outcome: stillHeld ? 'FAILED' : 'CONFIRMED',
        adapter: this.name,
        reference: result.txHash,
        detail: stillHeld
          ? `revoke landed but ${target.label} STILL holds ${args.actionType}`
          : `${args.actionType} revoked from ${target.label}`,
      }
    } catch (err) {
      return this.unknown(err, `revoking ${args.actionType} from ${target.label}`)
    }
  }

  /**
   * EAC roles carry no magnitude, so there is nothing here to narrow.
   *
   * UNKNOWN rather than CONFIRMED on purpose. Returning CONFIRMED would tell a
   * caller this boundary now enforces the tighter limit, which it does not and
   * cannot — the local adapter is the only place that ceiling is real.
   */
  async attenuate(args: {
    capabilityId: string
    actorId: string
    actionType: string
  }): Promise<EnforcementResult> {
    const target = await resolveEnsTarget(args.actorId)
    if (!target) return this.notApplicable('no ENS identity for this actor')
    return {
      outcome: 'UNKNOWN',
      adapter: this.name,
      reference: null,
      detail: 'EAC roles are boolean; an amount ceiling has no on-chain representation',
    }
  }

  async inspect(args: {
    capabilityId: string
    actorId: string
    actionType: string
  }): Promise<CapabilityState> {
    const target = await resolveEnsTarget(args.actorId)
    if (!target) {
      return { enforceable: null, adapter: this.name, detail: 'no ENS identity for this actor' }
    }
    try {
      const held = await hasOnChainRole(target.label, target.holder, args.actionType)
      return {
        enforceable: held,
        adapter: this.name,
        detail: held
          ? `${target.label} holds ${args.actionType} on-chain`
          : `${target.label} does not hold ${args.actionType} on-chain`,
      }
    } catch (err) {
      // Null, never false. An unreachable RPC is not evidence of absence, and
      // guessing false here would silently deny a legitimate action.
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ err, label: target.label }, 'EAC inspect failed')
      return { enforceable: null, adapter: this.name, detail: `chain unreachable: ${message}` }
    }
  }

  private notApplicable(detail: string): EnforcementResult {
    return { outcome: 'UNKNOWN', adapter: this.name, reference: null, detail }
  }

  private unknown(err: unknown, what: string): EnforcementResult {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ err }, `EAC enforcement left an unknown state while ${what}`)
    return {
      outcome: 'UNKNOWN',
      adapter: this.name,
      reference: null,
      detail: `${what} failed: ${message}`,
    }
  }
}

export const ensEacEnforcementAdapter = new EnsEacEnforcementAdapter()
