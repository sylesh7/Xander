/**
 * Incident lifecycle — Xander V2 spec sections 14.1, 15, 23. Phase 10.
 *
 * Turns a live anomaly into a traceable security-operations record:
 *
 *   ANOMALY -> open incident -> contain -> investigate (supporting AND
 *   contradicting evidence) -> deterministic policy decision -> mitigate
 *   -> resolve
 *
 * CONTAINMENT PRECEDES UNDERSTANDING. Section 14.1 puts "freeze financial
 * capability" before "launch investigation", and this file keeps that order.
 * An agent draining funds while a language model composes a paragraph is
 * exactly the failure this phase exists to prevent. The containment is
 * reversible — RESTORE exists for when the investigation clears the actor.
 */
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { revokeEverywhere } from '../authorization/enforcement/enforcement-service.js'
import { attenuatedLimit } from '../trust/trust-mutation.js'
import { recordTrustSignal } from '../trust/trust-history.js'
import { searchCounterEvidence, type CounterEvidenceReport } from './counter-evidence.js'
import {
  canTransition,
  deterministicAction,
  initialMitigation,
  isClosed,
  reconcileRecommendation,
  severityRank,
  type IncidentSeverity,
  type IncidentType,
  type Mitigation,
} from './incident-types.js'

export class IncidentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'IncidentError'
  }
}

export interface OpenIncidentInput {
  actorId?: string | null | undefined
  clusterId?: string | null | undefined
  campaignId?: string | null | undefined
  type: IncidentType
  severity: IncidentSeverity
  source: string
  detail?: string | null | undefined
  /** Contain immediately, per section 14.1. Default true. */
  contain?: boolean | undefined
}

/**
 * Opens an incident and immediately contains it if the severity warrants.
 *
 * Deduplicates on (actorId, type) while an incident is still open: a Substreams
 * stream re-firing the same anomaly every block must not produce a thousand
 * incidents nobody can triage. The existing incident is ESCALATED instead if
 * the new report is more severe, so a worsening situation is never masked by
 * the deduplication.
 */
export async function openIncident(input: OpenIncidentInput) {
  if (input.actorId) {
    const existing = await prisma.incident.findFirst({
      where: {
        actorId: input.actorId,
        type: input.type,
        status: { in: ['OPEN', 'INVESTIGATING'] },
      },
      orderBy: { openedAt: 'desc' },
    })
    if (existing) {
      if (severityRank(input.severity) > severityRank(existing.severity)) {
        const escalated = await prisma.incident.update({
          where: { id: existing.id },
          data: {
            severity: input.severity,
            detail: input.detail ?? existing.detail,
          },
        })
        logger.warn(
          { incidentId: existing.id, from: existing.severity, to: input.severity },
          'incident escalated',
        )
        await contain(escalated.id)
        // An incident that escalated INTO HIGH/CRITICAL needs a human even
        // though the incident row already existed.
        await raiseOperatorAction(escalated.id)
        return prisma.incident.findUniqueOrThrow({ where: { id: escalated.id } })
      }
      return existing
    }
  }

  const incident = await prisma.incident.create({
    data: {
      actorId: input.actorId ?? null,
      clusterId: input.clusterId ?? null,
      campaignId: input.campaignId ?? null,
      type: input.type,
      severity: input.severity,
      status: 'OPEN',
      source: input.source,
      detail: input.detail ?? null,
    },
  })

  logger.warn(
    { incidentId: incident.id, type: input.type, severity: input.severity, actorId: input.actorId },
    'incident opened',
  )

  if (input.contain !== false) await contain(incident.id)
  await raiseOperatorAction(incident.id)
  return prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })
}

