/**
 * The Remote Authority API client — `Authorization: Bearer <token>` +
 * `X-Device-Id: <id>`, for `/v2/control/*` only.
 *
 * A completely separate credential from `lib/api/console.ts`'s API key —
 * sending the console key here is rejected by design (spec 27.1: never reuse
 * a static protocol key as a mobile-user credential). Never share a header
 * builder between these two clients.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'
const TOKEN_KEY = 'xander.authority.token'
const EXPIRES_KEY = 'xander.authority.expiresAt'
const DEVICE_KEY = 'xander.authority.deviceId'

export function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  try {
    let id = window.localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

export interface AuthoritySession {
  token: string
  expiresAt: string
}

export function getSession(): AuthoritySession | null {
  if (typeof window === 'undefined') return null
  try {
    const token = window.localStorage.getItem(TOKEN_KEY)
    const expiresAt = window.localStorage.getItem(EXPIRES_KEY)
    if (!token || !expiresAt) return null
    return { token, expiresAt }
  } catch {
    return null
  }
}

export function setSession(session: AuthoritySession): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TOKEN_KEY, session.token)
    window.localStorage.setItem(EXPIRES_KEY, session.expiresAt)
  } catch {
    // ignore
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(TOKEN_KEY)
    window.localStorage.removeItem(EXPIRES_KEY)
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error?: string; message?: string } | null,
  ) {
    super(body?.message ?? `Request failed with ${status}`)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
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

export async function authorityRequest<T>(path: string, opts: RequestOptions = {}): Promise<{ status: number; data: T }> {
  const session = getSession()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Id': getDeviceId(),
  }
  if (session) headers.Authorization = `Bearer ${session.token}`

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

export const authorityApi = {
  get: <T>(path: string, query?: RequestOptions['query']) => authorityRequest<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => authorityRequest<T>(path, { method: 'POST', body }),
  del: <T>(path: string) => authorityRequest<T>(path, { method: 'DELETE' }),
}
