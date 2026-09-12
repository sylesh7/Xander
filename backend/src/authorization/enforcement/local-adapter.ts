/**
 * The local enforcement adapter — spec section 18.1, implementation order 1:
 * "internal/mock-free local policy adapter for development".
 *
 * The boundary here is Xander's own capability store. Not a placeholder for a
 * real one — this IS the enforcement for every action that Xander itself
 * gates, and it is the only boundary that keeps working when a chain is
 * unreachable.
 */
import { logger } from '../../lib/logger.js'
import { prisma } from '../../lib/prisma.js'
import { checkCapability } from '../../capabilities/capability-service.js'
import type { CapabilityLimits } from '../../capabilities/capability-types.js'
import type {
  CapabilityState,
  EnforcementAdapter,
  EnforcementResult,
} from './enforcement-adapter.js'

export class LocalEnforcementAdapter implements EnforcementAdapter {
  readonly name = 'local'

  /**
   * The capability row IS the grant, so this confirms rather than creates.
   *
   * Returning CONFIRMED for a row that does not exist would be the exact
   * failure section 18.2 warns about — claiming enforcement we cannot show.
   */
  async grant(args: {
    capabilityId: string
    actorId: string
    actionType: string
    limits: CapabilityLimits
  }): Promise<EnforcementResult> {
    const capability = await prisma.capability.findUnique({ where: { id: args.capabilityId } })
    if (!capability) {
      return {
        outcome: 'FAILED',
        adapter: this.name,
        reference: null,
        detail: `no capability ${args.capabilityId}`,
      }
    }
    return {
      outcome: capability.status === 'ACTIVE' ? 'CONFIRMED' : 'FAILED',
      adapter: this.name,
      reference: capability.id,
      detail: `capability is ${capability.status}`,
    }
  }

  async revoke(args: {
    capabilityId: string
    actorId: string
    actionType: string
  }): Promise<EnforcementResult> {
    const { count } = await prisma.capability.updateMany({
      where: { id: args.capabilityId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      data: { status: 'REVOKED' },
    })
    // Already revoked is still the desired end state, so it confirms.
    const capability = await prisma.capability.findUnique({ where: { id: args.capabilityId } })
    const confirmed = capability?.status === 'REVOKED'
    logger.info({ capabilityId: args.capabilityId, changed: count }, 'local revoke')
    return {
      outcome: confirmed ? 'CONFIRMED' : 'FAILED',
      adapter: this.name,
      reference: args.capabilityId,
      detail: confirmed ? 'capability revoked' : 'capability could not be revoked',
    }
  }

  async attenuate(args: {
    capabilityId: string
    actorId: string
    actionType: string
    limits: CapabilityLimits
  }): Promise<EnforcementResult> {
    const capability = await prisma.capability.findUnique({ where: { id: args.capabilityId } })
    if (!capability) {
      return { outcome: 'FAILED', adapter: this.name, reference: null, detail: 'no such capability' }
    }
    await prisma.capability.update({
      where: { id: args.capabilityId },
      data: {
        amountLimit: args.limits.amountLimit,
        frequencyLimit: args.limits.frequencyLimit,
        frequencyWindowSeconds: args.limits.frequencyWindowSeconds,
        capabilityType: 'ATTENUATED_GRANT',
      },
    })
    return {
      outcome: 'CONFIRMED',
      adapter: this.name,
      reference: args.capabilityId,
      detail: `narrowed to ${args.limits.amountLimit ?? 'no amount bound'}`,
    }
  }

  async inspect(args: {
    capabilityId: string
    actorId: string
    actionType: string
    amount?: string | null
    targetAddress?: string | null
  }): Promise<CapabilityState> {
    // The concrete action, not the abstract permission — amount and target are
    // where a ceiling and an allow-list actually bite.
    const check = await checkCapability({
      actorId: args.actorId,
      actionType: args.actionType,
      amount: args.amount ?? null,
      targetAddress: args.targetAddress ?? null,
    })
    return {
      enforceable: check.allowed,
      adapter: this.name,
      detail: check.detail,
    }
  }
}

export const localEnforcementAdapter = new LocalEnforcementAdapter()
