/**
 * Trust history — Xander V2 spec section 21.
 *
 * "V2 should maintain a history of decisions, not simply one mutable score."
 * TrustSnapshot rows are that history for the computed vector; TrustSignal rows
 * are the ledger of events that earned it. Both are append-only.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { isPositiveSignal, type TrustSignalKind } from './trust-types.js'

export interface RecordSignalInput {
  actorId: string
  kind: TrustSignalKind
  /** 0..1 — how much this event should count. */
  weight: number
  detail: string
  /** What produced the signal. Never blank, so no signal is anonymous. */
  source: string
  metadata?: Record<string, unknown>
}

/**
 * Appends a trust signal.
 *
 * `positive` is derived from the kind rather than accepted from the caller, so
 * the same event can never be recorded as positive in one place and negative in
 * another — the classification lives in exactly one table.
 */
export async function recordTrustSignal(input: RecordSignalInput): Promise<string> {
  const row = await prisma.trustSignal.create({
    data: {
      actorId: input.actorId,
      kind: input.kind,
      positive: isPositiveSignal(input.kind),
      weight: Math.min(1, Math.max(0, input.weight)),
      detail: input.detail,
      source: input.source,
      ...(input.metadata ? { metadataJson: input.metadata as Prisma.InputJsonValue } : {}),
    },
  })
  return row.id
}

/** The most recent snapshots for an actor, newest first. */
export async function getTrustHistory(actorId: string, limit = 20) {
  return prisma.trustSnapshot.findMany({
    where: { actorId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/** The latest snapshot, or null if the actor has never been evaluated. */
export async function getLatestSnapshot(actorId: string) {
  return prisma.trustSnapshot.findFirst({
    where: { actorId },
    orderBy: { createdAt: 'desc' },
  })
}

/** Signals for an actor, newest first. */
export async function getTrustSignals(actorId: string, limit = 50) {
  return prisma.trustSignal.findMany({
    where: { actorId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * Net signal balance — positives minus negatives, each by weight.
 *
 * Deliberately NOT fed into the trust vector in Phase 2. It is a reported
 * figure only. Section 3.1 keeps deterministic evidence in charge of security
 * decisions, and quietly letting an accumulated tally move a band would mean a
 * run of routine successes could offset a live coordination signal.
 */
export async function trustSignalBalance(
  actorId: string,
): Promise<{ positive: number; negative: number; net: number; count: number }> {
  const signals = await prisma.trustSignal.findMany({
    where: { actorId },
    select: { positive: true, weight: true },
  })

  let positive = 0
  let negative = 0
  for (const s of signals) {
    if (s.positive) positive += s.weight
    else negative += s.weight
  }

  return { positive, negative, net: positive - negative, count: signals.length }
}
