/**
 * Intent and authorization domain types — Xander V2 spec sections 5.7-5.10.
 *
 * Pure. No database, no network, no clock.
 */

/**
 * What is being attempted. Section 5.7's list verbatim.
 *
 * CLAIM is here so V1's airdrop claim becomes one action type among many rather
 * than the only thing the system understands — that reframing is the whole
 * point of Phase 1.
 */
export const ACTION_TYPES = [
  'CLAIM',
  'VOTE',
  'MINT',
  'TRADE',
  'BORROW',
  'TRANSFER',
  'API_REQUEST',
  'X402_PAYMENT',
  'AGENT_DELEGATION',
] as const
export type ActionType = (typeof ACTION_TYPES)[number]

export const INTENT_STATUSES = ['PENDING', 'DECIDED', 'EXPIRED', 'CANCELLED'] as const
export type IntentStatus = (typeof INTENT_STATUSES)[number]

/**
 * The V2 outcome set (section 7.1).
 *
 * `LIMIT` is the one the spec calls essential — reduce a capability instead of
 * approving or rejecting outright. Phase 1 cannot produce it: attenuation needs
 * the capability engine that arrives in Phase 3. It is defined here so the
 * column and the type do not have to change later.
 *
 * `REVIEW` is where V1's PENDING_REVIEW lands. Both mean the same thing
 * operationally — do not proceed, this needs more than the evidence on hand.
 */
export const AUTHORIZATION_RESULTS = ['ALLOW', 'LIMIT', 'CHALLENGE', 'REVIEW', 'BLOCK'] as const
export type AuthorizationResult = (typeof AUTHORIZATION_RESULTS)[number]

/** Section 18.2: nothing is executed until an enforcement adapter confirms it. */
export const EXECUTION_STATUSES = ['NOT_EXECUTED', 'EXECUTED', 'FAILED'] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

/**
 * Machine-readable decision reasons.
 *
 * Separate from the human summary because a reason code is what policy, metrics
 * and later phases branch on, and prose is what a person reads. Conflating them
 * means any wording change silently breaks a consumer.
 */
export const REASON_CODES = {
  /** Evidence was stale or a required Graph query failed — the claim is held. */
  EVIDENCE_NOT_FRESH: 'EVIDENCE_NOT_FRESH',
  /** Score fell in the ALLOW band. */
  RISK_WITHIN_ALLOW_BAND: 'RISK_WITHIN_ALLOW_BAND',
  /** Score fell in the CHALLENGE band — step-up assurance required. */
  RISK_REQUIRES_ASSURANCE: 'RISK_REQUIRES_ASSURANCE',
  /** Score fell in the BLOCK band. */
  RISK_IN_BLOCK_BAND: 'RISK_IN_BLOCK_BAND',
  /** The intent's own expiry passed before it was decided. */
  INTENT_EXPIRED: 'INTENT_EXPIRED',
  /** The actor is frozen, restricted or revoked — checked before any scoring. */
  ACTOR_NOT_ACTIVE: 'ACTOR_NOT_ACTIVE',
} as const
export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES]

/** The semantic parameters of an intent — everything `parametersHash` covers. */
export interface IntentParameters {
  resourceType: string
  resourceId: string
  actionType: ActionType
  chainId: number | null
  targetAddress: string | null
  amount: string | null
  asset: string | null
  protocol: string | null
}