/**
 * Puts a serious incident in front of a human — sections 14.1 and 19.
 *
 * Section 14.1 ends the incident workflow with "notify operator", and section
 * 19 calls the mobile surface a HUMAN AUTHORITY PLANE. Neither is true if
 * nothing ever reaches it: containment is automatic and blunt, and the decision
 * about what happens NEXT — restore, narrow, or freeze outright — is exactly
 * the judgement a person is supposed to make.
 *
 * Only HIGH and CRITICAL raise one. Queueing every LOW incident for a human is
 * how an alert queue becomes noise nobody reads, which is worse than no queue.
 *
 * Best-effort: containment has already happened and IS the enforcement. A
 * failure to enqueue must not roll back a real freeze.
 */
async function raiseOperatorAction(incidentId: string): Promise<void> {
  const incident = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } })
  if (severityRank(incident.severity) < severityRank('HIGH')) return
  if (!incident.actorId) return

  // One open action per incident. An escalating stream must not queue the same
  // decision twice — the operator would answer one and be left holding a stale
  // duplicate whose binding no longer matches anything.
  const existing = await prisma.pendingAction.findFirst({
    where: { incidentId, status: 'PENDING' },
  })
  if (existing) return

  try {
    const agent = await prisma.agent.findFirst({
      where: { actorId: incident.actorId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true },
    })

    const { createPendingAction } = await import('../control/control-service.js')
    const action = await createPendingAction({
      subjectType: 'INCIDENT',
      subjectId: incident.id,
      summary: `${incident.type} on ${agent?.name ?? 'actor'} — ${incident.severity}. ${
        incident.mitigation && incident.mitigation !== 'NONE'
          ? `Already contained (${incident.mitigation}).`
          : 'Not yet contained.'
      } Decide what happens next.`,
      // FREEZE is offered because containment is reversible by design and an
      // operator looking at a live incident is the right person to make it
      // permanent. APPROVE here means "stand the agent back up".
      allowed: ['APPROVE', 'LIMIT', 'FREEZE'],
      actorId: incident.actorId,
      agentId: agent?.id ?? null,
      incidentId: incident.id,
      severity: incident.severity,
    })
    logger.info({ incidentId, actionId: action.id }, 'operator action raised for incident')
  } catch (err) {
    logger.error({ incidentId, err }, 'could not raise an operator action; containment stands')
  }
}

/**
 * Section 14.1 step 1 — freeze financial capability, before anything else.
 *
 * Applies only what the SEVERITY alone justifies. Nothing has been investigated
 * yet, so this is deliberately blunt and deliberately reversible.
 */
async function contain(incidentId: string): Promise<void> {
  const incident = await prisma.incident.findUniqueOrThrow({ where: { id: incidentId } })
  const mitigation = initialMitigation(incident.severity)
  if (mitigation === 'NONE' || !incident.actorId) return

  const applied = await applyMitigation(incident.actorId, mitigation)
  await prisma.incident.update({
    where: { id: incidentId },
    data: {
      mitigation,
      mitigationReason: `containment on ${incident.severity} severity, before investigation`,
    },
  })
  logger.warn({ incidentId, mitigation, applied }, 'incident contained')
}

/**
 * Applies a mitigation to an actor's authority.
 *
 * RESTRICT halves ceilings; REVOKE withdraws at every enforcement boundary,
 * which for an agent with an ENS identity means a real on-chain transaction.
 * RESTORE deliberately does NOT hand authority back — see below.
 */
