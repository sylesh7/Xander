/**
 * Live trust mutation — Xander V2 spec section 13, Phase 7.
 *
 * The phase where Substreams stops refreshing a cache and starts CHANGING
 * AUTHORITY:
 *
 *   on-chain event -> evidence -> trust rebuild -> band comparison
 *                  -> capability attenuated / suspended / revoked
 *                  -> Temporal signalled
 *
 * Until now a live event could make an actor riskier and nothing happened to
 * the authority it already held. A capability granted an hour ago outlived the
 * evidence that justified it. This closes that window.
 */
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { buildTrustContext } from './trust-context.js'
import { recordTrustSignal } from './trust-history.js'
import type { TrustBand } from './trust-types.js'

/**
 * Band severity, worst last.
 *
 * INSUFFICIENT_EVIDENCE sits ABOVE UncERTAIN and below HIGH_RISK on purpose.
 * Losing the ability to measure an actor is worse than having measured them as
 * ambiguous — we can no longer justify the authority they hold — but it is not
 * evidence of coordination, so it must not be treated as harshly as an actual
 * high-risk finding. Ranking it as harmless would let an actor escape scrutiny
 * simply by going quiet until their evidence went stale.
 */
const BAND_SEVERITY: Record<TrustBand, number> = {
  VERIFIED_LOW: 0,
  ESTABLISHED_LOW: 1,
  UNCERTAIN: 2,
  INSUFFICIENT_EVIDENCE: 3,
  HIGH_RISK: 4,
  CRITICAL: 5,
}

export function bandSeverity(band: string): number {
  return BAND_SEVERITY[band as TrustBand] ?? BAND_SEVERITY.INSUFFICIENT_EVIDENCE
}

/** Did trust get worse? Equal is not worse. */
export function isDegradation(previous: string, current: string): boolean {
  return bandSeverity(current) > bandSeverity(previous)
}

export const MUTATION_CONSEQUENCES = ['NONE', 'ATTENUATE', 'SUSPEND', 'REVOKE'] as const
export type MutationConsequence = (typeof MUTATION_CONSEQUENCES)[number]

/**
 * What a band change should do to authority the actor already holds.
 *
 * Driven by the CURRENT band, not by how far it fell. An actor that dropped
 * two bands into UNCERTAIN is in exactly the same position as one that drifted
 * there gently — what matters is where they are now, not the size of the step.
 *
 * Improvement never widens authority here. Trust rising is a reason to grant
 * more on the NEXT request, judged by policy against the actual action; it is
 * not a reason to retroactively expand a grant nobody re-evaluated.
 */
export function decideConsequence(previous: string, current: string): MutationConsequence {
  if (!isDegradation(previous, current)) return 'NONE'

  switch (current as TrustBand) {
    case 'CRITICAL':
      return 'REVOKE'
    case 'HIGH_RISK':
      return 'SUSPEND'
    // We can no longer justify what they hold, so it is withdrawn — but
    // reversibly, because absence of evidence is not proof of wrongdoing.
    case 'INSUFFICIENT_EVIDENCE':
      return 'SUSPEND'
    case 'UNCERTAIN':
      return 'ATTENUATE'
    default:
      return 'NONE'
  }
}

/** How much an ATTENUATE narrows an amount ceiling. */
export function attenuatedLimit(current: string | null, divisor: number): string | null {
  if (current === null) return null
  try {
    const value = BigInt(current)
    const reduced = value / BigInt(Math.max(2, Math.floor(divisor)))
    return reduced.toString()
  } catch {
    return current
  }
}

export interface MutationResult {
  actorId: string
  previousBand: string | null
  currentBand: string
  degraded: boolean
  consequence: MutationConsequence
  capabilitiesAffected: number
  snapshotId: string
  /** True when a running workflow was told about this. */
  workflowsSignalled: number
}

/**
 * Re-evaluates one actor against fresh evidence and applies the consequences.
 *
 * The previous band comes from the actor's LAST snapshot, read before the new
 * one is written — append-only history is what makes "did this get worse?"
 * answerable at all.
 */
