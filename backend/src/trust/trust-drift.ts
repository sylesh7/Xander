/**
 * Behaviour drift — Xander V2 spec section 6.3.
 *
 * Pure: `(baseline, recent, opts) => DriftResult`. No database, no clock.
 *
 * WHAT THIS IS NOT. Drift is not an abuse detector and this module never
 * returns a verdict. Section 6.3: "Behavior drift is a signal, not an automatic
 * proof of abuse." A legitimate user really does start using a new protocol,
 * really does make an unusually large transfer, really does change their hours.
 * So every function here reports WHAT changed and HOW MUCH, and the policy
 * engine decides what that is worth — same division of labour as the risk
 * features, which measure without judging.
 */
import type { DriftResult, DriftSignal } from './trust-types.js'

/** One observation, in the shape drift needs. */
export interface BehaviorEvent {
  counterparty: string | null
  eventType: string
  protocolType: string | null
  /** Base-units amount as a string, exactly as stored. */
  amount: string | null
  timestamp: Date
}

export interface DriftOptions {
  /** Below this many baseline events there is nothing meaningful to deviate from. */
  minBaselineEvents: number
  /** An amount this many times the baseline median counts as unusual. */
  unusualAmountMultiple: number
  /** Hour-of-day distance, in hours, before timing counts as a new regime. */
  timingRegimeShiftHours: number
  /** Cluster growth multiple that counts as sudden expansion. */
  clusterExpansionMultiple: number
}

/**
 * Median of a bigint series, as a bigint.
 *
 * Median, not mean, for the same reason the risk engine uses median/MAD: one
 * outlying transfer would drag a mean far enough that genuinely unusual amounts
 * stop looking unusual. Kept in bigint throughout — these are base units and a
 * float conversion silently loses precision above 2^53.
 */
export function medianBigInt(values: readonly bigint[]): bigint | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2n
}

function parseAmounts(events: readonly BehaviorEvent[]): bigint[] {
  const out: bigint[] = []
  for (const e of events) {
    if (e.amount === null) continue
    try {
      out.push(BigInt(e.amount))
    } catch {
      // A non-numeric amount is bad data, not a drift signal.
    }
  }
  return out
}

/** Circular distance between two hours of day, in hours (0..12). */
export function hourDistance(a: number, b: number): number {
  const raw = Math.abs(a - b) % 24
  return Math.min(raw, 24 - raw)
}

/** Mean hour-of-day, computed on the circle so 23:00 and 01:00 average to midnight. */
export function meanHourOfDay(events: readonly BehaviorEvent[]): number | null {
  if (events.length === 0) return null
  let x = 0
  let y = 0
  for (const e of events) {
    const angle = (e.timestamp.getUTCHours() / 24) * 2 * Math.PI
    x += Math.cos(angle)
    y += Math.sin(angle)
  }
  if (x === 0 && y === 0) return null
  const angle = Math.atan2(y / events.length, x / events.length)
  const hours = (angle / (2 * Math.PI)) * 24
  return (hours + 24) % 24
}

/**
 * Compares recent behaviour against an actor's own historical baseline.
 *
 * `hadBaseline: false` when there is too little history to compare — which is
 * NOT the same as "no drift". A brand-new actor has not stopped behaving
 * normally; there is simply nothing to have deviated from, and reporting that
 * as a clean result would be the cold-start mistake in a different costume.
 */
