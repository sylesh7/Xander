/**
 * The capability lease workflow — Xander V2 spec section 14.1.
 *
 *   grant -> wait until expiry -> re-check trust -> renew / attenuate / revoke
 *
 * This is what makes section 7.3's "every high-value capability should be
 * time-bound" real rather than aspirational. Without it, `expiresAt` is a
 * column that something has to remember to check; with it, the expiry is an
 * event that actively re-examines whether the grant still deserves to exist.
 *
 * Deterministic — see the note in authorization.workflow.ts.
 */
import { condition, proxyActivities, setHandler, sleep } from '@temporalio/workflow'
import type * as activities from './activities.js'
import {
  operatorDecisionSignal,
  trustChangedSignal,
  type CapabilityLeaseWorkflowInput,
  type CapabilityLeaseWorkflowOutput,
  type OperatorDecision,
} from './shared.js'

const { loadTrust, readCapability, renewCapability, attenuateCapability, revokeActorCapabilities } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '2 minutes',
    retry: { initialInterval: '2s', maximumInterval: '30s', maximumAttempts: 5 },
  })

/** Bands at which a lease is not renewed. Risk ends the lease rather than shrinking it. */
const TERMINAL_BANDS = new Set(['CRITICAL', 'HIGH_RISK', 'INSUFFICIENT_EVIDENCE'])
/** Bands where the grant survives but is narrowed. */
const ATTENUATE_BANDS = new Set(['UNCERTAIN'])

export async function capabilityLeaseWorkflow(
  input: CapabilityLeaseWorkflowInput,
): Promise<CapabilityLeaseWorkflowOutput> {
  const history: string[] = []
  let renewals = 0
  let operatorDecision: OperatorDecision | null = null
  let trustChanged = false

  // Read through a function, not directly. TypeScript's control-flow analysis
  // cannot see that a Temporal signal handler assigns these, so it narrows the
  // variable to `null` and every later branch to `never`. A call boundary
  // returns the declared type instead.
  const currentDecision = (): OperatorDecision | null => operatorDecision

  setHandler(operatorDecisionSignal, (decision) => {
    operatorDecision = decision
    history.push(`operator ${decision.command}`)
  })
  // A live trust change ends the wait early. Waiting out the full lease after
  // learning an actor became dangerous is exactly the window section 13.2's
  // live-invalidation path exists to close.
  setHandler(trustChangedSignal, (change) => {
    trustChanged = true
    history.push(`trust changed to ${change.band}`)
  })

  for (;;) {
    // Wake on whichever comes first: the lease expiring, an operator command,
    // or trust moving.
    const interrupted = await Promise.race([
      sleep(`${input.leaseSeconds}s`).then(() => false),
      condition(() => operatorDecision !== null || trustChanged).then(() => true),
    ])
    history.push(interrupted ? 'woken early' : 'lease expired')

    const capability = await readCapability(input.capabilityId)
    if (!capability || capability.status === 'REVOKED') {
      history.push('capability already gone')
      return { capabilityId: input.capabilityId, renewals, finalAction: 'REVOKED', history }
    }

    const decision = currentDecision()
    if (decision) {
      if (decision.command === 'REVOKE' || decision.command === 'FREEZE' || decision.command === 'DENY') {
        await revokeActorCapabilities({
          actorId: input.actorId,
          reason: `operator ${decision.command}`,
        })
        history.push(`revoked by operator ${decision.command}`)
        return { capabilityId: input.capabilityId, renewals, finalAction: 'REVOKED', history }
      }
      if (decision.command === 'LIMIT' && decision.limitAmount) {
        await attenuateCapability({
          capabilityId: input.capabilityId,
          amountLimit: decision.limitAmount,
        })
        history.push(`attenuated to ${decision.limitAmount} by operator`)
        return { capabilityId: input.capabilityId, renewals, finalAction: 'ATTENUATED', history }
      }
      // EXTEND / APPROVE / UNFREEZE fall through to the trust re-check below —
      // an operator asking to extend still does not get to skip it.
      operatorDecision = null
    }

    const trust = await loadTrust(input.actorId)
    history.push(`re-checked trust: ${trust.band}`)
    trustChanged = false

    if (TERMINAL_BANDS.has(trust.band)) {
      await revokeActorCapabilities({ actorId: input.actorId, reason: `trust ${trust.band}` })
      history.push(`revoked at trust ${trust.band}`)
      return { capabilityId: input.capabilityId, renewals, finalAction: 'REVOKED', history }
    }

    if (ATTENUATE_BANDS.has(trust.band) && capability.amountLimit) {
      // Halve rather than revoke: an actor who became merely uncertain has not
      // done anything wrong, and withdrawing all authority for ambiguity is the
      // false-positive behaviour this project exists to avoid.
      const halved = (BigInt(capability.amountLimit) / 2n).toString()
      await attenuateCapability({ capabilityId: input.capabilityId, amountLimit: halved })
      history.push(`attenuated to ${halved} at trust ${trust.band}`)
      return { capabilityId: input.capabilityId, renewals, finalAction: 'ATTENUATED', history }
    }

    renewals += 1
    await renewCapability({ capabilityId: input.capabilityId, seconds: input.leaseSeconds })
    history.push(`renewed (${renewals}/${input.maxRenewals}) at trust ${trust.band}`)

    if (renewals >= input.maxRenewals) {
      // Bounded rather than infinite: an unbounded loop grows workflow history
      // until the run has to continue-as-new, and a lease nobody ever revisits
      // is the standing authority section 7.3 warns about.
      history.push('renewal limit reached')
      return { capabilityId: input.capabilityId, renewals, finalAction: 'RENEWED', history }
    }
  }
}
