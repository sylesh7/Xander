import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TokenApiError,
  getBalances,
  getFirstSeenBlock,
  getInboundTransfers,
  getNativeTransfers,
  getTransfers,
} from '../src/graph/token-api/client.js'

/** Captures the URLs the client builds so we can assert on query shape. */
function mockFetch(pages: unknown[][] | unknown[]) {
  const calls: string[] = []
  const queue = Array.isArray(pages[0]) ? ([...pages] as unknown[][]) : [pages as unknown[]]
  const fn = vi.fn(async (url: URL | string, _init?: RequestInit) => {
    calls.push(url.toString())
    const data = queue.length > 1 ? (queue.shift() ?? []) : (queue[0] ?? [])
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn }
}

const erc20 = (block: number, from: string, logIndex = 0) => ({
  block_num: block,
  datetime: '2026-01-01 00:00:00',
  timestamp: 1767225600,
  transaction_id: `0xtx${block}`,
  log_index: logIndex,
  contract: '0xcontract',
  type: 'transfer',
  from,
  to: '0xwallet',
  amount: '1000000',
  network: 'mainnet',
})

const native = (block: number, from: string) => ({
  block_num: block,
  datetime: '2026-01-01 00:00:00',
  timestamp: 1767225600,
  transaction_id: `0xntx${block}`,
  transaction_index: 0,
  call_index: 0,
  type: 'call',
  from,
  to: '0xwallet',
  amount: '5000000000000000',
  network: 'mainnet',
})

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Token API client — request shape', () => {
  it('sends the bearer token and Accept header', async () => {
    const { fn } = mockFetch([])
    await getTransfers({ toAddress: '0xwallet' })
    const init = fn.mock.calls[0]?.[1]
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toMatch(/^Bearer .+/)
    expect(headers.Accept).toBe('application/json')
  })

  it('uses to_address / from_address, never an `address` param', async () => {
    // The spec documents ?address= for this endpoint, which the API silently
    // ignores. Regression guard: funding evidence depends on to_address.
    const { calls } = mockFetch([])
    await getTransfers({ toAddress: '0xwallet' })
    const params = new URL(calls[0]!).searchParams
    expect(params.get('to_address')).toBe('0xwallet')
    expect(params.get('address')).toBeNull()
  })

  it('defaults to the configured network', async () => {
    const { calls } = mockFetch([])
    await getBalances('0xwallet')
    expect(new URL(calls[0]!).searchParams.get('network')).toBe('mainnet')
  })

  it('rejects an unsupported network instead of sending it', async () => {
    mockFetch([])
    await expect(getTransfers({ network: 'solana' })).rejects.toThrow(
      /Unsupported Token API network/,
    )
  })
})

describe('Token API client — plan limits', () => {
  it('clamps limit to the plan maximum rather than letting the API 403', async () => {
    const { calls } = mockFetch([])
    await getTransfers({ toAddress: '0xwallet', limit: 500 })
    expect(new URL(calls[0]!).searchParams.get('limit')).toBe('10')
  })

  it('surfaces a non-2xx response as TokenApiError with the status intact', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"status":403,"code":"forbidden"}', { status: 403 })),
    )
    const err = await getTransfers({ toAddress: '0xwallet' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TokenApiError)
    expect((err as TokenApiError).status).toBe(403)
    expect((err as TokenApiError).isAuthFailure).toBe(true)
    expect((err as TokenApiError).isRateLimited).toBe(false)
  })

  it('classifies 429 as rate limited, not auth failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('slow down', { status: 429 })),
    )
    const err = (await getNativeTransfers().catch((e: unknown) => e)) as TokenApiError
    expect(err.isRateLimited).toBe(true)
    expect(err.isAuthFailure).toBe(false)
  })
})

describe('Token API client — funding evidence', () => {
  it('merges ERC-20 and native transfers, oldest first', async () => {
    // Both endpoints are queried; return ERC-20 rows first, then native.
    const queue: unknown[][] = [[erc20(200, '0xfunderA')], [native(100, '0xfunderB')]]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const isNative = url.toString().includes('/native')
        return new Response(JSON.stringify({ data: isNative ? queue[1] : queue[0] }), {
          status: 200,
        })
      }),
    )

    const out = await getInboundTransfers('0xwallet')
    expect(out).toHaveLength(2)
    expect(out[0]?.block_num).toBe(100)
    expect(out[0]?.kind).toBe('native')
    expect(out[1]?.kind).toBe('erc20')
  })

  it('getFirstSeenBlock returns the earliest inbound block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const isNative = url.toString().includes('/native')
        const data = isNative ? [] : [erc20(500, '0xf', 1), erc20(300, '0xf', 0)]
        return new Response(JSON.stringify({ data }), { status: 200 })
      }),
    )
    expect(await getFirstSeenBlock('0xwallet')).toBe(300)
  })

  it('getFirstSeenBlock returns null for a wallet with no inbound history', async () => {
    mockFetch([])
    // null means "unknown" — callers must never coerce this to block 0.
    expect(await getFirstSeenBlock('0xwallet')).toBeNull()
  })

  it('caps each feed independently so native transfers are never crowded out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const isNative = url.toString().includes('/native')
        const rows = isNative
          ? [native(1, '0xgasFunder')]
          : Array.from({ length: 10 }, (_, i) => erc20(100 + i, '0xf', i))
        return new Response(JSON.stringify({ data: rows }), { status: 200 })
      }),
    )
    const out = await getInboundTransfers('0xwallet', { maxItemsPerSource: 10 })
    expect(out.some((t) => t.kind === 'native')).toBe(true)
    expect(out[0]?.kind).toBe('native')
  })

  it('stops paginating on a short page', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        calls++
        const data = url.toString().includes('/native') ? [] : [erc20(1, '0xf')]
        return new Response(JSON.stringify({ data }), { status: 200 })
      }),
    )
    await getInboundTransfers('0xwallet', { maxItemsPerSource: 50 })
    // 1 short ERC-20 page + 1 short native page = 2 requests, not 10.
    expect(calls).toBe(2)
  })
})
