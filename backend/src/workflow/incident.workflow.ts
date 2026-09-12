/**
 * The incident response workflow — Xander V2 spec section 14.1.
 *
 *   ANOMALY
 *    -> freeze financial capability
 *    -> launch investigation
 *    -> collect evidence
 *    -> wait AI investigation
 *    -> policy decision
 *    -> RESTRICT / RESTORE / REVOKE
 *    -> notify operator
 *
 * Durable because incident response is exactly the thing that must not be lost
 * to a process restart. A crashed in-memory handler leaves an actor frozen with
 * nothing scheduled to ever un-freeze it, or — worse — leaves a dangerous actor
 * un-frozen because the containment step never ran.
 *
 * TWO ORDERING DECISIONS THAT MATTER:
 *
 * 1. CONTAINMENT IS FIRST AND IS NOT CONDITIONAL ON THE INVESTIGATION. The
 *    spec's arrow order is deliberate and this workflow keeps it literally.
 *
 * 2. THE INVESTIGATION HAS A DEADLINE. If no finding arrives, the workflow
 *    decides WITHOUT one rather than waiting forever. An incident response that
 *    stalls because a model never answered is an incident response that failed,
 *    and the deterministic decision was always sufficient on its own — the AI
 *    can only tighten it (section 15.3).
 *
 * Deterministic — see the note in authorization.workflow.ts.
 */
import { condition, proxyActivities, setHandler } from '@temporalio/workflow'
import type * as activities from './activities.js'
import {
  incidentStateQuery,
  investigationCompletedSignal,
  type IncidentWorkflowInput,
  type IncidentWorkflowOutput,
  type InvestigationSignalPayload,
} from './shared.js'

const { investigateIncidentActivity, decideIncidentActivity, notifyOperatorActivity } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '5 minutes',
    retry: { initialInterval: '2s', maximumInterval: '30s', maximumAttempts: 3 },
  })

export async function incidentWorkflow(
  input: IncidentWorkflowInput,
): Promise<IncidentWorkflowOutput> {
  const history: string[] = []
  let phase = 'OPENED'
  let investigationId: string | null = null
  let mitigation: string | null = null
  let finding: InvestigationSignalPayload | null = null

  // Read through a function so TypeScript does not narrow the signal-assigned
  // variable to `null` — same reason as capability.workflow.ts.
  const currentFinding = (): InvestigationSignalPayload | null => finding

  setHandler(investigationCompletedSignal, (payload) => {
    finding = payload
    history.push(
      `investigation ${payload.investigationId} recommended ${payload.recommendedAction ?? 'nothing'}`,
    )
  })

  setHandler(incidentStateQuery, () => ({
    incidentId: input.incidentId,
    phase,
    // Containment already happened synchronously in `openIncident`; this
    // workflow's job is everything after it.
    contained: true,
    investigationId,
    mitigation,
    history: [...history],
  }))

  // --- collect evidence, both supporting and contradicting -----------------
  phase = 'INVESTIGATING'
  const investigation = await investigateIncidentActivity(input.incidentId)
  investigationId = investigation.investigationId
  history.push(
    `deterministic investigation found ${investigation.counterFindings} counter-finding(s)`,
  )

  // --- wait for the AI, but not forever ------------------------------------
  phase = 'AWAITING_INVESTIGATION'
  const arrived = await condition(
    () => currentFinding() !== null,
    `${input.investigationTimeoutSeconds} seconds`,
  )
  const timedOut = !arrived
  if (timedOut) {
    history.push('no AI finding within the deadline; deciding deterministically')
  }

  // --- the decision --------------------------------------------------------
  phase = 'DECIDING'
  const aiRecommendation = currentFinding()?.recommendedAction ?? null
  const decision = await decideIncidentActivity({
    incidentId: input.incidentId,
    aiRecommendation,
  })
  mitigation = decision.mitigation
  history.push(`${decision.mitigation}: ${decision.reason}`)

  if (decision.aiAttemptedToWiden) {
    // Surfaced in the workflow history, not only in a log line. An investigator
    // arguing for less than the deterministic floor is a signal in itself.
    history.push('AI recommended LESS restriction than policy required; ignored')
  }

  // --- notify ---------------------------------------------------------------
  phase = 'NOTIFYING'
  await notifyOperatorActivity({
    incidentId: input.incidentId,
    mitigation: decision.mitigation,
    reason: decision.reason,
  })

  phase = 'DONE'
  return {
    incidentId: input.incidentId,
    mitigation: decision.mitigation,
    aiRecommendation,
    aiAttemptedToWiden: decision.aiAttemptedToWiden,
    investigationId,
    timedOut,
    history,
  }
}
