/**
 * Trust Context assembly — Xander V2 spec section 6, Phase 2.
 *
 * The impure half. Gathers real evidence, hands it to the pure vector and drift
 * functions, derives a band, and persists an append-only TrustSnapshot.
 *
 * WHAT IS GENUINELY MEASURED IN PHASE 2, and what is honestly UNKNOWN:
 *
 *   coordinationRisk        - V1's real cluster risk score
 *   evidenceFreshness       - real evidence age, classified
 *   historyStrength         - real evidence span and volume
 *   behaviorIntegrity       - derived from this phase's own drift detector
 *   humanAssurance          - a real PASSED World challenge, if one exists
 *   investigationConfidence - a real completed MCP investigation, if one exists
 *   agentReputation         - UNKNOWN. ERC-8004 arrives in Phase 6.
 *
 * The last one is the point of the whole design. It stays null rather than
 * defaulting to some neutral number, because a neutral number would be
 * indistinguishable from a measured mediocre reputation.
 */
import type { Prisma } from '@prisma/client'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { getRiskThroughCache } from '../cache/risk-cache.js'
import type { ClusterRisk } from '../interfaces/evidence-risk-api.js'
import { detectDrift, type BehaviorEvent, type DriftOptions } from './trust-drift.js'
import { readErc8004Snapshot, toAgentReputationValue } from '../agents/erc8004.js'
import {
  bootstrapVector,
  classifyFreshness,
  deriveBand,
  freshnessToDimension,
  vectorToJson,
  type FreshnessOptions,
  type TrustBandOptions,
} from './trust-vector.js'
import {
  dimension,
  unknown,
  TRUST_ENGINE_VERSION,
  type TrustDimensionValue,
  type DriftResult,
  type TrustBand,
  type TrustVector,
} from './trust-types.js'

export interface TrustContext {
  actorId: string
  vector: TrustVector
  band: TrustBand
  drift: DriftResult
  evidenceIds: string[]
  policyVersion: string
  engineVersion: string
  snapshotId: string
}

export function bandOptionsFromEnv(): TrustBandOptions {
  return {
    criticalCoordinationRisk: env.TRUST_CRITICAL_COORDINATION_RISK,
    highCoordinationRisk: env.TRUST_HIGH_COORDINATION_RISK,
    lowCoordinationRisk: env.TRUST_LOW_COORDINATION_RISK,
    establishedHistoryStrength: env.TRUST_ESTABLISHED_HISTORY_STRENGTH,
    verifiedHumanAssurance: env.TRUST_VERIFIED_HUMAN_ASSURANCE,
    minKnownDimensions: env.TRUST_MIN_KNOWN_DIMENSIONS,
  }
}

export function freshnessOptionsFromEnv(): FreshnessOptions {
  return {
    agingAfterSeconds: env.TRUST_FRESHNESS_AGING_SECONDS,
    staleAfterSeconds: env.TRUST_FRESHNESS_STALE_SECONDS,
    expiredAfterSeconds: env.TRUST_FRESHNESS_EXPIRED_SECONDS,
  }
}

export function driftOptionsFromEnv(): DriftOptions {
  return {
    minBaselineEvents: env.TRUST_DRIFT_MIN_BASELINE_EVENTS,
    unusualAmountMultiple: env.TRUST_DRIFT_UNUSUAL_AMOUNT_MULTIPLE,
    timingRegimeShiftHours: env.TRUST_DRIFT_TIMING_SHIFT_HOURS,
    clusterExpansionMultiple: env.TRUST_DRIFT_CLUSTER_EXPANSION_MULTIPLE,
  }
}

/**
 * History strength from the evidence itself: how long we have watched, and how
 * much we saw. Both halves matter — one transaction a year ago is not history,
 * and fifty transactions in one minute is not history either.
 */
export function historyStrength(
  events: readonly { timestamp: Date }[],
  now: Date,
): { value: number; basis: string } | null {
  if (events.length === 0) return null

  const times = events.map((e) => e.timestamp.getTime())
  const earliest = Math.min(...times)
  const spanDays = (now.getTime() - earliest) / 86_400_000

  const spanScore = Math.min(1, spanDays / env.TRUST_HISTORY_FULL_STRENGTH_DAYS)
  const volumeScore = Math.min(1, events.length / env.TRUST_HISTORY_FULL_STRENGTH_EVENTS)

  // Geometric mean, so a strong score on one half cannot carry a near-zero
  // other half. Fifty events in a single day is still a one-day-old actor.
  const value = Math.sqrt(spanScore * volumeScore)
  return {
    value,
    basis: `${events.length} events over ${spanDays.toFixed(1)} days`,
  }
}

