/**
 * API middleware — Backend-Sylesh.md Phase 22, "operational concerns".
 *
 * These are named in the spec as real gaps rather than nice-to-haves: the claim
 * and World routes trigger quota-bound upstream calls, so leaving them open is
 * a free proxy to The Graph's gateway and World's verify endpoint on someone
 * else's budget.
 */
import { timingSafeEqual } from 'node:crypto'
import rateLimit from 'express-rate-limit'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { ZodSchema } from 'zod'
import { env, requireBackendApiKey } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { ClaimError } from './orchestrator.js'

/**
 * Constant-time comparison.
 *
 * A plain `===` on a secret leaks its prefix through response timing. The
 * length check first is unavoidable (timingSafeEqual throws on a length
 * mismatch) and leaks only the key's length, which is not the secret.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Shared-key auth. A hackathon backend does not need OAuth, but it does need to
 * not be open.
 *
 * An unconfigured key is a 503, not an open door. "No key set" must never be
 * the same thing as "no key required" — that is the failure mode where a
 * deployment silently ships unauthenticated.
 */
export const apiKeyAuth: RequestHandler = (req, res, next) => {
  let expected: string
  try {
    expected = requireBackendApiKey()
  } catch {
    res.status(503).json({
      error: 'server_misconfigured',
      message: 'BACKEND_API_KEY is not configured, so authenticated routes cannot be served.',
    })
    return
  }

  const provided = req.header('x-api-key')
  if (!provided || !secretsMatch(provided, expected)) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid X-API-Key header.' })
    return
  }

  next()
}

/**
 * Rate limit for the routes that cost real upstream quota.
 *
 * Deliberately not applied globally: `GET /receipts/:id` serves a stored row
 * and is the endpoint an operator hits repeatedly while investigating, so
 * throttling it would degrade the audit path to protect nothing.
 */
export const upstreamRateLimit = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — slow down.' },
})

/**
 * Express 4 does not catch rejected promises from async handlers; without this
 * an upstream failure hangs the request until the client times out instead of
 * returning a 500.
 */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next)
  }
}

/** Rejects a malformed body before it can reach the orchestrator. */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'Request body failed validation.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
      return
    }
    req.body = parsed.data
    next()
  }
}

/**
 * Terminal error handler.
 *
 * `ClaimError` carries its own status because the orchestrator knows the
 * difference between "no such claim" and "verification still outstanding".
 * Everything else is a 500 with the detail logged rather than returned —
 * upstream error text can contain credentials and internal hostnames.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err)
    return
  }

  if (err instanceof ClaimError) {
    res.status(err.status).json({ error: 'claim_error', message: err.message })
    return
  }

  logger.error({ err }, 'unhandled API error')
  res.status(500).json({ error: 'internal_error', message: 'Request failed.' })
}
