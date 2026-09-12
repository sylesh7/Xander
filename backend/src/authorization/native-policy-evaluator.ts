/**
 * The PolicyEvaluator implementation backed by rule rows.
 *
 * The only place that loads policy from the database. Everything else depends
 * on the `PolicyEvaluator` interface, so replacing this with a Cedar-backed
 * implementation later touches this file and the wiring, nothing more.
 */
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { evaluateRules, type Rule } from './rule-engine.js'
import type {
  AuthorizationOutcome,
  AuthorizationRequest,
  PolicyEvaluator,
} from './policy-evaluator.js'

interface CachedPolicy {
  loadedAtMs: number
  policyId: string | null
  version: string
  rules: Rule[]
}

let cache: CachedPolicy | null = null

/** Drops the cached ruleset. For tests and for an operator who just fixed a rule. */
export function resetPolicyCache(): void {
  cache = null
}

async function loadActiveRules(force = false): Promise<CachedPolicy> {
  const ttlMs = env.POLICY_CACHE_TTL_SECONDS * 1000
  if (!force && cache && Date.now() - cache.loadedAtMs < ttlMs) return cache

  const policy = await prisma.policy.findFirst({
    where: { active: true },
    include: { rules: { orderBy: { priority: 'asc' } } },
  })

  const loaded: CachedPolicy = policy
    ? {
        loadedAtMs: Date.now(),
        policyId: policy.id,
        version: policy.version,
        rules: policy.rules,
      }
    : { loadedAtMs: Date.now(), policyId: null, version: 'none', rules: [] }

  if (!policy) {
    // No active policy means no rule can match, and `applyRule` defaults to
    // REVIEW. That is the correct fail-closed behaviour, but it is also an
    // operational fault worth shouting about rather than absorbing quietly.
    logger.error('no active Policy row — every /v2 authorization will hold for REVIEW')
  }

  cache = loaded
  return loaded
}

export class NativePolicyEvaluator implements PolicyEvaluator {
  async evaluate(request: AuthorizationRequest): Promise<AuthorizationOutcome> {
    const { policyId, version, rules } = await loadActiveRules()
    const outcome = evaluateRules(rules, request, {
      policyId,
      policyVersion: version,
      now: new Date(),
    })

    logger.debug(
      {
        actorId: request.actor.id,
        actionType: request.intent.actionType,
        band: request.trust.band,
        result: outcome.result,
        rule: outcome.ruleName,
      },
      'policy evaluated',
    )
    return outcome
  }
}

/** The evaluator the rest of the backend uses. One instance, swappable here. */
export const policyEvaluator: PolicyEvaluator = new NativePolicyEvaluator()
