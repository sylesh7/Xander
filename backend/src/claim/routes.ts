/**
 * The Claim Gate API — Backend-Sylesh.md Phase 22.
 *
 * This is the frozen surface the frontend calls (Phase 25's handoff contract),
 * so shapes here are a commitment, not an implementation detail.
 *
 * Every route validates its input with zod before the orchestrator sees it, and
 * every block number crosses the wire as a STRING — they exceed
 * Number.MAX_SAFE_INTEGER, and `res.json` throws outright on a BigInt rather
 * than silently rounding, which is the better of the two failures but still not
 * one to leave to chance.
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { getRiskThroughCache } from '../cache/risk-cache.js'
import { getInvestigation, InvestigationError, startInvestigation } from '../mcp/investigation-agent.js'
import { getReceipt } from '../policy/evidence-receipt.js'
import { generateRpSignature } from '../world/rp-signature.js'
import { apiKeyAuth, asyncHandler, upstreamRateLimit, validateBody } from './middleware.js'
import { ClaimError, finalizeClaim, reissueChallenge, screenClaim, verifyClaim } from './orchestrator.js'

const walletSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x-prefixed 40-character hex address.')

/**
 * A single path parameter as a plain string.
 *
 * Express types a param as `string | string[] | undefined` because a route
 * pattern can bind one name repeatedly. None of these routes do, but the type
 * is honest and narrowing it here once beats casting at nine call sites.
 */
function pathParam(req: Request, name: string): string | null {
  const value = req.params[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const screenClaimSchema = z.object({
  wallet: walletSchema,
  campaignId: z.string().min(1).max(128),
})

const rpSignatureSchema = z.object({
  action: z.string().min(1).max(256),
})

const verifySchema = z.object({
  claimId: z.string().min(1),
  // Forwarded to World exactly as received — Phase 18 is explicit that field
  // remapping is what breaks this call, so it is deliberately not modelled.
  idkitResponse: z.unknown().refine((v) => typeof v === 'object' && v !== null, {
    message: 'idkitResponse must be the IDKit result object, forwarded unmodified.',
  }),
  rp_id: z.string().min(1).optional(),
})

const claimIdSchema = z.object({ claimId: z.string().min(1) })
const investigationSchema = z.object({ clusterId: z.string().min(1) })

export const apiRouter = Router()

// Every route below spends real upstream quota or exposes risk data, so the
// whole surface is authenticated. /health stays open and is mounted elsewhere.
apiRouter.use(apiKeyAuth)

// ---------------------------------------------------------------------------
// Claim decisions
// ---------------------------------------------------------------------------

apiRouter.post(
  '/screen-claim',
  upstreamRateLimit,
  validateBody(screenClaimSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof screenClaimSchema>
    const result = await screenClaim(body)

    // 202 signals "not finished — go do the Selfie Check", which is genuinely a
    // different outcome from a completed decision and worth distinguishing at
    // the status-code level rather than only in the body.
    res.status(result.decision === 'CHALLENGE' ? 202 : 200).json(result)
  }),
)

apiRouter.post(
  '/claim/finalize',
  validateBody(claimIdSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof claimIdSchema>
    res.json(await finalizeClaim(body))
  }),
)

// ---------------------------------------------------------------------------
// World (Phases 16-19)
// ---------------------------------------------------------------------------

apiRouter.post(
  '/world/rp-signature',
  upstreamRateLimit,
  validateBody(rpSignatureSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof rpSignatureSchema>
    try {
      res.json(generateRpSignature(body.action))
    } catch (err) {
      // A missing signing key is a configuration problem, not a bad request.
      logger.error({ err }, 'rp-signature failed')
      res.status(503).json({
        error: 'world_unconfigured',
        message: err instanceof Error ? err.message : 'RP signing unavailable.',
      })
    }
  }),
)

apiRouter.post(
  '/world/verify',
  upstreamRateLimit,
  validateBody(verifySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof verifySchema>
    const result = await verifyClaim({
      claimId: body.claimId,
      idkitResponse: body.idkitResponse,
      ...(body.rp_id ? { rpId: body.rp_id } : {}),
    })

    // 503 on RETRYABLE, not 200: World being unreachable must not read as a
    // completed verification to any client that only checks the status code.
    const status = result.status === 'PASSED' ? 200 : result.status === 'FAILED' ? 400 : 503
    res.status(status).json(result)
  }),
)

apiRouter.post(
  '/world/challenge',
  upstreamRateLimit,
  validateBody(claimIdSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof claimIdSchema>
    res.json(await reissueChallenge(body))
  }),
)

// ---------------------------------------------------------------------------
// Evidence, clusters, receipts
// ---------------------------------------------------------------------------

apiRouter.get(
  '/wallets/:address/risk',
  asyncHandler(async (req, res) => {
    const address = walletSchema.safeParse(pathParam(req, 'address'))
    if (!address.success) {
      res.status(400).json({ error: 'invalid_request', message: 'Malformed wallet address.' })
      return
    }

    const { risk, cached } = await getRiskThroughCache(address.data)
    res.json({ wallet: address.data.toLowerCase(), cached, ...risk })
  }),
)

