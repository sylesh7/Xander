/**
 * x402 protocol v2 wire types — Xander V2 spec sections 4.6 and 17.
 *
 * Transcribed from the authoritative specification in the Coinbase x402
 * repository (`specs/x402-specification-v2.md` and `specs/transports-v2/http.md`),
 * verified against the live facilitator at x402.org, which advertises
 * `x402Version: 2` and CAIP-2 network ids.
 *
 * WHY v2 AND NOT v1: the two versions are not compatible on the wire. v1 sends
 * `X-PAYMENT` and names networks `base-sepolia`; v2 sends `PAYMENT-SIGNATURE`
 * and names them `eip155:84532`. The live facilitator answers v2, so building
 * v1 would have targeted a protocol nothing we can reach still speaks.
 *
 * Pure: no network, no database, no clock. Everything here is shape and
 * encoding, so it is testable without touching a chain.
 */

/** The protocol version this module speaks. */
export const X402_VERSION = 2

/** Header names, exactly as the v2 HTTP transport defines them. */
export const X402_HEADERS = {
  /** Server -> client, on a 402. Base64 PaymentRequired. */
  REQUIRED: 'PAYMENT-REQUIRED',
  /** Client -> server. Base64 PaymentPayload. */
  SIGNATURE: 'PAYMENT-SIGNATURE',
  /** Server -> client, after settlement. Base64 SettlementResponse. */
  RESPONSE: 'PAYMENT-RESPONSE',
} as const

/** What a resource costs and how it may be paid. */
export interface PaymentRequirements {
  scheme: string
  /** CAIP-2, e.g. "eip155:84532" for Base Sepolia. */
  network: string
  /** Atomic token units, as a string. Never a number — this is a uint256. */
  amount: string
  asset: string
  payTo: string
  maxTimeoutSeconds: number
  extra?: Record<string, unknown>
}

export interface ResourceInfo {
  url: string
  description?: string
  mimeType?: string
}

/** The body of a 402. */
export interface PaymentRequired {
  x402Version: number
  error?: string
  resource: ResourceInfo
  accepts: PaymentRequirements[]
  extensions?: Record<string, unknown>
}

/** EIP-3009 `transferWithAuthorization` parameters. */
export interface Eip3009Authorization {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
}

export interface ExactEvmPayload {
  signature: string
  authorization: Eip3009Authorization
}

/** What the client sends back to prove it will pay. */
export interface PaymentPayload {
  x402Version: number
  resource?: ResourceInfo
  accepted: PaymentRequirements
  payload: ExactEvmPayload
  extensions?: Record<string, unknown>
}

export interface VerifyResponse {
  isValid: boolean
  invalidReason?: string
  payer?: string
}

export interface SettlementResponse {
  success: boolean
  errorReason?: string
  payer?: string
  transaction: string
  network: string
  amount?: string
  extensions?: Record<string, unknown>
}

/**
 * The EIP-712 types for `transferWithAuthorization`.
 *
 * Field ORDER is part of the signature: EIP-712 hashes the type string built
 * from this list, so reordering it produces a different digest and a signature
 * the token contract will reject. Kept here, once, rather than restated at each
 * signing site.
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

/** Base64 of the JSON encoding, which is how every x402 header travels. */
export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

/**
 * Decodes an x402 header, or returns null.
 *
 * Never throws. A malformed header is a client error to be reported as a 402
 * with a reason, not a 500 — and an exception escaping here would turn every
 * garbage header into an outage.
 */
export function decodeHeader<T>(header: string | undefined | null): T | null {
  if (!header) return null
  try {
    const json = Buffer.from(header, 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as T
  } catch {
    return null
  }
}

/** The chain id inside a CAIP-2 `eip155:*` network, or null. */
export function chainIdFromCaip2(network: string): number | null {
  const match = /^eip155:(\d+)$/.exec(network)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** CAIP-2 for an EVM chain id. */
export function caip2ForChainId(chainId: number): string {
  return `eip155:${chainId}`
}

/**
 * Is this payload structurally usable, and does it match what we asked for?
 *
 * Checked BEFORE the facilitator is called. The facilitator validates the
 * signature and the money; this validates that the client is answering the
 * question we actually asked. A payload that is perfectly signed but pays a
 * different recipient, or a smaller amount, is invalid here and must never
 * reach settlement.
 */
export function paymentMatchesRequirements(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): { ok: true } | { ok: false; reason: string } {
  if (payload.x402Version !== X402_VERSION) {
    return { ok: false, reason: `unsupported x402Version ${payload.x402Version}` }
  }
  if (payload.accepted?.scheme !== requirements.scheme) {
    return { ok: false, reason: `scheme mismatch: ${payload.accepted?.scheme}` }
  }
  if (payload.accepted.network !== requirements.network) {
    return { ok: false, reason: `network mismatch: ${payload.accepted.network}` }
  }
  if (payload.accepted.asset?.toLowerCase() !== requirements.asset.toLowerCase()) {
    return { ok: false, reason: 'asset mismatch' }
  }
  if (payload.accepted.payTo?.toLowerCase() !== requirements.payTo.toLowerCase()) {
    // The dangerous one. A client that redirects payment to itself would
    // otherwise settle a valid transfer that pays us nothing.
    return { ok: false, reason: 'payTo mismatch' }
  }

  const authorization = payload.payload?.authorization
  if (!authorization) return { ok: false, reason: 'missing authorization' }

  if (authorization.to?.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { ok: false, reason: 'authorization pays the wrong recipient' }
  }

  let value: bigint
  let required: bigint
  try {
    value = BigInt(authorization.value)
    required = BigInt(requirements.amount)
  } catch {
    return { ok: false, reason: 'unparseable amount' }
  }
  // At least, not exactly: overpayment is the client's business, underpayment
  // is ours.
  if (value < required) {
    return { ok: false, reason: `authorized ${value} is below the required ${required}` }
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(authorization.nonce)) {
    return { ok: false, reason: 'nonce must be 32 bytes of hex' }
  }
  if (!/^0x[0-9a-fA-F]+$/.test(payload.payload.signature ?? '')) {
    return { ok: false, reason: 'signature must be hex' }
  }

  return { ok: true }
}

/** True when the authorization window covers `now`. */
export function authorizationIsCurrent(
  authorization: Eip3009Authorization,
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  const seconds = Math.floor(now.getTime() / 1000)
  let after: number
  let before: number
  try {
    after = Number(BigInt(authorization.validAfter))
    before = Number(BigInt(authorization.validBefore))
  } catch {
    return { ok: false, reason: 'unparseable validity window' }
  }
  if (seconds < after) return { ok: false, reason: 'authorization is not yet valid' }
  if (seconds >= before) return { ok: false, reason: 'authorization has expired' }
  return { ok: true }
}
