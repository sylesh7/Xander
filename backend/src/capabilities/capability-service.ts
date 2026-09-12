/**
 * Capability grant, exercise and revocation — Xander V2 spec sections 5.8, 7.
 */
import type { Capability } from '@prisma/client'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import {
  CAPABILITY_DENIALS,
  isCapabilityLive,
  isLeaseLive,
  parseAmount,
  targetAllowed,
  withinAmountLimit,
  type CapabilityDenial,
  type CapabilityLimits,
} from './capability-types.js'

export interface GrantInput {
  actorId: string
  actionType: string
  resourceScope: string
  chainScope?: number | null
  limits: CapabilityLimits
  sourceDecisionId?: string | null
  assuranceLeaseId?: string | null
  attenuated: boolean
}

/**
 * Issues a capability from an authorization outcome.
 *
 * `capabilityType` records whether the grant was reduced, because "you may
 * transfer 500" reads very differently depending on whether 500 was asked for
 * or 5000 was.
 */
export async function grantCapability(input: GrantInput): Promise<Capability> {
  const capability = await prisma.capability.create({
    data: {
      actorId: input.actorId,
      capabilityType: input.attenuated ? 'ATTENUATED_GRANT' : 'GRANT',
      actionType: input.actionType,
      resourceScope: input.resourceScope,
      chainScope: input.chainScope ?? null,
      amountLimit: input.limits.amountLimit,
      frequencyLimit: input.limits.frequencyLimit,
      frequencyWindowSeconds: input.limits.frequencyWindowSeconds,
      allowedTargets: input.limits.allowedTargets,
      expiresAt: input.limits.expiresAt,
      status: 'ACTIVE',
      sourceDecisionId: input.sourceDecisionId ?? null,
      assuranceLeaseId: input.assuranceLeaseId ?? null,
    },
  })
  logger.debug(
    { capabilityId: capability.id, actorId: input.actorId, actionType: input.actionType },
    'capability granted',
  )
  return capability
}

export interface CapabilityCheck {
  allowed: boolean
  capability: Capability | null
  denial: CapabilityDenial | null
  detail: string
}

/**
 * Can this actor exercise a capability for this action, right now?
 *
 * Checks liveness, then the assurance lease it depends on, then amount, target
 * and frequency. Every failure names a specific reason — "denied" with no
 * reason is unactionable for the operator who has to explain it.
 *
 * Frequency is counted from CapabilityUsage rows rather than a counter column,
 * so two concurrent exercises cannot lose an increment to a read-modify-write
 * race.
 */
