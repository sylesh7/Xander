/**
 * Express entrypoint.
 *
 * OWNERSHIP: Backend-Suganthan.md Section 0.5 assigns this file to SYLESH.
 * It exists now only to satisfy the Phase 2 acceptance test ("`npm run dev`
 * boots a bare Express server (even with zero routes) and `/health` returns
 * `{ ok: true }`").
 *
 * Sylesh: this is yours from Phase 22 onward. Replace/extend freely — mount the
 * claim routes, auth middleware, rate limiting and zod validation here. The one
 * thing to preserve is /health, which Phase 11 extends with provenance data
 * (Token API last-success, per-deployment block lag, Substreams cursor lag).
 */
import express from 'express'
import { pathToFileURL } from 'node:url'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'

export const app = express()

app.use(express.json())

app.get('/health', (_req, res) => {
  // Phase 11 extends this payload. Suganthan owns the data it reports;
  // Sylesh owns the route.
  res.json({ ok: true })
})

// Only listen when run directly, so tests can import `app` into supertest
// without binding a port.
//
// pathToFileURL is required, not cosmetic: on Windows process.argv[1] is a
// backslash path (C:\...\server.ts) while import.meta.url is file:///C:/...,
// so a raw string compare silently never matches and the server exits 0
// without ever listening.
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'sybil-shield backend listening')
  })
}
