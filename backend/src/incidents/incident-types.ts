/**
 * Incident types and the AI-authority rule — Xander V2 spec sections 15.3, 23.
 *
 * Pure. No database, no network, no clock (times arrive as arguments).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE is section 15.3:
 *
 *   "The AI may recommend ALLOW / LIMIT / REVIEW / BLOCK, but the
 *    recommendation is passed back into deterministic policy evaluation.
 *    It is not itself the authorization authority."
 *
 * which is backend rule 5 — deterministic core, AI at the edges — in its
 * sharpest form. `reconcileRecommendation` below is where that is made
 * structural rather than aspirational.
 */

export const INCIDENT_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'MITIGATED',
  'FALSE_POSITIVE',
  'RESOLVED',
] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

export const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number]

export const INCIDENT_TYPES = [
  'COORDINATION_DETECTED',
  'TRUST_COLLAPSE',
  'ENFORCEMENT_FAILURE',
  'ASSURANCE_LAPSE',
  'ANOMALOUS_VELOCITY',
  'MANUAL',
] as const
export type IncidentType = (typeof INCIDENT_TYPES)[number]

/** What an investigator is allowed to suggest. Section 15.3. */
export const RECOMMENDED_ACTIONS = ['ALLOW', 'LIMIT', 'REVIEW', 'BLOCK'] as const
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number]

/** What Xander actually did. Section 14.1's RESTRICT / RESTORE / REVOKE. */
export const MITIGATIONS = ['NONE', 'RESTORE', 'RESTRICT', 'REVOKE'] as const
export type Mitigation = (typeof MITIGATIONS)[number]

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
}

/**
 * How serious, as a number.
 *
 * An unrecognised severity ranks as CRITICAL, not LOW. A severity we do not
 * understand is not a severity we may treat as harmless — the same reasoning
 * that makes an unknown trust band rank as unmeasurable in `trust-mutation.ts`.
 */
export function severityRank(severity: string): number {
  return SEVERITY_RANK[severity as IncidentSeverity] ?? SEVERITY_RANK.CRITICAL
}

/** Restrictiveness of an action, worst last. Used to compare, never to decide. */
const ACTION_RANK: Record<RecommendedAction, number> = {
  ALLOW: 0,
  LIMIT: 1,
  REVIEW: 2,
  BLOCK: 3,
}

export function actionRank(action: string): number {
  // An unparseable recommendation is treated as the most restrictive thing it
  // could have meant, so a garbled model response can never read as ALLOW.
  return ACTION_RANK[action as RecommendedAction] ?? ACTION_RANK.BLOCK
}

/** True when `a` is at least as restrictive as `b`. */
export function atLeastAsRestrictive(a: string, b: string): boolean {
  return actionRank(a) >= actionRank(b)
}

export interface Reconciliation {
  /** What will actually be applied. */
  action: RecommendedAction
  /** Whether the AI's suggestion changed the outcome at all. */
  aiChangedOutcome: boolean
  /** Whether the AI tried to loosen the deterministic decision. */
  aiAttemptedToWiden: boolean
  reason: string
}

/**
 * Combines a deterministic decision with an AI recommendation — SECTION 15.3.
 *
 * The asymmetry is the whole point, and it is not negotiable:
 *
 *   the AI may TIGHTEN the deterministic decision.
 *   the AI may NEVER loosen it.
 *
 * An investigator that can only escalate is useful — it finds things the
 * deterministic features missed, and a false escalation costs a human review.
 * An investigator that can de-escalate is an authorization bypass reachable by
 * prompt injection: any attacker who can get text into the evidence the model
 * reads can then argue their way out of a block. There is no amount of model
 * quality that makes that acceptable, so it is refused structurally here
 * rather than discouraged in a prompt.
 *
 * `deterministic` is the floor. The result is never below it.
 */