export async function checkCapability(args: {
  actorId: string
  actionType: string
  amount?: string | null
  targetAddress?: string | null
  now?: Date
}): Promise<CapabilityCheck> {
  const now = args.now ?? new Date()

  const candidates = await prisma.capability.findMany({
    where: { actorId: args.actorId, actionType: args.actionType, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  })

  if (candidates.length === 0) {
    return {
      allowed: false,
      capability: null,
      denial: CAPABILITY_DENIALS.NOT_FOUND,
      detail: `No capability for ${args.actionType}.`,
    }
  }

  let lastDenial: CapabilityCheck | null = null

  for (const capability of candidates) {
    if (!isCapabilityLive(capability, now)) {
      lastDenial = {
        allowed: false,
        capability,
        denial: CAPABILITY_DENIALS.EXPIRED,
        detail: `Capability ${capability.id} expired at ${capability.expiresAt?.toISOString()}.`,
      }
      continue
    }

    // A grant that depended on human assurance dies with that assurance. This
    // is the lease model doing its job: World establishes it, the active
    // challenge rotates it, and expiry withdraws the authority it backed.
    if (capability.assuranceLeaseId) {
      const lease = await prisma.assuranceLease.findUnique({
        where: { id: capability.assuranceLeaseId },
      })
      if (!isLeaseLive(lease, now)) {
        lastDenial = {
          allowed: false,
          capability,
          denial: CAPABILITY_DENIALS.ASSURANCE_EXPIRED,
          detail: `Capability ${capability.id} requires a live assurance lease.`,
        }
        continue
      }
    }

    if (!withinAmountLimit(args.amount ?? null, capability.amountLimit)) {
      lastDenial = {
        allowed: false,
        capability,
        denial: CAPABILITY_DENIALS.AMOUNT_EXCEEDED,
        detail: `Requested ${args.amount} exceeds the ${capability.amountLimit} limit.`,
      }
      continue
    }

    if (!targetAllowed(args.targetAddress ?? null, capability.allowedTargets)) {
      lastDenial = {
        allowed: false,
        capability,
        denial: CAPABILITY_DENIALS.TARGET_NOT_ALLOWED,
        detail: `Target ${args.targetAddress} is not in the allow-list.`,
      }
      continue
    }

    if (capability.frequencyLimit !== null && capability.frequencyWindowSeconds !== null) {
      const since = new Date(now.getTime() - capability.frequencyWindowSeconds * 1000)
      const used = await prisma.capabilityUsage.count({
        where: { capabilityId: capability.id, createdAt: { gte: since } },
      })
      if (used >= capability.frequencyLimit) {
        lastDenial = {
          allowed: false,
          capability,
          denial: CAPABILITY_DENIALS.FREQUENCY_EXCEEDED,
          detail: `${used}/${capability.frequencyLimit} uses in the last ${capability.frequencyWindowSeconds}s.`,
        }
        continue
      }
    }

    return { allowed: true, capability, denial: null, detail: 'Within capability bounds.' }
  }

  return (
    lastDenial ?? {
      allowed: false,
      capability: null,
      denial: CAPABILITY_DENIALS.NOT_FOUND,
      detail: `No usable capability for ${args.actionType}.`,
    }
  )
}

/** Records an exercise, so frequency limits have something to count. */
export async function recordUsage(args: {
  capabilityId: string
  intentId?: string | null
  amount?: string | null
}): Promise<void> {
  await prisma.capabilityUsage.create({
    data: {
      capabilityId: args.capabilityId,
      intentId: args.intentId ?? null,
      amount: args.amount ?? null,
    },
  })
}

/** Live capabilities for an actor, newest first. */
export async function listCapabilities(actorId: string, now = new Date()) {
  const rows = await prisma.capability.findMany({
    where: { actorId },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map((c) => ({
    ...c,
    live: isCapabilityLive(c, now),
  }))
}

/**
 * Revokes capabilities. Returns how many changed.
 *
 * Revocation is a status transition, not a delete — section 19.3 makes freeze a
 * capability state, and a deleted row cannot explain why an action that used to
 * work stopped working.
 */
export async function revokeCapabilities(args: {
  actorId: string
  actionType?: string
  reason: string
}): Promise<number> {
  const { count } = await prisma.capability.updateMany({
    where: {
      actorId: args.actorId,
      status: 'ACTIVE',
      ...(args.actionType ? { actionType: args.actionType } : {}),
    },
    data: { status: 'REVOKED' },
  })
  if (count > 0) {
    logger.info({ actorId: args.actorId, count, reason: args.reason }, 'capabilities revoked')
  }
  return count
}

/** Suspends capabilities — reversible, unlike revocation. Section 19.3's freeze. */
export async function suspendCapabilities(actorId: string, reason: string): Promise<number> {
  const { count } = await prisma.capability.updateMany({
    where: { actorId, status: 'ACTIVE' },
    data: { status: 'SUSPENDED' },
  })
  if (count > 0) logger.info({ actorId, count, reason }, 'capabilities suspended')
  return count
}

/** The live assurance lease for an actor, or null. */
export async function getLiveLease(actorId: string, now = new Date()) {
  const lease = await prisma.assuranceLease.findFirst({
    where: { actorId, status: 'ACTIVE' },
    orderBy: { expiresAt: 'desc' },
  })
  return isLeaseLive(lease, now) ? lease : null
}

/** Amount parsing re-exported so callers do not reimplement it. */
export { parseAmount }
