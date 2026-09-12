import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    /**
     * Test FILES run one at a time. Tests INSIDE a file still run as written,
     * so every deliberate concurrency test — the Claim upsert race, the actor
     * resolver race, the idempotency-key race — is untouched and still proves
     * what it did.
     *
     * Why: this suite has no in-memory fixtures. Every file shares one Postgres
     * and one Redis, and running 30+ of them at once produced a steady drip of
     * failures that had nothing to do with the code under test — one file
     * deleting an actor another was mid-test on, a global row count moving
     * because a parallel file inserted, a BullMQ round trip starved of the
     * event loop, a shared rate limiter tripping at 30 req/min. Each was fixed
     * individually and another appeared. They are one class of defect with one
     * cause, and serialising files removes the cause instead of the symptoms.
     *
     * The cost is wall-clock: roughly 20s to 90s. That is a good trade for a
     * suite whose entire job is to be believed.
     */
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5433/xander',
      REDIS_URL: 'redis://localhost:6380',
      GRAPH_MARKET_API_TOKEN: 'test-token',
      // Falls through to the REAL key when one is already in process.env — which
      // happens under `npm run test:live` (`node --env-file=.env vitest.mjs`,
      // Node populates process.env before this file evaluates). Fixed at
      // 'test-gateway-key' otherwise, so `npm test` (no .env loaded) stays fully
      // deterministic — Suganthan's token-api/standardized-subgraphs tests stub
      // `fetch` and never make a real call, so the literal value never mattered
      // to them either way.
      //
      // Found the hard way: without this fallback, a live investigation test ran
      // against a REAL MCP server that then forwarded this FAKE key to the real
      // gateway, which rejected every tool call with "malformed API key" — a
      // silent failure the test still reported as a pass, because an attempted
      // tool call still produced a citation regardless of whether it succeeded.
      GRAPH_GATEWAY_API_KEY: process.env.GRAPH_GATEWAY_API_KEY || 'test-gateway-key',

      // --- SYLESH (Phases 13-25) --------------------------------------------
      BACKEND_API_KEY: 'test-api-key',
      WORLD_RP_ID: 'rp_test',
      // app_id is a separate, required field on the real IDKit client SDK's
      // request config — not an alternate spelling of rp_id (see
      // requireWorldAppId in src/config/env.ts).
      WORLD_APP_ID: 'app_test',
      // A throwaway secp256k1 key. Real signing is exercised against it; it
      // guards nothing and is not a credential.
      WORLD_RP_SIGNING_KEY:
        '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
      // The cache is off by default under test so unit tests do not need a live
      // Redis. The tests that exercise caching turn it on explicitly.
      RISK_CACHE_ENABLED: 'false',
      // The express rate limiter is app-level shared state, and vitest runs test
      // FILES in parallel — the claim suite and both /v2 suites hit limited
      // routes at once and blow through the production default of 30/min. That
      // surfaced as `res.body.decision` being undefined, because the request had
      // actually been answered with a 429. Raised for the test process only;
      // production keeps its real limit, and no test asserts this threshold.
      RATE_LIMIT_MAX_REQUESTS: '100000',
    },
  },
})
