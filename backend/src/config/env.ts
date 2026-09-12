/**
 * The ONLY file in this repo permitted to read `process.env`.
 *
 * Backend-Suganthan.md Section 0.2, rule 2 and Phase 2:
 *   "zod-validated environment, single source of truth — no file anywhere else
 *    reads process.env directly."
 *
 * This is enforced mechanically, not by convention: eslint.config.js bans
 * `process.env` repo-wide via no-restricted-properties and whitelists only this
 * file. If you need a new setting, add it to the schema below and to
 * .env.example — do not reach for process.env at the call site.
 *
 * Validation runs once at import time and throws on a bad/missing value, so the
 * process dies at boot with a readable message instead of failing later with
 * `undefined` halfway through a risk computation.
 */
import { z } from 'zod'

/** Coerce "true"/"false"/"1"/"0" into a real boolean. */
const boolFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

/** A numeric env var, kept as a number with a documented default. */
const num = (fallback: number) => z.coerce.number().default(fallback)

/**
 * An optional string that treats "" as absent.
 *
 * Node's --env-file turns a blank line like `GRAPH_MARKET_API_TOKEN=` into an
 * empty string, not undefined. Without this, `.optional()` would report the
 * credential as present-but-empty and the require* helpers below would be the
 * only thing catching it.
 */
const optionalStr = () =>
  z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v))
    .optional()

