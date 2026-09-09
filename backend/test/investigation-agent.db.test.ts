/**
 * Subgraph MCP investigation agent — Backend-Sylesh.md Phase 15. NO MOCKS.
 *
 * This file replaced an earlier version that mocked `@mastra/core/agent` and
 * the MCP client. That approach was worth removing: with the Agent mocked, the
 * rejection test only proved the mock returned what the mock was told to
 * return. The safeguard is now a pure exported function, `evaluateAgentRun`,
 * exercised against real inputs — and the full pipeline is exercised against a
 * real model and a real MCP server in the live block at the bottom.
 *
 * Split by what each part needs:
 *   - `evaluateAgentRun` / `extractCitations`: pure, no infrastructure at all.
 *   - Persistence + failure handling: real Postgres.
 *   - End-to-end investigation: real MCP binary + real model, skipped unless
 *     SUBGRAPH_MCP_COMMAND and OPENROUTER_API_KEY are both set.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import {
  evaluateAgentRun,
  extractCitations,
  getInvestigation,
  InvestigationError,
  startInvestigation,
} from '../src/mcp/investigation-agent.js'

const LIVE = Boolean(env.SUBGRAPH_MCP_COMMAND && env.OPENROUTER_API_KEY)

const createdClusterIds: string[] = []
const createdWallets: string[] = []

async function makeCluster(): Promise<string> {
  const n = createdClusterIds.length
  const addresses = [`0x${`a${n}`.padStart(40, '0')}`, `0x${`b${n}`.padStart(40, '0')}`]
  const cluster = await prisma.cluster.create({
    data: {
      confidence: 'HIGH',
      score: 0.43,
      wallets: { create: addresses.map((address) => ({ address })) },
    },
  })
  createdClusterIds.push(cluster.id)
  createdWallets.push(...addresses)
  return cluster.id
}

/** Waits for the background run to reach a terminal status. */
async function settled(id: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const row = await prisma.investigation.findUniqueOrThrow({ where: { id } })
    if (row.status !== 'RUNNING') return row
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('investigation never settled')
}

