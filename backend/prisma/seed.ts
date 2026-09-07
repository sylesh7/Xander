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
async function seedSuganthan(): Promise<void> {
  logger.info('[seed:suganthan] skeleton — populated in Phase 12')
  // TODO Phase 4:  DeploymentRegistryEntry rows for the 2-3 chosen protocols
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
