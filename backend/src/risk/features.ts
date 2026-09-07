/**
 * The five risk features — Backend-Suganthan.md Phase 7.
 *
 * Every extractor is pure: `(walletSet, evidenceWindow, opts) => FeatureResult`.
 * No database, no network, no clock. They are computed at CLUSTER level — the
 * cluster is the unit of analysis (Section 0.2 rule 6), so these measure how
 * alike a SET of wallets is, not how alike two wallets are.
 *
 * All knobs arrive in `opts`; there are no inline numbers in any formula
 * (Section 0.2 rule 1). `./index.ts` supplies them from env.
 */
import { jaccard } from '../behavior-graph/pairwise.js'
import type {
  Confidence,
  EvidenceWindow,
  FeatureOptions,
  FeatureResult,
  RiskEvidenceRow,
} from './types.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type ByWallet = Map<string, RiskEvidenceRow[]>

function groupRows(wallets: readonly string[], window: EvidenceWindow): ByWallet {
  const set = new Set(wallets.map((w) => w.toLowerCase()))
  const out: ByWallet = new Map()
  for (const w of set) out.set(w, [])
  for (const e of window.events) {
    const list = out.get(e.wallet.toLowerCase())
    if (list) list.push(e)
  }
  for (const list of out.values()) {
    list.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
      return a.timestamp.getTime() - b.timestamp.getTime()
    })
  }
  return out
}

/**
 * Confidence from coverage: what fraction of the wallet set actually had the
 * evidence this feature needs.
 *
 * Deliberately not derived from the value. A feature computed from 2 of 20
 * wallets can produce a confident-looking number from almost no data, and the
 * Evidence Receipt has to be able to say so.
 */
function coverageConfidence(withEvidence: number, total: number): Confidence {
  if (total === 0) return 'LOW'
  const ratio = withEvidence / total
  if (ratio >= 0.8) return 'HIGH'
  if (ratio >= 0.5) return 'MEDIUM'
  return 'LOW'
}

/** Population standard deviation. Returns 0 for fewer than two samples. */
export function stddev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/**
 * The spread-to-similarity shape both TIMING_CORRELATION and
 * WALLET_AGE_SIMILARITY use: `max(0, 1 - spread / normalizer)`.
 *
 * Tight spread means near 1; spread beyond the normalizer clamps to 0.
 */
export function spreadSimilarity(spread: number, normalizer: number): number {
  if (normalizer <= 0) return 0
  return Math.max(0, 1 - spread / normalizer)
}

/**
 * Below this many events, an LCS ratio says more about the small size of the
 * event vocabulary than about shared behaviour. Used to downgrade confidence,
 * never to alter the value.
 */
const MIN_INFORMATIVE_SEQUENCE_LENGTH = 4

/** Lowers a confidence by one level. */
function downgrade(c: Confidence): Confidence {
  return c === 'HIGH' ? 'MEDIUM' : 'LOW'
}

/** A featureless result, with the reason recorded. */
function empty(
  name: FeatureResult['name'],
  note: string,
  confidence: Confidence = 'LOW',
): FeatureResult {
  return { name, value: 0, confidence, sourceEvidenceIds: [], note }
}

/**
 * A set of fewer than two wallets has no internal structure to measure.
 *
 * Every extractor guards on this. Without it, a one-wallet set produces a
 * stddev of 0, which `spreadSimilarity` turns into a perfect 1.0 — a lone
 * wallet scoring maximum coordination against itself.
 */
function tooFewWallets(wallets: readonly string[]): boolean {
  return new Set(wallets.map((w) => w.toLowerCase())).size < 2
}

// ---------------------------------------------------------------------------
// FUNDING_CORRELATION
// ---------------------------------------------------------------------------

/**
 * The largest number of timestamps that fall inside any single window of
 * `windowMs`, via a two-pointer sweep over the sorted values.
 *
 * Needed because "grouped by shared funder within FUNDING_WINDOW_HOURS" is not
 * the same as "share a funder". One exchange hot wallet funds thousands of
 * unrelated people over years; only the ones it funded in a tight burst are
 * evidence of coordination.
 */
export function largestWindowCluster(timesMs: readonly number[], windowMs: number): number {
  if (timesMs.length === 0) return 0
  const sorted = [...timesMs].sort((a, b) => a - b)
  let best = 1
  let left = 0
  for (let right = 0; right < sorted.length; right++) {
    while (sorted[right]! - sorted[left]! > windowMs) left++
    best = Math.max(best, right - left + 1)
  }
  return best
}

