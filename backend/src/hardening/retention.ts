/**
 * Retention — Xander V2 spec section 33, Phase 12, and section 28 (privacy).
 *
 * Closes the carry-forward logged since Phase 7: TrustSnapshot is append-only
 * and nothing ever removed a row, so one fixture actor had accumulated ~96
 * snapshots by Phase 8. That is a disk problem eventually and a privacy problem
 * immediately — section 28 is explicit that Xander stores what it needs and no
 * more.
 *
 * TWO RULES SHAPE EVERY POLICY BELOW:
 *
 * 1. NEVER DELETE THE MOST RECENT ROW. A trust snapshot is what an authorization
 *    rests on; deleting an actor's last one makes them unmeasurable and would
 *    turn a cleanup job into a mass denial of service.
 *
 * 2. NEVER DELETE AN AUDIT TRAIL ON A SCHEDULE. `OperatorAuditLog` and
 *    `ActionReceipt` answer "who did this and why" after an incident, and an
 *    incident can be discovered long after the fact. They have a retention
 *    window, but it is deliberately long and separate.
 */
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { env } from '../config/env.js'

export interface RetentionResult {
  table: string
  deleted: number
  kept: string
}

export interface RetentionReport {
  dryRun: boolean
  results: RetentionResult[]
  totalDeleted: number
}

/**
 * Applies every retention policy.
 *
 * Defaults to a DRY RUN. A deletion job that runs for real unless told
 * otherwise is one misconfiguration away from destroying an audit trail.
 */
export async function applyRetention(opts: { dryRun?: boolean; now?: Date } = {}): Promise<RetentionReport> {
  const dryRun = opts.dryRun !== false
  const now = opts.now ?? new Date()
  const results: RetentionResult[] = []

  results.push(await pruneTrustSnapshots(dryRun, now))
  results.push(await pruneExpiredSessions(dryRun, now))
  results.push(await pruneDecidedPendingActions(dryRun, now))
  results.push(await pruneTrustSignals(dryRun, now))
  results.push(await pruneAuditLog(dryRun, now))

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0)
  logger.info({ dryRun, totalDeleted }, 'retention pass complete')
  return { dryRun, results, totalDeleted }
}

/**
 * Trust snapshots, keeping the newest N per actor.
 *
 * Per-actor rather than by age: an actor evaluated a hundred times in an hour
 * and one evaluated twice a year both need their recent history, and a single
 * global cutoff serves neither.
 */
async function pruneTrustSnapshots(dryRun: boolean, now: Date): Promise<RetentionResult> {
  const keep = env.RETENTION_TRUST_SNAPSHOTS_PER_ACTOR
  const cutoff = new Date(now.getTime() - env.RETENTION_TRUST_SNAPSHOT_DAYS * 86_400_000)

  const actors = await prisma.trustSnapshot.groupBy({
    by: ['actorId'],
    _count: { _all: true },
    having: { actorId: { _count: { gt: keep } } },
  })

  let deleted = 0
  for (const { actorId } of actors) {
    // Read the ids to KEEP, then delete the rest older than the cutoff. Both
    // conditions must hold: a busy actor keeps its newest N even if they are
    // all old, and an old row survives if it is one of the newest N.
    const survivors = await prisma.trustSnapshot.findMany({
      where: { actorId },
      orderBy: { createdAt: 'desc' },
      take: keep,
      select: { id: true },
    })
    const survivorIds = survivors.map((s) => s.id)

    if (dryRun) {
      deleted += await prisma.trustSnapshot.count({
        where: { actorId, id: { notIn: survivorIds }, createdAt: { lt: cutoff } },
      })
    } else {
      const { count } = await prisma.trustSnapshot.deleteMany({
        where: { actorId, id: { notIn: survivorIds }, createdAt: { lt: cutoff } },
      })
      deleted += count
    }
  }

  return {
    table: 'TrustSnapshot',
    deleted,
    kept: `newest ${keep} per actor, plus anything under ${env.RETENTION_TRUST_SNAPSHOT_DAYS} days`,
  }
}

/** Sessions that expired long enough ago to be uninteresting. */
async function pruneExpiredSessions(dryRun: boolean, now: Date): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - env.RETENTION_SESSION_DAYS * 86_400_000)
  const where = { expiresAt: { lt: cutoff } }
  const deleted = dryRun
    ? await prisma.operatorSession.count({ where })
    : (await prisma.operatorSession.deleteMany({ where })).count
  return {
    table: 'OperatorSession',
    deleted,
    kept: `anything expiring within ${env.RETENTION_SESSION_DAYS} days`,
  }
}

/** Answered or expired pending actions. The audit log keeps the decision. */
async function pruneDecidedPendingActions(dryRun: boolean, now: Date): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - env.RETENTION_PENDING_ACTION_DAYS * 86_400_000)
  const where = {
    status: { in: ['DECIDED', 'EXPIRED', 'CANCELLED'] },
    createdAt: { lt: cutoff },
  }
  const deleted = dryRun
    ? await prisma.pendingAction.count({ where })
    : (await prisma.pendingAction.deleteMany({ where })).count
  return {
    table: 'PendingAction',
    deleted,
    // PENDING is never pruned at any age: an unanswered action is a live
    // obligation, and deleting it would silently drop a decision somebody owes.
    kept: `every PENDING action regardless of age, plus anything under ${env.RETENTION_PENDING_ACTION_DAYS} days`,
  }
}

/** Old trust signals, keeping the newest per actor. */
async function pruneTrustSignals(dryRun: boolean, now: Date): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - env.RETENTION_TRUST_SIGNAL_DAYS * 86_400_000)
  const where = { createdAt: { lt: cutoff } }
  const deleted = dryRun
    ? await prisma.trustSignal.count({ where })
    : (await prisma.trustSignal.deleteMany({ where })).count
  return {
    table: 'TrustSignal',
    deleted,
    kept: `anything under ${env.RETENTION_TRUST_SIGNAL_DAYS} days`,
  }
}

/**
 * The operator audit log — a deliberately LONG window.
 *
 * Kept far longer than anything else here. "Who froze this agent, and why"
 * is a question that gets asked months later, and an audit trail that rolls
 * off quickly is not an audit trail.
 */
async function pruneAuditLog(dryRun: boolean, now: Date): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - env.RETENTION_AUDIT_LOG_DAYS * 86_400_000)
  const where = { createdAt: { lt: cutoff } }
  const deleted = dryRun
    ? await prisma.operatorAuditLog.count({ where })
    : (await prisma.operatorAuditLog.deleteMany({ where })).count
  return {
    table: 'OperatorAuditLog',
    deleted,
    kept: `${env.RETENTION_AUDIT_LOG_DAYS} days`,
  }
}

/**
 * What retention would NEVER delete, stated so it can be reviewed.
 *
 * Exported rather than commented because "which tables are permanent?" is a
 * question a security review asks, and it should have an answer in code.
 */
export const NEVER_PRUNED = [
  'ActionReceipt — the record that an action was authorised and executed',
  'AuthorizationDecision — the reasoning behind every decision',
  'Incident — security history, closed or not',
  'Investigation — what was examined and what was found',
  'X402Payment — a financial record',
  'EvidenceEvent — the evidence every decision cites',
  'KnownFunderAddress — labels are versioned by validTo, never deleted',
] as const
