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
   * Cap on the event sequence PROTOCOL_BEHAVIOR_SIMILARITY compares (Phase 7).
   * LCS is O(n*m) per pair, so an uncapped busy wallet would dominate the whole
   * scoring pass.
   */
  PROTOCOL_SEQUENCE_MAX_LENGTH: num(200),

  // --- SYLESH's section (Backend-Sylesh.md Section 0.6) -------------------
  // Declared optional here so this track boots without World credentials.
  // Sylesh: tighten these to required on your side and add any you're missing.
  SUBGRAPH_MCP_URL: z.string().url().default('https://subgraphs.mcp.thegraph.com/sse'),
  WORLD_APP_ID: optionalStr(),
  WORLD_RP_ID: optionalStr(),
  WORLD_RP_SIGNING_KEY: optionalStr(),
  WORLD_ACTION_PREFIX: z.string().default('claim'),
  WORLD_VERIFY_BASE_URL: z.string().url().default('https://developer.world.org'),
  BACKEND_API_KEY: optionalStr(),
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

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
