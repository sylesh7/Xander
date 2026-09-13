/**
 * The console API client — `X-API-Key` auth, for `/v2/*` (except `/v2/control/*`)
 * and the V1 Claim Gate (`/screen-claim`, `/world/*`, `/receipts/*`, ...).
 *
 * Deliberately separate from `lib/api/authority.ts` — backendwiring.md rule 1:
 * "Build two API clients, not one. Never share a header builder between them."
 * Sending this surface's key to `/v2/control/*` is rejected by design.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'
const STORAGE_KEY = 'xander.console.apiKey'

export function getConsoleApiKey(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setConsoleApiKey(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, key)
  } catch {
    // Private window / storage blocked — the modal will just reappear next load.
  }
}

export function clearConsoleApiKey(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; message?: string; issues?: unknown } | null,
  ) {
    super(body?.message ?? `Request failed with ${status}`)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  /** Skip attaching the API key — used by nothing yet, kept for parity with authority.ts. */
  noAuth?: boolean
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, BASE_URL)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/**
 * Every response is parsed as JSON and returned alongside its status, because
 * this product's whole point is that 402/403/404/409/429 are designed results,
 * not exceptions — see Rule 3. Only a genuine network failure or 5xx throws.
 */
export async function consoleRequest<T>(path: string, opts: RequestOptions = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!opts.noAuth) {
    const key = getConsoleApiKey()
    if (key) headers['X-API-Key'] = key
  }

  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (res.status >= 500) {
    throw new ApiError(res.status, data)
  }

  return { status: res.status, data: data as T }
}

export const consoleApi = {
  get: <T>(path: string, query?: RequestOptions['query']) => consoleRequest<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => consoleRequest<T>(path, { method: 'POST', body }),
}
