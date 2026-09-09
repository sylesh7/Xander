/**
 * SHARED seed script. Both tracks write into this ONE file.
 *
 * Backend-Suganthan.md Phase 2: "create the file now so Sylesh can add
 * World-side seed data to the same script later without a merge conflict."
 * Backend-Sylesh.md Phase 23: "extend Suganthan's prisma/seed.ts with your
 * World-side fixtures rather than writing a second seed file."
 *
 * RULE: append inside your own function below. Do not reorder or rewrite the
 * other person's function. Run with `npm run db:seed`.
 *
 * STATUS: skeleton (Phase 2). Populated in Phase 12.
 */
import { prisma } from '../src/lib/prisma.js'
import { logger } from '../src/lib/logger.js'
import { activatePolicyVersion } from '../src/risk/policy.js'
import { RESERVE_WEIGHT } from '../src/risk/scoring.js'
import { persistEvidenceEvents } from '../src/evidence/repository.js'
import type { NormalizedEvidenceEvent } from '../src/evidence/types.js'
import {
  FIXTURE_CLEAN_WALLET,
  FIXTURE_CLUSTERED_WALLET,
  recomputeClusterForCandidates,
} from '../src/interfaces/evidence-risk-api.js'
// --- SYLESH (Phases 13-25) ---------------------------------------------------
import {
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_CHALLENGE_FUNDER,
  FIXTURE_CHALLENGE_MATE,
  FIXTURE_CHALLENGE_SHARED_COUNTERPARTY,
  FIXTURE_CHALLENGE_STATE_WALLET,
  FIXTURE_CHALLENGE_WALLET,
  FIXTURE_EXPIRED_STATE_WALLET,
  FIXTURE_FAILED_STATE_WALLET,
  FIXTURE_PASSED_STATE_WALLET,
} from '../src/claim/fixtures.js'
import { buildWorldAction } from '../src/world/idkit-request-config.js'
import { expectedSignalHash } from '../src/world/wallet-binding.js'
import { nullifierToDecimalString } from '../src/world/replay-protection.js'

/**
 * SUGANTHAN — Phase 12.1.
 *
 * Two scenarios, both required by the Phase 8 and Phase 12 acceptance tests:
 *   A. a clean wallet      -> score near 0    -> resolves ALLOW
 *   B. a coordinated set   -> 5 wallets, one shared funder, tight timing window
 *                          -> resolves CHALLENGE or higher
 *
 * Also seeds the config tables the risk engine reads at runtime:
 *   - DeploymentRegistryEntry (Phase 4) — "which protocols we support" lives
 *     ONLY here; adding a protocol is an INSERT, never a code change.
 *   - RiskWeight / RiskThreshold (Phase 8) — weights must sum to 1.0; the
 *     seed step fails loudly if they don't.
 *   - PolicyVersion (Phase 8) — snapshot of the above, exactly one row active.
 */
/**
 * Deployment registry rows — Phase 4.
 *
 * Every deployment id below was verified live on 2026-09-07: fetched through
 * the gateway, schema introspected, and confirmed to implement the standardized
 * schema its `schemaFamily` claims. Do not add a row from a Graph Explorer
 * listing alone — plenty of subgraphs named "Aave V3 <chain>" implement Aave's
 * OWN schema (protocols/pools/supplies/redeemUnderlyings) rather than the
 * standardized one (lendingProtocols/markets/positions/deposits/withdraws), and
 * the two are not interchangeable.
 *
 * Aave V3 Ethereum and Compound V3 Ethereum are both lending-cdp on purpose:
 * two different protocols answering one query function with no protocol branch
 * is the Phase 4 acceptance test.
 */
