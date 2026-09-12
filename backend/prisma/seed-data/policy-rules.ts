/**
 * The seeded V2 authorization policy — Xander V2 spec section 20.2.
 *
 * A CONFIGURABLE DEMO POLICY, NOT A VALIDATED MODEL — the same honesty V1's
 * risk weights carry. These thresholds are reasonable and explainable, not
 * fitted against labelled data.
 *
 * ORDERING IS THE POLICY. First match by ascending priority wins, so the
 * dangerous cases are numbered first and the permissive ones last. Read this
 * list top to bottom and you have read the authorization model.
 *
 * The three examples in section 20.2 are rules 30, 40 and 60 below.
 */
import type { AuthorizationResult } from '../../src/intent/intent-types.js'

export interface PolicyRuleSeed {
  priority: number
  name: string
  actionType?: string | null
  minAmount?: string | null
  maxAmount?: string | null
  trustBands?: string[]
  maxCoordinationRisk?: number | null
  minBehaviorIntegrity?: number | null
  requiresLiveAssurance?: boolean | null
  effect: AuthorizationResult
  reasonCode: string
  limitAmount?: string | null
  limitFrequency?: number | null
  limitWindowSeconds?: number | null
  capabilityTtlSeconds?: number | null
}

/**
 * Bump this whenever a rule changes — never edit a published version in place.
 *
 * `AuthorizationDecision.policyVersion` and `ActionReceipt.policyVersion` are
 * LINEAGE: they claim which rule set judged a request. Rewriting v2-1.0's rules
 * would make every receipt already citing it describe a policy that no longer
 * exists, and section 3.6's "every decision stores the policy version that
 * judged it" would become a lie.
 *
 * v2-1.1 adds the section 17 x402 commerce ladder (priorities 52-56).
 */
export const POLICY_VERSION = 'v2-1.1'
export const POLICY_NAME = 'Xander V2 default authorization policy'

/** USDC-style 6dp base units, so 100 USDC is 100_000_000. */
const USDC = (whole: number): string => (BigInt(whole) * 1_000_000n).toString()

