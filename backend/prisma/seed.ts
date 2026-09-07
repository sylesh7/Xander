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

  // TODO Phase 8:  RiskWeight, RiskThreshold, initial active PolicyVersion
  // TODO Phase 12: scenario A (clean wallet) + scenario B (coordinated cluster)
  //                using FIXTURE_CLEAN_WALLET / FIXTURE_CLUSTERED_WALLET from
  //                src/interfaces/stub-fixtures.ts so the addresses stay stable
  //                across the stub -> real transition.
}

/**
 * SYLESH — Phase 23. World-side fixtures.
 *
 * Suggested contents: a Claim in each decision state, a VerificationChallenge
 * in ISSUED/PASSED/FAILED/EXPIRED, and an EvidenceReceipt to serve from
 * GET /receipts/:id without hitting the Graph or World.
 *
 * Note VerificationChallenge.nullifier is Decimal(78,0) — convert World's
 * 0x-hex nullifier to decimal before storing.
 */
async function seedSylesh(): Promise<void> {
  logger.info('[seed:sylesh] not yet implemented')
}

async function main(): Promise<void> {
  logger.info('seeding sybil_shield…')
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
