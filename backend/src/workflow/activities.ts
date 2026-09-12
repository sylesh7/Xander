/**
 * Workflow activities — Xander V2 Phase 4.
 *
 * Every side effect a workflow needs lives here. Workflow code is replayed from
 * history on every worker restart, so it must be deterministic; activities are
 * the sanctioned escape hatch where a database read or a chain call is allowed
 * because their RESULT is recorded in history and replayed rather than re-run.
 *
 * These are thin on purpose. They call the same services the synchronous API
 * calls — there is no second implementation of trust or policy for the
 * workflow path, which is exactly how the two would drift apart.
 */
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { buildTrustContext } from '../trust/trust-context.js'
import { policyEvaluator } from '../authorization/native-policy-evaluator.js'
import { getLiveLease, grantCapability, revokeCapabilities } from '../capabilities/capability-service.js'
import type { AuthorizationResult } from '../intent/intent-types.js'

export interface TrustSummary {
  band: string
  snapshotId: string
  coordinationRisk: number | null
  behaviorIntegrity: number | null
  evidenceFreshness: number | null
}

/** Builds and persists a trust snapshot. Re-run on each re-evaluation. */
export async function loadTrust(actorId: string): Promise<TrustSummary> {
  const trust = await buildTrustContext(actorId)
  return {
    band: trust.band,
    snapshotId: trust.snapshotId,
    coordinationRisk: trust.vector.coordinationRisk.value,
    behaviorIntegrity: trust.vector.behaviorIntegrity.value,
    evidenceFreshness: trust.vector.evidenceFreshness.value,
  }
}

export interface PolicyOutcome {
  result: AuthorizationResult
  reasonCode: string
  reasonSummary: string
  requiredAssurance: string | null
  amountLimit: string | null
  frequencyLimit: number | null
  frequencyWindowSeconds: number | null
  expiresAtIso: string | null
  attenuated: boolean
  policyVersion: string
}

/**
 * Evaluates policy for an intent against current trust.
 *
 * Note it reads the live assurance lease itself rather than trusting a flag
 * passed down from the workflow: a lease can expire mid-wait, and a workflow
 * asserting "assurance was completed an hour ago" is not the same as assurance
 * being valid now.
 */
export async function evaluatePolicy(args: {
  intentId: string
  actorId: string
  actionType: string
  resourceType: string
  resourceId: string
  amount: string | null
  trust: TrustSummary
}): Promise<PolicyOutcome> {
  const actor = await prisma.actor.findUnique({ where: { id: args.actorId } })
  if (!actor) throw new Error(`No actor ${args.actorId}`)

  const lease = await getLiveLease(args.actorId)
  const currentCapabilities = await prisma.capability.findMany({
    where: { actorId: args.actorId, actionType: args.actionType, status: 'ACTIVE' },
    select: { id: true, actionType: true, amountLimit: true, expiresAt: true },
  })

  const outcome = await policyEvaluator.evaluate({
    actor: { id: actor.id, actorType: actor.actorType, status: actor.status },
    intent: {
      id: args.intentId,
      actionType: args.actionType,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      amount: args.amount,
      asset: null,
      chainId: null,
      targetAddress: null,
    },
    trust: {
      band: args.trust.band,
      coordinationRisk: args.trust.coordinationRisk,
      behaviorIntegrity: args.trust.behaviorIntegrity,
      evidenceFreshness: args.trust.evidenceFreshness,
      snapshotId: args.trust.snapshotId,
    },
    assurance: {
      hasLiveLease: lease !== null,
      level: lease?.level ?? null,
      expiresAt: lease?.expiresAt ?? null,
    },
    currentCapabilities,
  })

  return {
    result: outcome.result,
    reasonCode: outcome.reasonCode,
    reasonSummary: outcome.reasonSummary,
    requiredAssurance: outcome.requiredAssurance,
    amountLimit: outcome.limits?.amountLimit ?? null,
    frequencyLimit: outcome.limits?.frequencyLimit ?? null,
    frequencyWindowSeconds: outcome.limits?.frequencyWindowSeconds ?? null,
    expiresAtIso: outcome.limits?.expiresAt?.toISOString() ?? null,
    attenuated: outcome.attenuated,
    policyVersion: outcome.policyVersion,
  }
}

/** Mints the capability an ALLOW or LIMIT earned. */
export async function grantCapabilityActivity(args: {
  actorId: string
  actionType: string
  resourceType: string
  resourceId: string
  outcome: PolicyOutcome
  /** An operator-imposed ceiling overrides the policy's, when it is stricter. */
  operatorLimitAmount?: string | null
}): Promise<string> {
  const lease = await getLiveLease(args.actorId)

  // An operator lowering the ceiling must win; an operator RAISING it must not.
  // A human approving an action is approving that action, not granting
  // themselves the right to exceed the policy that governs it.
  let amountLimit = args.outcome.amountLimit
  if (args.operatorLimitAmount) {
    const operator = BigInt(args.operatorLimitAmount)
    const policyCeiling = amountLimit === null ? null : BigInt(amountLimit)
    amountLimit =
      policyCeiling === null || operator < policyCeiling
        ? args.operatorLimitAmount
        : amountLimit
  }

  const capability = await grantCapability({
    actorId: args.actorId,
    actionType: args.actionType,
    resourceScope: `${args.resourceType}:${args.resourceId}`,
    limits: {
      amountLimit,
      frequencyLimit: args.outcome.frequencyLimit,
      frequencyWindowSeconds: args.outcome.frequencyWindowSeconds,
      allowedTargets: [],
      expiresAt: args.outcome.expiresAtIso ? new Date(args.outcome.expiresAtIso) : null,
    },
    assuranceLeaseId: lease?.id ?? null,
    attenuated: args.outcome.attenuated || Boolean(args.operatorLimitAmount),
  })
  return capability.id
}

