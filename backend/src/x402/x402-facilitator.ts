/**
 * The x402 facilitator client — spec section 17.
 *
 * A thin typed wrapper over the documented REST interface (`POST /verify`,
 * `POST /settle`, `GET /supported`), which is backend rule 2's prescribed
 * answer when there is no confirmed SDK: the wrapper IS the permanent solution,
 * not a placeholder for one.
 *
 * The facilitator is the party that checks the signature and moves the money.
 * Xander does not hold funds and does not broadcast the transfer itself.
 */
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'
import {
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequirements,
  type SettlementResponse,
  type VerifyResponse,
} from './x402-types.js'

export class FacilitatorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'FacilitatorError'
  }
}

export interface SupportedKind {
  x402Version: number
  scheme: string
  network: string
  extra?: Record<string, unknown>
}

function facilitatorUrl(path: string): string {
  return `${env.X402_FACILITATOR_URL.replace(/\/$/, '')}${path}`
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.X402_FACILITATOR_TIMEOUT_MS)
  try {
    const response = await fetch(facilitatorUrl(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new FacilitatorError(
        `facilitator ${path} returned ${response.status}: ${text.slice(0, 300)}`,
        response.status,
      )
    }
    return JSON.parse(text) as T
  } catch (err) {
    if (err instanceof FacilitatorError) throw err
    const message = err instanceof Error ? err.message : String(err)
    // 503, not 500: the facilitator being unreachable is an upstream outage,
    // and section 0.2 rule 4 says an upstream failure holds the claim rather
    // than inventing a confident answer.
    throw new FacilitatorError(`facilitator ${path} unreachable: ${message}`, 503)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Checks a payment authorization WITHOUT moving money.
 *
 * Called before the protected work runs. Serving first and discovering the
 * signature was invalid afterwards would mean giving away the resource.
 */
export async function verifyPayment(args: {
  paymentPayload: PaymentPayload
  paymentRequirements: PaymentRequirements
}): Promise<VerifyResponse> {
  const result = await post<VerifyResponse>('/verify', {
    x402Version: X402_VERSION,
    paymentPayload: args.paymentPayload,
    paymentRequirements: args.paymentRequirements,
  })
  logger.info(
    { isValid: result.isValid, invalidReason: result.invalidReason, payer: result.payer },
    'x402 payment verified',
  )
  return result
}

/**
 * Broadcasts the transfer.
 *
 * Called AFTER the protected work succeeded. The ordering is deliberate: money
 * moves for a response that was actually produced, never for one that failed
 * on the way out.
 */
export async function settlePayment(args: {
  paymentPayload: PaymentPayload
  paymentRequirements: PaymentRequirements
}): Promise<SettlementResponse> {
  const result = await post<SettlementResponse>('/settle', {
    x402Version: X402_VERSION,
    paymentPayload: args.paymentPayload,
    paymentRequirements: args.paymentRequirements,
  })
  logger.info(
    { success: result.success, transaction: result.transaction, network: result.network },
    'x402 payment settled',
  )
  return result
}

/** What the facilitator can actually handle right now. */
export async function supportedKinds(): Promise<SupportedKind[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.X402_FACILITATOR_TIMEOUT_MS)
  try {
    const response = await fetch(facilitatorUrl('/supported'), { signal: controller.signal })
    if (!response.ok) {
      throw new FacilitatorError(`facilitator /supported returned ${response.status}`, response.status)
    }
    const body = (await response.json()) as { kinds?: SupportedKind[] }
    return body.kinds ?? []
  } catch (err) {
    if (err instanceof FacilitatorError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new FacilitatorError(`facilitator /supported unreachable: ${message}`, 503)
  } finally {
    clearTimeout(timeout)
  }
}

/** Does the facilitator support the scheme and network we are configured for? */
export async function facilitatorSupportsConfigured(): Promise<{
  supported: boolean
  detail: string
}> {
  const kinds = await supportedKinds()
  const match = kinds.find(
    (k) =>
      k.scheme === env.X402_SCHEME &&
      k.network === env.X402_NETWORK &&
      k.x402Version === X402_VERSION,
  )
  return {
    supported: Boolean(match),
    detail: match
      ? `${env.X402_SCHEME} on ${env.X402_NETWORK} (v${X402_VERSION})`
      : `facilitator does not advertise ${env.X402_SCHEME}/${env.X402_NETWORK} at v${X402_VERSION}`,
  }
}
