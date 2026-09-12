/**
 * Counter-evidence search — Xander V2 spec section 15.2, step 4.
 *
 * The spec puts "query supporting evidence" and "query COUNTER-evidence" as two
 * separate, mandatory steps in the investigation sequence, and this file is the
 * second one. It exists because of a specific failure mode:
 *
 *   An investigator that only looks for support for its own hypothesis will
 *   always find some. Coordination features are correlations, and correlations
 *   appear in innocent populations all the time — that is precisely how the
 *   Arbitrum false positive happened, and it is the lesson this whole project
 *   is built around.
 *
 * So counter-evidence is gathered DETERMINISTICALLY, from the database, before
 * any model sees the case. Leaving it to the LLM to "also consider the other
 * side" is not a control; it is a hope. These checks cannot be talked out of
 * finding what they find.
 *
 * Pure-ish: reads the database, but no network and no model. Every finding
 * names the evidence rows it rests on.
 */
import { prisma } from '../lib/prisma.js'
import { env } from '../config/env.js'
import { loadKnownFunders } from '../risk/known-funders.js'
import { knownFunderKey } from '../risk/features.js'

/** One reason to doubt the coordination hypothesis. */
export interface CounterFinding {
  kind: string
  /** Plain sentence an operator can read without knowing the feature names. */
  detail: string
  /** How strongly this argues AGAINST coordination, 0..1. */
  weight: number
  evidenceIds: string[]
}

export interface CounterEvidenceReport {
  wallets: string[]
  findings: CounterFinding[]
  /** Every evidence row consulted, so the finding is traceable. */
  consideredEvidenceIds: string[]
  /** 0..1. How much doubt the deterministic checks found. Null when unmeasurable. */
  doubt: number | null
  summary: string
}

/**
 * Looks for reasons the coordination hypothesis might be WRONG.
 *
 * Four independent checks, each targeting a different way a benign population
 * produces a coordination-shaped signal.
 */
export async function searchCounterEvidence(args: {
  wallets: readonly string[]
  chain?: string
}): Promise<CounterEvidenceReport> {
  const wallets = [...new Set(args.wallets.map((w) => w.toLowerCase()))]
  if (wallets.length === 0) {
    return {
      wallets: [],
      findings: [],
      consideredEvidenceIds: [],
      doubt: null,
      summary: 'No wallets to examine.',
    }
  }

  const events = await prisma.evidenceEvent.findMany({
    where: { wallet: { in: wallets } },
    orderBy: { timestamp: 'asc' },
  })

  if (events.length === 0) {
    // Null, not zero. No evidence is not "no doubt" — it is no basis for an
    // opinion either way, and reporting 0 would read as "we checked and found
    // nothing exculpatory", which is a much stronger claim than the truth.
    return {
      wallets,
      findings: [],
      consideredEvidenceIds: [],
      doubt: null,
      summary: 'No evidence for these wallets, so no counter-evidence could be gathered.',
    }
  }

  const consideredEvidenceIds = events.map((e) => e.id)
  const findings: CounterFinding[] = []

  findings.push(...(await labelledFunderFindings(events)))
  const timing = divergentTimingFinding(events, wallets)
  if (timing) findings.push(timing)
  const protocols = independentProtocolFinding(events, wallets)
  if (protocols) findings.push(protocols)
  const longevity = independentHistoryFinding(events, wallets)
  if (longevity) findings.push(longevity)

  // Doubt is the strongest single finding, not the sum. Four weak reasons to
  // doubt are not equivalent to one strong one, and summing would let a pile of
  // marginal observations wash out a real coordination signal.
  const doubt = findings.length === 0 ? 0 : Math.max(...findings.map((f) => f.weight))

  return {
    wallets,
    findings,
    consideredEvidenceIds,
    doubt,
    summary:
      findings.length === 0
        ? `Examined ${events.length} events across ${wallets.length} wallets and found nothing that argues against coordination.`
        : `Found ${findings.length} reason(s) to doubt coordination; strongest carries weight ${doubt.toFixed(2)}.`,
  }
}

type EvidenceRow = Awaited<ReturnType<typeof prisma.evidenceEvent.findMany>>[number]

/**
 * Is the shared funder an exchange, a bridge, or a faucet?
 *
 * The Arbitrum case in one check. Thousands of unrelated people withdrawing
 * from the same Binance hot wallet in the same hour after an airdrop
 * announcement look exactly like a funded ring to FUNDING_CORRELATION.
 */
