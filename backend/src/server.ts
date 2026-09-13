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
import cors from 'cors'
import express from 'express'
import { pathToFileURL } from 'node:url'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { getProvenanceHealth } from './provenance/health.js'
import { apiRouter } from './claim/routes.js'
import { v2Router } from './v2/routes.js'
import { x402Router } from './x402/x402-routes.js'
import { controlRouter } from './control/control-routes.js'
import { errorHandler } from './claim/middleware.js'
import { startInvalidationWorker } from './cache/invalidation-worker.js'
import { checkReadiness } from './hardening/readiness.js'
import { startTelemetry, stopTelemetry } from './hardening/telemetry.js'

export const app = express()

/**
 * CORS — every surface in this file is called directly from browser JS
 * (the console, the authority mobile UI, x402's client-side EIP-712 signing),
 * and none of them share an origin with this API in dev. Without this, every
 * fetch fails at the browser's CORS check before the request even reaches
 * `apiKeyAuth` — it looks identical to the backend being down.
 *
 * Reflects the requesting origin rather than a fixed list: this is a
 * hackathon dev backend gated by BACKEND_API_KEY / operator auth / the x402
 * payment itself, not by origin, so there is no meaningful origin allowlist
 * to maintain here.
 */
app.use(
  cors({
    origin: true,
    credentials: false,
    allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization', 'X-Device-Id', 'X-Wallet', 'PAYMENT-SIGNATURE'],
    exposedHeaders: ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
  }),
)

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

/**
 * Readiness — Phase 12. DISTINCT FROM /health, and the distinction matters.
 *
 * `/health` answers "is this process alive?" and stays `ok: true` for a running
 * server; a liveness probe that failed on a Postgres blip would restart every
 * replica in a loop and turn a dependency outage into a total one. `/ready`
 * answers "should I get traffic?" and is what an orchestrator drains on.
 *
 * Unauthenticated for the same reason /health is: a probe that needs a
 * credential silently stops working the moment that credential rotates.
 */
app.get('/ready', (_req, res) => {
  checkReadiness()
    .then((report) => res.status(report.ready ? 200 : 503).json(report))
    .catch((err: unknown) => {
      logger.error({ err }, '/ready: the readiness check itself failed')
      // Fail closed: a readiness check that cannot run is not a ready instance.
      res.status(503).json({ ready: false, canAuthorize: false, summary: 'readiness check failed' })
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

// Remote Authority (spec section 19). Mounted BEFORE apiRouter for the same
// reason as x402: that router calls apiKeyAuth with no path prefix. The control
// plane has its own, stronger operator authentication — section 27.1 forbids
// reusing the static protocol key as a mobile-user credential.
app.use(controlRouter)

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
  // Telemetry first: auto-instrumentation must patch http/pg/ioredis before
  // any of them is used, and it is never fatal if it cannot start.
  void startTelemetry().then((t) => logger.info(t, 'telemetry'))

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'xander backend listening')
  })

  // Started only in the real process, never on a supertest import — a test run
  // that opened a live BullMQ consumer would drain jobs from a developer's
  // queue and hold the event loop open after the suite finished.
  startInvalidationWorker()

  /**
   * Graceful shutdown — Phase 12, for rolling deploys and autoscaling.
   *
   * Stops accepting new connections and lets in-flight requests finish. Without
   * this, every scale-down event severs requests mid-decision, and a client
   * that retries a non-idempotent call after a severed connection is exactly
   * how duplicate authorizations happen.
   */
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down')
    server.close(() => {
      void stopTelemetry().then(() => process.exit(0))
    })
    // A hung connection must not hold the deploy open forever.
    setTimeout(() => process.exit(1), 15_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