export function detectDrift(
  baseline: readonly BehaviorEvent[],
  recent: readonly BehaviorEvent[],
  opts: DriftOptions,
  clusterSizes?: { baseline: number; current: number },
): DriftResult {
  if (baseline.length < opts.minBaselineEvents || recent.length === 0) {
    return { signals: [], peakMagnitude: 0, hadBaseline: false }
  }

  const signals: DriftSignal[] = []

  // --- new counterparty -----------------------------------------------------
  const knownCounterparties = new Set(
    baseline.map((e) => e.counterparty?.toLowerCase()).filter((c): c is string => Boolean(c)),
  )
  const recentCounterparties = new Set(
    recent.map((e) => e.counterparty?.toLowerCase()).filter((c): c is string => Boolean(c)),
  )
  const novelCounterparties = [...recentCounterparties].filter((c) => !knownCounterparties.has(c))
  if (novelCounterparties.length > 0 && recentCounterparties.size > 0) {
    signals.push({
      name: 'NEW_COUNTERPARTY',
      magnitude: novelCounterparties.length / recentCounterparties.size,
      detail: `${novelCounterparties.length} of ${recentCounterparties.size} recent counterparties are new`,
    })
  }

  // --- unusual amount -------------------------------------------------------
  const baselineMedian = medianBigInt(parseAmounts(baseline))
  const recentAmounts = parseAmounts(recent)
  if (baselineMedian !== null && baselineMedian > 0n && recentAmounts.length > 0) {
    const largest = recentAmounts.reduce((a, b) => (b > a ? b : a), 0n)
    const threshold = baselineMedian * BigInt(Math.max(1, Math.round(opts.unusualAmountMultiple)))
    if (largest > threshold) {
      // Ratio is computed only for the magnitude, after the bigint comparison
      // has already decided the question, so precision loss cannot change the
      // outcome — only how strong the reported signal is.
      const ratio = Number(largest) / Number(baselineMedian)
      signals.push({
        name: 'UNUSUAL_AMOUNT',
        magnitude: Math.min(1, ratio / (opts.unusualAmountMultiple * 10)),
        detail: `largest recent amount is ~${ratio.toFixed(1)}x the baseline median`,
      })
    }
  }

  // --- new protocol category ------------------------------------------------
  const knownProtocols = new Set(
    baseline.map((e) => e.protocolType).filter((p): p is string => Boolean(p)),
  )
  const recentProtocols = new Set(
    recent.map((e) => e.protocolType).filter((p): p is string => Boolean(p)),
  )
  const novelProtocols = [...recentProtocols].filter((p) => !knownProtocols.has(p))
  if (novelProtocols.length > 0 && knownProtocols.size > 0) {
    signals.push({
      name: 'NEW_PROTOCOL_CATEGORY',
      magnitude: Math.min(1, novelProtocols.length / Math.max(1, recentProtocols.size)),
      detail: `entered protocol categories not seen before: ${novelProtocols.join(', ')}`,
    })
  }

  // --- new timing regime ----------------------------------------------------
  const baseHour = meanHourOfDay(baseline)
  const recentHour = meanHourOfDay(recent)
  if (baseHour !== null && recentHour !== null) {
    const distance = hourDistance(baseHour, recentHour)
    if (distance >= opts.timingRegimeShiftHours) {
      signals.push({
        name: 'NEW_TIMING_REGIME',
        // 12 is the maximum possible circular distance between two hours.
        magnitude: Math.min(1, distance / 12),
        detail: `activity moved ~${distance.toFixed(1)}h from its usual hour of day`,
      })
    }
  }

  // --- behaviour sequence deviation ----------------------------------------
  const knownTypes = new Set(baseline.map((e) => e.eventType))
  const recentTypes = new Set(recent.map((e) => e.eventType))
  const novelTypes = [...recentTypes].filter((t) => !knownTypes.has(t))
  if (novelTypes.length > 0) {
    signals.push({
      name: 'BEHAVIOR_SEQUENCE_DEVIATION',
      magnitude: Math.min(1, novelTypes.length / Math.max(1, recentTypes.size)),
      detail: `performed action types not seen before: ${novelTypes.join(', ')}`,
    })
  }

  // --- sudden cluster expansion --------------------------------------------
  if (clusterSizes && clusterSizes.baseline > 0) {
    const multiple = clusterSizes.current / clusterSizes.baseline
    if (multiple >= opts.clusterExpansionMultiple) {
      signals.push({
        name: 'SUDDEN_CLUSTER_EXPANSION',
        magnitude: Math.min(1, multiple / (opts.clusterExpansionMultiple * 4)),
        detail: `cluster grew from ${clusterSizes.baseline} to ${clusterSizes.current} wallets`,
      })
    }
  }

  return {
    signals,
    peakMagnitude: signals.reduce((max, s) => Math.max(max, s.magnitude), 0),
    hadBaseline: true,
  }
}
