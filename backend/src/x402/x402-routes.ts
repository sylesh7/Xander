/**
 * The x402-protected surface — Xander V2 spec section 17, Phase 9.
 *
 * NO API KEY. This router is mounted outside `/v2`'s `apiKeyAuth` on purpose:
 * in x402 the PAYMENT is the authorization, and requiring a pre-issued key
 * first would defeat the whole premise of an agent discovering a resource and
 * paying for it without a prior relationship.
 *
 * What replaces the key is the wallet: the address that signs the EIP-3009
 * authorization is the identity Xander prices, and section 17's ladder is
 * applied to that address's trust band.
 */
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../claim/middleware.js'
import { EVM_ADDRESS_PATTERN } from '../actor/actor-types.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import {
  authorizePaidRequest,
  requirementsFor,
  resourceUrl,
  X402Error,
  x402Availability,
} from './x402-service.js'
import { facilitatorSupportsConfigured } from './x402-facilitator.js'
import {
  decodeHeader,
  encodeHeader,
  X402_HEADERS,
  X402_VERSION,
  type PaymentPayload,
} from './x402-types.js'

export const x402Router: Router = Router()

/**
 * The caller's wallet.
 *
 * Taken from the signed authorization when one is present — that is the address
 * that will actually pay, and it cannot be spoofed without the private key. The
 * `X-Wallet` header is only consulted for the unpaid first request, where there
 * is no signature yet and the agent is merely asking for a price.
 */
function callerWallet(req: Request, payload: PaymentPayload | null): string | null {
  const fromAuthorization = payload?.payload?.authorization?.from
  if (fromAuthorization && EVM_ADDRESS_PATTERN.test(fromAuthorization)) {
    return fromAuthorization.toLowerCase()
  }
  const header = req.header('X-Wallet')
  if (header && EVM_ADDRESS_PATTERN.test(header)) return header.toLowerCase()
  return null
}

/**
 * A real protected resource: a wallet's live Xander risk summary.
 *
 * Chosen deliberately over a toy payload — it is genuinely something an agent
 * would pay for, and it makes the phase's point that Xander works outside
 * claims by selling the very thing Xander computes.
 */
const querySchema = z.object({
  wallet: z.string().regex(EVM_ADDRESS_PATTERN, 'wallet must be a 0x address'),
})

x402Router.get(
  '/x402/risk-report',
  asyncHandler(async (req: Request, res: Response) => {
    const unavailable = x402Availability()
    if (unavailable) {
      res.status(503).json({ error: 'x402_unavailable', message: unavailable })
      return
    }

    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', message: parsed.error.issues[0]?.message })
      return
    }

    const payload = decodeHeader<PaymentPayload>(req.header(X402_HEADERS.SIGNATURE))
    const wallet = callerWallet(req, payload)
    if (!wallet) {
      res.status(400).json({
        error: 'bad_request',
        message: `Provide an X-Wallet header, or a ${X402_HEADERS.SIGNATURE} header carrying a signed authorization.`,
      })
      return
    }

    const result = await authorizePaidRequest({
      wallet,
      path: '/x402/risk-report',
      paymentPayload: payload,
    })

    if (result.outcome === 'PAYMENT_REQUIRED' && result.paymentRequired) {
      res
        .status(402)
        .set(X402_HEADERS.REQUIRED, encodeHeader(result.paymentRequired))
        .json({
          error: 'payment_required',
          x402Version: X402_VERSION,
          trustBand: result.trustBand,
          reasonCode: result.reasonCode,
          allowanceRemaining: result.allowanceRemaining,
          // The body duplicates the header for human readability. The HEADER is
          // the protocol; a client must not depend on this body.
          accepts: result.paymentRequired.accepts,
        })
      return
    }

    if (result.outcome !== 'SETTLED') {
      res.status(result.status).json({
        error: result.outcome.toLowerCase(),
        message: result.detail,
        trustBand: result.trustBand,
        reasonCode: result.reasonCode,
        allowanceRemaining: result.allowanceRemaining,
      })
      return
    }

    // Paid for. Now actually do the work.
    const report = await buildRiskReport(parsed.data.wallet)

    res
      .status(200)
      .set(X402_HEADERS.RESPONSE, encodeHeader(result.settlement))
      .json({
        resource: resourceUrl('/x402/risk-report'),
        paidBy: result.settlement?.payer ?? null,
        transaction: result.settlement?.transaction ?? null,
        network: result.settlement?.network ?? null,
        allowanceRemaining: result.allowanceRemaining,
        report,
      })
  }),
)

/** The thing being sold: a live trust summary for a wallet. */
async function buildRiskReport(wallet: string): Promise<unknown> {
  const { resolveActorForWallet } = await import('../actor/actor-resolver.js')
  const { buildTrustContext } = await import('../trust/trust-context.js')
  const subject = await resolveActorForWallet(wallet)
  const trust = await buildTrustContext(subject.id)
  return {
    wallet: wallet.toLowerCase(),
    actorId: subject.id,
    band: trust.band,
    vector: trust.vector,
    drift: trust.drift,
    engineVersion: trust.engineVersion,
    policyVersion: trust.policyVersion,
    evidenceCount: trust.evidenceIds.length,
    generatedAt: new Date().toISOString(),
  }
}

/** What this resource costs and whether the facilitator can actually take it. */
x402Router.get(
  '/x402/info',
  asyncHandler(async (_req: Request, res: Response) => {
    const unavailable = x402Availability()
    if (unavailable) {
      res.status(503).json({ error: 'x402_unavailable', message: unavailable })
      return
    }
    let facilitator: { supported: boolean; detail: string }
    try {
      facilitator = await facilitatorSupportsConfigured()
    } catch (err) {
      facilitator = {
        supported: false,
        detail: err instanceof Error ? err.message : String(err),
      }
    }
    res.json({
      x402Version: X402_VERSION,
      resource: resourceUrl('/x402/risk-report'),
      accepts: [requirementsFor()],
      facilitator,
    })
  }),
)

/** An actor's payment history — the audit trail for agent commerce. */
x402Router.get(
  '/x402/payments/:actorId',
  asyncHandler(async (req: Request, res: Response) => {
    const payments = await prisma.x402Payment.findMany({
      where: { actorId: String(req.params.actorId) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({
      actorId: String(req.params.actorId),
      payments: payments.map((p) => ({
        id: p.id,
        status: p.status,
        reasonCode: p.reasonCode,
        trustBand: p.trustBand,
        amount: p.amount,
        network: p.network,
        transaction: p.transaction,
        errorReason: p.errorReason,
        createdAt: p.createdAt.toISOString(),
        settledAt: p.settledAt?.toISOString() ?? null,
      })),
    })
  }),
)

x402Router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err)
    return
  }
  if (err instanceof X402Error) {
    logger.warn({ err }, 'x402 request failed')
    res.status(err.status).json({ error: 'x402_error', message: err.message })
    return
  }
  next(err)
})
