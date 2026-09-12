/**
 * Express entrypoint.
 *
 * OWNERSHIP: Sylesh, from Phase 22 (Backend-Suganthan.md Section 0.5). The
 * Phase 2 placeholder this replaced carried one instruction — preserve
 * `/health` — and that route is unchanged below, including the shape Phase 11
 * extended it with. Suganthan owns the data it reports; this file owns the
 * route.
 *
 * `/health` is deliberately the ONE unauthenticated route. An uptime check that
 * needs a credential is a check that silently stops working when the credential
 * rotates.
 */
import express from 'express'
import { pathToFileURL } from 'node:url'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { getProvenanceHealth } from './provenance/health.js'
import { apiRouter } from './claim/routes.js'
import { v2Router } from './v2/routes.js'
import { x402Router } from './x402/x402-routes.js'
import { errorHandler } from './claim/middleware.js'
import { startInvalidationWorker } from './cache/invalidation-worker.js'

export const app = express()

app.use(express.json())

app.get('/health', (_req, res) => {
  // `ok: true` stays exactly as Phase 2's acceptance test fixed it.
  // `provenance` is Phase 11's addition — Suganthan owns this data, Sylesh
  // owns the route from Phase 22 onward. Failure here degrades the payload,
  // it never turns a working server into a failing health check: an operator
  // watching uptime should not go dark because a provenance query hiccuped.
  getProvenanceHealth()
    .then((provenance) => res.json({ ok: true, provenance }))
    .catch((err: unknown) => {
      logger.warn({ err }, '/health: provenance data unavailable')
      res.json({ ok: true, provenance: null })
    })
})

// Agent commerce (spec section 17). MOUNTED FIRST, and deliberately not behind
// apiKeyAuth: in x402 the payment IS the authorization, and demanding a
// pre-issued key would defeat the premise of an agent paying for a resource
// with no prior relationship. The paying wallet's trust band gates it instead.
//
// It must precede apiRouter because that router calls `apiKeyAuth` with no path
// prefix, so anything mounted after it inherits the key requirement. Ordering
// here rather than changing the V1 router keeps the claim gate's auth untouched.
app.use(x402Router)

// The Phase 22 claim gate. Auth, rate limiting and zod validation are applied
// inside the router so no route can be added later that quietly skips them.
app.use(apiRouter)

// The V2 Trust Runtime surface (spec section 24), mounted ALONGSIDE the claim
// gate rather than in front of it. Section 1.1 keeps the V1 routes as a
// compatibility surface: every existing client keeps working unchanged, and
// nothing under /v2 writes a V1 table.
app.use(v2Router)

// Must be last: Express selects error middleware by arity and by position.
app.use(errorHandler)

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
    logger.info({ port: env.PORT }, 'xander backend listening')
  })

  // Started only in the real process, never on a supertest import — a test run
  // that opened a live BullMQ consumer would drain jobs from a developer's
  // queue and hold the event loop open after the suite finished.
  startInvalidationWorker()
}