/** Records the decision and its receipt. */
export async function recordDecision(args: {
  intentId: string
  actorId: string
  outcome: PolicyOutcome
  trust: TrustSummary
  capabilityId: string | null
  workflowId: string
}): Promise<string> {
  const decision = await prisma.authorizationDecision.create({
    data: {
      intentId: args.intentId,
      trustSnapshotId: args.trust.snapshotId,
      policyVersion: args.outcome.policyVersion,
      result: args.outcome.result,
      reasonCode: args.outcome.reasonCode,
      reasonSummary: args.outcome.reasonSummary,
      evidenceIds: [],
      requiredAssurance: args.outcome.requiredAssurance,
      riskScore: args.trust.coordinationRisk ?? 0,
      clusterId: null,
      confidence: 'MEDIUM',
      capabilityId: args.capabilityId,
      workflowId: args.workflowId,
    },
  })

  await prisma.intent.update({
    where: { id: args.intentId },
    data: { status: 'DECIDED' },
  })

  logger.info(
    { intentId: args.intentId, result: args.outcome.result, workflowId: args.workflowId },
    'workflow decision recorded',
  )
  return decision.id
}

/** Capability state for the lease workflow to re-check. */
export async function readCapability(capabilityId: string): Promise<{
  exists: boolean
  status: string
  actorId: string
  actionType: string
  amountLimit: string | null
} | null> {
  const c = await prisma.capability.findUnique({ where: { id: capabilityId } })
  if (!c) return null
  return {
    exists: true,
    status: c.status,
    actorId: c.actorId,
    actionType: c.actionType,
    amountLimit: c.amountLimit,
  }
}

/** Extends a capability's expiry — the lease workflow's renewal step. */
export async function renewCapability(args: {
  capabilityId: string
  seconds: number
}): Promise<void> {
  await prisma.capability.update({
    where: { id: args.capabilityId },
    data: { expiresAt: new Date(Date.now() + args.seconds * 1000) },
  })
}

/** Lowers a capability's ceiling in place. */
export async function attenuateCapability(args: {
  capabilityId: string
  amountLimit: string
}): Promise<void> {
  await prisma.capability.update({
    where: { id: args.capabilityId },
    data: { amountLimit: args.amountLimit, capabilityType: 'ATTENUATED_GRANT' },
  })
}

/** Revokes every capability for an actor — the freeze path. */
export async function revokeActorCapabilities(args: {
  actorId: string
  reason: string
}): Promise<number> {
  return revokeCapabilities({ actorId: args.actorId, reason: args.reason })
}

// --- Phase 10: incident response (spec sections 14.1, 15, 23) --------------

/**
 * Runs the deterministic investigation — supporting AND counter-evidence.
 *
 * An activity rather than workflow code because it queries the database, which
 * a deterministic workflow sandbox cannot do.
 */
export async function investigateIncidentActivity(incidentId: string): Promise<{
  investigationId: string
  counterFindings: number
  doubt: number | null
  summary: string
}> {
  const { investigateIncident } = await import('../incidents/incident-service.js')
  const result = await investigateIncident(incidentId)
  return {
    investigationId: result.investigationId,
    counterFindings: result.counterEvidence.findings.length,
    doubt: result.counterEvidence.doubt,
    summary: result.counterEvidence.summary,
  }
}

/**
 * The deterministic policy decision — section 15.3.
 *
 * The AI recommendation arrives as an argument and can only tighten the result.
 */
export async function decideIncidentActivity(args: {
  incidentId: string
  aiRecommendation: string | null
}): Promise<{
  mitigation: string
  reason: string
  aiAttemptedToWiden: boolean
  capabilitiesAffected: number
}> {
  const { decideIncident } = await import('../incidents/incident-service.js')
  const result = await decideIncident(args)
  return {
    mitigation: result.incident.mitigation ?? 'NONE',
    reason: result.reconciled.reason,
    aiAttemptedToWiden: result.reconciled.aiAttemptedToWiden,
    capabilitiesAffected: result.capabilitiesAffected,
  }
}

/**
 * Tells an operator an incident needs them — section 14.1's final step.
 *
 * Logging IS the notification channel until Phase 11 gives Remote Authority a
 * real one. Named honestly rather than pretending to page somebody: a function
 * called `notifyOperator` that silently does nothing would be worse than one
 * that says where the notification went.
 */
export async function notifyOperatorActivity(args: {
  incidentId: string
  mitigation: string
  reason: string
}): Promise<{ delivered: boolean; channel: string }> {
  logger.warn(
    { incidentId: args.incidentId, mitigation: args.mitigation, reason: args.reason },
    'OPERATOR ATTENTION: incident mitigated',
  )
  return { delivered: true, channel: 'log' }
}
