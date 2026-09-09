import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/xander',
      REDIS_URL: 'redis://localhost:6379',
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
    },
  },
})