const envSchema = z.object({
  // --- Core ---------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: num(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // --- The Graph credentials (Phase 1) ------------------------------------
  // Optional at boot so Phases 2 and 5-8 (all offline-testable) can run before
  // Phase 1 access lands. The clients in Phases 3-4 must call the `require*`
  // helpers below rather than reading these directly, so a missing credential
  // fails loudly at the point of use instead of silently sending no auth header.
  GRAPH_MARKET_API_TOKEN: optionalStr(),
  TOKEN_API_BASE_URL: z.string().url().default('https://token-api.thegraph.com'),
  GRAPH_GATEWAY_API_KEY: optionalStr(),

  /**
   * Supported Token API network ids. Config, never a hardcoded switch
   * (Section 0.2 rule 1). Verified against the service's OpenAPI enum.
   */
  TOKEN_API_NETWORKS: z
    .string()
    .default('arbitrum-one,avalanche,base,bsc,hyperevm,mainnet,optimism,polygon,unichain'),
  TOKEN_API_DEFAULT_NETWORK: z.string().default('mainnet'),

  /**
   * Max items the plan allows per request. The API returns 403 — not a
   * truncated list — when `limit` exceeds this, so the client clamps to it and
   * paginates. Free tier is 10 (from the JWT's TOKEN_API_ITEMS_RETURNED claim).
   */
  TOKEN_API_MAX_ITEMS: num(10),

  /**
   * Standardized Subgraphs gateway (Phase 4). The API key is created in
   * Subgraph Studio under the "API Keys" tab — it is NOT the subgraph deploy
   * key, which only publishes your own subgraph and cannot query the gateway.
   */
  GRAPH_GATEWAY_BASE_URL: z.string().url().default('https://gateway.thegraph.com'),
  /**
   * 'header' sends Authorization: Bearer <key> (documented, and keeps the key
   * out of logs and Referer headers). 'path' uses the legacy
   * /api/{key}/subgraphs/id/... form, still supported by gateway.thegraph.com.
   */
  GRAPH_GATEWAY_AUTH_MODE: z.enum(['header', 'path']).default('header'),
  /** How long the deployment registry cache lives before a DB re-read. */
  DEPLOYMENT_REGISTRY_TTL_SECONDS: num(300),

  // --- Substreams (Phases 9-10) -------------------------------------------
  // Locked P0 per Section 0.6 — do not feature-flag this off.
  ENABLE_SUBSTREAMS: boolFromString.default('true'),
  /**
   * Single-endpoint fallback, kept for compatibility with Section 0.6 of the
   * spec. SUBSTREAMS_ENDPOINTS below is the multi-chain form and wins.
   */
  SUBSTREAMS_ENDPOINT: optionalStr(),
  /**
   * `network=host:port` pairs, comma-separated. gRPC — no https:// prefix.
   * Third-party hosted and known to move, so this is config, not code.
   */
  SUBSTREAMS_ENDPOINTS: z.string().default(''),
  // Base Sepolia, not mainnet: this project streams against the testnet
  // while building/demoing. Switching to a mainnet chain at ship time is
  // this one value plus the matching entry in SUBSTREAMS_ENDPOINTS.
  SUBSTREAMS_DEFAULT_NETWORK: z.string().default('base-sepolia'),
  SUBSTREAMS_WEBHOOK_SECRET: optionalStr(),

  // --- Risk engine tunables (Phases 6, 7, 11) -----------------------------
  // Section 0.2 rule 1: every knob is config, never an inline number.
  // Defaults are the documented starting values from the phase specs.
  EDGE_THRESHOLD: num(0.5),
  MIN_CLUSTER_SIZE: num(2),
  FUNDING_LOOKBACK_HOPS: num(1),
  FUNDING_WINDOW_HOURS: num(24),
  TIMING_NORMALIZATION_SECONDS: num(3600),
  AGE_NORMALIZATION_BLOCKS: num(50_000),
  FRESHNESS_MAX_BLOCK_LAG: num(100),
  /**
   * How old EvidenceEvent rows may be, in seconds, before token-api and
   * standardized-subgraph evidence is treated as stale (Phase 11). Default 6h.
   */
  FRESHNESS_MAX_EVIDENCE_AGE_SECONDS: num(21_600),
  /**
   * How long a SubstreamsCursor may go without updating before its chain's
   * live evidence is treated as stale — "is the stream still running", not a
   * block-count question. Default 15 minutes.
   */
  FRESHNESS_MAX_STREAM_LAG_SECONDS: num(900),
  /**
   * Cap on the event sequence PROTOCOL_BEHAVIOR_SIMILARITY compares (Phase 7).
   * LCS is O(n*m) per pair, so an uncapped busy wallet would dominate the whole
   * scoring pass.
   */
  PROTOCOL_SEQUENCE_MAX_LENGTH: num(200),

  // --- Known-funder registry (V2 Phase 0, spec section 12.3) --------------
  /**
   * What a shared-funder signal is worth when the shared funder is a LABELLED
   * benign operational address — an exchange hot wallet, a bridge, a faucet.
   *
   * Not zero on purpose. A coordinated ring really can be funded out of one
   * exchange account inside a tight window, so a labelled funder has to reduce
   * the signal rather than erase it. 0.15 keeps such a group scoreable while
   * making the shared funder alone insufficient to reach the CHALLENGE band.
   *
   * This is the concrete mitigation for the Arbitrum-style false positive the
   * README calls "the single most important lesson": thousands of unrelated
   * people withdrawing from the same exchange in the same hour after an airdrop
   * announcement are not a Sybil ring.
   */
  KNOWN_FUNDER_WEIGHT_MULTIPLIER: num(0.15),
  /** How long the known-funder table is cached in-process. Mirrors the deployment registry. */
  KNOWN_FUNDER_CACHE_TTL_SECONDS: num(300),

  // --- V2 Phase 1: Actor + Intent ------------------------------------------
  /**
   * How long an Intent stays valid when the caller does not set `expiresAt`.
   *
   * Intents expire by default rather than living forever because an
   * authorization is a statement about evidence at a moment in time. Section
   * 7.3 makes the same argument for capabilities. Default 15 minutes.
   */
  INTENT_DEFAULT_TTL_SECONDS: num(900),

  // --- SYLESH's section (Backend-Sylesh.md Section 0.6) -------------------
  // Credentials stay optional at boot so the server starts without World
  // access (Phase 13 is access-gated with no published SLA). Every one of them
  // is read through a `require*` helper below, so a missing credential fails
  // loudly at the point of use rather than silently sending no auth header.
  SUBGRAPH_MCP_URL: z.string().url().default('https://subgraphs.mcp.thegraph.com/sse'),
  WORLD_APP_ID: optionalStr(),
  WORLD_RP_ID: optionalStr(),
  WORLD_RP_SIGNING_KEY: optionalStr(),
  WORLD_ACTION_PREFIX: z.string().default('claim'),
  WORLD_VERIFY_BASE_URL: z.string().url().default('https://developer.world.org'),
  BACKEND_API_KEY: optionalStr(),

  // --- Risk cache (Phase 14) ----------------------------------------------
  /**
   * TTL is a safety net, not the invalidation mechanism. Correctness comes
   * from the explicit `risk-invalidation` eviction (Phase 14); this only bounds
   * how long a cache entry can outlive an invalidation that never arrived.
   */
  RISK_CACHE_TTL_SECONDS: num(3600),
  /** Turn the cache off to force every claim down the compute path. */
  RISK_CACHE_ENABLED: boolFromString.default('true'),
  /** Bounds how long a claim waits on an unreachable Redis before computing directly. */
  RISK_CACHE_CONNECT_TIMEOUT_MS: num(2000),

  // --- World escalation (Phases 16-20) ------------------------------------
  /**
   * Selfie Check's documented validity window. A PASSED challenge older than
   * this is not reusable as "still verified" — Phase 20 re-issues instead.
   */
  WORLD_CHALLENGE_VALIDITY_DAYS: num(90),
  /**
   * How long an ISSUED challenge may sit unresolved before it is EXPIRED.
   * Separate from the 90-day window above: that one governs a PASSED proof's
   * reusability, this one governs an unanswered prompt.
   */
  WORLD_CHALLENGE_TTL_MINUTES: num(30),
  /** Timeout for the call to World's verify endpoint (Phase 18). */
  WORLD_VERIFY_TIMEOUT_MS: num(10_000),
  /**
   * Attempts for a TRANSIENT verify failure (timeout, 5xx, network). A definite
   * rejection from World is never retried — it is an answer, not an outage.
   */
  WORLD_VERIFY_MAX_ATTEMPTS: num(3),

  // --- Subgraph MCP investigation agent (Phase 15) ------------------------
  /**
   * Tool-call budget for one investigation. Phase 15 requires this to be
   * bounded — an agent free to loop indefinitely against a metered gateway is
   * both a cost and an availability problem.
   */
  MCP_INVESTIGATION_MAX_STEPS: num(8),
  MCP_INVESTIGATION_TIMEOUT_MS: num(120_000),
  /**
   * Output-token ceiling for one investigation.
   *
   * Without this the provider default applies — 64000 tokens on the model
   * router — which is absurd for a short grounded summary and is charged
   * against the request budget up front. OpenRouter rejects the call outright
   * (HTTP 402) when the reserved ceiling exceeds the remaining balance, so an
   * uncapped run can fail before it makes a single tool call.
   */
  MCP_INVESTIGATION_MAX_OUTPUT_TOKENS: num(2000),
  /**
   * Which MCP tools the investigation agent may use, comma-separated. Empty
   * means all of them.
   *
   * Every tool's JSON schema is sent on every model call, so the full set of
   * nine costs ~6k prompt tokens before the agent does anything. The mandate
   * here is narrow — find shared schemas, summarize the shared path — and these
   * four cover it. Narrowing also keeps the agent from wandering into
   * capabilities its instructions never authorized.
   */
  MCP_INVESTIGATION_TOOLS: z
    .string()
    .default(
      'search_subgraphs_by_keyword,get_schema_by_deployment_id,execute_query_by_deployment_id,get_deployment_30day_query_counts',
    ),
  /**
   * Model id for the investigation agent, in Mastra's `provider/model` routing
   * form. Config, not code — swapping models must not require a redeploy.
   */
  MCP_INVESTIGATION_MODEL: z.string().default('openrouter/anthropic/claude-sonnet-4.5'),
  /**
   * OpenRouter credential for the investigation agent.
   *
   * Mastra's model router supports `openrouter` natively — it reads this exact
   * variable name and sends `Authorization: Bearer <key>`, so no extra provider
   * package is needed. Routing through OpenRouter means the model is a config
   * change (`MCP_INVESTIGATION_MODEL`) rather than a dependency change.
   *
   * Declared here for validation and documentation; Mastra reads it from the
   * process environment itself.
   */
  OPENROUTER_API_KEY: optionalStr(),
  /**
   * Path to a LOCAL `subgraph-mcp` binary, run over stdio instead of the hosted
   * SSE endpoint. Optional; when empty, SUBGRAPH_MCP_URL is used.
   *
   * This exists because the hosted endpoint was verified broken on 2026-09-09:
   * it accepts the connection (HTTP 200, `Content-Type: text/event-stream`) and
   * then sends zero bytes, for a valid and an invalid Gateway key alike, so the
   * MCP handshake never gets the `endpoint` event it needs. Confirmed against
   * the official @modelcontextprotocol SDK as well as Mastra, with an unrelated
   * public SSE stream working fine from the same machine — so it is the server,
   * not the client or the network.
   *
   * The upstream server (graphops/subgraph-mcp, Rust) supports stdio natively:
   *   cargo build --release  ->  target/release/subgraph-mcp
   */
  SUBGRAPH_MCP_COMMAND: optionalStr(),
  /**
   * Direct-to-Anthropic alternative. Only needed if MCP_INVESTIGATION_MODEL is
   * switched from an `openrouter/*` id to a bare `anthropic/*` one.
   */
  ANTHROPIC_API_KEY: optionalStr(),

  // --- API surface (Phase 22) ---------------------------------------------
  RATE_LIMIT_WINDOW_MS: num(60_000),
  RATE_LIMIT_MAX_REQUESTS: num(30),
})