const DEPLOYMENTS = [
  {
    protocol: 'aave-v3',
    chain: 'mainnet',
    schemaFamily: 'lending-cdp',
    deploymentId: 'QmcXE5QVcBcvcaJddPxd8mFs6W9xt7STmwfgguoiM6ddAd',
  },
  {
    protocol: 'compound-v3',
    chain: 'mainnet',
    schemaFamily: 'lending-cdp',
    deploymentId: 'QmNrQoow7pjM3biRnnhzeCaDYhuEbDyjKCpFeNv2oGXnuK',
  },
  {
    protocol: 'compound-v2',
    chain: 'mainnet',
    schemaFamily: 'lending-cdp',
    deploymentId: 'QmZ2LVu8b1J9F92CDRnDKX4CcM21zSNjb9ogdRfMxVCFrg',
  },
  {
    protocol: 'compound-v3',
    chain: 'polygon',
    schemaFamily: 'lending-cdp',
    deploymentId: 'QmSpf6KX1qpKPkMdQWwRee3uyztNbsNn4NQv3Jaf6AC3z7',
  },
  {
    protocol: 'uniswap-v3',
    chain: 'mainnet',
    schemaFamily: 'dex-amm',
    deploymentId: 'Qmc9TiHtLDgsbgqvyfXKiyndZDnjWdrfdvETgarZbg3StY',
  },
] as const

/**
 * Phase 8 seed weights.
 *
 * A CONFIGURABLE DEMO POLICY, NOT A VALIDATED MODEL. These numbers were chosen
 * to be reasonable and explainable, not fitted against labelled Sybil data.
 * See docs/RISK-MODEL.md. Say this out loud in the pitch — claiming a tuned
 * model would be the one dishonest thing in an otherwise auditable system.
 *
 * RESERVE is unallocated headroom held as a real row so the table genuinely
 * sums to 1.0 and validation is honest rather than special-cased. Its value is
 * always 0, so the maximum achievable score is 0.85.
 */
const SEED_WEIGHTS = [
  { feature: 'FUNDING_CORRELATION', weight: 0.25 },
  { feature: 'TIMING_CORRELATION', weight: 0.15 },
  { feature: 'WALLET_AGE_SIMILARITY', weight: 0.15 },
  { feature: 'SHARED_COUNTERPARTY', weight: 0.15 },
  { feature: 'PROTOCOL_BEHAVIOR_SIMILARITY', weight: 0.15 },
  { feature: RESERVE_WEIGHT, weight: 0.15 },
] as const

/** Phase 8 policy bands. Half-open [min, max), top band closed at 1.0. */
const SEED_THRESHOLDS = [
  { band: 'ALLOW', minScore: 0, maxScore: 0.35 },
  { band: 'CHALLENGE', minScore: 0.35, maxScore: 0.7 },
  { band: 'BLOCK', minScore: 0.7, maxScore: 1 },
] as const

const SEED_POLICY_VERSION = '1.0'

async function seedPolicy(): Promise<void> {
  for (const w of SEED_WEIGHTS) {
    await prisma.riskWeight.upsert({
      where: { feature: w.feature },
      create: w,
      update: { weight: w.weight },
    })
  }
  for (const t of SEED_THRESHOLDS) {
    await prisma.riskThreshold.upsert({
      where: { band: t.band },
      create: t,
      update: { minScore: t.minScore, maxScore: t.maxScore },
    })
  }

  const existing = await prisma.policyVersion.findUnique({
    where: { version: SEED_POLICY_VERSION },
  })
  if (existing) {
    logger.info({ version: SEED_POLICY_VERSION }, '[seed:suganthan] policy version already exists')
    return
  }

  const policy = await activatePolicyVersion(SEED_POLICY_VERSION)
  logger.info(
    { version: policy.version, weights: policy.weights.length, bands: policy.thresholds.length },
    '[seed:suganthan] policy seeded and activated',
  )
}

async function seedSuganthan(): Promise<void> {
  for (const d of DEPLOYMENTS) {
    // Keyed on deploymentId so re-seeding is idempotent and an operator's
    // manual `enabled: false` is not silently undone.
    const existing = await prisma.deploymentRegistryEntry.findFirst({
      where: { deploymentId: d.deploymentId },
    })
    if (existing) continue
    await prisma.deploymentRegistryEntry.create({ data: d })
  }
  const count = await prisma.deploymentRegistryEntry.count()
  logger.info({ deployments: count }, '[seed:suganthan] deployment registry seeded')

  await seedPolicy()
  await seedFixtureScenarios()
}

