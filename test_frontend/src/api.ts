/**
 * Thin, typed wrapper over Xander's real Claim Gate API.
 *
 * Every shape here matches backend/docs/API-CONTRACT.md exactly — this file
 * is deliberately not more clever than the contract it reflects, since the
 * whole point of this page is to catch drift between the two.
 */

export interface AppConfig {
  baseUrl: string
  apiKey: string
}

export type Decision = 'ALLOW' | 'CHALLENGE' | 'BLOCK' | 'PENDING_REVIEW'

export interface IdKitConfig {
  app_id: string
  rp_id: string
  action: string
  preset: string
  signal: string
  allow_legacy_proofs: true
}

export interface ScreenClaimResponse {
  claimId: string
  decision: Decision
  clusterId: string | null
  riskScore: number
  requiredAssurance: 'SELFIE_CHECK' | null
  evidenceReceiptId: string | null
  verificationChallengeId: string | null
  idkit: IdKitConfig | null
  reason: string
  cached: boolean
}

export interface RpSignatureResponse {
  sig: string
  nonce: string
  createdAt: number
  expiresAt: number
  created_at: number
  expires_at: number
}

export interface VerifyResponse {
  status: 'PASSED' | 'FAILED' | 'RETRYABLE'
  challengeId: string
  reason: string
}

export interface ChallengeResponse {
  claimId: string
  challengeId: string
  reused: boolean
  idkit: IdKitConfig | null
}

export interface FinalizeResponse {
  claimId: string
  decision: 'ALLOW' | 'BLOCK' | Decision
  evidenceReceiptId: string | null
  worldChallengeId: string | null
  reason: string
}

export interface ReceiptResponse {
  id: string
  claimId: string
  wallet: string
  clusterId: string | null
  decision: string
  riskScore: number
  confidence: string
  features: Array<{ name: string; value: number }>
  sources: Array<{ type: string; deployment: string | null; block: string | null }>
  policyVersion: string
  requiredAssurance: string | null
  worldChallengeId: string | null
  createdAt: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Xander's routes do not all use the same error-body shape — most use
 * `{ error, message }`, but `/world/verify`'s non-2xx responses are the real
 * `VerifyResult` shape, `{ status, challengeId, reason }`, with no `message`
 * key at all. Checking only `message` silently swallowed World's actual
 * rejection detail (surfaced via the backend's own `reason` field) and showed
 * a useless generic "HTTP 400" instead — found by testing against a real
 * proof that World genuinely rejected, where the real reason was the one
 * thing worth seeing.
 */
function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    for (const key of ['message', 'reason', 'error']) {
      const value = record[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  return `HTTP ${status}`
}

/** Called around every request so the page can render a live activity log. */
export type RequestLogger = (entry: {
  method: string
  path: string
  requestBody: unknown
  status: number | null
  responseBody: unknown
  ok: boolean
  durationMs: number
}) => void

async function call<T>(
  config: AppConfig,
  method: string,
  path: string,
  body: unknown,
  onLog?: RequestLogger,
): Promise<T> {
  const started = performance.now()
  let status: number | null = null
  let responseBody: unknown = null
  let ok = false

  try {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(path === '/health' ? {} : { 'X-API-Key': config.apiKey }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    status = res.status
    ok = res.ok
    responseBody = await res.json().catch(() => null)

    if (!res.ok) {
      throw new ApiError(extractErrorMessage(responseBody, res.status), res.status, responseBody)
    }
    return responseBody as T
  } finally {
    onLog?.({
      method,
      path,
      requestBody: body ?? null,
      status,
      responseBody,
      ok,
      durationMs: Math.round(performance.now() - started),
    })
  }
}

export const api = {
  health: (config: AppConfig, onLog?: RequestLogger) =>
    call<{ ok: boolean; provenance: unknown }>(config, 'GET', '/health', undefined, onLog),

  screenClaim: (
    config: AppConfig,
    body: { wallet: string; campaignId: string },
    onLog?: RequestLogger,
  ) => call<ScreenClaimResponse>(config, 'POST', '/screen-claim', body, onLog),

  rpSignature: (config: AppConfig, body: { action: string }, onLog?: RequestLogger) =>
    call<RpSignatureResponse>(config, 'POST', '/world/rp-signature', body, onLog),

  worldVerify: (
    config: AppConfig,
    body: { claimId: string; idkitResponse: unknown; rp_id?: string },
    onLog?: RequestLogger,
  ) => call<VerifyResponse>(config, 'POST', '/world/verify', body, onLog),

  reissueChallenge: (config: AppConfig, body: { claimId: string }, onLog?: RequestLogger) =>
    call<ChallengeResponse>(config, 'POST', '/world/challenge', body, onLog),

  finalize: (config: AppConfig, body: { claimId: string }, onLog?: RequestLogger) =>
    call<FinalizeResponse>(config, 'POST', '/claim/finalize', body, onLog),

  receipt: (config: AppConfig, id: string, onLog?: RequestLogger) =>
    call<ReceiptResponse>(config, 'GET', `/receipts/${id}`, undefined, onLog),
}
