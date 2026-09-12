/**
 * Composing the enforcement boundaries into one verdict — spec section 18.2.
 *
 * An actor can sit behind more than one boundary at once: Xander's own
 * capability store always, plus an on-chain EAC role when the actor is an agent
 * with an ENS identity. The rule for combining them is deliberately harsh:
 *
 *   EVERY APPLICABLE BOUNDARY MUST POSITIVELY CONFIRM.
 *
 * Not "no boundary objected" — that would let an unreachable chain read as
 * permission. Section 18.2 says an action Xander cannot PROVE was authorized
 * must not be reported as executed-as-authorized, and "cannot prove" is the
 * common case when a boundary is merely silent.
 */
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'
import type { CapabilityState, EnforcementAdapter } from './enforcement-adapter.js'
import { localEnforcementAdapter } from './local-adapter.js'
import { ensEacEnforcementAdapter, resolveEnsTarget } from './ens-eac-adapter.js'

export interface EnforcementVerdict {
  /** True only when every applicable boundary positively confirmed. */
  enforced: boolean
  /** Every boundary's own answer, kept separate so a receipt can name them. */
  states: CapabilityState[]
  /** The boundaries consulted, in order. */
  adapters: string[]
  /** Why, in one line an operator can act on. */
  reason: string
}

/**
 * Which boundaries actually govern this actor.
 *
 * The local store always does. The chain only does when there is a real ENS
 * identity behind the actor — asking an EAC registry about a bare wallet would
 * return "no role" and be indistinguishable from a denial.
 */
export async function adaptersForActor(actorId: string): Promise<EnforcementAdapter[]> {
  const adapters: EnforcementAdapter[] = [localEnforcementAdapter]
  const ensTarget = await resolveEnsTarget(actorId)
  if (ensTarget) adapters.push(ensEacEnforcementAdapter)
  return adapters
}

/**
 * Asks every applicable boundary whether this exact action is permitted.
 *
 * Note that `enforceable: null` — a boundary that could not answer — fails the
 * check just as hard as `false`. That is the whole point of the third state
 * existing: an RPC timeout must not become an authorization.
 */
export async function verifyEnforcement(args: {
  actorId: string
  actionType: string
  capabilityId?: string
  amount?: string | null
  targetAddress?: string | null
}): Promise<EnforcementVerdict> {
  const adapters = await adaptersForActor(args.actorId)

  const states: CapabilityState[] = []
  for (const adapter of adapters) {
    states.push(
      await adapter.inspect({
        capabilityId: args.capabilityId ?? '',
        actorId: args.actorId,
        actionType: args.actionType,
        amount: args.amount ?? null,
        targetAddress: args.targetAddress ?? null,
      }),
    )
  }

  const refused = states.filter((s) => s.enforceable === false)
  const silent = states.filter((s) => s.enforceable === null)
  const enforced = refused.length === 0 && silent.length === 0 && states.length > 0

  let reason: string
  if (enforced) {
    reason = `confirmed by ${states.map((s) => s.adapter).join(' + ')}`
  } else if (refused.length > 0) {
    reason = refused.map((s) => `${s.adapter}: ${s.detail}`).join('; ')
  } else {
    reason = `unproven — ${silent.map((s) => `${s.adapter}: ${s.detail}`).join('; ')}`
  }

  return { enforced, states, adapters: adapters.map((a) => a.name), reason }
}

/**
 * Withdraws authority at every boundary at once.
 *
 * Order matters: local first, because it is the boundary that actually stops
 * the next request in this process. If the chain write then fails we are left
 * publicly showing a role the agent no longer has, which is bad but survivable;
 * the reverse — chain revoked, local still permitting — would keep letting the
 * action through.
 */
export async function revokeEverywhere(args: {
  capabilityId: string
  actorId: string
  actionType: string
}): Promise<EnforcementVerdict> {
  const adapters = await adaptersForActor(args.actorId)
  const states: CapabilityState[] = []

  for (const adapter of adapters) {
    const result = await adapter.revoke(args)
    states.push({
      enforceable: result.outcome === 'CONFIRMED' ? false : null,
      adapter: adapter.name,
      detail: `${result.outcome}: ${result.detail}`,
    })
    if (result.outcome !== 'CONFIRMED') {
      logger.error(
        { adapter: adapter.name, capabilityId: args.capabilityId, outcome: result.outcome },
        'revocation not confirmed at a boundary',
      )
    }
  }

  const allConfirmed = states.every((s) => s.enforceable === false)
  return {
    enforced: allConfirmed,
    states,
    adapters: adapters.map((a) => a.name),
    reason: allConfirmed
      ? `revoked at ${states.map((s) => s.adapter).join(' + ')}`
      : states.map((s) => `${s.adapter}: ${s.detail}`).join('; '),
  }
}

/** What every boundary currently believes about an actor's authority. */
export async function enforcementStatus(actorId: string): Promise<{
  actorId: string
  boundaries: { adapter: string; actionType: string; enforceable: boolean | null; detail: string }[]
}> {
  const capabilities = await prisma.capability.findMany({
    where: { actorId, status: 'ACTIVE' },
    select: { id: true, actionType: true },
    distinct: ['actionType'],
  })
  const adapters = await adaptersForActor(actorId)

  const boundaries: {
    adapter: string
    actionType: string
    enforceable: boolean | null
    detail: string
  }[] = []
  for (const capability of capabilities) {
    for (const adapter of adapters) {
      const state = await adapter.inspect({
        capabilityId: capability.id,
        actorId,
        actionType: capability.actionType,
      })
      boundaries.push({
        adapter: adapter.name,
        actionType: capability.actionType,
        enforceable: state.enforceable,
        detail: state.detail,
      })
    }
  }
  return { actorId, boundaries }
}
