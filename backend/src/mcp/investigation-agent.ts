/**
 * Subgraph MCP investigation agent — Backend-Sylesh.md Phase 15.
 *
 * Section 0.2 rule 5, restated because it is the whole design of this file:
 * DETERMINISTIC CORE, AI AT THE EDGES. Nothing here writes `Claim.riskDecision`,
 * touches a score, or feeds back into the Policy Engine. The agent explains a
 * cluster the deterministic scorer has ALREADY flagged. If this module were
 * deleted, every claim would still resolve to exactly the same decision.
 *
 * The one non-obvious safeguard: a report with no SUCCESSFUL tool calls behind
 * it is REJECTED rather than stored. An LLM handed a cluster id and no
 * successful queries will still happily produce a fluent paragraph about
 * coordinated funding patterns — and that paragraph would be indistinguishable,
 * in the database, from one grounded in real subgraph data. "Successful"
 * matters, not just "attempted": a tool call that reached the server and came
 * back an execution error (bad credential, downstream outage) is exactly as
 * ungrounded as one never made, and is filtered out the same way. Recording
 * the tool-call trace next to the prose, and refusing the prose when that
 * trace has nothing real in it, is what makes "the AI investigates" an
 * auditable claim instead of a decorative one.
 */
import { Agent } from '@mastra/core/agent'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { getSubgraphMcpClient } from './client.js'

export class InvestigationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvestigationError'
  }
}

/** One entry of the agent's real tool-call trace. */
export interface Citation {
  tool: string
  args: Record<string, unknown>
}

/**
 * The mandate is deliberately narrow. An open-ended "analyse this cluster"
 * prompt invites the model to reason from the cluster id and its own priors —
 * which is exactly the failure this module exists to prevent.
 */
const INSTRUCTIONS = [
  'You are a blockchain forensics assistant investigating a cluster of wallets that a',
  'deterministic risk engine has already flagged. You do not decide anything: your only',
  'job is to explain what shared on-chain behaviour, if any, the available subgraph data',
  'actually shows.',
  '',
  'Using ONLY the Subgraph MCP tools available to you:',
  '  1. Determine which standardized schemas/deployments these wallets share activity in.',
  '  2. Summarize the shared behavioural path concretely — which protocols, which actions,',
  '     in which order.',
  '',
  'Rules you must follow:',
  '  - You MUST call at least one tool before writing your report. A report written',
  '    without querying anything is worthless here and will be discarded — answering',
  '    from your own knowledge of these protocols is not an acceptable substitute for',
  '    querying. Start with search_subgraphs_by_keyword.',
  '  - Cite the specific deployment or subgraph id you queried for every claim you make.',
  '  - Do not speculate beyond what the query results show. If the data does not support a',
  '    conclusion, say so plainly.',
  '  - Do not assign a risk score, a verdict, or a recommendation. That is not your role.',
  '  - If your queries return nothing useful, report exactly that. An empty result is a',
  '    valid and useful finding.',
].join('\n')

/**
 * Which toolCallIds correspond to a tool execution that actually FAILED.
 *
 * A real entry from `@mastra/core`'s Agent is:
 *   { type: 'tool-result', payload: { toolCallId, toolName, result: { isError, content } } }
 *
 * Found by running against the real MCP server with a bad gateway key
 * (a vitest.config.ts bug, since fixed): the model called a real tool, the
 * call reached the server, and the server returned an auth error — which
 * `extractCitations` alone could not distinguish from success, because it only
 * checks whether a call was ATTEMPTED. An investigation "grounded" by a call
 * that failed outright has no more real data behind it than one that made no
 * call at all, and treating it as grounded would have hidden exactly the
 * failure this check exists to catch.
 */
function extractFailedToolCallIds(toolResults: unknown): Set<string> {
  const failed = new Set<string>()
  if (!Array.isArray(toolResults)) return failed

  for (const entry of toolResults) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const payload =
      typeof record.payload === 'object' && record.payload !== null
        ? (record.payload as Record<string, unknown>)
        : record

    const toolCallId = payload.toolCallId
    const result = payload.result
    const isError =
      typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>).isError
        : undefined

    if (typeof toolCallId === 'string' && isError === true) failed.add(toolCallId)
  }

  return failed
}

