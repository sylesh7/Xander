/**
 * The x402 client — NO auth header at all (backendwiring.md §0: "the payment
 * IS the auth"). A third, deliberately separate client from `console.ts` and
 * `authority.ts` — never share a header builder between these.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'

export const X402_HEADERS = {
  REQUIRED: 'PAYMENT-REQUIRED',
  SIGNATURE: 'PAYMENT-SIGNATURE',
  RESPONSE: 'PAYMENT-RESPONSE',
} as const

/** Base64 of UTF-8 JSON, matching the backend's `encodeHeader`/`decodeHeader` exactly. */
export function encodeX402Header(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

export function decodeX402Header<T>(header: string | null): T | null {
  if (!header) return null
  try {
    const binary = atob(header)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

export interface X402Response<T> {
  status: number
  data: T
  headers: Headers
}

export async function x402Request<T>(
  path: string,
  opts: { headers?: Record<string, string> } = {},
): Promise<X402Response<T>> {
  const res = await fetch(new URL(path, BASE_URL), { headers: opts.headers })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  return { status: res.status, data: data as T, headers: res.headers }
}