/**
 * FUNDING_CORRELATION — does this wallet set share a funder?
 *
 * `value = (largest shared-funder group − 1) / (total wallets − 1)`
 *
 * The `−1`s make the scale meaningful: one wallet cannot be "co-funded" with
 * itself, so a group of 1 scores 0, and a group covering every wallet scores 1.
 *
 * FUNDING_LOOKBACK_HOPS is 1 — the direct funder only. Walking further back is
 * a real graph traversal and the spec says not to reach for it until
 * direct-funder correlation proves insufficient.
 */
export const fundingCorrelation = (
  wallets: readonly string[],
  window: EvidenceWindow,
  opts: FeatureOptions,
): FeatureResult => {
  const name = 'FUNDING_CORRELATION' as const
  if (tooFewWallets(wallets)) return empty(name, 'fewer than two wallets')

  const byWallet = groupRows(wallets, window)
  const total = byWallet.size

  // Earliest inbound transfer per wallet: who funded it, when, and which row said so.
  const funded = new Map<string, { funder: string; atMs: number; evidenceId: string }>()
  for (const [wallet, rows] of byWallet) {
    for (const r of rows) {
      if (r.eventType !== 'transfer' || !r.counterparty) continue
      const prev = funded.get(wallet)
      const atMs = r.timestamp.getTime()
      if (!prev || atMs < prev.atMs) {
        funded.set(wallet, { funder: r.counterparty.toLowerCase(), atMs, evidenceId: r.id })
      }
    }
  }

  if (funded.size === 0) {
    return empty(name, 'no inbound transfer evidence for any wallet')
  }

  const byFunder = new Map<string, Array<{ atMs: number; evidenceId: string }>>()
  for (const f of funded.values()) {
    const list = byFunder.get(f.funder)
    if (list) list.push({ atMs: f.atMs, evidenceId: f.evidenceId })
    else byFunder.set(f.funder, [{ atMs: f.atMs, evidenceId: f.evidenceId }])
  }

  const windowMs = opts.fundingWindowHours * 3_600_000
  let bestCount = 0
  let bestFunder: string | null = null
  for (const [funder, entries] of byFunder) {
    const count = largestWindowCluster(
      entries.map((e) => e.atMs),
      windowMs,
    )
    if (count > bestCount) {
      bestCount = count
      bestFunder = funder
    }
  }

  const value = total > 1 ? (bestCount - 1) / (total - 1) : 0

  return {
    name,
    value: Math.min(1, Math.max(0, value)),
    confidence: coverageConfidence(funded.size, total),
    sourceEvidenceIds:
      bestFunder === null ? [] : (byFunder.get(bestFunder) ?? []).map((e) => e.evidenceId),
    ...(funded.size < total
      ? { note: `funding evidence for ${funded.size}/${total} wallets` }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// TIMING_CORRELATION
// ---------------------------------------------------------------------------

/**
 * TIMING_CORRELATION — did these wallets act at suspiciously similar times?
 *
 * `value = max(0, 1 − stddev_seconds(timestamps) / TIMING_NORMALIZATION_SECONDS)`
 *
 * The timestamps compared are each wallet's FIRST activity. The spec says
 * "timestamps" without saying which; first-activity is the choice that measures
 * coordinated arrival — a ring of wallets waking up together — rather than
 * being dominated by whichever member happened to stay busiest afterwards.
 */
export const timingCorrelation = (
  wallets: readonly string[],
  window: EvidenceWindow,
  opts: FeatureOptions,
): FeatureResult => {
  const name = 'TIMING_CORRELATION' as const
  if (tooFewWallets(wallets)) return empty(name, 'fewer than two wallets')

  const byWallet = groupRows(wallets, window)
  const total = byWallet.size

  const firsts: Array<{ seconds: number; evidenceId: string }> = []
  for (const rows of byWallet.values()) {
    const first = rows[0]
    if (first) firsts.push({ seconds: first.timestamp.getTime() / 1000, evidenceId: first.id })
  }

  if (firsts.length < 2) {
    return empty(name, 'fewer than two wallets have any evidence')
  }

  const value = spreadSimilarity(
    stddev(firsts.map((f) => f.seconds)),
    opts.timingNormalizationSeconds,
  )

  return {
    name,
    value,
    confidence: coverageConfidence(firsts.length, total),
    sourceEvidenceIds: firsts.map((f) => f.evidenceId),
    ...(firsts.length < total ? { note: `timing from ${firsts.length}/${total} wallets` } : {}),
  }
}

// ---------------------------------------------------------------------------
// WALLET_AGE_SIMILARITY
// ---------------------------------------------------------------------------

/**
 * WALLET_AGE_SIMILARITY — were these wallets born around the same time?
 *
 * `value = max(0, 1 − stddev_blocks(firstSeenBlock) / AGE_NORMALIZATION_BLOCKS)`
 *
 * Computed in BLOCKS, not converted to wall-clock time first. The spec says
 * "converted to approximate timestamp via average block time" and then
 * normalizes by a block COUNT, which is dimensionally inconsistent. Staying in
 * blocks also avoids introducing an average-block-time constant, which would be
 * wrong the moment a cluster spans chains — mainnet is ~12s a block and Polygon
 * ~2s, so one constant would silently distort every cross-chain comparison.
 */
export const walletAgeSimilarity = (
  wallets: readonly string[],
  window: EvidenceWindow,
  opts: FeatureOptions,
): FeatureResult => {
  const name = 'WALLET_AGE_SIMILARITY' as const
  if (tooFewWallets(wallets)) return empty(name, 'fewer than two wallets')

  const byWallet = groupRows(wallets, window)
  const total = byWallet.size

  const firstBlocks: Array<{ block: number; evidenceId: string }> = []
  for (const rows of byWallet.values()) {
    const first = rows[0]
    // Number() is safe here: block heights are far below MAX_SAFE_INTEGER, and
    // stddev needs floats. The bigint is preserved everywhere it is persisted.
    if (first) firstBlocks.push({ block: Number(first.blockNumber), evidenceId: first.id })
  }

  if (firstBlocks.length < 2) {
    return empty(name, 'fewer than two wallets have any evidence')
  }

  const value = spreadSimilarity(
    stddev(firstBlocks.map((f) => f.block)),
    opts.ageNormalizationBlocks,
  )

  return {
    name,
    value,
    confidence: coverageConfidence(firstBlocks.length, total),
    sourceEvidenceIds: firstBlocks.map((f) => f.evidenceId),
    ...(firstBlocks.length < total
      ? { note: `age from ${firstBlocks.length}/${total} wallets` }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// SHARED_COUNTERPARTY
// ---------------------------------------------------------------------------

/**
 * SHARED_COUNTERPARTY — average pairwise Jaccard similarity of the distinct
 * counterparties each wallet has touched.
 *
 * `J = |Cᵢ ∩ Cⱼ| / |Cᵢ ∪ Cⱼ|`, averaged across all pairs.
 *
 * Averaged over ALL pairs, including pairs where both sets are empty (which
 * score 0). Skipping empty pairs would let a cluster of mostly-unknown wallets
 * inherit the score of its one well-documented pair.
 */
export const sharedCounterparty = (
  wallets: readonly string[],
  window: EvidenceWindow,
  _opts: FeatureOptions,
): FeatureResult => {
  const name = 'SHARED_COUNTERPARTY' as const
  if (tooFewWallets(wallets)) return empty(name, 'fewer than two wallets')

  const byWallet = groupRows(wallets, window)
  const total = byWallet.size

  const sets = new Map<string, Set<string>>()
  const idsByCounterparty = new Map<string, string[]>()
  for (const [wallet, rows] of byWallet) {
    const s = new Set<string>()
    for (const r of rows) {
      if (!r.counterparty) continue
      const cp = r.counterparty.toLowerCase()
      s.add(cp)
      const ids = idsByCounterparty.get(cp)
      if (ids) ids.push(r.id)
      else idsByCounterparty.set(cp, [r.id])
    }
    sets.set(wallet, s)
  }

  const withEvidence = [...sets.values()].filter((s) => s.size > 0).length
  const keys = [...sets.keys()].sort()

  let sum = 0
  let pairs = 0
  const contributing = new Set<string>()
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = sets.get(keys[i]!)!
      const b = sets.get(keys[j]!)!
      const score = jaccard(a, b)
      sum += score
      pairs++
      if (score > 0) for (const cp of a) if (b.has(cp)) contributing.add(cp)
    }
  }

  const sourceEvidenceIds = [...contributing].flatMap((cp) => idsByCounterparty.get(cp) ?? [])

  return {
    name,
    value: pairs === 0 ? 0 : sum / pairs,
    confidence: coverageConfidence(withEvidence, total),
    sourceEvidenceIds,
    ...(withEvidence < total
      ? { note: `counterparties for ${withEvidence}/${total} wallets` }
      : {}),
  }
}

// ---------------------------------------------------------------------------
// PROTOCOL_BEHAVIOR_SIMILARITY
// ---------------------------------------------------------------------------

/**
 * Length of the longest common subsequence of two sequences.
 *
 * Subsequence, not substring: order matters but gaps are allowed, so two
 * wallets running deposit → borrow → repay catch each other even if one also
 * made an unrelated swap partway through.
 *
 * Rolling two rows keeps memory O(min(n, m)) instead of O(n*m).
 */
export function lcsLength(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  let prev = new Array<number>(short.length + 1).fill(0)
  let cur = new Array<number>(short.length + 1).fill(0)

  for (let i = 1; i <= long.length; i++) {
    for (let j = 1; j <= short.length; j++) {
      cur[j] = long[i - 1] === short[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!)
    }
    ;[prev, cur] = [cur, prev]
    cur.fill(0)
  }
  return prev[short.length]!
}

/**
 * PROTOCOL_BEHAVIOR_SIMILARITY — do these wallets walk the same path through
 * the same protocols, in the same order?
 *
 * `LCS(seqᵢ, seqⱼ) / max(|seqᵢ|, |seqⱼ|)`, averaged across pairs.
 *
 * Dividing by the LONGER sequence is what stops a short sequence scoring 1.0
 * against a long one just because it happens to be a prefix of it.
 *
 * Sequences are truncated to `protocolSequenceMaxLength`. LCS is O(n*m) per
 * pair and a busy wallet with tens of thousands of events would otherwise
 * dominate the entire scoring pass. The truncation keeps the EARLIEST events,
 * because a Sybil ring's tell is a shared setup sequence, not a shared tail.
 */
export const protocolBehaviorSimilarity = (
  wallets: readonly string[],
  window: EvidenceWindow,
  opts: FeatureOptions,
): FeatureResult => {
  const name = 'PROTOCOL_BEHAVIOR_SIMILARITY' as const
  if (tooFewWallets(wallets)) return empty(name, 'fewer than two wallets')

  const byWallet = groupRows(wallets, window)
  const total = byWallet.size

  const seqs = new Map<string, { types: string[]; ids: string[] }>()
  for (const [wallet, rows] of byWallet) {
    const capped = rows.slice(0, opts.protocolSequenceMaxLength)
    seqs.set(wallet, { types: capped.map((r) => r.eventType), ids: capped.map((r) => r.id) })
  }

  const withEvidence = [...seqs.values()].filter((s) => s.types.length > 0).length
  if (withEvidence < 2) {
    return empty(name, 'fewer than two wallets have any evidence')
  }

  const keys = [...seqs.keys()].sort()
  let sum = 0
  let pairs = 0
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = seqs.get(keys[i]!)!.types
      const b = seqs.get(keys[j]!)!.types
      const longest = Math.max(a.length, b.length)
      sum += longest === 0 ? 0 : lcsLength(a, b) / longest
      pairs++
    }
  }

  // Short sequences inflate this feature. Drawn from a vocabulary of seven
  // event types, two wallets with two events each that both open with a
  // transfer already score 0.5 by coincidence alone. The formula is fixed by
  // the spec, so the correction belongs in confidence: a mathematically valid
  // number computed from almost no behaviour is exactly what `confidence`
  // exists to flag.
  const lengths = [...seqs.values()].map((s) => s.types.length).filter((n) => n > 0)
  const shortest = lengths.length === 0 ? 0 : Math.min(...lengths)
  const base = coverageConfidence(withEvidence, total)
  const confidence: Confidence = shortest < MIN_INFORMATIVE_SEQUENCE_LENGTH ? downgrade(base) : base

  const notes: string[] = []
  if (withEvidence < total) notes.push(`sequences for ${withEvidence}/${total} wallets`)
  if (shortest < MIN_INFORMATIVE_SEQUENCE_LENGTH) {
    notes.push(`shortest sequence is ${shortest} events — similarity is weakly evidenced`)
  }

  return {
    name,
    value: pairs === 0 ? 0 : sum / pairs,
    confidence,
    sourceEvidenceIds: [...seqs.values()].flatMap((s) => s.ids),
    ...(notes.length > 0 ? { note: notes.join('; ') } : {}),
  }
}

// ---------------------------------------------------------------------------

/** All five, in the order they appear in the spec. */
export const EXTRACTORS = [
  fundingCorrelation,
  timingCorrelation,
  walletAgeSimilarity,
  sharedCounterparty,
  protocolBehaviorSimilarity,
] as const

export function extractFeatures(
  wallets: readonly string[],
  window: EvidenceWindow,
  opts: FeatureOptions,
): FeatureResult[] {
  return EXTRACTORS.map((fn) => fn(wallets, window, opts))
}
