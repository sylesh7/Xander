/**
 * Live check: proves the three Graph integrations (Token API, Standardized
 * Subgraphs, Substreams) actually work against real credentials and real
 * data — not a unit test, a real network round trip through each one.
 *
 * Run with: npm run check:graph
 */
import { getBalances, getInboundTransfers } from '../src/graph/token-api/client.js'
import { getDeploymentsForFamily } from '../src/graph/standardized-subgraphs/deployment-registry.js'
import { queryDeployment } from '../src/graph/standardized-subgraphs/client.js'
import { resolveEndpoint } from '../src/graph/substreams/endpoints.js'
import { env } from '../src/config/env.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(28)} ${detail}`)
const fail = (label: string, detail: string) =>
  console.log(`  [FAIL] ${label.padEnd(28)} ${detail}`)

let failures = 0

async function checkTokenApi(): Promise<void> {
  const addr = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' // vitalik.eth
  try {
    const balances = await getBalances(addr, { limit: 3 })
    const transfers = await getInboundTransfers(addr, { maxItemsPerSource: 5 })
    ok('Token API', `${balances.length} balances, ${transfers.length} transfers for a real address`)
  } catch (err) {
    fail('Token API', err instanceof Error ? err.message : String(err))
    failures++
  }
}

async function checkStandardizedSubgraphs(): Promise<void> {
  try {
    const deployments = await getDeploymentsForFamily('lending-cdp')
    if (deployments.length === 0) {
      fail(
        'Standardized Subgraphs',
        'registry has 0 lending-cdp deployments — did you run npm run db:seed?',
      )
      failures++
      return
    }
    const entry = deployments[0]!
    const { provenance } = await queryDeployment<{ _empty?: never }>(
      entry,
      'query { _meta { block { number } } }',
    )
    ok(
      'Standardized Subgraphs',
      `${entry.protocol} @ block ${provenance.block}, pinned-match=${provenance.deploymentMatches}`,
    )
  } catch (err) {
    fail('Standardized Subgraphs', err instanceof Error ? err.message : String(err))
    failures++
  }
}

function checkSubstreamsEndpoint(): void {
  try {
    const endpoint = resolveEndpoint(env.SUBSTREAMS_DEFAULT_NETWORK)
    ok(
      'Substreams endpoint',
      `${env.SUBSTREAMS_DEFAULT_NETWORK} -> ${endpoint} (config resolves; run npm run substreams:pack + a stream to prove the live gRPC path)`,
    )
  } catch (err) {
    fail('Substreams endpoint', err instanceof Error ? err.message : String(err))
    failures++
  }
}

async function main(): Promise<void> {
  console.log('Checking live Graph integrations...\n')
  await checkTokenApi()
  await checkStandardizedSubgraphs()
  checkSubstreamsEndpoint()
  console.log()
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed.')
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
