/**
 * Policy loading and versioning — Backend-Suganthan.md Phase 8.5.
 *
 * A PolicyVersion is a frozen snapshot of every weight and threshold at the
 * moment it was activated. It is what makes an Evidence Receipt reproducible:
 * six months from now, after the weights have been retuned twice, "why was this
 * wallet challenged?" is answerable by replaying the stored features against
 * the stored policy — not by guessing what the weights used to be.
 *
 * The live RiskWeight / RiskThreshold tables are the EDITING surface. The
 * active PolicyVersion is the DECIDING surface. Scoring always reads the
 * snapshot, so an operator halfway through editing weights cannot produce a
 * decision from a half-changed policy.
 */
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import {
  PolicyError,
  validateThresholds,
  validateWeights,
  type Threshold,
  type Weight,
} from './scoring.js'

export interface ActivePolicy {
  version: string
  weights: Weight[]
  thresholds: Threshold[]
}

/** Reads the live editable tables — the surface an operator changes. */
export async function readLiveTables(): Promise<{ weights: Weight[]; thresholds: Threshold[] }> {
  const [weightRows, thresholdRows] = await Promise.all([
    prisma.riskWeight.findMany({ orderBy: { feature: 'asc' } }),
    prisma.riskThreshold.findMany({ orderBy: { minScore: 'asc' } }),
  ])
  return {
    weights: weightRows.map((w) => ({ feature: w.feature, weight: w.weight })),
    thresholds: thresholdRows.map((t) => ({
      band: t.band,
      minScore: t.minScore,
      maxScore: t.maxScore,
    })),
  }
}

/**
 * The policy scoring uses.
 *
 * Throws when no version is active. Section 0.2 rule 4: a missing policy is a
 * loud failure, never a silent fallback to some default that would produce a
 * confident decision nobody configured.
 */
export async function loadActivePolicy(): Promise<ActivePolicy> {
  const row = await prisma.policyVersion.findFirst({ where: { active: true } })
  if (!row) {
    throw new PolicyError(
      'No active PolicyVersion. Run the seed or activate a version before scoring — ' +
        'scoring without a policy would invent a decision.',
    )
  }

  const weights = row.weights as unknown as Weight[]
  const thresholds = row.thresholds as unknown as Threshold[]

  // A snapshot can be corrupted by a bad hand-edit. Validate on read so the
  // failure names the policy rather than surfacing as a strange score later.
  validateWeights(weights)
  validateThresholds(thresholds)

  return { version: row.version, weights, thresholds }
}

/**
 * Snapshots the current live tables as a new active PolicyVersion.
 *
 * Validates BEFORE writing: an invalid policy must never become the active one,
 * because everything scored afterwards would inherit the fault.
 *
 * Deactivating the previous version and activating the new one happen in one
 * transaction. Section 0.4 notes Postgres cannot express "at most one true"
 * without a partial index, so the invariant is held here — two active versions
 * would make "which policy decided this?" unanswerable.
 */
export async function activatePolicyVersion(version: string): Promise<ActivePolicy> {
  const { weights, thresholds } = await readLiveTables()
  validateWeights(weights)
  validateThresholds(thresholds)

  const existing = await prisma.policyVersion.findUnique({ where: { version } })
  if (existing) {
    throw new PolicyError(
      `PolicyVersion ${version} already exists. Bump the version rather than ` +
        `overwriting — receipts already reference this one.`,
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.policyVersion.updateMany({ where: { active: true }, data: { active: false } })
    await tx.policyVersion.create({
      data: {
        version,
        weights: weights as unknown as object,
        thresholds: thresholds as unknown as object,
        active: true,
      },
    })
  })

  logger.info({ version, weights: weights.length }, 'activated policy version')
  return { version, weights, thresholds }
}

/**
 * Fetches a specific version by name — how a receipt is replayed.
 *
 * `GET /receipts/:id` (Sylesh Phase 21) reconstructs a decision by loading the
 * features stored on the receipt and the policy named on it, then re-running
 * `scoreFeatures`. That only works because the snapshot is immutable.
 */
export async function loadPolicyVersion(version: string): Promise<ActivePolicy> {
  const row = await prisma.policyVersion.findUnique({ where: { version } })
  if (!row) throw new PolicyError(`PolicyVersion ${version} not found.`)
  return {
    version: row.version,
    weights: row.weights as unknown as Weight[],
    thresholds: row.thresholds as unknown as Threshold[],
  }
}
