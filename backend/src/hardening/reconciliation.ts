/**
 * Enforcement reconciliation — Xander V2 spec section 33, Phase 12.
 *
 * Xander's database and the chain are two records of the same authority, and
 * they can drift. A revoke that landed locally but whose transaction reverted
 * leaves the agent publicly holding a role it should not have. A grant that
 * landed on-chain while the database write failed leaves the reverse.
 *
 * Both are dangerous, but NOT equally, and this file treats them differently:
 *
 *   CHAIN GRANTS MORE THAN THE DATABASE  -> urgent. Public authority exists
 *                                           that Xander does not believe in.
 *   DATABASE GRANTS MORE THAN THE CHAIN  -> less urgent. The execution gate
 *                                           already refuses these, because
 *                                           section 18.2 requires EVERY
 *                                           boundary to confirm.
 *
 * Reconciliation REPORTS by default and only repairs when explicitly asked.
 * A repair is a real on-chain transaction, and a reconciler that silently
 * transacts on a schedule is a way to turn one bad read into a lot of gas.
 */
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { resolveEnsTarget } from '../authorization/enforcement/ens-eac-adapter.js'
import { agentRoleForAction } from '../ens/eac-roles.js'

export const DRIFT_KINDS = ['CHAIN_EXCESS', 'CHAIN_MISSING', 'UNREADABLE'] as const
export type DriftKind = (typeof DRIFT_KINDS)[number]

export interface Drift {
  kind: DriftKind
  agentId: string
  actorId: string
  label: string
  actionType: string
  /** Urgent when the chain permits something Xander does not. */
  urgent: boolean
  detail: string
}

export interface ReconciliationReport {
  checkedAgents: number
  checkedActions: number
  drift: Drift[]
  /** True when nothing could be read at all — NOT the same as "no drift". */
  unreadable: boolean
  summary: string
}

/**
 * Compares Xander's capabilities against on-chain EAC roles.
 *
 * Read-only. `repairDrift` below is the only thing that transacts.
 */
export async function reconcileEnforcement(
  opts: { agentId?: string; limit?: number } = {},
): Promise<ReconciliationReport> {
  const agents = await prisma.agent.findMany({
    where: {
      ensName: { not: null },
      ...(opts.agentId ? { id: opts.agentId } : {}),
      status: { notIn: ['REVOKED'] },
    },
    take: opts.limit ?? 50,
  })

  const drift: Drift[] = []
  let checkedActions = 0
  let unreadableCount = 0

  const { hasOnChainRole } = await import('../ens/agent-identity.js')

  for (const agent of agents) {
    const target = await resolveEnsTarget(agent.actorId)
    if (!target) continue

    // Which actions Xander currently believes this agent may perform.
    const active = await prisma.capability.findMany({
      where: { actorId: agent.actorId, status: 'ACTIVE' },
      select: { actionType: true },
      distinct: ['actionType'],
    })
    const believed = new Set(active.map((c) => c.actionType))

    // Only actions that HAVE an on-chain representation can drift. An action
    // with no EAC bit is enforced locally by definition and comparing it would
    // report drift that cannot exist.
    const comparable = [...new Set([...believed, ...ENFORCEABLE_ACTIONS])].filter(
      (a) => agentRoleForAction(a) !== null,
    )

    for (const actionType of comparable) {
      checkedActions++
      let onChain: boolean
      try {
        onChain = await hasOnChainRole(target.label, target.holder, actionType)
      } catch (err) {
        unreadableCount++
        drift.push({
          kind: 'UNREADABLE',
          agentId: agent.id,
          actorId: agent.actorId,
          label: target.label,
          actionType,
          // Not urgent, because we do not know there IS drift — but recorded,
          // because "we could not check" must never look like "we checked".
          urgent: false,
          detail: `could not read the on-chain role: ${err instanceof Error ? err.message : String(err)}`,
        })
        continue
      }

      const locally = believed.has(actionType)
      if (onChain && !locally) {
        drift.push({
          kind: 'CHAIN_EXCESS',
          agentId: agent.id,
          actorId: agent.actorId,
          label: target.label,
          actionType,
          urgent: true,
          detail: `${target.label} holds ${actionType} on-chain but Xander has no ACTIVE capability for it`,
        })
      } else if (!onChain && locally) {
        drift.push({
          kind: 'CHAIN_MISSING',
          agentId: agent.id,
          actorId: agent.actorId,
          label: target.label,
          actionType,
          // The execution gate already refuses this, so it is a consistency
          // problem rather than a security hole.
          urgent: false,
          detail: `Xander grants ${actionType} but ${target.label} does not hold it on-chain; the execution gate will refuse it`,
        })
      }
    }
  }

  const urgent = drift.filter((d) => d.urgent)
  if (urgent.length > 0) {
    logger.error({ urgent: urgent.length }, 'RECONCILIATION: chain grants authority Xander does not')
  }

  return {
    checkedAgents: agents.length,
    checkedActions,
    drift,
    // Every read failing is materially different from finding nothing wrong.
    unreadable: checkedActions > 0 && unreadableCount === checkedActions,
    summary:
      checkedActions === 0
        ? 'No on-chain-enforceable agents to reconcile.'
        : `Checked ${checkedActions} action(s) across ${agents.length} agent(s); ${drift.length} drift(s), ${urgent.length} urgent.`,
  }
}

/** Actions worth checking even when Xander grants none of them. */
const ENFORCEABLE_ACTIONS = ['CLAIM', 'TRADE', 'TRANSFER', 'BORROW', 'API_REQUEST', 'X402_PAYMENT']

/**
 * Repairs drift by making the CHAIN match Xander, never the reverse.
 *
 * The direction is deliberate and one-way: Xander's database is the authority,
 * so an excess on-chain role is REVOKED. Drift is never repaired by granting,
 * because a bug that dropped a capability locally would otherwise be "repaired"
 * into re-granting authority nobody re-authorised.
 *
 * Only CHAIN_EXCESS is repairable. CHAIN_MISSING is left alone — the execution
 * gate already refuses it, and re-granting on-chain would be exactly the
 * widening this function refuses to do.
 */
export async function repairDrift(
  report: ReconciliationReport,
  opts: { dryRun?: boolean } = {},
): Promise<{ repaired: number; skipped: number; details: string[] }> {
  const repairable = report.drift.filter((d) => d.kind === 'CHAIN_EXCESS')
  const details: string[] = []
  let repaired = 0

  if (opts.dryRun !== false) {
    // Defaults to a dry run. A reconciler that transacts unless told not to is
    // one bad read away from a lot of unintended gas.
    return {
      repaired: 0,
      skipped: repairable.length,
      details: repairable.map((d) => `would revoke ${d.actionType} from ${d.label}`),
    }
  }

  const { ensEacEnforcementAdapter } = await import(
    '../authorization/enforcement/ens-eac-adapter.js'
  )

  for (const d of repairable) {
    const result = await ensEacEnforcementAdapter.revoke({
      capabilityId: '',
      actorId: d.actorId,
      actionType: d.actionType,
    })
    if (result.outcome === 'CONFIRMED') {
      repaired++
      details.push(`revoked ${d.actionType} from ${d.label} (${result.reference ?? 'no tx'})`)
      logger.warn({ agentId: d.agentId, actionType: d.actionType }, 'reconciliation revoked excess on-chain role')
    } else {
      details.push(`FAILED to revoke ${d.actionType} from ${d.label}: ${result.detail}`)
    }
  }

  return { repaired, skipped: repairable.length - repaired, details }
}