export type Env = z.infer<typeof envSchema>

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the missing values.`,
  )
}

export const env: Env = parsed.data

/**
 * Phase 3 (Token API) calls this instead of reading the token directly.
 * Turns "credential absent" into a loud, specific failure at the call site.
 */
export function requireGraphMarketApiToken(): string {
  if (!env.GRAPH_MARKET_API_TOKEN) {
    throw new Error(
      'GRAPH_MARKET_API_TOKEN is not set. Token API requires a bearer JWT on every ' +
        'request — there is no unauthenticated tier (Phase 1.1).',
    )
  }
  return env.GRAPH_MARKET_API_TOKEN
}

/**
 * Phase 4 (Standardized Subgraphs) calls this to build the gateway query URL.
 * Sylesh's Phase 15 (Subgraph MCP) uses the same key.
 */
export function requireGraphGatewayApiKey(): string {
  if (!env.GRAPH_GATEWAY_API_KEY) {
    throw new Error(
      'GRAPH_GATEWAY_API_KEY is not set. Required for the Standardized Subgraphs ' +
        'gateway URL (Phase 4) and the Subgraph MCP connection (Sylesh Phase 15).',
    )
  }
  return env.GRAPH_GATEWAY_API_KEY
}

/**
 * The Relying Party id World issues alongside the app id (Sylesh Phase 16-18).
 *
 * `rp_id` is the primary identifier for the v4 verify endpoint; `app_id` is
 * accepted only for backward compatibility, so it is the fallback rather than
 * an equal alternative.
 */
export function requireWorldRpId(): string {
  const id = env.WORLD_RP_ID ?? env.WORLD_APP_ID
  if (!id) {
    throw new Error(
      'WORLD_RP_ID is not set. Register the app at developer.world.org (Phase 13.2) — ' +
        'IDKit requests and POST /api/v4/verify/{rp_id} both need it.',
    )
  }
  return id
}

/**
 * The World app id, for the CLIENT-SIDE IDKit request config (Sylesh Phase 17).
 *
 * NOT a fallback here — unlike `requireWorldRpId`, where `app_id` only stands
 * in for a missing `rp_id`. The installed `@worldcoin/idkit-core` client SDK's
 * `IDKitRequestConfig.app_id` is a REQUIRED top-level field, structurally
 * distinct from `rp_context.rp_id`: a request cannot be constructed at all
 * without it, verify endpoint preference for `rp_id` notwithstanding.
 */
export function requireWorldAppId(): string {
  if (!env.WORLD_APP_ID) {
    throw new Error(
      'WORLD_APP_ID is not set. The IDKit client SDK requires app_id on every request ' +
        'config — register the app at developer.world.org (Phase 13.2) to get one.',
    )
  }
  return env.WORLD_APP_ID
}

/**
 * The RP signing key (Sylesh Phase 16).
 *
 * Read ONLY on the server. IDKit's own documentation is explicit that this key
 * must never reach the client; the whole reason POST /world/rp-signature exists
 * as a backend route is to keep it here.
 */
export function requireWorldRpSigningKey(): string {
  if (!env.WORLD_RP_SIGNING_KEY) {
    throw new Error(
      'WORLD_RP_SIGNING_KEY is not set. Without it signRequest() cannot sign, and IDKit ' +
        'will not open on the client (Phase 16).',
    )
  }
  return env.WORLD_RP_SIGNING_KEY
}

/**
 * The shared API key guarding the routes that spend real upstream quota
 * (Sylesh Phase 22).
 *
 * Absent config throws rather than defaulting to "open". An unauthenticated
 * /screen-claim is a free, quota-burning proxy to the Token API and the
 * Standardized Subgraphs gateway.
 */
export function requireBackendApiKey(): string {
  if (!env.BACKEND_API_KEY) {
    throw new Error(
      'BACKEND_API_KEY is not set. The claim and World routes require an X-API-Key header ' +
        'checked against it (Phase 22); serving them unauthenticated is not a supported mode.',
    )
  }
  return env.BACKEND_API_KEY
}

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
