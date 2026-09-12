/**
 * The native rule evaluator — Xander V2 spec section 20.
 *
 * Pure matching logic, separated from the loader so it can be unit-tested with
 * fabricated rules and no database.
 *
 * FIRST MATCH BY ASCENDING PRIORITY WINS. Ordering is therefore the policy
 * itself, which is why `priority` is unique per policy — two rules sharing a
 * priority would make the outcome depend on row order from Postgres.
 */
import {
  attenuateAmount,
  parseAmount,
  withinAmountLimit,
  type CapabilityLimits,
} from '../capabilities/capability-types.js'
import type { AuthorizationRequest, AuthorizationOutcome } from './policy-evaluator.js'
import type { AuthorizationResult } from '../intent/intent-types.js'

/** A rule as the engine reads it — the Prisma row shape, minus persistence. */
export interface Rule {
  id: string
  priority: number
  name: string
  actionType: string | null
  minAmount: string | null
  maxAmount: string | null
  trustBands: string[]
  maxCoordinationRisk: number | null
  minBehaviorIntegrity: number | null
  requiresLiveAssurance: boolean | null
  effect: string
  reasonCode: string
  limitAmount: string | null
  limitFrequency: number | null
  limitWindowSeconds: number | null
  capabilityTtlSeconds: number | null
}

/**
 * Does one rule match?
 *
 * Every condition is ANDed, and a null condition is skipped — a rule constrains
 * only what it names.
 *
 * A NULL TRUST DIMENSION NEVER SATISFIES A THRESHOLD. If a rule says
 * `maxCoordinationRisk: 0.3` and we could not measure coordination risk, the
 * rule does not match. That is the cold-start invariant carried into policy:
 * "we don't know" must not clear a bound that "we measured it as low" would.
 * Without this, an unmeasurable actor would satisfy every upper-bound rule and
 * fall straight through to the most permissive one.
 */
export function ruleMatches(rule: Rule, request: AuthorizationRequest): boolean {
  if (rule.actionType !== null && rule.actionType !== request.intent.actionType) return false

  if (rule.trustBands.length > 0 && !rule.trustBands.includes(request.trust.band)) return false

  const amount = parseAmount(request.intent.amount)

  if (rule.minAmount !== null) {
    const min = parseAmount(rule.minAmount)
    if (min !== null) {
      if (amount === null) return false
      if (amount < min) return false
    }
  }

  if (rule.maxAmount !== null) {
    const max = parseAmount(rule.maxAmount)
    if (max !== null) {
      if (amount === null) return false
      if (amount > max) return false
    }
  }

  if (rule.maxCoordinationRisk !== null) {
    const value = request.trust.coordinationRisk
    if (value === null) return false
    if (value > rule.maxCoordinationRisk) return false
  }

  if (rule.minBehaviorIntegrity !== null) {
    const value = request.trust.behaviorIntegrity
    if (value === null) return false
    if (value < rule.minBehaviorIntegrity) return false
  }

  if (rule.requiresLiveAssurance !== null) {
    if (rule.requiresLiveAssurance !== request.assurance.hasLiveLease) return false
  }

  return true
}

/** The first rule that matches, by ascending priority. */
export function selectRule(rules: readonly Rule[], request: AuthorizationRequest): Rule | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority)
  for (const rule of ordered) {
    if (ruleMatches(rule, request)) return rule
  }
  return null
}

function limitsFor(rule: Rule, now: Date): CapabilityLimits {
  return {
    amountLimit: rule.limitAmount,
    frequencyLimit: rule.limitFrequency,
    frequencyWindowSeconds: rule.limitWindowSeconds,
    allowedTargets: [],
    expiresAt:
      rule.capabilityTtlSeconds === null
        ? null
        : new Date(now.getTime() + rule.capabilityTtlSeconds * 1000),
  }
}

/**
 * Turns the matched rule into an outcome.
 *
 * THE DEFAULT WHEN NOTHING MATCHES IS REVIEW, NOT ALLOW. Section 27.5 is
 * fail-closed: an action no rule anticipated is an action nobody authorised.
 * A permissive default would mean every gap in the ruleset is a silent opening,
 * and gaps are exactly what a new action type introduces.
 */
export function applyRule(
  rule: Rule | null,
  request: AuthorizationRequest,
  context: { policyId: string | null; policyVersion: string; now: Date },
): AuthorizationOutcome {
  const base = {
    policyId: context.policyId,
    policyVersion: context.policyVersion,
    requiredAssurance: null as string | null,
  }

  if (rule === null) {
    return {
      ...base,
      result: 'REVIEW',
      reasonCode: 'NO_MATCHING_POLICY_RULE',
      reasonSummary:
        'No policy rule matched this request, so it is held for review rather than allowed.',
      ruleId: null,
      ruleName: null,
      limits: null,
      attenuated: false,
    }
  }

  const shared = {
    ...base,
    ruleId: rule.id,
    ruleName: rule.name,
    reasonCode: rule.reasonCode,
  }

  switch (rule.effect as AuthorizationResult) {
    case 'ALLOW':
      return {
        ...shared,
        result: 'ALLOW',
        reasonSummary: `Allowed by rule "${rule.name}".`,
        limits: limitsFor(rule, context.now),
        attenuated: false,
      }

    case 'LIMIT': {
      // Section 7.2 — reduce the grant rather than approve or reject outright.
      const granted = attenuateAmount(request.intent.amount, rule.limitAmount)
      const attenuated = !withinAmountLimit(request.intent.amount, rule.limitAmount)
      return {
        ...shared,
        result: 'LIMIT',
        reasonSummary: attenuated
          ? `Rule "${rule.name}" limited this action to ${granted ?? 'its ceiling'} from ${request.intent.amount ?? 'unspecified'}.`
          : `Allowed within the bounds of rule "${rule.name}".`,
        limits: { ...limitsFor(rule, context.now), amountLimit: rule.limitAmount },
        attenuated,
      }
    }

    case 'CHALLENGE':
      return {
        ...shared,
        result: 'CHALLENGE',
        reasonSummary: `Rule "${rule.name}" requires step-up assurance before this action.`,
        limits: null,
        attenuated: false,
        requiredAssurance: 'SELFIE_CHECK',
      }

    case 'REVIEW':
      return {
        ...shared,
        result: 'REVIEW',
        reasonSummary: `Rule "${rule.name}" holds this action for review.`,
        limits: null,
        attenuated: false,
      }

    case 'BLOCK':
      return {
        ...shared,
        result: 'BLOCK',
        reasonSummary: `Rule "${rule.name}" blocks this action.`,
        limits: null,
        attenuated: false,
      }

    default:
      // An unrecognised effect is a misconfigured rule, and a misconfigured
      // rule must not be permissive.
      return {
        ...shared,
        result: 'REVIEW',
        reasonCode: 'UNKNOWN_RULE_EFFECT',
        reasonSummary: `Rule "${rule.name}" has an unrecognised effect "${rule.effect}"; held for review.`,
        limits: null,
        attenuated: false,
      }
  }
}

/** Select then apply — the whole evaluation, as one pure function. */
export function evaluateRules(
  rules: readonly Rule[],
  request: AuthorizationRequest,
  context: { policyId: string | null; policyVersion: string; now: Date },
): AuthorizationOutcome {
  return applyRule(selectRule(rules, request), request, context)
}
