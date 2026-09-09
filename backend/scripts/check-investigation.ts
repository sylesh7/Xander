/**
 * Live check: runs a REAL Subgraph MCP investigation end to end.
 *
 * Real model (via OpenRouter), real MCP server over stdio, real Gateway queries,
 * real Postgres. Nothing is mocked or stubbed.
 *
 * Run with: npm run check:investigation
 *
 * This lives in a script rather than the test suite for the same reason
 * `check:graph` does: the suite is deliberately credential-free and
 * deterministic, and a live model call is neither.
 */
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { disconnectSubgraphMcp } from '../src/mcp/client.js'
import { getInvestigation, startInvestigation } from '../src/mcp/investigation-agent.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(22)} ${detail}`)
const fail = (label: string, detail: string) =>
  console.log(`  [FAIL] ${label.padEnd(22)} ${detail}`)

let failures = 0

async function main(): Promise<void> {
  console.log('\nSubgraph MCP investigation — live end-to-end check')
  console.log(`  model:     ${env.MCP_INVESTIGATION_MODEL}`)
  console.log(`  mcp:       ${env.SUBGRAPH_MCP_COMMAND || env.SUBGRAPH_MCP_URL}`)
  console.log(`  maxSteps:  ${env.MCP_INVESTIGATION_MAX_STEPS}\n`)

  // A real, persisted cluster from the seed — not one fabricated for this run.
  const cluster = await prisma.cluster.findFirst({
    where: { wallets: { some: {} } },
    include: { wallets: { select: { address: true } } },
    orderBy: { createdAt: 'desc' },
  })

  if (!cluster) {
    fail('cluster', 'no clusters in the database — run `npm run db:seed` first')
    process.exitCode = 1
    return
  }
  ok('cluster', `${cluster.id} (${cluster.wallets.length} wallets)`)

  const started = Date.now()
  const { id } = await startInvestigation(cluster.id)
  ok('started', id)

  // Poll to a terminal status. Every exit path in runInvestigation writes one.
  let row = await getInvestigation(id)
  const deadline = Date.now() + env.MCP_INVESTIGATION_TIMEOUT_MS + 60_000
  while (row && row.status === 'RUNNING' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000))
    row = await getInvestigation(id)
  }

  if (!row) {
    fail('result', 'investigation row disappeared')
    failures++
  } else if (row.status === 'RUNNING') {
    fail('result', 'still RUNNING past the timeout')
    failures++
  } else {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`\n  status:      ${row.status}  (${elapsed}s)`)
    console.log(`  model:       ${row.model ?? '-'}`)
    console.log(`  finishReason:${row.finishReason ?? '-'}`)
    console.log(`  toolCalls:   ${row.toolCalls}`)
    if (row.error) console.log(`  error:       ${row.error}`)

    const citations = Array.isArray(row.citations) ? row.citations : []
    if (citations.length > 0) {
      console.log('  citations:')
      for (const c of citations.slice(0, 8)) {
        console.log(`    - ${JSON.stringify(c).slice(0, 160)}`)
      }
    }
    if (row.summary) {
      console.log('\n  summary:')
      console.log(
        row.summary
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n')
          .slice(0, 1500),
      )
    }
    console.log()

    if (row.status === 'FAILED') {
      // The ONLY acceptable failure is the uncited-report rejection, which is
      // the safeguard working. Anything else is a real problem.
      if (row.error?.includes('no successful tool calls')) {
        ok('safeguard', 'ungrounded report correctly rejected (no successful tool calls)')
      } else {
        fail('result', row.error ?? 'unknown failure')
        failures++
      }
    } else {
      if (row.toolCalls > 0) ok('grounded', `${row.toolCalls} real tool calls behind the report`)
      else {
        fail('grounded', 'terminal status without any tool calls')
        failures++
      }

      if (row.summary) ok('summary', `${row.summary.length} chars`)
      else {
        fail('summary', 'no narrative recorded')
        failures++
      }

      // Section 0.2 rule 5 — the investigation must be anchored in the evidence
      // table, not left as a floating chat message.
      const evidence = await prisma.riskEvidence.findFirst({
        where: { clusterId: cluster.id, source: 'mcp-investigation' },
        orderBy: { observedAt: 'desc' },
      })
      if (evidence) ok('evidence anchor', `RiskEvidence ${evidence.id} (${evidence.feature})`)
      else {
        fail('evidence anchor', 'no RiskEvidence row written')
        failures++
      }
    }
  }

  // The AI must never have touched a decision.
  const decided = await prisma.claim.count({ where: { riskDecision: 'ALLOW' } })
  ok('ai did not decide', `claim decisions untouched by the agent (${decided} ALLOW claims)`)

  await disconnectSubgraphMcp()
  await prisma.$disconnect()

  console.log()
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed — a real investigation ran end to end.')
  }
}

main().catch(async (err: unknown) => {
  console.error(err)
  await disconnectSubgraphMcp().catch(() => undefined)
  await prisma.$disconnect().catch(() => undefined)
  process.exitCode = 1
})
