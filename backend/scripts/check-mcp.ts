/**
 * Live check: proves the Subgraph MCP connection actually works — a real
 * transport handshake, a real tool listing, and a real tool call returning real
 * data from The Graph Network. Nothing here is mocked.
 *
 * Run with: npm run check:mcp
 *
 * Transport is whichever `src/mcp/client.ts` resolves from config:
 *   - SUBGRAPH_MCP_COMMAND set -> a local subgraph-mcp binary over stdio
 *   - otherwise               -> the hosted SSE endpoint at SUBGRAPH_MCP_URL
 *
 * The hosted endpoint was verified broken on 2026-09-09 (HTTP 200,
 * `Content-Type: text/event-stream`, then zero bytes, so the MCP handshake
 * never receives its `endpoint` event). If this check hangs and then fails
 * against the hosted URL, that is what you are seeing — build the binary and
 * set SUBGRAPH_MCP_COMMAND. See docs/PROGRESS-SYLESH.md.
 */
import { env } from '../src/config/env.js'
import { disconnectSubgraphMcp, getSubgraphMcpClient } from '../src/mcp/client.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(24)} ${detail}`)
const fail = (label: string, detail: string) =>
  console.log(`  [FAIL] ${label.padEnd(24)} ${detail}`)

let failures = 0

/** Tool names the upstream server documents. Used to prove we got the real thing. */
const EXPECTED_TOOLS = [
  'search_subgraphs_by_keyword',
  'get_deployment_30day_query_counts',
  'get_top_subgraph_deployments',
]

async function main(): Promise<void> {
  const transport = env.SUBGRAPH_MCP_COMMAND
    ? `stdio (${env.SUBGRAPH_MCP_COMMAND})`
    : `sse (${env.SUBGRAPH_MCP_URL})`
  console.log(`\nSubgraph MCP live check\n  transport: ${transport}\n`)

  let tools: Record<string, unknown> = {}

  try {
    tools = await getSubgraphMcpClient().listTools()
    const names = Object.keys(tools)
    if (names.length === 0) {
      fail('connect', 'connected but the server exposed 0 tools')
      failures++
    } else {
      ok('connect', `${names.length} tools discovered`)
      console.log(`         ${names.join('\n         ')}`)
    }
  } catch (err) {
    fail('connect', err instanceof Error ? err.message : String(err))
    failures++
  }

  // Namespacing: Mastra prefixes each tool with its server name.
  const resolve = (bare: string): string | undefined =>
    Object.keys(tools).find((n) => n === bare || n.endsWith(`_${bare}`))

  for (const expected of EXPECTED_TOOLS) {
    if (resolve(expected)) ok('tool present', expected)
    else {
      fail('tool missing', expected)
      failures++
    }
  }

  // A real call against The Graph Network, not just discovery. Discovery alone
  // would pass against a server that cannot actually reach the gateway.
  const searchName = resolve('search_subgraphs_by_keyword')
  if (searchName) {
    try {
      const tool = tools[searchName] as {
        execute?: (params: unknown, options: unknown) => Promise<unknown>
      }
      if (typeof tool.execute !== 'function') {
        fail('tool call', 'tool has no execute()')
        failures++
      } else {
        const result = await tool.execute({ keyword: 'uniswap' }, {})
        const text = JSON.stringify(result)
        if (text.toLowerCase().includes('uniswap')) {
          ok('tool call', `search_subgraphs_by_keyword("uniswap") -> ${text.length} bytes of real data`)
        } else {
          fail('tool call', `returned data without the search term: ${text.slice(0, 200)}`)
          failures++
        }
      }
    } catch (err) {
      fail('tool call', err instanceof Error ? err.message : String(err))
      failures++
    }
  }

  await disconnectSubgraphMcp()

  console.log()
  if (failures > 0) {
    console.log(`${failures} check(s) failed.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed — the MCP connection is live and returning real data.')
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