export function reconcileRecommendation(
  deterministic: string,
  aiRecommendation: string | null,
): Reconciliation {
  const floor = (ACTION_RANK[deterministic as RecommendedAction] ?? ACTION_RANK.BLOCK) as number
  const floorAction = (RECOMMENDED_ACTIONS.find((a) => ACTION_RANK[a] === floor) ??
    'BLOCK') as RecommendedAction

  if (aiRecommendation === null) {
    return {
      action: floorAction,
      aiChangedOutcome: false,
      aiAttemptedToWiden: false,
      reason: `no AI recommendation; deterministic ${floorAction} stands`,
    }
  }

  const aiRank = actionRank(aiRecommendation)

  if (aiRank > floor) {
    const escalated = (RECOMMENDED_ACTIONS.find((a) => ACTION_RANK[a] === aiRank) ??
      'BLOCK') as RecommendedAction
    return {
      action: escalated,
      aiChangedOutcome: true,
      aiAttemptedToWiden: false,
      reason: `investigation escalated ${floorAction} to ${escalated}`,
    }
  }

  if (aiRank < floor) {
    return {
      action: floorAction,
      aiChangedOutcome: false,
      aiAttemptedToWiden: true,
      // Recorded loudly. An investigator repeatedly arguing for less than the
      // deterministic floor is either miscalibrated or being manipulated, and
      // either way somebody needs to see it.
      reason: `investigation recommended ${aiRecommendation}, which is weaker than the deterministic ${floorAction}; IGNORED`,
    }
  }

  return {
    action: floorAction,
    aiChangedOutcome: false,
    aiAttemptedToWiden: false,
    reason: `investigation agreed with the deterministic ${floorAction}`,
  }
}

/**
 * Legal status moves — spec section 23.
 *
 * A closed incident is terminal. Reopening would let the same incident carry
 * two contradictory conclusions, and an incident log that can be rewritten is
 * not an audit trail.
 */
const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ['INVESTIGATING', 'MITIGATED', 'FALSE_POSITIVE', 'RESOLVED'],
  INVESTIGATING: ['MITIGATED', 'FALSE_POSITIVE', 'RESOLVED'],
  // Mitigated is not closed: the harm is contained but the cause is unexplained.
  MITIGATED: ['RESOLVED', 'FALSE_POSITIVE'],
  FALSE_POSITIVE: [],
  RESOLVED: [],
}

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from as IncidentStatus] ?? []).includes(to as IncidentStatus)
}

export function isClosed(status: string): boolean {
  return status === 'RESOLVED' || status === 'FALSE_POSITIVE'
}

/**
 * The mitigation a severity justifies on its own, before any investigation.
 *
 * Deliberately conservative: this runs on detection, when the least is known.
 * Section 14.1 puts "freeze financial capability" FIRST in the incident
 * workflow — containment precedes understanding, because an agent draining
 * funds while an LLM composes a paragraph is the failure this phase exists to
 * prevent. Reversible by design; RESTORE exists for exactly the case where the
 * investigation clears the actor.
 */
export function initialMitigation(severity: string): Mitigation {
  switch (severity as IncidentSeverity) {
    case 'LOW':
    case 'MEDIUM':
      // Containment costs the actor real authority. Applying it to every
      // incident would make the product unusable and train operators to
      // ignore incidents.
      return 'NONE'
    case 'HIGH':
      return 'RESTRICT'
    case 'CRITICAL':
      return 'REVOKE'
    default:
      // Fail CLOSED on a severity we do not recognise, matching
      // `severityRank`, which ranks the unknown as CRITICAL. Defaulting to
      // NONE here would have let a typo'd or newly-added severity through
      // uncontained while every other function in this file treated it as the
      // most serious thing there is.
      return 'REVOKE'
  }
}

/** The deterministic action a severity maps to, used as the floor above. */
export function deterministicAction(severity: string): RecommendedAction {
  switch (severity as IncidentSeverity) {
    case 'LOW':
      return 'ALLOW'
    case 'MEDIUM':
      return 'LIMIT'
    case 'HIGH':
      return 'REVIEW'
    case 'CRITICAL':
      return 'BLOCK'
    default:
      // Same fail-closed rule. This value becomes the FLOOR that the AI
      // recommendation is reconciled against, so an unrecognised severity
      // defaulting to ALLOW would hand the model an unrestricted floor to
      // agree with.
      return 'BLOCK'
  }
}