/**
 * The ERC-8004 dimension for an actor, or UNKNOWN.
 *
 * Deliberately fails soft: an unreachable registry leaves the dimension
 * unmeasured rather than aborting the whole trust build. External reputation
 * is one signal of seven, and losing the other six because a third-party
 * contract was unreachable would be a worse outcome than not knowing this one.
 */
async function readAgentReputation(actorId: string): Promise<TrustDimensionValue> {
  if (!env.ERC8004_ENABLED) {
    return unknown('ERC-8004 lookups are disabled')
  }

  const agent = await prisma.agent.findFirst({
    where: { actorId, erc8004AgentId: { not: null } },
    orderBy: { createdAt: 'desc' },
  })
  if (!agent?.erc8004AgentId) {
    return unknown('no ERC-8004 agent id linked to this actor')
  }

  try {
    const snapshot = await readErc8004Snapshot(BigInt(agent.erc8004AgentId))
    const { value, basis } = toAgentReputationValue(snapshot)
    return value === null ? unknown(basis) : dimension(value, basis)
  } catch (err) {
    logger.warn({ actorId, err }, 'ERC-8004 read failed; agent reputation stays unknown')
    return unknown('ERC-8004 registries were unreachable')
  }
}

/**
 * Builds and persists the trust context for an actor.
 *
 * Writes a NEW snapshot every time (section 21's append-only history), so a
 * decision that cited snapshot N stays reconstructable after snapshot N+1.
 */
export async function buildTrustContext(
  actorId: string,
  opts: { campaignId?: string; now?: Date; risk?: ClusterRisk } = {},
): Promise<TrustContext> {
  const now = opts.now ?? new Date()

  const actor = await prisma.actor.findUnique({
    where: { id: actorId },
    include: { identities: true },
  })
  if (!actor) throw new Error(`No actor ${actorId}`)

  const wallets = actor.identities
    .filter((i) => i.kind === 'WALLET')
    .map((i) => i.externalId)

  // No wallet means no on-chain evidence can exist. Cold start, every
  // dimension UNKNOWN — not a clean bill of health.
  if (wallets.length === 0) {
    return persistSnapshot({
      actorId,
      campaignId: opts.campaignId ?? null,
      vector: bootstrapVector('actor has no wallet identity, so no on-chain evidence exists'),
      drift: { signals: [], peakMagnitude: 0, hadBaseline: false },
      evidenceIds: [],
      policyVersion: 'none',
    })
  }

  const events = await prisma.evidenceEvent.findMany({
    where: { wallet: { in: wallets } },
    select: {
      counterparty: true,
      eventType: true,
      protocolType: true,
      amount: true,
      timestamp: true,
      createdAt: true,
      sourceType: true,
      deploymentId: true,
      blockNumber: true,
    },
    orderBy: { timestamp: 'asc' },
  })

  if (events.length === 0) {
    return persistSnapshot({
      actorId,
      campaignId: opts.campaignId ?? null,
      vector: bootstrapVector('no evidence found for this actor'),
      drift: { signals: [], peakMagnitude: 0, hadBaseline: false },
      evidenceIds: [],
      policyVersion: 'none',
    })
  }

  // --- coordination risk, from V1's real engine ------------------------------
  //
  // The caller may hand in the risk it already computed. The intent flow does,
  // and it matters for more than speed: recomputing here could return a
  // DIFFERENT score than the one the decision was actually made against — a
  // cache expiry or a Substreams invalidation landing between the two calls is
  // enough — and the snapshot a decision cites would then describe evidence
  // that decision never saw. One computation, one lineage.
  const risk = opts.risk ?? (await getRiskThroughCache(wallets[0]!)).risk

  const vector = bootstrapVector('not measured')

  if (risk.status === 'PENDING_REVIEW') {
    // The freshness guard held it. Leaving coordinationRisk UNKNOWN is what
    // forces the band to INSUFFICIENT_EVIDENCE rather than letting a
    // score of 0 read as "clean".
    vector.coordinationRisk = unknown('risk engine returned PENDING_REVIEW — evidence not fresh')
  } else {
    vector.coordinationRisk = dimension(
      risk.riskScore,
      `cluster risk ${risk.riskScore.toFixed(4)} under policy ${risk.policyVersion}`,
    )
  }

  // --- evidence freshness ----------------------------------------------------
  const newestCreatedAt = events.reduce(
    (max, e) => (e.createdAt > max ? e.createdAt : max),
    events[0]!.createdAt,
  )
  const ageSeconds = (now.getTime() - newestCreatedAt.getTime()) / 1000
  const freshnessClass = classifyFreshness(ageSeconds, freshnessOptionsFromEnv())
  vector.evidenceFreshness = freshnessToDimension(freshnessClass)

  // --- history strength ------------------------------------------------------
  const history = historyStrength(events, now)
  vector.historyStrength = history
    ? dimension(history.value, history.basis)
    : unknown('no evidence to measure history from')

  // --- behaviour drift, and integrity derived from it ------------------------
  const cutoff = new Date(now.getTime() - env.TRUST_DRIFT_RECENT_WINDOW_SECONDS * 1000)
  const toBehavior = (e: (typeof events)[number]): BehaviorEvent => ({
    counterparty: e.counterparty,
    eventType: e.eventType,
    protocolType: e.protocolType,
    amount: e.amount,
    timestamp: e.timestamp,
  })
  const baseline = events.filter((e) => e.timestamp < cutoff).map(toBehavior)
  const recent = events.filter((e) => e.timestamp >= cutoff).map(toBehavior)
  const drift = detectDrift(baseline, recent, driftOptionsFromEnv())

  vector.behaviorIntegrity = drift.hadBaseline
    ? dimension(
        1 - drift.peakMagnitude,
        drift.signals.length === 0
          ? 'behaviour consistent with this actor’s own baseline'
          : `drift observed: ${drift.signals.map((s) => s.name).join(', ')}`,
      )
    : unknown('not enough history to establish a behavioural baseline')

  // --- human assurance, from a REAL completed World challenge ----------------
  const passed = await prisma.verificationChallenge.findFirst({
    where: { wallet: { in: wallets }, status: 'PASSED' },
    orderBy: { resolvedAt: 'desc' },
  })
  vector.humanAssurance = passed
    ? dimension(1, `World challenge ${passed.id} PASSED`)
    : unknown('no completed World verification for this actor')

  // --- investigation confidence, from a REAL completed investigation ---------
  if (risk.clusterId) {
    const investigation = await prisma.investigation.findFirst({
      where: { clusterId: risk.clusterId, status: 'COMPLETE' },
      orderBy: { completedAt: 'desc' },
    })
    vector.investigationConfidence = investigation
      ? dimension(
          // Grounding, not eloquence: an investigation is worth something in
          // proportion to how much real evidence it actually pulled. Capped at
          // five tool calls, past which more querying is not more confidence.
          Math.min(1, investigation.toolCalls / 5),
          `investigation ${investigation.id} completed with ${investigation.toolCalls} tool calls`,
        )
      : unknown('no completed investigation for this actor’s cluster')
  }

  // --- agent reputation, from ERC-8004 (Phase 6) -----------------------------
  //
  // Only measurable for an actor that HAS an agent with a linked ERC-8004 id.
  // A plain wallet has no agent reputation and never will, so it stays UNKNOWN
  // rather than being scored — the dimension is genuinely inapplicable, and
  // section 16.2 keeps these inputs advisory in any case.
  vector.agentReputation = await readAgentReputation(actorId)

  const evidenceIds = [
    ...new Set(
      events.map(
        (e) => `${e.sourceType}:${e.deploymentId ?? 'none'}@${e.blockNumber.toString()}`,
      ),
    ),
  ].sort()

  return persistSnapshot({
    actorId,
    campaignId: opts.campaignId ?? null,
    vector,
    drift,
    evidenceIds,
    policyVersion: risk.policyVersion,
  })
}

