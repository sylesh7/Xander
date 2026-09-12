/**
 * The execution boundary — Xander V2 spec section 18.2, Phase 8.
 *
 * This is the file that turns a decision into a refusal. Until now an ALLOW
 * meant a row in AuthorizationDecision and nothing stood between an agent and
 * the action; Phase 1 even left the marker, writing every receipt as
 * NOT_EXECUTED with the comment "Phase 1 has no enforcement". This is that
 * enforcement.
 *
 * The order below is the whole design and it is not negotiable:
 *
 *   1. the decision must have authorized this action
 *   2. EVERY applicable boundary must positively confirm, right now
 *   3. only then is the executor called
 *   4. usage is recorded, and the receipt says which boundaries proved it
 *
 * Step 2 happens at execution time, not at decision time. A decision made an
 * hour ago rests on trust that may since have collapsed — Phase 7 made that
 * collapse suspend capabilities, and this is the step where the suspension
 * actually stops something.
 */
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'
import { checkCapability, recordUsage } from '../../capabilities/capability-service.js'
import { verifyEnforcement } from './enforcement-service.js'

export const EXECUTION_STATUSES = [
  'NOT_EXECUTED',
  'EXECUTED_AS_AUTHORIZED',
  'BLOCKED_UNENFORCEABLE',
  'FAILED',
] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]

export interface ExecutionOutcome {
  intentId: string
  status: ExecutionStatus
  /** True only for EXECUTED_AS_AUTHORIZED. */
  executed: boolean
  reason: string
  adapters: string[]
  capabilityId: string | null
  txHash: string | null
  receiptId: string | null
}

/** What the caller actually does once permission is proven. */
export type Executor = () => Promise<{ txHash?: string | null }>

export class NoSuchIntentError extends Error {}

/**
 * Runs an authorized action, or refuses to.
 *
 * `executor` is optional: Xander is an authorization runtime, and for most
 * integrations the caller performs the action itself and comes here for the
 * gate and the receipt. When it IS supplied, the guarantee is that it is never
 * invoked unless every boundary confirmed first — the refusal happens before
 * any side effect, not after one that then has to be undone.
 */
export async function executeAuthorizedAction(
  intentId: string,
  executor?: Executor,
): Promise<ExecutionOutcome> {
  const intent = await prisma.intent.findUnique({ where: { id: intentId } })
  if (!intent) throw new NoSuchIntentError(`No intent ${intentId}`)

  const receipt = await prisma.actionReceipt.findFirst({
    where: { intentId },
    orderBy: { createdAt: 'desc' },
  })
  const decision = await prisma.authorizationDecision.findFirst({
    where: { intentId },
    orderBy: { createdAt: 'desc' },
  })

  const refuse = (status: ExecutionStatus, reason: string, adapters: string[] = []) =>
    finishReceipt({ intentId, receiptId: receipt?.id ?? null, status, reason, adapters, txHash: null })

  if (!decision) {
    return refuse('BLOCKED_UNENFORCEABLE', 'no authorization decision for this intent')
  }
  if (decision.result !== 'ALLOW' && decision.result !== 'LIMIT') {
    // CHALLENGE, REVIEW and BLOCK authorize nothing. Executing on one of them
    // would make the entire decision layer decorative.
    return refuse(
      'BLOCKED_UNENFORCEABLE',
      `decision was ${decision.result}, which authorizes no execution`,
    )
  }
  if (intent.expiresAt.getTime() <= Date.now()) {
    return refuse('BLOCKED_UNENFORCEABLE', 'intent expired before execution')
  }

  // Re-check the capability against the CONCRETE action, now. The decision
  // said what was permissible; this says whether it still is.
  const check = await checkCapability({
    actorId: intent.actorId,
    actionType: intent.actionType,
    amount: intent.amount,
    targetAddress: intent.targetAddress,
  })
  if (!check.allowed || !check.capability) {
    return refuse('BLOCKED_UNENFORCEABLE', check.detail, ['local'])
  }

  const verdict = await verifyEnforcement({
    actorId: intent.actorId,
    actionType: intent.actionType,
    capabilityId: check.capability.id,
    amount: intent.amount,
    targetAddress: intent.targetAddress,
  })

  if (!verdict.enforced) {
    logger.warn(
      { intentId, actorId: intent.actorId, reason: verdict.reason },
      'execution refused — enforcement not proven',
    )
    const outcome = await refuse('BLOCKED_UNENFORCEABLE', verdict.reason, verdict.adapters)
    return { ...outcome, capabilityId: check.capability.id }
  }

  // Only here, with every boundary having said yes, does anything happen.
  let txHash: string | null = null
  if (executor) {
    try {
      const result = await executor()
      txHash = result.txHash ?? null
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ intentId, err }, 'authorized action failed during execution')
      // FAILED, not BLOCKED: authority was genuinely proven and the action was
      // genuinely attempted. Conflating the two would hide a broken integration
      // behind what looks like a policy refusal.
      const outcome = await finishReceipt({
        intentId,
        receiptId: receipt?.id ?? null,
        status: 'FAILED',
        reason: `authorized, but execution failed: ${message}`,
        adapters: verdict.adapters,
        txHash: null,
      })
      return { ...outcome, capabilityId: check.capability.id }
    }
  }

  // Recorded after the action, so a failed execution does not consume a
  // frequency slot the actor never actually used.
  await recordUsage({
    capabilityId: check.capability.id,
    intentId,
    amount: intent.amount,
  })

  const outcome = await finishReceipt({
    intentId,
    receiptId: receipt?.id ?? null,
    status: 'EXECUTED_AS_AUTHORIZED',
    reason: verdict.reason,
    adapters: verdict.adapters,
    txHash,
  })
  return { ...outcome, capabilityId: check.capability.id }
}

async function finishReceipt(args: {
  intentId: string
  receiptId: string | null
  status: ExecutionStatus
  reason: string
  adapters: string[]
  txHash: string | null
}): Promise<ExecutionOutcome> {
  if (args.receiptId) {
    await prisma.actionReceipt.update({
      where: { id: args.receiptId },
      data: {
        executionStatus: args.status,
        executionTxHash: args.txHash,
        enforcementAdapters: args.adapters,
        enforcementReason: args.reason,
        executedAt: args.status === 'EXECUTED_AS_AUTHORIZED' ? new Date() : null,
      },
    })
  }
  return {
    intentId: args.intentId,
    status: args.status,
    executed: args.status === 'EXECUTED_AS_AUTHORIZED',
    reason: args.reason,
    adapters: args.adapters,
    capabilityId: null,
    txHash: args.txHash,
    receiptId: args.receiptId,
  }
}