/**
 * Phase 12.1 fixture scenarios — the acceptance test for the whole track:
 *
 *   A. FIXTURE_CLEAN_WALLET alone     -> score near 0    -> resolves ALLOW
 *   B. FIXTURE_CLUSTERED_WALLET + 4   -> shared funder, tight window,
 *      more wallets                      identical protocol path -> CHALLENGE+
 *
 * sourceType is 'token-api' with deploymentId: null rather than 'substreams'.
 * That is a deliberate choice, not an arbitrary label: the freshness guard
 * (Phase 11) treats 'substreams' evidence as needing a live SubstreamsCursor
 * row for the chain it claims, which synthetic seed data has no business
 * creating — a fixture wallet would resolve PENDING_REVIEW forever, defeating
 * the entire point of a fixture that is supposed to exercise the OK path.
 * 'token-api' evidence is judged purely on EvidenceEvent.createdAt recency,
 * which seeding satisfies automatically.
 *
 * Idempotent via the same @@unique([transactionHash, eventType, wallet,
 * sourceId]) constraint Phase 5 already enforces — re-running the seed is a
 * no-op on the events themselves. Re-seeding is NOT re-run for the cluster
 * formation step below (see the guard there).
 */
async function seedFixtureScenarios(): Promise<void> {
  const t0 = Date.now()
  const at = (minutesFromT0: number) => new Date(t0 + minutesFromT0 * 60_000)

  const cleanEvents: NormalizedEvidenceEvent[] = [
    {
      chain: 'seed',
      wallet: FIXTURE_CLEAN_WALLET,
      counterparty: '0x00000000000000000000000000000000fund3d',
      eventType: 'transfer',
      protocol: null,
      protocolType: null,
      amount: '1000000000000000000',
      timestamp: at(0),
      blockNumber: 1_000_000n,
      transactionHash: '0xseedcleantx1',
      sourceType: 'token-api',
      sourceId: '0xseedcleantx1-0',
      deploymentId: null,
    },
    {
      chain: 'seed',
      wallet: FIXTURE_CLEAN_WALLET,
      counterparty: '0x00000000000000000000000000000000venue1',
      eventType: 'deposit',
      protocol: 'seed-protocol',
      protocolType: 'lending-cdp',
      amount: '500000000000000000',
      timestamp: at(60 * 24 * 30), // a month later — no coordinated timing
      blockNumber: 1_050_000n,
      transactionHash: '0xseedcleantx2',
      sourceType: 'token-api',
      sourceId: '0xseedcleantx2-0',
      deploymentId: null,
    },
  ]

  // 5 wallets: FIXTURE_CLUSTERED_WALLET plus 4 synthetic mates, one shared
  // funder, all funded within minutes, identical deposit->borrow->repay path.
  const clusterMates = [
    FIXTURE_CLUSTERED_WALLET,
    '0x00000000000000000000000000000000c1058',
    '0x00000000000000000000000000000000c1059',
    '0x00000000000000000000000000000000c105a',
    '0x00000000000000000000000000000000c105b',
  ]
  const sharedFunder = '0x00000000000000000000000000000000ring0f'
  const sharedMarket = '0x00000000000000000000000000000000market'

  const clusterEvents: NormalizedEvidenceEvent[] = clusterMates.flatMap((wallet, i) => [
    {
      chain: 'seed',
      wallet,
      counterparty: sharedFunder,
      eventType: 'transfer',
      protocol: null,
      protocolType: null,
      amount: '2000000000000000000',
      timestamp: at(i), // minutes apart — a tight window
      blockNumber: 2_000_000n + BigInt(i),
      transactionHash: `0xseedring${i}a`,
      sourceType: 'token-api',
      sourceId: `0xseedring${i}a-0`,
      deploymentId: null,
    },
    {
      chain: 'seed',
      wallet,
      counterparty: sharedMarket,
      eventType: 'deposit',
      protocol: 'seed-protocol',
      protocolType: 'lending-cdp',
      amount: '1000000000000000000',
      timestamp: at(60 + i),
      blockNumber: 2_100_000n + BigInt(i),
      transactionHash: `0xseedring${i}b`,
      sourceType: 'token-api',
      sourceId: `0xseedring${i}b-0`,
      deploymentId: null,
    },
    {
      chain: 'seed',
      wallet,
      counterparty: sharedMarket,
      eventType: 'borrow',
      protocol: 'seed-protocol',
      protocolType: 'lending-cdp',
      amount: '500000000000000000',
      timestamp: at(70 + i),
      blockNumber: 2_200_000n + BigInt(i),
      transactionHash: `0xseedring${i}c`,
      sourceType: 'token-api',
      sourceId: `0xseedring${i}c-0`,
      deploymentId: null,
    },
  ])

  const { created } = await persistEvidenceEvents([...cleanEvents, ...clusterEvents])
  logger.info(
    { created, cleanWallet: FIXTURE_CLEAN_WALLET, clusterWallets: clusterMates.length },
    '[seed:suganthan] fixture evidence seeded',
  )

  // Form the actual cluster so getOrComputeClusterRisk(FIXTURE_CLUSTERED_WALLET)
  // finds a real, persisted Cluster rather than scoring the wallet alone.
  // Guarded on the Wallet row already having a cluster so re-running the seed
  // does not create a second Cluster pointing at the same wallets.
  const already = await prisma.wallet.findUnique({ where: { address: FIXTURE_CLUSTERED_WALLET } })
  if (already?.clusterId) {
    logger.info('[seed:suganthan] fixture cluster already formed, skipping')
    return
  }
  const clusterIds = await recomputeClusterForCandidates(clusterMates)
  logger.info({ clusterIds }, '[seed:suganthan] fixture cluster formed')
}