export const POLICY_RULE_SEEDS: readonly PolicyRuleSeed[] = [
  // --- 10-29: hard stops. Nothing below can override these. -----------------
  {
    priority: 10,
    name: 'Block everything for a CRITICAL actor',
    trustBands: ['CRITICAL'],
    effect: 'BLOCK',
    reasonCode: 'TRUST_BAND_CRITICAL',
  },
  {
    priority: 20,
    name: 'Hold every action when evidence is insufficient',
    trustBands: ['INSUFFICIENT_EVIDENCE'],
    effect: 'REVIEW',
    reasonCode: 'INSUFFICIENT_EVIDENCE',
    // Invariant 3.2 in policy form. An actor we could not measure is not an
    // actor we can authorise, however small the request.
  },

  // --- 30-49: high-value actions --------------------------------------------
  {
    priority: 30,
    name: 'Borrowing is never authorised without human assurance',
    actionType: 'BORROW',
    requiresLiveAssurance: false,
    effect: 'CHALLENGE',
    reasonCode: 'BORROW_REQUIRES_ASSURANCE',
  },
  {
    priority: 31,
    name: 'Treasury-scale transfers need human assurance',
    actionType: 'TRANSFER',
    minAmount: USDC(5000),
    requiresLiveAssurance: false,
    effect: 'CHALLENGE',
    reasonCode: 'HIGH_VALUE_TRANSFER_REQUIRES_ASSURANCE',
    // Section 20.2's first example: TRANSFER above 5000 escalates.
  },
  {
    priority: 32,
    name: 'Large transfers from a low-integrity actor are challenged',
    actionType: 'TRANSFER',
    minAmount: USDC(1000),
    minBehaviorIntegrity: 0.8,
    effect: 'ALLOW',
    reasonCode: 'TRANSFER_WITHIN_INTEGRITY_BOUNDS',
    capabilityTtlSeconds: 3600,
  },
  {
    priority: 33,
    name: 'Large transfers otherwise require step-up',
    actionType: 'TRANSFER',
    minAmount: USDC(1000),
    effect: 'CHALLENGE',
    reasonCode: 'TRANSFER_INTEGRITY_UNPROVEN',
  },

  // --- 40-49: risk-banded trading -------------------------------------------
  {
    priority: 40,
    name: 'Trading is capped for an uncertain actor',
    actionType: 'TRADE',
    trustBands: ['UNCERTAIN'],
    effect: 'LIMIT',
    reasonCode: 'TRADE_LIMITED_UNCERTAIN_TRUST',
    limitAmount: USDC(500),
    limitFrequency: 20,
    limitWindowSeconds: 86_400,
    capabilityTtlSeconds: 86_400,
    // Section 20.2's third example: TRADE under UNCERTAIN is limited to 500.
  },
  {
    priority: 41,
    name: 'Trading is tightly capped for a high-risk actor',
    actionType: 'TRADE',
    trustBands: ['HIGH_RISK'],
    effect: 'LIMIT',
    reasonCode: 'TRADE_LIMITED_HIGH_RISK',
    limitAmount: USDC(100),
    limitFrequency: 5,
    limitWindowSeconds: 86_400,
    capabilityTtlSeconds: 3600,
  },
  {
    priority: 42,
    name: 'Established actors trade with a daily ceiling',
    actionType: 'TRADE',
    trustBands: ['ESTABLISHED_LOW', 'VERIFIED_LOW'],
    effect: 'LIMIT',
    reasonCode: 'TRADE_WITHIN_ESTABLISHED_BOUNDS',
    limitAmount: USDC(2000),
    limitFrequency: 100,
    limitWindowSeconds: 86_400,
    capabilityTtlSeconds: 86_400,
    // Section 7.3: even a trusted actor's trading authority is time-bound.
  },

  // --- 50-59: API and agent commerce ----------------------------------------
  {
    priority: 50,
    name: 'Unverified actors get a small API allowance',
    actionType: 'API_REQUEST',
    trustBands: ['UNCERTAIN'],
    effect: 'LIMIT',
    reasonCode: 'API_ALLOWANCE_UNCERTAIN',
    limitFrequency: 10,
    limitWindowSeconds: 86_400,
    capabilityTtlSeconds: 86_400,
  },
  {
    priority: 51,
    name: 'Established actors get a working API allowance',
    actionType: 'API_REQUEST',
    trustBands: ['ESTABLISHED_LOW', 'VERIFIED_LOW'],
    effect: 'LIMIT',
    reasonCode: 'API_ALLOWANCE_ESTABLISHED',
    limitFrequency: 500,
    limitWindowSeconds: 3600,
    capabilityTtlSeconds: 86_400,
  },

  // --- 52-56: x402 agent commerce. Section 17's ladder, as ROWS. ------------
  // The spec states it as:
  //     new agent          -> 10 requests/day
  //     human-backed agent -> 500 requests/hour
  //     trusted agent      -> 5000 requests/hour
  //     anomalous agent    -> 0
  // It lives here rather than in the x402 code so that repricing agent commerce
  // is an UPDATE, per section 0.2 rule 1 — and so an operator can read the
  // whole commercial policy in one table.
  //
  // WHAT "NEW AGENT" MEANS HERE, and what it does not. The bottom rung is rule
  // 56, UNCERTAIN: an agent we HAVE measured and found unremarkable. An actor
  // with no fresh evidence at all never reaches this table — `createIntent`
  // holds it for REVIEW at the section 27.5 fail-closed gate, before any rule
  // is consulted.
  //
  // That is deliberate and this ladder must not override it. An earlier draft
  // of this file carved out an INSUFFICIENT_EVIDENCE exception so the spec's
  // "new agent -> 10 requests/day" line would be literally reachable for a
  // brand-new wallet; it was removed. Prepayment bounds what an attacker
  // spends, but it does not make an unmeasurable actor measurable, and
  // invariant 3.2 outranks a convenience rung. In Xander an agent becomes
  // "new" rather than "unknown" by being created with an identity and
  // assurance, which gives it the evidence this table needs.
  {
    priority: 52,
    name: 'An anomalous actor may not buy anything',
    actionType: 'X402_PAYMENT',
    trustBands: ['HIGH_RISK', 'CRITICAL'],
    effect: 'BLOCK',
    reasonCode: 'X402_ANOMALOUS_ACTOR',
    // Stated explicitly even though the priority 10/20 hard stops already catch
    // these bands. Section 17's ladder has four rungs and all four should be
    // visible to whoever reads the policy, not three plus an inherited default.
  },
  {
    priority: 53,
    name: 'A trusted actor gets the full commerce allowance',
    actionType: 'X402_PAYMENT',
    trustBands: ['VERIFIED_LOW'],
    effect: 'LIMIT',
    reasonCode: 'X402_ALLOWANCE_TRUSTED',
    limitFrequency: 5000,
    limitWindowSeconds: 3600,
    capabilityTtlSeconds: 3600,
  },
  {
    priority: 54,
    name: 'A human-backed actor gets a working commerce allowance',
    actionType: 'X402_PAYMENT',
    trustBands: ['ESTABLISHED_LOW'],
    requiresLiveAssurance: true,
    effect: 'LIMIT',
    reasonCode: 'X402_ALLOWANCE_HUMAN_BACKED',
    limitFrequency: 500,
    limitWindowSeconds: 3600,
    capabilityTtlSeconds: 3600,
  },
  {
    priority: 55,
    name: 'An established actor without live assurance gets the new-agent rate',
    actionType: 'X402_PAYMENT',
    trustBands: ['ESTABLISHED_LOW'],
    effect: 'LIMIT',
    reasonCode: 'X402_ALLOWANCE_NO_ASSURANCE',
    limitFrequency: 10,
    limitWindowSeconds: 86_400,
    capabilityTtlSeconds: 86_400,
    // Section 17 prices the 500/hour rung as "human-backed", so an established
    // actor whose assurance lease has lapsed drops to the new-agent rate rather
    // than keeping a rate it can no longer justify.
  },
  {
    priority: 56,
    name: 'An uncertain actor gets a tiny commerce allowance',
    actionType: 'X402_PAYMENT',
    trustBands: ['UNCERTAIN'],
    effect: 'LIMIT',
    reasonCode: 'X402_ALLOWANCE_NEW',
    limitFrequency: 10,
    limitWindowSeconds: 86_400,
    capabilityTtlSeconds: 86_400,
    // Small, not zero — same reasoning as rule 15, for an actor we HAVE
    // measured and found ambiguous rather than one we could not measure at all.
  },

  // --- 60-69: claims. The V1 vertical, now one action among many. -----------
  {
    priority: 60,
    name: 'Small claims from a low-coordination actor are allowed',
    actionType: 'CLAIM',
    maxAmount: USDC(100),
    maxCoordinationRisk: 0.3,
    effect: 'ALLOW',
    reasonCode: 'CLAIM_WITHIN_ALLOW_BAND',
    capabilityTtlSeconds: 3600,
    // Section 20.2's second example: CLAIM <= 100 with coordinationRisk < 0.30.
  },
  {
    priority: 61,
    name: 'Claims from a high-risk actor are challenged',
    actionType: 'CLAIM',
    trustBands: ['HIGH_RISK'],
    effect: 'CHALLENGE',
    reasonCode: 'CLAIM_REQUIRES_ASSURANCE',
  },
  {
    priority: 62,
    name: 'Claims from an established actor are allowed',
    actionType: 'CLAIM',
    trustBands: ['ESTABLISHED_LOW', 'VERIFIED_LOW'],
    effect: 'ALLOW',
    reasonCode: 'CLAIM_ESTABLISHED_ACTOR',
    capabilityTtlSeconds: 3600,
  },
  {
    priority: 63,
    name: 'A claim from a measurably low-coordination actor is allowed',
    actionType: 'CLAIM',
    maxCoordinationRisk: 0.3,
    effect: 'ALLOW',
    reasonCode: 'CLAIM_LOW_COORDINATION_RISK',
    capabilityTtlSeconds: 3600,
    // Without this, a clean wallet with only a short history bands UNCERTAIN
    // and falls through to the challenge below — escalating the product's core
    // vertical purely for lack of age, which V1 never did. Thin history is a
    // reason to be uncertain, not a reason to demand a selfie for a claim we
    // have measured as uncoordinated. Note maxCoordinationRisk still requires a
    // MEASURED value, so an unmeasurable actor cannot reach this rule.
  },
  {
    priority: 64,
    name: 'Any other claim is challenged rather than guessed at',
    actionType: 'CLAIM',
    effect: 'CHALLENGE',
    reasonCode: 'CLAIM_UNCERTAIN_REQUIRES_ASSURANCE',
  },

  // --- 90+: catch-alls ------------------------------------------------------
  {
    priority: 90,
    name: 'Voting requires human assurance',
    actionType: 'VOTE',
    requiresLiveAssurance: false,
    effect: 'CHALLENGE',
    reasonCode: 'VOTE_REQUIRES_UNIQUENESS',
    // One-person-one-vote is a uniqueness question, which is exactly what
    // World's credential answers and a risk score does not.
  },
  {
    priority: 99,
    name: 'Anything unmatched is held, never allowed',
    effect: 'REVIEW',
    reasonCode: 'NO_SPECIFIC_RULE',
    // Belt and braces: the engine already defaults to REVIEW when nothing
    // matches. This makes the fail-closed default visible in the policy table
    // itself, where an operator reads it, rather than only in code.
  },
]
