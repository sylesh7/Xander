/**
 * Freshness guard — Backend-Suganthan.md Phase 11.
 *
 * "Before any risk computation uses evidence, check the `_meta.block.number`
 * captured at fetch time against current chain head. If lag exceeds a
 * configured threshold, or a required deployment query failed outright, the
 * caller gets PENDING_REVIEW back, not a score." (Section 0.2 rule 4.)
 *
 * Three source types, three different freshness questions, because "how
 * stale is this?" means something different for each:
 *
 *  - standardized-subgraph: the literal spec question — re-query the SAME
 *    pinned deployment's `_meta.block.number` right now and compare it to the
 *    block our stored evidence was captured at. This is the one signal that
 *    needs a live network call, so it is bounded to at most one cheap
 *    _meta-only query per DISTINCT deployment present in the wallet set's
 *    evidence — not per row — and it only runs on a cache miss (Sylesh's
 *    Phase 14 cache is what keeps this rare, not this guard).
 *  - substreams: there is no per-wallet "chain head" question here at all —
 *    the real question is "is the live stream still running". That is
 *    exactly what SubstreamsCursor.updatedAt answers, with no network call.
 *  - token-api: the Token API has no `_meta`-equivalent notion of a current
 *    indexed head to compare against. The honest, buildable freshness
 *    question is recency of our own last successful fetch, so this uses
 *    EvidenceEvent.createdAt directly — also no network call.
 *
 * A wallet with NO evidence at all is PENDING_REVIEW too — Section 0.2 rule 4
 * again: an empty picture is not the same as a confidently clean one.
 */
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { getDeployments } from '../graph/standardized-subgraphs/deployment-registry.js'
import { queryDeployment } from '../graph/standardized-subgraphs/client.js'

export interface FreshnessResult {
  fresh: boolean
  /** Human-readable reasons, present whenever `fresh` is false. Feeds logs and receipts. */
  reasons: string[]
}

const SUBSTREAMS_MODULE = 'map_funding_transfers'

/** Injectable clock — tests pin `now` rather than racing the real one. */
export interface FreshnessOptions {
  now?: Date
}

/**
 * Checks whether a wallet set's evidence is fresh enough to score.
 *
 * Reads whatever EvidenceEvent rows already exist for the set — it does not
 * fetch new evidence itself. That is `refreshWalletEvidence`'s job (Phase 12);
 * keeping fetch and freshness-check separate is what lets Sylesh's cache layer
 * decide whether a refresh is worth the network cost before this guard runs.
 */
export async function checkFreshness(
  wallets: readonly string[],
  opts: FreshnessOptions = {},
): Promise<FreshnessResult> {
  const now = opts.now ?? new Date()
  const normalized = wallets.map((w) => w.toLowerCase())
  const reasons: string[] = []

  const rows = await prisma.evidenceEvent.findMany({
    where: { wallet: { in: normalized } },
    select: {
      sourceType: true,
      deploymentId: true,
      chain: true,
      blockNumber: true,
      createdAt: true,
    },
  })

  if (rows.length === 0) {
    return { fresh: false, reasons: ['no evidence found for this wallet set'] }
  }

  const tokenApiRows = rows.filter((r) => r.sourceType === 'token-api')
  const subgraphRows = rows.filter((r) => r.sourceType === 'standardized-subgraph')
  const substreamsRows = rows.filter((r) => r.sourceType === 'substreams')

  // --- token-api: recency of our own last successful fetch --------------
  if (tokenApiRows.length > 0) {
    const newest = tokenApiRows.reduce(
      (a, b) => (b.createdAt > a ? b.createdAt : a),
      tokenApiRows[0]!.createdAt,
    )
    const ageSeconds = (now.getTime() - newest.getTime()) / 1000
    if (ageSeconds > env.FRESHNESS_MAX_EVIDENCE_AGE_SECONDS) {
      reasons.push(
        `token-api evidence is ${Math.round(ageSeconds)}s old, exceeds FRESHNESS_MAX_EVIDENCE_AGE_SECONDS=${env.FRESHNESS_MAX_EVIDENCE_AGE_SECONDS}`,
      )
    }
  }

  // --- standardized-subgraph: live re-check against the pinned deployment
  if (subgraphRows.length > 0) {
    const byDeployment = new Map<string, { maxBlock: bigint; chain: string }>()
    for (const r of subgraphRows) {
      if (!r.deploymentId) continue
      const cur = byDeployment.get(r.deploymentId)
      if (!cur || r.blockNumber > cur.maxBlock) {
        byDeployment.set(r.deploymentId, { maxBlock: r.blockNumber, chain: r.chain })
      }
    }

    const registry = await getDeployments()
    for (const [deploymentId, { maxBlock }] of byDeployment) {
      const entry = registry.find((e) => e.deploymentId === deploymentId)
      if (!entry) {
        reasons.push(`deployment ${deploymentId} is no longer in the registry`)
        continue
      }

      try {
        // __typename is always valid on the Query type — a minimal probe
        // whose only real purpose is the _meta fragment queryDeployment
        // appends automatically.
        const { provenance } = await queryDeployment<{ __typename?: string }>(
          entry,
          'query { __typename }',
        )
        if (!provenance.deploymentMatches) {
          reasons.push(`deployment ${entry.protocol} did not serve from the pinned deployment`)
          continue
        }
        if (provenance.block === null) {
          reasons.push(`deployment ${entry.protocol} reported no block in _meta`)
          continue
        }
        const currentBlock = BigInt(provenance.block)
        const lag = currentBlock - maxBlock
        if (lag > BigInt(env.FRESHNESS_MAX_BLOCK_LAG)) {
          reasons.push(
            `deployment ${entry.protocol} evidence is ${lag} blocks behind (max ${env.FRESHNESS_MAX_BLOCK_LAG})`,
          )
        }
      } catch (err) {
        // "a required deployment query failed outright" — Section 0.2 rule 4
        // names this explicitly as a PENDING_REVIEW trigger, not a thing to
        // swallow and hope the rest of the evidence carries the decision.
        logger.warn({ deploymentId, err }, 'freshness check: deployment query failed')
        reasons.push(`deployment ${entry.protocol} query failed: ${errMessage(err)}`)
      }
    }
  }

  // --- substreams: is the live stream still running? ---------------------
  if (substreamsRows.length > 0) {
    const chains = [...new Set(substreamsRows.map((r) => r.chain))]
    const cursors = await prisma.substreamsCursor.findMany({
      where: { chain: { in: chains }, moduleName: SUBSTREAMS_MODULE },
    })
    const cursorByChain = new Map(cursors.map((c) => [c.chain, c]))

    for (const chain of chains) {
      const cursor = cursorByChain.get(chain)
      if (!cursor) {
        reasons.push(`no substreams cursor for chain ${chain}`)
        continue
      }
      const lagSeconds = (now.getTime() - cursor.updatedAt.getTime()) / 1000
      if (lagSeconds > env.FRESHNESS_MAX_STREAM_LAG_SECONDS) {
        reasons.push(
          `substreams cursor for ${chain} is ${Math.round(lagSeconds)}s stale (max ${env.FRESHNESS_MAX_STREAM_LAG_SECONDS})`,
        )
      }
    }
  }

  return { fresh: reasons.length === 0, reasons }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