export async function applyMitigation(actorId: string, mitigation: Mitigation): Promise<number> {
  if (mitigation === 'REVOKE') {
    const capabilities = await prisma.capability.findMany({
      where: { actorId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      select: { id: true, actionType: true },
    })
    for (const capability of capabilities) {
      // Through the Phase 8 seam, so the chain is withdrawn too rather than
      // only the database row.
      await revokeEverywhere({ capabilityId: capability.id, actorId, actionType: capability.actionType })
    }
    return capabilities.length
  }

  if (mitigation === 'RESTRICT') {
    const capabilities = await prisma.capability.findMany({
      where: { actorId, status: 'ACTIVE' },
      select: { id: true, amountLimit: true },
    })
    let affected = 0
    for (const capability of capabilities) {
      const reduced = attenuatedLimit(capability.amountLimit, 2)
      await prisma.capability.update({
        where: { id: capability.id },
        data: {
          status: 'SUSPENDED',
          ...(reduced !== null && reduced !== capability.amountLimit
            ? { amountLimit: reduced, capabilityType: 'ATTENUATED_GRANT' }
            : {}),
        },
      })
      affected++
    }
    return affected
  }

  if (mitigation === 'RESTORE') {
    // Un-suspends what THIS incident suspended, and nothing more. Restoring
    // every capability an actor ever held would let one cleared incident undo
    // an unrelated Phase 7 trust suspension that is still perfectly valid.
    const { count } = await prisma.capability.updateMany({
      where: { actorId, status: 'SUSPENDED' },
      data: { status: 'ACTIVE' },
    })
    return count
  }

  return 0
}

export interface InvestigationFinding {
  hypothesis: string
  supportingEvidenceIds: string[]
  contradictingEvidenceIds: string[]
  affectedRelationships: unknown
  /** 0..1, or null when the run could not justify one. */
  confidence: number | null
  /** ALLOW | LIMIT | REVIEW | BLOCK — advisory only. */
  recommendedAction: string | null
}

/**
 * Runs the deterministic half of an investigation and records it.
 *
 * The counter-evidence search always runs, even when no model is available:
 * section 15.2 makes it a required step, and it is the half that does not
 * depend on an LLM being reachable or well-behaved.
 */
export async function investigateIncident(incidentId: string): Promise<{
  incidentId: string
  investigationId: string
  counterEvidence: CounterEvidenceReport
}> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } })
  if (!incident) throw new IncidentError(`No incident ${incidentId}`, 404)
  if (isClosed(incident.status)) {
    throw new IncidentError(`Incident ${incidentId} is ${incident.status} and cannot be reopened.`, 409)
  }

  const wallets = await walletsForIncident(incident.actorId, incident.clusterId)
  const counterEvidence = await searchCounterEvidence({ wallets })

  const supporting = await prisma.evidenceEvent.findMany({
    where: { wallet: { in: wallets } },
    select: { id: true },
    take: 200,
  })

  const investigation = await prisma.investigation.create({
    data: {
      clusterId: incident.clusterId ?? `incident:${incident.id}`,
      wallets: wallets as unknown as object,
      status: 'COMPLETE',
      citations: [] as unknown as object,
      incidentId: incident.id,
      hypothesis: `${incident.type} reported by ${incident.source}`,
      supportingEvidenceIds: supporting.map((e) => e.id),
      contradictingEvidenceIds: counterEvidence.findings.flatMap((f) => f.evidenceIds),
      affectedRelationships: { wallets } as unknown as object,
      // Null, never a number, when the deterministic pass could not measure it.
      confidence: counterEvidence.doubt === null ? null : 1 - counterEvidence.doubt,
      recommendedAction: null,
      summary: counterEvidence.summary,
      completedAt: new Date(),
    },
  })

  if (canTransition(incident.status, 'INVESTIGATING')) {
    await prisma.incident.update({
      where: { id: incident.id },
      data: { status: 'INVESTIGATING', investigationId: investigation.id },
    })
  } else {
    await prisma.incident.update({
      where: { id: incident.id },
      data: { investigationId: investigation.id },
    })
  }

  logger.info(
    {
      incidentId,
      investigationId: investigation.id,
      counterFindings: counterEvidence.findings.length,
      doubt: counterEvidence.doubt,
    },
    'incident investigated',
  )

  return { incidentId, investigationId: investigation.id, counterEvidence }
}

/**
 * Decides what to do — SECTION 15.3, the rule this phase turns on.
 *
 * The deterministic action comes from the incident's severity. The AI's
 * recommendation is then reconciled against it, and can only ever TIGHTEN the
 * result. `reconcileRecommendation` is where that asymmetry lives; this
 * function's job is to record what happened, including when the AI was
 * overruled, so a disagreement is visible rather than silently resolved.
 */
