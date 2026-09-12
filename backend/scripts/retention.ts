/**
 * `npm run retention` — Phase 12's retention pass.
 *
 * DRY RUN unless `--apply` is passed. The only job in this repo that can
 * destroy data defaults to describing what it would do.
 */
import { prisma } from '../src/lib/prisma.js'
import { applyRetention } from '../src/hardening/retention.js'

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const report = await applyRetention({ dryRun: !apply })

  console.log(`\nRetention — ${report.dryRun ? 'DRY RUN' : 'APPLIED'}\n`)
  for (const r of report.results) {
    console.log(`  ${r.table.padEnd(20)} ${String(r.deleted).padStart(6)}  keeps ${r.kept}`)
  }
  console.log(`\n  total ${report.totalDeleted}`)
  console.log(report.dryRun ? '\nNothing was deleted. Pass --apply to run it for real.\n' : '\n')
  await prisma.$disconnect()
}

main().catch(async (err: unknown) => {
  console.error('retention failed\n', err)
  process.exitCode = 1
  await prisma.$disconnect()
})
