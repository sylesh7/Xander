/**
 * The high-value authorization workflow — Xander V2 spec section 14.1.
 *
 *   load trust -> policy -> [challenge] -> WAIT for assurance
 *              -> WAIT for a human -> re-evaluate -> grant -> receipt
 *
 * DETERMINISTIC CODE ONLY. No `Date.now()`, no `Math.random()`, no database, no
 * fetch. Temporal replays this function from history after every worker
 * restart, and anything that could answer differently on replay would corrupt
 * the run. All I/O is in `activities.ts`; time comes from `sleep`/`condition`.
 *
 * Why this exists at all: the synchronous `/v2/intents` path has to answer
 * inside one HTTP request, so a CHALLENGE just records that assurance is
 * needed. This is the same decision spread over minutes or hours — waiting for
 * a person, surviving a deploy, and re-checking whether the answer still holds
 * before acting on it.
 */
import {
  condition,
  defineQuery,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow'
import type * as activities from './activities.js'
import {
  assuranceCompletedSignal,
  authorizationStateQuery,
  operatorDecisionSignal,
  trustChangedSignal,
  type AssuranceProof,
  type AuthorizationWorkflowInput,
  type AuthorizationWorkflowOutput,
  type AuthorizationWorkflowState,
  type OperatorDecision,
  type WorkflowPhase,
} from './shared.js'

const {
  loadTrust,
  evaluatePolicy,
  grantCapabilityActivity,
  recordDecision,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    // Trust and policy both reach out to Postgres and The Graph. A transient
    // failure there should be retried, not turned into a denied authorization
    // — section 29 is explicit that a transport failure is never a verdict.
    initialInterval: '2s',
    maximumInterval: '30s',
    maximumAttempts: 5,
  },
})

/** Exposed so a test or an operator console can read progress without a signal. */
export const phaseQuery = defineQuery<WorkflowPhase>('phase')