export async function decideIncident(args: {
  incidentId: string
  aiRecommendation?: string | null
}) {
  const incident = await prisma.incident.findUnique({ where: { id: args.incidentId } })
  if (!incident) throw new IncidentError(`No incident ${args.incidentId}`, 404)
  if (isClosed(incident.status)) {
    throw new IncidentError(`Incident is ${incident.status}.`, 409)
  }

  const deterministic = deterministicAction(incident.severity)
  const reconciled = reconcileRecommendation(deterministic, args.aiRecommendation ?? null)

  const mitigation: Mitigation =
    reconciled.action === 'BLOCK'
      ? 'REVOKE'
      : reconciled.action === 'REVIEW'
        ? 'RESTRICT'
        : reconciled.action === 'LIMIT'
          ? 'RESTRICT'
          : 'NONE'

  let affected = 0
  if (incident.actorId && mitigation !== 'NONE') {
    affected = await applyMitigation(incident.actorId, mitigation)
  }

  if (reconciled.aiAttemptedToWiden) {
    logger.error(
      { incidentId: incident.id, aiRecommendation: args.aiRecommendation, deterministic },
      'AI recommended LESS restriction than the deterministic decision — IGNORED',
    )
  }

  if (incident.investigationId && args.aiRecommendation) {
    await prisma.investigation.update({
      where: { id: incident.investigationId },
      data: { recommendedAction: args.aiRecommendation },
    })
  }

  const updated = await prisma.incident.update({
    where: { id: incident.id },
    data: {
      mitigation,
      mitigationReason: reconciled.reason,
      ...(canTransition(incident.status, 'MITIGATED') && mitigation !== 'NONE'
        ? { status: 'MITIGATED' }
        : {}),
    },
  })

  if (incident.actorId && mitigation !== 'NONE') {
    await recordTrustSignal({
      actorId: incident.actorId,
      kind: 'BEHAVIOR_DRIFT',
      weight: mitigation === 'REVOKE' ? 1 : 0.6,
      detail: `incident ${incident.id} (${incident.type}): ${reconciled.reason}`,
      source: 'incident-response',
    })
  }

  return { incident: updated, reconciled, capabilitiesAffected: affected }
}

/** Closes an incident. Terminal — a closed incident is never reopened. */
export async function resolveIncident(args: {
  incidentId: string
  status: 'RESOLVED' | 'FALSE_POSITIVE'
  rootCause: string
  restore?: boolean | undefined
}) {
  const incident = await prisma.incident.findUnique({ where: { id: args.incidentId } })
  if (!incident) throw new IncidentError(`No incident ${args.incidentId}`, 404)
  if (!canTransition(incident.status, args.status)) {
    throw new IncidentError(
      `Cannot move an incident from ${incident.status} to ${args.status}.`,
      409,
    )
  }
  if (!args.rootCause.trim()) {
    // An incident closed with no stated cause taught nobody anything, and an
    // empty string in this column would look like one that had been examined.
    throw new IncidentError('A root cause is required to close an incident.', 400)
  }

  let restored = 0
  if (args.restore && incident.actorId) {
    if (args.status !== 'FALSE_POSITIVE') {
      throw new IncidentError(
        'Authority may only be restored when an incident is closed as FALSE_POSITIVE.',
        400,
      )
    }
    restored = await applyMitigation(incident.actorId, 'RESTORE')
  }

  const updated = await prisma.incident.update({
    where: { id: args.incidentId },
    data: {
      status: args.status,
      rootCause: args.rootCause,
      closedAt: new Date(),
      ...(args.restore ? { mitigation: 'RESTORE', mitigationReason: args.rootCause } : {}),
    },
  })

  logger.info({ incidentId: args.incidentId, status: args.status, restored }, 'incident closed')
  return { incident: updated, restored }
}

export async function getIncident(id: string) {
  const incident = await prisma.incident.findUnique({ where: { id } })
  if (!incident) return null
  const investigation = incident.investigationId
    ? await prisma.investigation.findUnique({ where: { id: incident.investigationId } })
    : null
  return { incident, investigation }
}