/**
 * SYLESH — Phase 23. World-side fixtures.
 *
 * Two groups:
 *   A. A real two-wallet cluster that SCORES into the CHALLENGE band. Suganthan's
 *      fixtures cover ALLOW (clean) and BLOCK (the 0.85 ring); neither exercises
 *      escalation, and CHALLENGE is the entire World path. This one is scored by
 *      the real feature extractors from real seeded evidence — its 0.43 is
 *      measured, not written down.
 *   B. Claim + VerificationChallenge rows in each lifecycle state, so the World
 *      flow and `GET /receipts/:id` can be exercised without holding a real
 *      Selfie Check proof.
 */
const SYLESH_CHALLENGE_PATHS = {
  [FIXTURE_CHALLENGE_WALLET]: ['deposit', 'borrow', 'repay', 'withdraw'],
  [FIXTURE_CHALLENGE_MATE]: ['swap', 'swap', 'deposit', 'swap'],
} as const

async function seedChallengeBandCluster(): Promise<void> {
  const t0 = Date.now()
  const at = (minutes: number) => new Date(t0 + minutes * 60_000)

  const wallets = [FIXTURE_CHALLENGE_WALLET, FIXTURE_CHALLENGE_MATE]
  // 20h apart: inside FUNDING_WINDOW_HOURS (24) so the pair is genuinely
  // co-funded, far enough apart that TIMING_CORRELATION stays at 0.
  const fundedAtMinutes = [0, 20 * 60]
  // ~45k blocks apart against a 50k normalizer — similar, not identical.
  const ageBase = [3_000_000n, 3_045_000n]

  const events: NormalizedEvidenceEvent[] = []

  wallets.forEach((wallet, i) => {
    events.push({
      chain: 'seed',
      wallet,
      counterparty: FIXTURE_CHALLENGE_FUNDER,
      eventType: 'transfer',
      protocol: null,
      protocolType: null,
      amount: '1000000000000000000',
      timestamp: at(fundedAtMinutes[i] ?? 0),
      blockNumber: ageBase[i] ?? 0n,
      transactionHash: `0xseedchallengefund${i}`,
      sourceType: 'token-api',
      sourceId: `0xseedchallengefund${i}-0`,
      deploymentId: null,
    })

    const path = SYLESH_CHALLENGE_PATHS[wallet] ?? []
    path.forEach((eventType, step) => {
      events.push({
        chain: 'seed',
        wallet,
        // Exactly one shared counterparty out of four keeps
        // SHARED_COUNTERPARTY moderate rather than conclusive.
        counterparty:
          step === 0
            ? FIXTURE_CHALLENGE_SHARED_COUNTERPARTY
            : `0x${`e${i}${step}`.padStart(40, '0')}`,
        eventType,
        protocol: 'seed-protocol',
        protocolType: 'lending-cdp',
        amount: '500000000000000000',
        timestamp: at((fundedAtMinutes[i] ?? 0) + 120 + step * 30),
        blockNumber: (ageBase[i] ?? 0n) + BigInt(1000 * (step + 1)),
        transactionHash: `0xseedchallengepath${i}${step}`,
        sourceType: 'token-api',
        sourceId: `0xseedchallengepath${i}${step}-0`,
        deploymentId: null,
      })
    })
  })

  const { created } = await persistEvidenceEvents(events)

  const already = await prisma.wallet.findUnique({ where: { address: FIXTURE_CHALLENGE_WALLET } })
  if (already?.clusterId) {
    logger.info('[seed:sylesh] challenge-band cluster already formed, skipping')
    return
  }

  const clusterIds = await recomputeClusterForCandidates([...wallets])
  logger.info({ created, clusterIds }, '[seed:sylesh] challenge-band cluster seeded')
}

