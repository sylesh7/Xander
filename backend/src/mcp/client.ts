/**
 * Subgraph MCP connection — Backend-Sylesh.md Phase 15.
 *
 * `@mastra/mcp`'s MCPClient talks to a `url`-based remote server natively
 * (negotiating Streamable HTTP and falling back to the legacy SSE transport
 * this endpoint uses). The `mcp-remote` proxy shown in The Graph's Cursor and
 * Cline guides is for editor integrations — backend code does not need it.
 *
 * Construction is LAZY on purpose. The Gateway key is optional at boot so the
 * rest of the API can run without it (Phase 13 credentials arrive on their own
 * schedule); building this at module scope would turn a missing key into a
 * server that refuses to start rather than one endpoint that reports 503.
 */
import { MCPClient } from '@mastra/mcp'
import { env, requireGraphGatewayApiKey } from '../config/env.js'

const SERVER_NAME = 'subgraphMcp'

let cached: MCPClient | null = null

/**
 * Two ways to reach the same server, chosen by config.
 *
 * The hosted SSE endpoint is the documented default and what the spec
 * specifies. As of 2026-09-09 it is broken server-side — it returns HTTP 200
 * with `Content-Type: text/event-stream` and then sends nothing, so the MCP
 * handshake never receives the `endpoint` event. That was confirmed with the
 * official `@modelcontextprotocol` SDK as well as Mastra, with an identical
 * result for a deliberately invalid Gateway key, and with an unrelated public
 * SSE stream working fine from the same machine.
 *
 * `SUBGRAPH_MCP_COMMAND` points at a locally built `subgraph-mcp` binary and
 * talks to it over stdio instead. Same server, same tools, transport that does
 * not depend on the hosted deployment being healthy.
 */
function serverDefinition() {
  if (env.SUBGRAPH_MCP_COMMAND) {
    return {
      command: env.SUBGRAPH_MCP_COMMAND,
      // The Rust server reads its own credential from the environment.
      env: { GATEWAY_API_KEY: requireGraphGatewayApiKey() },
    }
  }

  return {
    url: new URL(env.SUBGRAPH_MCP_URL),
    requestInit: {
      headers: { Authorization: `Bearer ${requireGraphGatewayApiKey()}` },
    },
  }
}

export function getSubgraphMcpClient(): MCPClient {
  cached ??= new MCPClient({
    id: 'xander-subgraph-mcp',
    servers: { [SERVER_NAME]: serverDefinition() },
    timeout: env.MCP_INVESTIGATION_TIMEOUT_MS,
  })
  return cached
}

export async function disconnectSubgraphMcp(): Promise<void> {
  if (cached) {
    await cached.disconnect()
    cached = null
  }
}