export async function authorizationWorkflow(
  input: AuthorizationWorkflowInput,
): Promise<AuthorizationWorkflowOutput> {
  const history: string[] = []
  let phase: WorkflowPhase = 'EVALUATING'
  let operatorDecision: OperatorDecision | null = null
  let assurance: AssuranceProof | null = null
  let trustBand: string | null = null
  let trustChangedDuringWait = false

  // Read through functions. TypeScript's control-flow analysis cannot see that
  // a Temporal signal handler assigns these, so it narrows them to `null` and
  // every later branch to `never`. A call boundary returns the declared type.
  const currentDecision = (): OperatorDecision | null => operatorDecision
  const currentAssurance = (): AssuranceProof | null => assurance

  const note = (message: string): void => {
    history.push(message)
  }

  // Handlers are registered BEFORE the first await. A signal that arrives while
  // the workflow is still starting is buffered by Temporal and delivered here;
  // registering later would drop it.
  setHandler(operatorDecisionSignal, (decision) => {
    operatorDecision = decision
    note(`operator ${decision.command} by ${decision.operatorId}`)
  })
  setHandler(assuranceCompletedSignal, (proof) => {
    assurance = proof
    note(`assurance completed at ${proof.level}`)
  })
  setHandler(trustChangedSignal, (change) => {
    trustChangedDuringWait = true
    note(`trust changed to ${change.band} while waiting`)
  })

  setHandler(phaseQuery, () => phase)
  setHandler(
    authorizationStateQuery,
    (): AuthorizationWorkflowState => ({
      intentId: input.intentId,
      actorId: input.actorId,
      phase,
      result: null,
      trustBand,
      awaiting:
        phase === 'AWAITING_ASSURANCE'
          ? 'assurance'
          : phase === 'AWAITING_OPERATOR'
            ? 'operator'
            : null,
      operatorDecision: currentDecision(),
      assurance: currentAssurance(),
      history: [...history],
    }),
  )

  // --- first pass ------------------------------------------------------------
  let trust = await loadTrust(input.actorId)
  trustBand = trust.band
  note(`trust ${trust.band}`)

  let outcome = await evaluatePolicy({
    intentId: input.intentId,
    actorId: input.actorId,
    actionType: input.actionType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    amount: input.amount,
    trust,
  })
  note(`policy ${outcome.result} (${outcome.reasonCode})`)

  let timedOut = false

  // --- wait for assurance, if policy asked for it ----------------------------
  if (outcome.result === 'CHALLENGE') {
    phase = 'AWAITING_ASSURANCE'
    note('awaiting assurance')
    const got = await condition(
      () => currentAssurance() !== null || currentDecision() !== null,
      `${input.approvalTimeoutSeconds}s`,
    )
    if (!got) {
      timedOut = true
      note('assurance timed out')
    }
  }

  // --- wait for a human on anything still not settled ------------------------
  // REVIEW means no rule could authorise this, so a person decides. BLOCK does
  // not wait: a blocked action is not pending, and holding a worker open for an
  // approval that policy has already refused would invite one.
  if (!timedOut && outcome.result === 'REVIEW' && currentDecision() === null) {
    phase = 'AWAITING_OPERATOR'
    note('awaiting operator')
    const got = await condition(
      () => currentDecision() !== null,
      `${input.approvalTimeoutSeconds}s`,
    )
    if (!got) {
      timedOut = true
      note('operator approval timed out')
    }
  }

  // --- an operator refusal is final -----------------------------------------
  const decision = currentDecision()
  if (decision && (decision.command === 'DENY' || decision.command === 'REVOKE')) {
    phase = 'COMPLETE'
    note(`denied by operator (${decision.command})`)
    await recordDecision({
      intentId: input.intentId,
      actorId: input.actorId,
      outcome: { ...outcome, result: 'BLOCK', reasonCode: `OPERATOR_${decision.command}` },
      trust,
      capabilityId: null,
      workflowId: workflowInfo().workflowId,
    })
    return {
      intentId: input.intentId,
      result: 'BLOCK',
      reasonCode: `OPERATOR_${decision.command}`,
      capabilityId: null,
      trustBand,
      timedOut: false,
      history,
    }
  }

  // --- a timeout is not an approval -----------------------------------------
  // Section 27.5, fail closed. Nobody answered, so nothing is authorised.
  if (timedOut) {
    phase = 'TIMED_OUT'
    await recordDecision({
      intentId: input.intentId,
      actorId: input.actorId,
      outcome: { ...outcome, result: 'REVIEW', reasonCode: 'APPROVAL_TIMED_OUT' },
      trust,
      capabilityId: null,
      workflowId: workflowInfo().workflowId,
    })
    return {
      intentId: input.intentId,
      result: 'REVIEW',
      reasonCode: 'APPROVAL_TIMED_OUT',
      capabilityId: null,
      trustBand,
      timedOut: true,
      history,
    }
  }

  // --- re-evaluate before acting --------------------------------------------
  // The whole point of waiting durably. Assurance may now exist, or trust may
  // have moved while a human deliberated — approving against the picture we had
  // an hour ago would authorise something nobody actually assessed.
  if (currentAssurance() !== null || trustChangedDuringWait || decision !== null) {
    phase = 'RE_EVALUATING'
    note('re-evaluating after wait')
    trust = await loadTrust(input.actorId)
    trustBand = trust.band
    outcome = await evaluatePolicy({
      intentId: input.intentId,
      actorId: input.actorId,
      actionType: input.actionType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      amount: input.amount,
      trust,
    })
    note(`re-evaluated to ${outcome.result} at trust ${trust.band}`)
  }

  // An operator approval cannot overrule a policy that now says BLOCK. The
  // human is a gate in addition to policy, never a bypass of it — invariant
  // 3.1 keeps deterministic rules in charge of the security decision.
  if (outcome.result === 'BLOCK') {
    phase = 'COMPLETE'
    note('policy blocks after re-evaluation; operator approval does not override')
    await recordDecision({
      intentId: input.intentId,
      actorId: input.actorId,
      outcome,
      trust,
      capabilityId: null,
      workflowId: workflowInfo().workflowId,
    })
    return {
      intentId: input.intentId,
      result: 'BLOCK',
      reasonCode: outcome.reasonCode,
      capabilityId: null,
      trustBand,
      timedOut: false,
      history,
    }
  }

  // --- grant --------------------------------------------------------------
  let capabilityId: string | null = null
  if (outcome.result === 'ALLOW' || outcome.result === 'LIMIT') {
    phase = 'GRANTING'
    capabilityId = await grantCapabilityActivity({
      actorId: input.actorId,
      actionType: input.actionType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome,
      operatorLimitAmount: decision?.command === 'LIMIT' ? (decision.limitAmount ?? null) : null,
    })
    note(`capability ${capabilityId} granted`)
  }

  await recordDecision({
    intentId: input.intentId,
    actorId: input.actorId,
    outcome,
    trust,
    capabilityId,
    workflowId: workflowInfo().workflowId,
  })

  phase = 'COMPLETE'
  return {
    intentId: input.intentId,
    result: outcome.result,
    reasonCode: outcome.reasonCode,
    capabilityId,
    trustBand,
    timedOut: false,
    history,
  }
}