afterAll(async () => {
  await prisma.investigation.deleteMany({ where: { clusterId: { in: createdClusterIds } } })
  await prisma.riskEvidence.deleteMany({ where: { clusterId: { in: createdClusterIds } } })
  await prisma.wallet.deleteMany({ where: { address: { in: createdWallets } } })
  await prisma.cluster.deleteMany({ where: { id: { in: createdClusterIds } } })
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// The safeguard itself — pure, real inputs, nothing stubbed.
// ---------------------------------------------------------------------------

describe('Phase 15 — the uncited-report rejection (pure)', () => {
  it('REJECTS a fluent report backed by no tool calls', () => {
    // An LLM given a cluster id and no successful queries still writes a
    // confident paragraph. Stored, it is indistinguishable from a grounded one.
    const verdict = evaluateAgentRun({
      text: 'These wallets are clearly a coordinated Sybil ring funded by one address.',
      finishReason: 'stop',
      toolCalls: [],
    })

    expect(verdict.status).toBe('FAILED')
    expect(verdict.summary).toBeNull()
    expect(verdict.error).toContain('no successful tool calls')
  })

  it('rejects when the trace is missing entirely, not just empty', () => {
    expect(evaluateAgentRun({ text: 'Findings.', finishReason: 'stop' }).status).toBe('FAILED')
    expect(evaluateAgentRun({ text: 'Findings.', toolCalls: null }).status).toBe('FAILED')
  })

  it('accepts a report with a real tool-call trace behind it', () => {
    const verdict = evaluateAgentRun({
      text: 'Both wallets supplied to the same Compound V3 market.',
      finishReason: 'stop',
      toolCalls: [
        { type: 'tool-call', payload: { toolName: 'subgraphMcp_execute_query_by_deployment_id', args: { id: 'QmX' } } },
      ],
    })

    expect(verdict.status).toBe('COMPLETE')
    expect(verdict.summary).toContain('Compound V3')
    expect(verdict.citations).toHaveLength(1)
    expect(verdict.citations[0]?.tool).toBe('subgraphMcp_execute_query_by_deployment_id')
  })

  it('marks a truncated run PARTIAL, keeping the findings so far', () => {
    const verdict = evaluateAgentRun({
      text: 'Partial findings.',
      finishReason: 'tool-calls',
      toolCalls: [{ type: 'tool-call', payload: { toolName: 'subgraphMcp_search_subgraphs_by_keyword', args: {} } }],
    })

    expect(verdict.status).toBe('PARTIAL')
    expect(verdict.summary).toBe('Partial findings.')
  })
})

describe('Phase 15 — citation extraction (pure)', () => {
  // This fixture is not invented — it is `result.toolCalls[0]` copied verbatim
  // from a REAL run against the real MCP server and openrouter/openai/gpt-4o-mini
  // (scripts/probe-toolcalls.ts, 2026-09-09). The first version of
  // extractCitations read toolName/args off the top-level object, which is
  // where a hand-written mock naturally puts them — every mocked test passed
  // while every real call silently produced zero citations, which is
  // indistinguishable from an ungrounded report. This is why the fixture below
  // is real captured output, not a shape someone typed from memory.
  const REAL_TOOL_CALL = {
    type: 'tool-call',
    runId: '5c23fead-0834-4767-8b0b-acedfdb1f0f5',
    from: 'AGENT',
    payload: {
      toolCallId: 'call_6o0FTV3ZYYGmRdFH0RpAg1wn',
      toolName: 'subgraphMcp_search_subgraphs_by_keyword',
      args: { keyword: 'uniswap' },
      providerMetadata: { openrouter: { reasoning_details: [] } },
    },
  }

  it('reads the real, payload-nested wire shape', () => {
    const [citation] = extractCitations([REAL_TOOL_CALL])
    expect(citation?.tool).toBe('subgraphMcp_search_subgraphs_by_keyword')
    expect(citation?.args).toEqual({ keyword: 'uniswap' })
  })

  it('also accepts a flat shape, in case a future SDK version stops nesting', () => {
    expect(extractCitations([{ toolName: 'a', args: { x: 1 } }])[0]?.tool).toBe('a')
    expect(extractCitations([{ name: 'b', input: { y: 2 } }])[0]?.tool).toBe('b')
    expect(extractCitations([{ payload: { name: 'c', input: { z: 3 } } }])[0]?.tool).toBe('c')
  })

  it('ignores malformed entries rather than inventing citations', () => {
    expect(extractCitations([null, 42, {}, { args: {} }, { payload: {} }])).toEqual([])
    expect(extractCitations('not an array')).toEqual([])
  })

  it('preserves the arguments, which is what names the deployment queried', () => {
    const [citation] = extractCitations([
      { type: 'tool-call', payload: { toolName: 't', args: { deployment: 'QmNrQoow7' } } },
    ])
    expect(citation?.args).toEqual({ deployment: 'QmNrQoow7' })
  })
})

describe('Phase 15 — a call that was ATTEMPTED but FAILED does not count as grounding', () => {
  // Found by running against the real MCP server with a bad gateway key
  // (a vitest.config.ts bug, since fixed): the model made a genuine tool call,
  // it reached the real server, and the server rejected it with an auth error —
  // which the first version of this check could not distinguish from success,
  // because it only asked "was a call attempted?". This is
  // `result.toolResults[0]` shape, copied from a real run.
  const REAL_TOOL_CALL = {
    type: 'tool-call',
    payload: {
      toolCallId: 'call_abc',
      toolName: 'subgraphMcp_search_subgraphs_by_keyword',
      args: { keyword: '0xdeadbeef' },
    },
  }
  const FAILED_RESULT = {
    type: 'tool-result',
    payload: {
      toolCallId: 'call_abc',
      toolName: 'subgraphMcp_search_subgraphs_by_keyword',
      result: { isError: true, content: [{ type: 'text', text: 'auth error: malformed API key' }] },
    },
  }
  const SUCCESSFUL_RESULT = {
    type: 'tool-result',
    payload: {
      toolCallId: 'call_abc',
      toolName: 'subgraphMcp_search_subgraphs_by_keyword',
      result: { isError: false, content: [{ type: 'text', text: '{"returned":1}' }] },
    },
  }

  it('drops a citation whose tool result reports isError: true', () => {
    expect(extractCitations([REAL_TOOL_CALL], [FAILED_RESULT])).toEqual([])
  })

  it('keeps a citation whose tool result succeeded', () => {
    expect(extractCitations([REAL_TOOL_CALL], [SUCCESSFUL_RESULT])).toHaveLength(1)
  })

  it('keeps a citation when no toolResults are supplied at all — an optional check', () => {
    expect(extractCitations([REAL_TOOL_CALL])).toHaveLength(1)
  })

  it('REJECTS the whole report when every attempted call failed — the acceptance case', () => {
    // The exact failure mode this was written to catch: one real tool call,
    // reaching a real server, that came back an auth error. Not distinguishable
    // from "no call was made" in terms of what data grounds the report.
    const verdict = evaluateAgentRun({
      text: 'These wallets appear unrelated based on available data.',
      finishReason: 'stop',
      toolCalls: [REAL_TOOL_CALL],
      toolResults: [FAILED_RESULT],
    })

    expect(verdict.status).toBe('FAILED')
    expect(verdict.error).toContain('no successful tool calls')
  })

  it('accepts the report when the same call succeeded instead', () => {
    const verdict = evaluateAgentRun({
      text: 'No matching subgraphs were found for either wallet.',
      finishReason: 'stop',
      toolCalls: [REAL_TOOL_CALL],
      toolResults: [SUCCESSFUL_RESULT],
    })

    expect(verdict.status).toBe('COMPLETE')
    expect(verdict.citations).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Real database behaviour.
// ---------------------------------------------------------------------------

describe('Phase 15 — persistence (real Postgres)', () => {
  it('rejects an investigation for a cluster that does not exist', async () => {
    await expect(startInvestigation('no-such-cluster')).rejects.toThrow(InvestigationError)
  })

  it('records a terminal status rather than leaving a row RUNNING forever', async () => {
    // With no model credential configured this fails fast at the credential
    // guard — which is itself the assertion: every exit path is terminal, so
    // GET /investigations/:id can never confuse "failed" with "in flight".
    if (LIVE) return
    const clusterId = await makeCluster()

    const { id } = await startInvestigation(clusterId)
    const row = await settled(id, 30_000)

    expect(row.status).toBe('FAILED')
    expect(row.completedAt).not.toBeNull()
    expect(row.error).toBeTruthy()
  }, 45_000)

  it('names the missing credential when the model is unconfigured', async () => {
    if (LIVE) return
    const clusterId = await makeCluster()

    const { id } = await startInvestigation(clusterId)
    const row = await settled(id, 30_000)

    expect(row.error).toMatch(/OPENROUTER_API_KEY|ANTHROPIC_API_KEY/)
  }, 45_000)
})

// ---------------------------------------------------------------------------
// The whole pipeline, for real: real MCP server, real model, real gateway.
// ---------------------------------------------------------------------------

describe.skipIf(!LIVE)('Phase 15 — end-to-end investigation (real model, real MCP)', () => {
  it('produces a grounded report and anchors it in the evidence table', async () => {
    const clusterId = await makeCluster()

    const { id } = await startInvestigation(clusterId)
    const row = await settled(id)

    // A real model against a real MCP server. The wallets are synthetic, so the
    // agent will legitimately find little — the assertion is that it INVESTIGATED
    // (made real tool calls) and was judged on that trace, not on its prose.
    expect(['COMPLETE', 'PARTIAL', 'FAILED']).toContain(row.status)

    if (row.status === 'FAILED') {
      // The only acceptable failure here is the uncited-report rejection.
      expect(row.error).toContain('no successful tool calls')
      return
    }

    expect(row.toolCalls).toBeGreaterThan(0)
    expect(row.summary).toBeTruthy()
    expect(row.model).toBe(env.MCP_INVESTIGATION_MODEL)

    const evidence = await prisma.riskEvidence.findFirst({
      where: { clusterId, source: 'mcp-investigation' },
    })
    expect(evidence).not.toBeNull()
    expect(evidence?.feature).toBe('MCP_INVESTIGATION')
  }, 300_000)

  it('never touches a claim decision — the AI does not decide', async () => {
    const before = await prisma.claim.findMany({ select: { id: true, riskDecision: true } })

    const clusterId = await makeCluster()
    const { id } = await startInvestigation(clusterId)
    await settled(id)

    const after = await prisma.claim.findMany({ select: { id: true, riskDecision: true } })
    // Section 0.2 rule 5, asserted against a real run.
    expect(after).toEqual(before)
  }, 300_000)
})

describe('Phase 15 — investigation retrieval', () => {
  it('returns null for an unknown id rather than throwing', async () => {
    expect(await getInvestigation('nope')).toBeNull()
  })
})
