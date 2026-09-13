/**
 * A static mirror of `backend/prisma/seed-data/policy-rules.ts` — the real
 * seeded v2-1.1 authorization policy. There is no `GET` endpoint for policy
 * rules yet (docs/frontendfinal.md §9 gap #2, §4.10: "ships as a static
 * mirror of the seed file" is the explicitly sanctioned workaround).
 *
 * Copied by hand, not generated — if the backend file changes, this drifts
 * until someone re-copies it. That's the honest cost of the workaround, not
 * a hidden assumption.
 */
export interface PolicyRule {
  priority: number
  name: string
  actionType?: string | null
  minAmount?: string | null
  maxAmount?: string | null
  trustBands?: string[]
  maxCoordinationRisk?: number | null
  minBehaviorIntegrity?: number | null
  requiresLiveAssurance?: boolean | null
  effect: string
  reasonCode: string
  limitAmount?: string | null
  limitFrequency?: number | null
  limitWindowSeconds?: number | null
  capabilityTtlSeconds?: number | null
}

export const POLICY_VERSION = 'v2-1.1'
export const POLICY_NAME = 'Xander V2 default authorization policy'

const USDC = (whole: number): string => (BigInt(whole) * BigInt(1_000_000)).toString()

export const POLICY_RULES: readonly PolicyRule[] = [
  { priority: 10, name: 'Block everything for a CRITICAL actor', trustBands: ['CRITICAL'], effect: 'BLOCK', reasonCode: 'TRUST_BAND_CRITICAL' },
  { priority: 20, name: 'Hold every action when evidence is insufficient', trustBands: ['INSUFFICIENT_EVIDENCE'], effect: 'REVIEW', reasonCode: 'INSUFFICIENT_EVIDENCE' },

  { priority: 30, name: 'Borrowing is never authorised without human assurance', actionType: 'BORROW', requiresLiveAssurance: false, effect: 'CHALLENGE', reasonCode: 'BORROW_REQUIRES_ASSURANCE' },
  { priority: 31, name: 'Treasury-scale transfers need human assurance', actionType: 'TRANSFER', minAmount: USDC(5000), requiresLiveAssurance: false, effect: 'CHALLENGE', reasonCode: 'HIGH_VALUE_TRANSFER_REQUIRES_ASSURANCE' },
  { priority: 32, name: 'Large transfers from a low-integrity actor are challenged', actionType: 'TRANSFER', minAmount: USDC(1000), minBehaviorIntegrity: 0.8, effect: 'ALLOW', reasonCode: 'TRANSFER_WITHIN_INTEGRITY_BOUNDS', capabilityTtlSeconds: 3600 },
  { priority: 33, name: 'Large transfers otherwise require step-up', actionType: 'TRANSFER', minAmount: USDC(1000), effect: 'CHALLENGE', reasonCode: 'TRANSFER_INTEGRITY_UNPROVEN' },

  { priority: 40, name: 'Trading is capped for an uncertain actor', actionType: 'TRADE', trustBands: ['UNCERTAIN'], effect: 'LIMIT', reasonCode: 'TRADE_LIMITED_UNCERTAIN_TRUST', limitAmount: USDC(500), limitFrequency: 20, limitWindowSeconds: 86_400, capabilityTtlSeconds: 86_400 },
  { priority: 41, name: 'Trading is tightly capped for a high-risk actor', actionType: 'TRADE', trustBands: ['HIGH_RISK'], effect: 'LIMIT', reasonCode: 'TRADE_LIMITED_HIGH_RISK', limitAmount: USDC(100), limitFrequency: 5, limitWindowSeconds: 86_400, capabilityTtlSeconds: 3600 },
  { priority: 42, name: 'Established actors trade with a daily ceiling', actionType: 'TRADE', trustBands: ['ESTABLISHED_LOW', 'VERIFIED_LOW'], effect: 'LIMIT', reasonCode: 'TRADE_WITHIN_ESTABLISHED_BOUNDS', limitAmount: USDC(2000), limitFrequency: 100, limitWindowSeconds: 86_400, capabilityTtlSeconds: 86_400 },

  { priority: 50, name: 'Unverified actors get a small API allowance', actionType: 'API_REQUEST', trustBands: ['UNCERTAIN'], effect: 'LIMIT', reasonCode: 'API_ALLOWANCE_UNCERTAIN', limitFrequency: 10, limitWindowSeconds: 86_400, capabilityTtlSeconds: 86_400 },
  { priority: 51, name: 'Established actors get a working API allowance', actionType: 'API_REQUEST', trustBands: ['ESTABLISHED_LOW', 'VERIFIED_LOW'], effect: 'LIMIT', reasonCode: 'API_ALLOWANCE_ESTABLISHED', limitFrequency: 500, limitWindowSeconds: 3600, capabilityTtlSeconds: 86_400 },

  { priority: 52, name: 'An anomalous actor may not buy anything', actionType: 'X402_PAYMENT', trustBands: ['HIGH_RISK', 'CRITICAL'], effect: 'BLOCK', reasonCode: 'X402_ANOMALOUS_ACTOR' },
  { priority: 53, name: 'A trusted actor gets the full commerce allowance', actionType: 'X402_PAYMENT', trustBands: ['VERIFIED_LOW'], effect: 'LIMIT', reasonCode: 'X402_ALLOWANCE_TRUSTED', limitFrequency: 5000, limitWindowSeconds: 3600, capabilityTtlSeconds: 3600 },
  { priority: 54, name: 'A human-backed actor gets a working commerce allowance', actionType: 'X402_PAYMENT', trustBands: ['ESTABLISHED_LOW'], requiresLiveAssurance: true, effect: 'LIMIT', reasonCode: 'X402_ALLOWANCE_HUMAN_BACKED', limitFrequency: 500, limitWindowSeconds: 3600, capabilityTtlSeconds: 3600 },
  { priority: 55, name: 'An established actor without live assurance gets the new-agent rate', actionType: 'X402_PAYMENT', trustBands: ['ESTABLISHED_LOW'], effect: 'LIMIT', reasonCode: 'X402_ALLOWANCE_NO_ASSURANCE', limitFrequency: 10, limitWindowSeconds: 86_400, capabilityTtlSeconds: 86_400 },
  { priority: 56, name: 'An uncertain actor gets a tiny commerce allowance', actionType: 'X402_PAYMENT', trustBands: ['UNCERTAIN'], effect: 'LIMIT', reasonCode: 'X402_ALLOWANCE_NEW', limitFrequency: 10, limitWindowSeconds: 86_400, capabilityTtlSeconds: 86_400 },

  { priority: 60, name: 'Small claims from a low-coordination actor are allowed', actionType: 'CLAIM', maxAmount: USDC(100), maxCoordinationRisk: 0.3, effect: 'ALLOW', reasonCode: 'CLAIM_WITHIN_ALLOW_BAND', capabilityTtlSeconds: 3600 },
  { priority: 61, name: 'Claims from a high-risk actor are challenged', actionType: 'CLAIM', trustBands: ['HIGH_RISK'], effect: 'CHALLENGE', reasonCode: 'CLAIM_REQUIRES_ASSURANCE' },
  { priority: 62, name: 'Claims from an established actor are allowed', actionType: 'CLAIM', trustBands: ['ESTABLISHED_LOW', 'VERIFIED_LOW'], effect: 'ALLOW', reasonCode: 'CLAIM_ESTABLISHED_ACTOR', capabilityTtlSeconds: 3600 },
  { priority: 63, name: 'A claim from a measurably low-coordination actor is allowed', actionType: 'CLAIM', maxCoordinationRisk: 0.3, effect: 'ALLOW', reasonCode: 'CLAIM_LOW_COORDINATION_RISK', capabilityTtlSeconds: 3600 },
  { priority: 64, name: 'Any other claim is challenged rather than guessed at', actionType: 'CLAIM', effect: 'CHALLENGE', reasonCode: 'CLAIM_UNCERTAIN_REQUIRES_ASSURANCE' },

  { priority: 90, name: 'Voting requires human assurance', actionType: 'VOTE', requiresLiveAssurance: false, effect: 'CHALLENGE', reasonCode: 'VOTE_REQUIRES_UNIQUENESS' },
  { priority: 99, name: 'Anything unmatched is held, never allowed', effect: 'REVIEW', reasonCode: 'NO_SPECIFIC_RULE' },
]

/** Section 17's x402 ladder, priorities 52-56, as the rate table the commerce page shows. */
export const X402_RATE_LADDER = POLICY_RULES.filter((r) => r.actionType === 'X402_PAYMENT')
