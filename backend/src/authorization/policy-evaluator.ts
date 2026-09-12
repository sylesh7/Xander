/**
 * The policy abstraction — Xander V2 spec section 20.3.
 *
 * Everything downstream depends on THIS interface, never on the engine behind
 * it. Section 20.3 requires that so Cedar can be adopted later without the rest
 * of the backend importing Cedar types.
 *
 * Cedar was NOT adopted in Phase 3, deliberately. The spec says to use it "only
 * if it cleanly replaces or strengthens the existing policy engine", and every
 * condition this product actually has is a comparison against a trust vector we
 * compute ourselves. Adding a WASM policy runtime to evaluate `amount > 5000`
 * would buy a dependency, a second thing to review, and no expressiveness we
 * currently need. The native evaluator below sits behind this interface, so
 * swapping it later is a one-file change.
 */
import type { AuthorizationResult } from '../intent/intent-types.js'
import type { CapabilityLimits } from '../capabilities/capability-types.js'

/** Everything policy is allowed to see — spec section 20.1. */
export interface AuthorizationRequest {
  actor: {
    id: string
    actorType: string
    status: string
  }
  intent: {
    id: string
    actionType: string
    resourceType: string
    resourceId: string
    amount: string | null
    asset: string | null
    chainId: number | null
    targetAddress: string | null
  }
  trust: {
    band: string
    coordinationRisk: number | null
    behaviorIntegrity: number | null
    evidenceFreshness: number | null
    snapshotId: string | null
  }
  /** Whether a live assurance lease backs this actor right now. */
  assurance: {
    hasLiveLease: boolean
    level: string | null
    expiresAt: Date | null
  }
  /** Capabilities the actor already holds for this action. */
  currentCapabilities: Array<{
    id: string
    actionType: string
    amountLimit: string | null
    expiresAt: Date | null
  }>
}

export interface AuthorizationOutcome {
  result: AuthorizationResult
  reasonCode: string
  reasonSummary: string
  /** The rule that decided this, for audit. Null when no rule matched. */
  ruleId: string | null
  ruleName: string | null
  policyId: string | null
  policyVersion: string
  /** Present for ALLOW and LIMIT — the bounds of the capability to grant. */
  limits: CapabilityLimits | null
  /** True when the granted amount is below what was requested. */
  attenuated: boolean
  requiredAssurance: string | null
}

/**
 * The seam. The rest of the backend calls this and nothing else.
 */
export interface PolicyEvaluator {
  evaluate(request: AuthorizationRequest): Promise<AuthorizationOutcome>
}