export async function applyTrustMutation(
  actorId: string,
  opts: { reason?: string; attenuationDivisor?: number } = {},
): Promise<MutationResult> {
  const previous = await prisma.trustSnapshot.findFirst({
    where: { actorId },
    orderBy: { createdAt: 'desc' },
    select: { overallBand: true },
  })
  const previousBand = previous?.overallBand ?? null

  const trust = await buildTrustContext(actorId)
  const currentBand = trust.band

  // A first-ever snapshot has nothing to compare against. Treating "no prior
  // band" as a degradation would punish every actor the moment they are first
  // seen, which is the cold-start mistake in yet another costume.
  const degraded = previousBand !== null && isDegradation(previousBand, currentBand)
  const consequence = previousBand === null ? 'NONE' : decideConsequence(previousBand, currentBand)

  let capabilitiesAffected = 0
  if (consequence !== 'NONE') {
    capabilitiesAffected = await applyConsequence(actorId, consequence, opts.attenuationDivisor ?? 2)

    await recordTrustSignal({
      actorId,
      kind: 'BEHAVIOR_DRIFT',
      weight: consequence === 'REVOKE' ? 1 : 0.6,
      detail: `trust ${previousBand} -> ${currentBand}; ${consequence} applied to ${capabilitiesAffected} capabilities`,
      source: opts.reason ?? 'live-trust-mutation',
    })

    logger.warn(
      { actorId, previousBand, currentBand, consequence, capabilitiesAffected },
      'live trust change altered authority',
    )
  }

  const workflowsSignalled = degraded
    ? await signalRunningWorkflows(actorId, currentBand, trust.snapshotId)
    : 0

  return {
    actorId,
    previousBand,
    currentBand,
    degraded,
    consequence,
    capabilitiesAffected,
    snapshotId: trust.snapshotId,
    workflowsSignalled,
  }
}

async function applyConsequence(
  actorId: string,
  consequence: MutationConsequence,
  divisor: number,
): Promise<number> {
  if (consequence === 'REVOKE') {
    const { count } = await prisma.capability.updateMany({
      where: { actorId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      data: { status: 'REVOKED' },
    })
    return count
  }

  if (consequence === 'SUSPEND') {
    // Reversible on purpose. If the actor becomes measurable again, an operator
    // or a lease re-check can restore this; a revoke could not be undone.
    const { count } = await prisma.capability.updateMany({
      where: { actorId, status: 'ACTIVE' },
      data: { status: 'SUSPENDED' },
    })
    return count
  }

  // ATTENUATE narrows every amount ceiling rather than removing authority.
  // An actor who became merely uncertain has done nothing wrong, and stripping
  // them entirely is the false-positive behaviour this project exists to avoid.
  const capabilities = await prisma.capability.findMany({
    where: { actorId, status: 'ACTIVE', amountLimit: { not: null } },
    select: { id: true, amountLimit: true },
  })
  let affected = 0
  for (const capability of capabilities) {
    const reduced = attenuatedLimit(capability.amountLimit, divisor)
    if (reduced === null || reduced === capability.amountLimit) continue
    await prisma.capability.update({
      where: { id: capability.id },
      data: { amountLimit: reduced, capabilityType: 'ATTENUATED_GRANT' },
    })
    affected++
  }
  return affected
}

/**
 * Tells any running workflow that trust moved under it.
 *
 * Section 13.2 puts a Temporal signal in the live path precisely so a workflow
 * parked waiting for a human re-evaluates instead of acting on the picture it
 * had when it started. Best-effort: Temporal being down must not stop the
 * capability changes above, which are the actual enforcement.
 */
async function signalRunningWorkflows(
  actorId: string,
  band: string,
  snapshotId: string,
): Promise<number> {
  const { isTemporalEnabled, getTemporalClient } = await import('../workflow/temporal-client.js')
  if (!isTemporalEnabled()) return 0

  // Only intents still awaiting a decision have a workflow worth waking.
  const pending = await prisma.intent.findMany({
    where: { actorId, status: 'PENDING' },
    select: { id: true },
    take: 25,
  })
  if (pending.length === 0) return 0

  let signalled = 0
  try {
    const client = await getTemporalClient()
    const { authorizationWorkflowId, trustChangedSignal } = await import('../workflow/shared.js')

    for (const intent of pending) {
      try {
        const handle = client.workflow.getHandle(authorizationWorkflowId(intent.id))
        await handle.signal(trustChangedSignal, { band, snapshotId })
        signalled++
      } catch {
        // No such workflow, or it already completed. Neither is an error — most
        // intents never start one.
      }
    }
  } catch (err) {
    logger.warn({ actorId, err }, 'could not signal workflows about a trust change')
  }
  return signalled
}

/**
 * Every actor whose trust depends on a wallet.
 *
 * A cluster's risk is shared, so one member's new evidence moves everyone in
 * it — which is the entire reason the cluster is the unit of analysis.
 */
export async function actorsForWallets(wallets: readonly string[]): Promise<string[]> {
  if (wallets.length === 0) return []
  const identities = await prisma.actorIdentity.findMany({
    where: { kind: 'WALLET', externalId: { in: wallets.map((w) => w.toLowerCase()) } },
    select: { actorId: true },
  })
  return [...new Set(identities.map((i) => i.actorId))]
}