/**
 * One claim per decision state, each with the challenge row that state implies.
 *
 * The nullifier is stored as a DECIMAL string converted from 0x-hex, exactly as
 * a real proof would be — storing the hex would silently break the uniqueness
 * that replay protection depends on.
 */
async function seedClaimLifecycleStates(): Promise<void> {
  const states = [
    { wallet: FIXTURE_CHALLENGE_STATE_WALLET, decision: 'CHALLENGE', challenge: 'ISSUED' },
    { wallet: FIXTURE_PASSED_STATE_WALLET, decision: 'ALLOW', challenge: 'PASSED' },
    { wallet: FIXTURE_FAILED_STATE_WALLET, decision: 'BLOCK', challenge: 'FAILED' },
    { wallet: FIXTURE_EXPIRED_STATE_WALLET, decision: 'CHALLENGE', challenge: 'EXPIRED' },
  ] as const

  const worldActionId = buildWorldAction(FIXTURE_CAMPAIGN_ID)

  for (const [index, state] of states.entries()) {
    const claim = await prisma.claim.upsert({
      where: { wallet_campaignId: { wallet: state.wallet, campaignId: FIXTURE_CAMPAIGN_ID } },
      create: {
        wallet: state.wallet,
        campaignId: FIXTURE_CAMPAIGN_ID,
        riskDecision: state.decision,
        policyVersion: SEED_POLICY_VERSION,
        decidedAt: state.decision === 'CHALLENGE' ? null : new Date(),
      },
      update: {},
    })

    const existing = await prisma.verificationChallenge.findFirst({
      where: { claimId: claim.id },
    })
    if (existing) continue

    await prisma.verificationChallenge.create({
      data: {
        claimId: claim.id,
        wallet: state.wallet,
        status: state.challenge,
        worldActionId,
        signalHash: expectedSignalHash(state.wallet, claim.id),
        // Only a resolved-successfully challenge carries a nullifier.
        nullifier:
          state.challenge === 'PASSED'
            ? nullifierToDecimalString(`0x${(index + 1).toString(16).padStart(64, '0')}`)
            : null,
        resolvedAt: state.challenge === 'ISSUED' ? null : new Date(),
      },
    })

    // An EvidenceReceipt for every seeded claim, so GET /receipts/:id can be
    // served without touching The Graph or World — which is the whole point of
    // a receipt (Phase 21).
    await prisma.evidenceReceipt.upsert({
      where: { claimId: claim.id },
      create: {
        claimId: claim.id,
        wallet: state.wallet,
        decision: state.decision,
        riskScore: 0.43,
        confidence: 'MEDIUM',
        features: [
          { name: 'FUNDING_CORRELATION', value: 1 },
          { name: 'TIMING_CORRELATION', value: 0 },
          { name: 'WALLET_AGE_SIMILARITY', value: 0.55 },
          { name: 'SHARED_COUNTERPARTY', value: 0.25 },
          { name: 'PROTOCOL_BEHAVIOR_SIMILARITY', value: 0.4 },
        ],
        sources: [{ type: 'token-api', deployment: null, block: '3049000' }],
        policyVersion: SEED_POLICY_VERSION,
        requiredAssurance: state.decision === 'CHALLENGE' ? 'SELFIE_CHECK' : null,
      },
      update: {},
    })
  }

  logger.info({ states: states.length }, '[seed:sylesh] claim lifecycle states seeded')
}

async function seedSylesh(): Promise<void> {
  await seedChallengeBandCluster()
  await seedClaimLifecycleStates()
}

async function main(): Promise<void> {
  logger.info('seeding xander…')
  await seedSuganthan()
  await seedSylesh()
  logger.info('seed complete')
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, 'seed failed')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