apiRouter.get(
  '/clusters/:id',
  asyncHandler(async (req, res) => {
    const id = pathParam(req, 'id')
    const cluster = id
      ? await prisma.cluster.findUnique({
          where: { id },
          include: { wallets: { select: { address: true, firstSeenBlock: true } } },
        })
      : null
    if (!cluster) {
      res.status(404).json({ error: 'not_found', message: 'No such cluster.' })
      return
    }

    res.json({
      id: cluster.id,
      confidence: cluster.confidence,
      score: cluster.score,
      walletCount: cluster.wallets.length,
      wallets: cluster.wallets.map((w) => ({
        address: w.address,
        firstSeenBlock: w.firstSeenBlock?.toString() ?? null,
      })),
      createdAt: cluster.createdAt,
      updatedAt: cluster.updatedAt,
    })
  }),
)

apiRouter.get(
  '/clusters/:id/evidence',
  asyncHandler(async (req, res) => {
    const id = pathParam(req, 'id')
    const cluster = id
      ? await prisma.cluster.findUnique({
          where: { id },
          include: { wallets: { select: { address: true } } },
        })
      : null
    if (!cluster) {
      res.status(404).json({ error: 'not_found', message: 'No such cluster.' })
      return
    }

    const wallets = cluster.wallets.map((w) => w.address)
    const limit = Math.min(Number(req.query.limit ?? 200) || 200, 1000)

    const events = await prisma.evidenceEvent.findMany({
      where: { wallet: { in: wallets } },
      orderBy: [{ blockNumber: 'desc' }],
      take: limit,
    })

    res.json({
      clusterId: cluster.id,
      walletCount: wallets.length,
      eventCount: events.length,
      // Section 0.2 rule 3: provenance travels with the evidence, always.
      events: events.map((e) => ({
        id: e.id,
        chain: e.chain,
        wallet: e.wallet,
        counterparty: e.counterparty,
        eventType: e.eventType,
        protocol: e.protocol,
        protocolType: e.protocolType,
        amount: e.amount,
        timestamp: e.timestamp,
        blockNumber: e.blockNumber.toString(),
        transactionHash: e.transactionHash,
        sourceType: e.sourceType,
        deploymentId: e.deploymentId,
      })),
    })
  }),
)

apiRouter.get(
  '/receipts/:id',
  asyncHandler(async (req, res) => {
    const id = pathParam(req, 'id')
    const receipt = id ? await getReceipt(id) : null
    if (!receipt) {
      res.status(404).json({ error: 'not_found', message: 'No such evidence receipt.' })
      return
    }
    res.json(receipt)
  }),
)

// ---------------------------------------------------------------------------
// Investigations (Phase 15)
// ---------------------------------------------------------------------------

apiRouter.post(
  '/investigations',
  upstreamRateLimit,
  validateBody(investigationSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof investigationSchema>
    try {
      const started = await startInvestigation(body.clusterId)
      res.status(202).json({
        ...started,
        status: 'RUNNING',
        message: 'Investigation started. Poll GET /investigations/:id for the result.',
      })
    } catch (err) {
      if (err instanceof InvestigationError) throw new ClaimError(err.message, 404)
      throw err
    }
  }),
)

apiRouter.get(
  '/investigations/:id',
  asyncHandler(async (req, res) => {
    const id = pathParam(req, 'id')
    const investigation = id ? await getInvestigation(id) : null
    if (!investigation) {
      res.status(404).json({ error: 'not_found', message: 'No such investigation.' })
      return
    }
    res.json(investigation)
  }),
)

// ---------------------------------------------------------------------------
// Campaign metrics
// ---------------------------------------------------------------------------

apiRouter.get(
  '/campaigns/:id',
  asyncHandler(async (req, res) => {
    const campaignId = pathParam(req, 'id')
    if (!campaignId) {
      res.status(400).json({ error: 'invalid_request', message: 'Missing campaign id.' })
      return
    }

    const claims = await prisma.claim.findMany({
      where: { campaignId },
      select: { id: true, riskDecision: true, clusterId: true },
    })

    if (claims.length === 0) {
      res.status(404).json({ error: 'not_found', message: 'No claims recorded for this campaign.' })
      return
    }

    const challenges = await prisma.verificationChallenge.findMany({
      where: { claimId: { in: claims.map((c) => c.id) } },
      select: { status: true },
    })

    const tally = (values: readonly string[]): Record<string, number> =>
      values.reduce<Record<string, number>>((acc, value) => {
        acc[value] = (acc[value] ?? 0) + 1
        return acc
      }, {})

    const decisions = tally(claims.map((c) => c.riskDecision))

    res.json({
      campaignId,
      totalClaims: claims.length,
      decisions,
      challenges: tally(challenges.map((c) => c.status)),
      distinctClusters: new Set(claims.map((c) => c.clusterId).filter(Boolean)).size,
      // The escalation rate IS the product thesis, stated as a number: what
      // fraction of claimants were asked for biometrics at all.
      escalationRate: (decisions.CHALLENGE ?? 0) / claims.length,
    })
  }),
)