async function labelledFunderFindings(events: EvidenceRow[]): Promise<CounterFinding[]> {
  const funders = new Map<string, { chain: string; address: string; ids: string[] }>()
  for (const event of events) {
    if (!event.counterparty) continue
    const key = knownFunderKey(event.chain, event.counterparty)
    const entry = funders.get(key) ?? {
      chain: event.chain,
      address: event.counterparty,
      ids: [],
    }
    entry.ids.push(event.id)
    funders.set(key, entry)
  }
  if (funders.size === 0) return []

  const known = await loadKnownFunders()
  const findings: CounterFinding[] = []

  for (const [key, entry] of funders) {
    const label = known.get(key)
    if (!label) continue
    findings.push({
      kind: 'SHARED_FUNDER_IS_LABELLED',
      detail:
        `Counterparty ${entry.address} is a labelled ${label.category} ("${label.label}", ` +
        `${label.confidence} confidence). Shared funding through it is weak evidence of ` +
        `coordination — this is the Arbitrum-style false positive.`,
      // Mirrors the scoring multiplier so the two cannot drift apart in spirit:
      // a HIGH-confidence label is a strong reason to doubt.
      weight: label.confidence === 'HIGH' ? 0.9 : label.confidence === 'MEDIUM' ? 0.7 : 0.4,
      evidenceIds: entry.ids.slice(0, 50),
    })
  }
  return findings
}

/** Did the wallets actually act at DIFFERENT times? */
function divergentTimingFinding(
  events: EvidenceRow[],
  wallets: string[],
): CounterFinding | null {
  if (wallets.length < 2) return null

  const firstByWallet = new Map<string, number>()
  for (const event of events) {
    const t = event.timestamp.getTime()
    const seen = firstByWallet.get(event.wallet)
    if (seen === undefined || t < seen) firstByWallet.set(event.wallet, t)
  }
  if (firstByWallet.size < 2) return null

  const times = [...firstByWallet.values()].sort((a, b) => a - b)
  const spreadSeconds = (times[times.length - 1]! - times[0]!) / 1000
  const window = env.TIMING_NORMALIZATION_SECONDS

  // Acting more than an order of magnitude apart is the opposite of the tight
  // burst TIMING_CORRELATION looks for.
  if (spreadSeconds <= window * 10) return null

  const days = spreadSeconds / 86_400
  return {
    kind: 'ACTIVITY_IS_NOT_SYNCHRONISED',
    detail:
      `First activity across these wallets spans ${days.toFixed(1)} days, far wider than the ` +
      `${window}s window a coordinated burst occupies.`,
    weight: Math.min(0.8, 0.3 + Math.log10(spreadSeconds / window) * 0.25),
    evidenceIds: events.slice(0, 50).map((e) => e.id),
  }
}

/** Do the wallets use genuinely different protocols? */
function independentProtocolFinding(
  events: EvidenceRow[],
  wallets: string[],
): CounterFinding | null {
  if (wallets.length < 2) return null

  const byWallet = new Map<string, Set<string>>()
  for (const event of events) {
    if (!event.protocol) continue
    const set = byWallet.get(event.wallet) ?? new Set<string>()
    set.add(event.protocol)
    byWallet.set(event.wallet, set)
  }
  if (byWallet.size < 2) return null

  const sets = [...byWallet.values()]
  const shared = [...sets[0]!].filter((p) => sets.every((s) => s.has(p)))
  const union = new Set(sets.flatMap((s) => [...s]))
  if (union.size === 0) return null

  const overlap = shared.length / union.size
  // Scripted rings tend to hit an identical protocol set. Substantially
  // different behaviour is a real argument for independence.
  if (overlap > 0.4) return null

  return {
    kind: 'PROTOCOL_USAGE_DIVERGES',
    detail:
      `These wallets share only ${shared.length} of ${union.size} protocols ` +
      `(${(overlap * 100).toFixed(0)}% overlap). A scripted ring usually shows a near-identical ` +
      `protocol footprint.`,
    weight: 0.3 + (1 - overlap) * 0.4,
    evidenceIds: events.slice(0, 50).map((e) => e.id),
  }
}

/** Does any wallet have a long history predating the others? */
function independentHistoryFinding(
  events: EvidenceRow[],
  wallets: string[],
): CounterFinding | null {
  if (wallets.length < 2) return null

  const spans = new Map<string, { first: number; last: number; count: number }>()
  for (const event of events) {
    const t = event.timestamp.getTime()
    const s = spans.get(event.wallet) ?? { first: t, last: t, count: 0 }
    s.first = Math.min(s.first, t)
    s.last = Math.max(s.last, t)
    s.count++
    spans.set(event.wallet, s)
  }

  const established = [...spans.entries()].filter(
    ([, s]) => s.last - s.first > 30 * 86_400_000 && s.count >= 10,
  )
  if (established.length === 0) return null

  return {
    kind: 'INDEPENDENT_PRIOR_HISTORY',
    detail:
      `${established.length} of ${spans.size} wallets have more than 30 days of independent ` +
      `history with 10+ events. Disposable ring wallets are typically created shortly before ` +
      `the campaign they target.`,
    weight: Math.min(0.75, 0.35 + established.length / spans.size),
    evidenceIds: events.slice(0, 50).map((e) => e.id),
  }
}