/**
 * Extracts the real tool-call trace from the agent result, excluding any call
 * whose own result reports a failure.
 *
 * `toolCalls` is what the framework observed the model actually invoke — it is
 * not derived from the model's prose, which is the entire reason it can be used
 * to check the prose. `toolResults`, when supplied, filters that trace down to
 * calls that actually returned data.
 *
 * THE WIRE SHAPE IS NESTED, NOT FLAT — verified by running a real investigation
 * against the real MCP server and real model, not from the SDK's types. A real
 * entry from `@mastra/core`'s Agent is:
 *
 *   { type: 'tool-call', runId, from: 'AGENT', payload: { toolCallId, toolName, args, providerMetadata } }
 *
 * The first version of this function read `toolName`/`args` off the top-level
 * object, which is where a hand-written mock naturally puts them — so a mocked
 * test passed while every real call silently extracted zero citations, which
 * is indistinguishable from an ungrounded report. Both shapes are accepted
 * below so a future SDK version that flattens this does not regress silently
 * back to the original bug.
 */
export function extractCitations(toolCalls: unknown, toolResults?: unknown): Citation[] {
  if (!Array.isArray(toolCalls)) return []

  const failed = extractFailedToolCallIds(toolResults)

  return toolCalls.flatMap((call): Citation[] => {
    if (typeof call !== 'object' || call === null) return []
    const record = call as Record<string, unknown>
    const payload =
      typeof record.payload === 'object' && record.payload !== null
        ? (record.payload as Record<string, unknown>)
        : record

    const toolCallId = payload.toolCallId
    if (typeof toolCallId === 'string' && failed.has(toolCallId)) return []

    const tool = payload.toolName ?? payload.name
    if (typeof tool !== 'string') return []
    const args = payload.args ?? payload.input
    return [{ tool, args: (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown> }]
  })
}

/** The verdict on one agent run, before any of it is persisted. */
export interface InvestigationVerdict {
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED'
  summary: string | null
  citations: Citation[]
  error: string | null
}

/**
 * Decides what an agent run is worth, from the run alone.
 *
 * Pure and exported on purpose: this is the safeguard that makes the whole
 * "AI investigates" claim auditable, and it must be testable against real
 * inputs without standing up a model. Previously this logic was inline, which
 * meant the only way to exercise the rejection path was to mock the Agent —
 * i.e. the test proved the mock behaved like the mock.
 *
 * The rule: a report with an EMPTY tool-call trace is rejected outright. An LLM
 * handed a cluster id and no successful queries will still write a fluent
 * paragraph about coordinated funding, and once stored that paragraph is
 * indistinguishable from one grounded in real subgraph data. `toolResults`,
 * when supplied, strengthens this the same way: a call that was ATTEMPTED but
 * came back an execution error (a bad credential, a downstream 5xx) has no
 * more real data behind it than no call at all, and would otherwise slip past
 * this check as if it had succeeded — found by running against a real MCP
 * server with a bad gateway key, where every "grounded" citation was actually
 * an auth failure.
 */
export function evaluateAgentRun(run: {
  text?: string | undefined
  finishReason?: string | undefined
  toolCalls?: unknown
  toolResults?: unknown
}): InvestigationVerdict {
  const citations = extractCitations(run.toolCalls, run.toolResults)

  if (citations.length === 0) {
    return {
      status: 'FAILED',
      summary: null,
      citations: [],
      error:
        'Report rejected: the agent made no successful tool calls, so nothing in it is ' +
        'grounded in subgraph data.',
    }
  }

  return {
    // Anything other than a clean stop means the run was cut short — usually
    // the tool-call budget. The findings are kept; the status says not to read
    // them as final.
    status: run.finishReason === 'stop' ? 'COMPLETE' : 'PARTIAL',
    summary: run.text ?? null,
    citations,
    error: null,
  }
}

/**
 * Fails early and specifically when the configured model has no credential.
 *
 * Mastra's own error for a missing key surfaces from deep inside the provider
 * and does not say which variable to set, which is a poor first experience for
 * the one route that needs it.
 */
function assertModelCredential(): void {
  const model = env.MCP_INVESTIGATION_MODEL
  const required = model.startsWith('openrouter/')
    ? { name: 'OPENROUTER_API_KEY', value: env.OPENROUTER_API_KEY }
    : model.startsWith('anthropic/')
      ? { name: 'ANTHROPIC_API_KEY', value: env.ANTHROPIC_API_KEY }
      : null

  if (required && !required.value) {
    throw new InvestigationError(
      `${required.name} is not set, but MCP_INVESTIGATION_MODEL is "${model}". ` +
        `The investigation agent cannot reason without a model credential.`,
    )
  }
}

async function buildAgent(): Promise<Agent> {
  assertModelCredential()

  // `listTools()` — NOT `getTools()`. The spec was written against an older
  // Mastra; @mastra/mcp 1.17 renamed it, and the old name no longer exists.
  // Verified against the installed package's own type definitions.
  const discovered = await getSubgraphMcpClient().listTools()

  if (Object.keys(discovered).length === 0) {
    throw new InvestigationError(
      'Subgraph MCP exposed no tools. The connection or the Gateway API key is likely bad — ' +
        'running an agent with no tools would produce an ungrounded report.',
    )
  }

  const tools = selectTools(discovered)

  if (Object.keys(tools).length === 0) {
    throw new InvestigationError(
      `MCP_INVESTIGATION_TOOLS matched none of the ${Object.keys(discovered).length} tools the ` +
        `server exposes. Check the names against \`npm run check:mcp\`.`,
    )
  }

  return new Agent({
    id: 'xander-investigator',
    name: 'Xander Cluster Investigator',
    instructions: INSTRUCTIONS,
    model: env.MCP_INVESTIGATION_MODEL,
    tools,
  })
}

/**
 * Narrows the discovered tools to the configured allowlist.
 *
 * Mastra namespaces MCP tools as `<serverName>_<toolName>`, so matching is on
 * the suffix rather than the exact key — the allowlist is written in the
 * server's own vocabulary, which is what `npm run check:mcp` prints.
 */
export function selectTools<T>(discovered: Record<string, T>): Record<string, T> {
  const allowed = env.MCP_INVESTIGATION_TOOLS.split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')

  if (allowed.length === 0) return discovered

  return Object.fromEntries(
    Object.entries(discovered).filter(([name]) =>
      allowed.some((a) => name === a || name.endsWith(`_${a}`)),
    ),
  )
}

/**
 * Runs one investigation to completion and records the outcome.
 *
 * Every exit path writes a terminal status to the Investigation row. A row left
 * in RUNNING forever would be indistinguishable, to `GET /investigations/:id`,
 * from one still in flight.
 */
async function runInvestigation(investigationId: string, clusterId: string, wallets: string[]): Promise<void> {
  try {
    const agent = await buildAgent()
    const abortSignal = AbortSignal.timeout(env.MCP_INVESTIGATION_TIMEOUT_MS)
    const modelSettings = { maxOutputTokens: env.MCP_INVESTIGATION_MAX_OUTPUT_TOKENS }

    const prompt = [
      `Cluster id: ${clusterId}`,
      `Wallets (${wallets.length}): ${wallets.join(', ')}`,
      '',
      'Investigate the shared behaviour of these wallets and report what the data shows.',
    ].join('\n')

    // TWO PHASES, not one call with toolChoice: 'required' for the whole loop.
    //
    // 'required' was tried first and verified, empirically, to be the wrong
    // tool for this: a budget model held to "you must call a tool" on EVERY
    // step never gets a step where it is allowed to stop and write prose, so
    // the run always ends at maxSteps with real citations but zero narrative.
    // That is compliant with Phase 23's "runaway -> bounded, partial evidence
    // saved" — but it silently discards a model that would gladly have
    // concluded after finding what it needed.
    //
    // Forcing only the FIRST call solves this: it makes grounding NON-OPTIONAL
    // (a cost-driven default model will otherwise happily answer from its own
    // training knowledge of "what Sybil rings look like" despite an explicit
    // instruction not to — exactly the ungrounded report this module exists to
    // prevent), while leaving every subsequent step free to conclude naturally.
    const grounding = await agent.generate(prompt, {
      maxSteps: 1,
      abortSignal,
      modelSettings,
      toolChoice: 'required',
    })

    const priorMessages = grounding.response?.messages ?? []

    // `priorMessages` is the AI SDK's own designed mechanism for continuing a
    // conversation — the user prompt plus the forced tool call and its real
    // result, fed back in as history rather than re-summarized by us.
    const conclusion = await agent.generate(
      [
        { role: 'user' as const, content: prompt },
        ...priorMessages,
        {
          role: 'user' as const,
          content:
            'Using the results above, write your final report now. Call another tool only if ' +
            'the results so far are insufficient to answer.',
        },
      ],
      {
        maxSteps: Math.max(env.MCP_INVESTIGATION_MAX_STEPS - 1, 1),
        abortSignal,
        modelSettings,
        toolChoice: 'auto',
      },
    )

    // Combined RAW tool-call arrays from both phases, so evaluateAgentRun runs
    // its own extraction over the full trace rather than being handed a
    // pre-computed citation list — the whole point of keeping evaluateAgentRun
    // pure is that it is the single place that decides what counts as
    // grounded, and that must include what phase 1 forced just as much as
    // whatever phase 2 chose to do on its own.
    const combinedToolCalls = [
      ...(Array.isArray(grounding.toolCalls) ? grounding.toolCalls : []),
      ...(Array.isArray(conclusion.toolCalls) ? conclusion.toolCalls : []),
    ]
    const combinedToolResults = [
      ...(Array.isArray(grounding.toolResults) ? grounding.toolResults : []),
      ...(Array.isArray(conclusion.toolResults) ? conclusion.toolResults : []),
    ]

    const verdict = evaluateAgentRun({
      text: conclusion.text,
      finishReason: conclusion.finishReason,
      toolCalls: combinedToolCalls,
      toolResults: combinedToolResults,
    })
    const { citations } = verdict

    // The uncited-report rejection. Phase 23's failure matrix wants partial
    // evidence preserved on a timeout, so the citations and finish reason are
    // written either way — only the untrustworthy prose is dropped.
    if (verdict.status === 'FAILED') {
      await prisma.investigation.update({
        where: { id: investigationId },
        data: {
          status: verdict.status,
          summary: verdict.summary,
          citations: [],
          toolCalls: 0,
          model: env.MCP_INVESTIGATION_MODEL,
          finishReason: conclusion.finishReason ?? null,
          error: verdict.error,
          completedAt: new Date(),
        },
      })
      logger.warn(
        { investigationId, clusterId, finishReason: conclusion.finishReason },
        'investigation rejected — uncited report',
      )
      return
    }

    // Both writes commit together, and the evidence anchor is written FIRST.
    //
    // Marking the investigation terminal before its RiskEvidence row exists
    // leaves a window where GET /investigations/:id reports COMPLETE while the
    // anchor is missing — and if the process dies in that window, it stays
    // missing forever. "COMPLETE" has to mean the whole record landed.
    await prisma.$transaction([
      // Phase 15: anchor the investigation in the evidence table rather than
      // leaving it as a free-floating chat message. `value` records how much
      // grounding the report has (tool calls made), NOT a risk contribution —
      // there is no RiskWeight row for this feature, so it can never reach a
      // score. Section 0.2 rule 5.
      prisma.riskEvidence.create({
        data: {
          wallet: wallets[0] ?? '',
          clusterId,
          feature: 'MCP_INVESTIGATION',
          value: citations.length,
          confidence: verdict.status === 'COMPLETE' ? 'HIGH' : 'LOW',
          source: 'mcp-investigation',
        },
      }),
      prisma.investigation.update({
        where: { id: investigationId },
        data: {
          status: verdict.status,
          summary: verdict.summary,
          citations: citations as unknown as object,
          toolCalls: citations.length,
          model: env.MCP_INVESTIGATION_MODEL,
          finishReason: conclusion.finishReason ?? null,
          completedAt: new Date(),
        },
      }),
    ])

    logger.info(
      { investigationId, clusterId, toolCalls: citations.length, finishReason: conclusion.finishReason },
      'investigation complete',
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.investigation
      .update({
        where: { id: investigationId },
        data: { status: 'FAILED', error: message, completedAt: new Date() },
      })
      .catch((updateErr: unknown) => {
        logger.error({ investigationId, updateErr }, 'could not record investigation failure')
      })
    logger.error({ investigationId, clusterId, err }, 'investigation failed')
  }
}

/**
 * Creates the Investigation row and starts the agent in the background.
 *
 * Returns as soon as the row exists so `POST /investigations` can hand back an
 * id immediately — an investigation runs for as long as its tool-call budget
 * allows, which is far too long to hold an HTTP request open.
 */
export async function startInvestigation(clusterId: string): Promise<{ id: string }> {
  const cluster = await prisma.cluster.findUnique({
    where: { id: clusterId },
    include: { wallets: { select: { address: true } } },
  })
  if (!cluster) throw new InvestigationError(`Cluster ${clusterId} not found.`)

  const wallets = cluster.wallets.map((w) => w.address)

  const row = await prisma.investigation.create({
    data: {
      clusterId,
      wallets: wallets as unknown as object,
      status: 'RUNNING',
      citations: [] as unknown as object,
    },
  })

  void runInvestigation(row.id, clusterId, wallets)

  return { id: row.id }
}

export async function getInvestigation(id: string) {
  return prisma.investigation.findUnique({ where: { id } })
}
