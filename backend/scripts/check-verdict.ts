/**
 * Live check: runs the FULL Phase 5-8 pipeline — evidence -> cluster ->
 * feature extraction -> score -> ALLOW/CHALLENGE/BLOCK verdict — against
 * whatever EvidenceEvent rows are actually in Postgres, and prints the
 * decision. This is not a synthetic fixture; it scores real data, typically
 * whatever a `substreams:run` or `check:graph` call already wrote.
 *
 * Run with: npm run check:verdict [chain]
 * Defaults to the configured SUBSTREAMS_DEFAULT_NETWORK (base-sepolia) if no
 * chain is given.
 */
import { prisma } from '../src/lib/prisma.js'
import { buildClusters } from '../src/behavior-graph/index.js'
import { scoreWalletSet } from '../src/risk/index.js'
import { env } from '../src/config/env.js'

const chain = process.argv[2] ?? env.SUBSTREAMS_DEFAULT_NETWORK

async function main(): Promise<void> {
  console.log(`Loading evidence for chain "${chain}"...\n`)

  const rows = await prisma.evidenceEvent.findMany({
    where: { chain },
    select: { wallet: true },
    distinct: ['wallet'],
  })
  const wallets = rows.map((r) => r.wallet)

  if (wallets.length === 0) {
    console.log(
      `No EvidenceEvent rows found for chain "${chain}". Run one of these first:\n` +
        `  npm run check:graph\n` +
        `  node --env-file=.env --import tsx src/graph/substreams/run.ts --spkg substreams/sybil_shield_substreams-v0.1.0.spkg --network ${chain} --start <block> --stop +3\n`,
    )
    process.exitCode = 1
    return
  }

  console.log(`${wallets.length} distinct wallets with evidence on "${chain}".\n`)

  const { clusters, unclustered, edgeCount } = await buildClusters(wallets)
  console.log(
    `Behavior graph: ${edgeCount} edges, ${clusters.length} clusters, ${unclustered.length} unclustered.\n`,
  )

  // Score every cluster, and the unclustered wallets as their own set.
  const targets: Array<{ label: string; wallets: string[] }> = clusters.map((c, i) => ({
    label: `Cluster ${i + 1} (${c.wallets.length} wallets, density ${c.density.toFixed(2)}, ${c.confidence})`,
    wallets: c.wallets,
  }))
  if (unclustered.length > 0) {
    targets.push({ label: `Unclustered (${unclustered.length} wallets)`, wallets: unclustered })
  }

  for (const target of targets) {
    console.log(`=== ${target.label} ===`)
    try {
      const result = await scoreWalletSet(target.wallets)
      for (const f of result.features) {
        console.log(
          `    ${f.name.padEnd(30)} ${f.value.toFixed(3)} x ${f.weight.toFixed(2)} = ${f.contribution.toFixed(3)}  [${f.confidence}]`,
        )
      }
      console.log(`  SCORE: ${result.score.toFixed(4)}`)
      console.log(`  DECISION: ${result.band}`)
      console.log(`  confidence: ${result.confidence}`)
      console.log(`  policyVersion: ${result.policyVersion}\n`)
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exitCode = 1
    }
  }
}

main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