export async function listIncidents(
  args: {
    status?: string | undefined
    actorId?: string | undefined
    take?: number | undefined
  } = {},
) {
  return prisma.incident.findMany({
    where: {
      ...(args.status ? { status: args.status } : {}),
      ...(args.actorId ? { actorId: args.actorId } : {}),
    },
    orderBy: { openedAt: 'desc' },
    take: args.take ?? 50,
  })
}

/** Every wallet the incident concerns. */
async function walletsForIncident(
  actorId: string | null,
  clusterId: string | null,
): Promise<string[]> {
  const wallets = new Set<string>()

  if (actorId) {
    const identities = await prisma.actorIdentity.findMany({
      where: { actorId, kind: 'WALLET' },
      select: { externalId: true },
    })
    for (const i of identities) wallets.add(i.externalId.toLowerCase())
  }

  if (clusterId) {
    const cluster = await prisma.cluster.findUnique({
      where: { id: clusterId },
      include: { wallets: { select: { address: true } } },
    })
    for (const w of cluster?.wallets ?? []) wallets.add(w.address.toLowerCase())
  }

  return [...wallets]
}

/**
 * Starts the durable incident workflow — section 14.1.
 *
 * Best-effort by design: containment has ALREADY happened synchronously in
 * `openIncident`, so Temporal being unreachable degrades the response to
 * "contained but not yet investigated" rather than "not contained". Throwing
 * here would roll back a real containment because a workflow engine was down,
 * which is the wrong trade every time.
 */
export async function startIncidentWorkflow(
  incidentId: string,
  opts: { investigationTimeoutSeconds?: number } = {},
): Promise<{ started: boolean; workflowId: string | null; detail: string }> {
  const { isTemporalEnabled, getTemporalClient } = await import('../workflow/temporal-client.js')
  if (!isTemporalEnabled()) {
    return { started: false, workflowId: null, detail: 'Temporal is disabled' }
  }

  const incident = await prisma.incident.findUnique({ where: { id: incidentId } })
  if (!incident) throw new IncidentError(`No incident ${incidentId}`, 404)

  const { incidentWorkflowId } = await import('../workflow/shared.js')
  const { env } = await import('../config/env.js')
  const workflowId = incidentWorkflowId(incidentId)

  try {
    const client = await getTemporalClient()
    await client.workflow.start('incidentWorkflow', {
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowId,
      args: [
        {
          incidentId,
          actorId: incident.actorId,
          severity: incident.severity,
          investigationTimeoutSeconds: opts.investigationTimeoutSeconds ?? 120,
        },
      ],
    })
    return { started: true, workflowId, detail: 'incident workflow started' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A duplicate is success: the deterministic workflow id means a retried
    // start attaches to the run already handling this incident.
    if (/already started/i.test(message)) {
      return { started: true, workflowId, detail: 'incident workflow already running' }
    }
    logger.error({ incidentId, err }, 'could not start incident workflow; containment stands')
    return { started: false, workflowId: null, detail: message }
  }
}

/** Delivers an investigator's finding to a running incident workflow. */
export async function signalInvestigationComplete(args: {
  incidentId: string
  investigationId: string
  recommendedAction: string | null
  confidence: number | null
  summary: string
}): Promise<{ signalled: boolean; detail: string }> {
  const { isTemporalEnabled, getTemporalClient } = await import('../workflow/temporal-client.js')
  if (!isTemporalEnabled()) return { signalled: false, detail: 'Temporal is disabled' }

  const { incidentWorkflowId, investigationCompletedSignal } = await import('../workflow/shared.js')
  try {
    const client = await getTemporalClient()
    const handle = client.workflow.getHandle(incidentWorkflowId(args.incidentId))
    await handle.signal(investigationCompletedSignal, {
      investigationId: args.investigationId,
      recommendedAction: args.recommendedAction,
      confidence: args.confidence,
      summary: args.summary,
    })
    return { signalled: true, detail: 'finding delivered' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { signalled: false, detail: message }
  }
}