async function persistSnapshot(args: {
  actorId: string
  campaignId: string | null
  vector: TrustVector
  drift: DriftResult
  evidenceIds: string[]
  policyVersion: string
}): Promise<TrustContext> {
  const band = deriveBand(args.vector, bandOptionsFromEnv())
  const v = args.vector

  const snapshot = await prisma.trustSnapshot.create({
    data: {
      actorId: args.actorId,
      campaignId: args.campaignId,
      behaviorIntegrity: v.behaviorIntegrity.value,
      coordinationRisk: v.coordinationRisk.value,
      historyStrength: v.historyStrength.value,
      humanAssurance: v.humanAssurance.value,
      agentReputation: v.agentReputation.value,
      evidenceFreshness: v.evidenceFreshness.value,
      investigationConfidence: v.investigationConfidence.value,
      overallBand: band,
      dimensionsJson: vectorToJson(v) as Prisma.InputJsonValue,
      driftJson: {
        signals: args.drift.signals,
        peakMagnitude: args.drift.peakMagnitude,
        hadBaseline: args.drift.hadBaseline,
      } as unknown as Prisma.InputJsonValue,
      evidenceIds: args.evidenceIds,
      engineVersion: TRUST_ENGINE_VERSION,
      policyVersion: args.policyVersion,
    },
  })

  logger.debug({ actorId: args.actorId, band, snapshotId: snapshot.id }, 'trust snapshot written')

  return {
    actorId: args.actorId,
    vector: args.vector,
    band,
    drift: args.drift,
    evidenceIds: args.evidenceIds,
    policyVersion: args.policyVersion,
    engineVersion: TRUST_ENGINE_VERSION,
    snapshotId: snapshot.id,
  }
}
