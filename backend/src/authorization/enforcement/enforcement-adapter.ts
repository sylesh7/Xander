/**
 * The enforcement seam — Xander V2 spec section 18.1.
 *
 * Everything above this interface reasons about capabilities; everything below
 * it knows about a specific execution boundary. Section 18.1 is explicit that
 * the policy engine must not be coupled to Safe or ERC-7715, and this is that
 * decoupling.
 *
 * THE RULE THAT MATTERS MOST is section 18.2:
 *
 *   "If Xander cannot prove that a capability was successfully
 *    granted/restricted, the action must not be reported as
 *    EXECUTED_AS_AUTHORIZED."
 *
 * So every result below distinguishes three states, never two: it worked, it
 * definitively did not work, or **we do not know**. A boolean would collapse
 * the third into one of the others, and the third is the dangerous one — an
 * adapter that timed out mid-revoke has left authority in an unknown state, and
 * reporting that as either success or failure is a lie.
 */
import type { CapabilityLimits } from '../../capabilities/capability-types.js'

export const ENFORCEMENT_OUTCOMES = ['CONFIRMED', 'FAILED', 'UNKNOWN'] as const
export type EnforcementOutcome = (typeof ENFORCEMENT_OUTCOMES)[number]

export interface EnforcementResult {
  outcome: EnforcementOutcome
  /** Which adapter answered. Recorded so a receipt names its own boundary. */
  adapter: string
  /** On-chain reference when there is one. */
  reference: string | null
  detail: string
}

/** What the boundary currently believes, independent of our database. */
export interface CapabilityState {
  /** Null when the boundary cannot answer — never guessed as false. */
  enforceable: boolean | null
  adapter: string
  detail: string
}

export interface EnforcementAdapter {
  readonly name: string

  /** Makes a capability real at this boundary. */
  grant(args: {
    capabilityId: string
    actorId: string
    actionType: string
    limits: CapabilityLimits
  }): Promise<EnforcementResult>

  /** Withdraws it. */
  revoke(args: { capabilityId: string; actorId: string; actionType: string }): Promise<EnforcementResult>

  /** Narrows it without withdrawing it. */
  attenuate(args: {
    capabilityId: string
    actorId: string
    actionType: string
    limits: CapabilityLimits
  }): Promise<EnforcementResult>

  /**
   * Asks the boundary what it currently permits.
   *
   * `amount` and `targetAddress` are optional because not every boundary can
   * see them — EAC roles are single bits with no magnitude — but a boundary
   * that CAN must judge the concrete action, not the abstract permission.
   */
  inspect(args: {
    capabilityId: string
    actorId: string
    actionType: string
    amount?: string | null
    targetAddress?: string | null
  }): Promise<CapabilityState>
}

/**
 * True only when the boundary positively confirmed.
 *
 * A helper rather than an inline comparison so `UNKNOWN` can never be treated
 * as success by a caller writing `outcome !== 'FAILED'`.
 */
export function isEnforced(result: EnforcementResult): boolean {
  return result.outcome === 'CONFIRMED'
}
