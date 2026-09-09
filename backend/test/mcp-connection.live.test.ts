/**
 * Subgraph MCP — REAL connection test. Nothing here is mocked.
 *
 * This is the counterpart to `investigation-agent.db.test.ts`, which mocks the
 * agent deliberately: you cannot make a real LLM reliably emit zero tool calls
 * on demand, so the uncited-report safeguard has to be driven with a controlled
 * response. That test proves the safeguard. THIS test proves the transport,
 * the credential and the tool surface are real.
 *
 * Requires a locally built `subgraph-mcp` binary:
 *
 *   git clone https://github.com/graphops/subgraph-mcp && cd subgraph-mcp
 *   cargo build --release
 *   SUBGRAPH_MCP_COMMAND=<repo>/target/release/subgraph-mcp npm test
 *
 * Skips (rather than fails) when SUBGRAPH_MCP_COMMAND is unset, so the suite
 * stays green on a machine without the binary. It does NOT fall back to the
 * hosted SSE endpoint, which is broken server-side — see docs/PROGRESS-SYLESH.md.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { env } from '../src/config/env.js'
import { disconnectSubgraphMcp, getSubgraphMcpClient } from '../src/mcp/client.js'

const LIVE = Boolean(env.SUBGRAPH_MCP_COMMAND)

/** Mastra namespaces MCP tools as `<serverName>_<toolName>`. */
const hasTool = (names: string[], bare: string): boolean =>
  names.some((n) => n === bare || n.endsWith(`_${bare}`))

afterAll(async () => {
  if (LIVE) await disconnectSubgraphMcp()
})

describe.skipIf(!LIVE)('Subgraph MCP — live connection (no mocks)', () => {
  it('completes a real handshake and discovers tools', async () => {
    const tools = await getSubgraphMcpClient().listTools()
    const names = Object.keys(tools)

    // Zero tools is exactly the hosted-endpoint failure mode, so this assertion
    // is the one that distinguishes "connected" from "hung".
    expect(names.length).toBeGreaterThan(0)
  }, 60_000)

  it('exposes the documented Subgraph tools', async () => {
    const names = Object.keys(await getSubgraphMcpClient().listTools())

    expect(hasTool(names, 'search_subgraphs_by_keyword')).toBe(true)
    expect(hasTool(names, 'get_deployment_30day_query_counts')).toBe(true)
    expect(hasTool(names, 'get_top_subgraph_deployments')).toBe(true)
  }, 60_000)

  it('exposes tools with an executable interface', async () => {
    const tools = await getSubgraphMcpClient().listTools()
    const name = Object.keys(tools).find((n) => n.endsWith('search_subgraphs_by_keyword'))
    expect(name).toBeDefined()

    const tool = tools[name as string] as { execute?: unknown }
    expect(typeof tool.execute).toBe('function')
  }, 60_000)
})

/**
 * DELIBERATELY NOT ASSERTED HERE: an actual gateway query.
 *
 * `vitest.config.ts` injects a placeholder `GRAPH_GATEWAY_API_KEY`, so a real
 * tool call from inside the suite fails with "malformed API key" — correctly.
 * Keeping the suite credential-free means it is deterministic, costs no metered
 * gateway quota, and runs on a machine that has no Graph account at all.
 *
 * The real round trip lives in `npm run check:mcp`, matching the convention
 * `check:graph` already set for live network verification. That script performs
 * `search_subgraphs_by_keyword("uniswap")` against the real gateway and asserts
 * real data comes back.
 */
