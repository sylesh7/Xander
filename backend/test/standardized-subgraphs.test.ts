import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SubgraphQueryError,
  buildGatewayUrl,
  gatewayHeaders,
  gatewayPathFor,
  queryDeployment,
  queryFamily,
  withMeta,
} from '../src/graph/standardized-subgraphs/client.js'
import { getAccountActivityAcrossFamily as lendingActivity } from '../src/graph/standardized-subgraphs/queries/lending-cdp.js'
import { getAccountActivityAcrossFamily as dexActivity } from '../src/graph/standardized-subgraphs/queries/dex-amm.js'
import { getAccountActivityAcrossFamily as yieldActivity } from '../src/graph/standardized-subgraphs/queries/yield-aggregator.js'
import type { DeploymentEntry } from '../src/graph/standardized-subgraphs/types.js'

const entry = (over: Partial<DeploymentEntry> = {}): DeploymentEntry => ({
  id: 'reg1',
  protocol: 'aave-v3',
  chain: 'mainnet',
  schemaFamily: 'lending-cdp',
  deploymentId: 'QmPinnedDeployment',
  enabled: true,
  ...over,
})

function respond(data: unknown, meta?: unknown) {
  return new Response(
    JSON.stringify({ data: { ...(data as object), ...(meta ? { _meta: meta } : {}) } }),
    { status: 200 },
  )
}

const META_OK = {
  block: { number: 21000000, hash: '0xabc' },
  deployment: 'QmPinnedDeployment',
  hasIndexingErrors: false,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('gateway URL construction', () => {
  it('routes a Qm deployment id to /deployments/id/', () => {
    // The spec shows only /subgraphs/id/, but deployment ids and subgraph ids
    // are different identifier spaces and the gateway will not resolve a
    // deployment id under the subgraphs path.
    expect(gatewayPathFor('QmXyz')).toBe('deployments')
    expect(buildGatewayUrl('QmXyz')).toContain('/deployments/id/QmXyz')
  })

  it('routes a 0x-prefixed deployment hash to /deployments/id/', () => {
    expect(gatewayPathFor('0xdeadbeef')).toBe('deployments')
  })

  it('routes a base58 subgraph id to /subgraphs/id/', () => {
    expect(gatewayPathFor('5zvR82QoaXYFyDEKLZ9t')).toBe('subgraphs')
    expect(buildGatewayUrl('5zvR82QoaXYFyDEKLZ9t')).toContain('/subgraphs/id/')
  })

  it('keeps the API key OUT of the URL by default', () => {
    // Header auth is the documented method and stops the key leaking into
    // access logs, proxy logs and Referer headers.
    const url = buildGatewayUrl('QmXyz')
    expect(url).toBe('https://gateway.thegraph.com/api/deployments/id/QmXyz')
    expect(url).not.toContain('test-gateway-key')
  })

  it('sends the key as Authorization: Bearer', () => {
    expect(gatewayHeaders().Authorization).toBe('Bearer test-gateway-key')
    expect(gatewayHeaders()['Content-Type']).toBe('application/json')
  })

  it('actually sends the auth header on a query', async () => {
    let sent: Record<string, string> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: URL | string, init?: RequestInit) => {
        sent = (init?.headers ?? {}) as Record<string, string>
        return respond({ deposits: [] }, META_OK)
      }),
    )
    await queryDeployment(entry(), 'query { deposits { id } }')
    expect(sent.Authorization).toBe('Bearer test-gateway-key')
  })
})

describe('provenance is attached to every query', () => {
  it('appends _meta to any query body', () => {
    const q = withMeta('query { markets { id } }')
    expect(q).toContain('_meta { block { number hash } deployment hasIndexingErrors }')
  })

  it('captures block, hash and deployment from the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond({ deposits: [] }, META_OK)),
    )
    const { provenance } = await queryDeployment(entry(), 'query { deposits { id } }')
    expect(provenance.block).toBe('21000000')
    expect(provenance.blockHash).toBe('0xabc')
    expect(provenance.servedDeployment).toBe('QmPinnedDeployment')
    expect(provenance.deploymentMatches).toBe(true)
  })

  it('returns block numbers as strings, never numbers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond({ deposits: [] }, META_OK)),
    )
    const { provenance } = await queryDeployment(entry(), 'query { deposits { id } }')
    expect(typeof provenance.block).toBe('string')
  })

  it('flags a served deployment that does not match the pinned one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond({ deposits: [] }, { ...META_OK, deployment: 'QmSomethingElse' })),
    )
    const { provenance } = await queryDeployment(entry(), 'query { deposits { id } }')
    expect(provenance.deploymentMatches).toBe(false)
    expect(provenance.servedDeployment).toBe('QmSomethingElse')
  })

  it('treats a missing deployment in _meta as a mismatch, not a pass', async () => {
    // Failing closed: unproven provenance must never read as verified.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond({ deposits: [] }, { block: { number: 1 }, deployment: null })),
    )
    const { provenance } = await queryDeployment(entry(), 'query { deposits { id } }')
    expect(provenance.deploymentMatches).toBe(false)
  })

  it('surfaces hasIndexingErrors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond({ deposits: [] }, { ...META_OK, hasIndexingErrors: true })),
    )
    const { provenance } = await queryDeployment(entry(), 'query { deposits { id } }')
    expect(provenance.hasIndexingErrors).toBe(true)
  })

  it('does not leak _meta into the returned data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond({ deposits: [{ id: 'd1' }] }, META_OK)),
    )
    const { data } = await queryDeployment<{ deposits: unknown[] }>(
      entry(),
      'query { deposits { id } }',
    )
    expect(data).toEqual({ deposits: [{ id: 'd1' }] })
    expect('_meta' in data).toBe(false)
  })
})

describe('error handling', () => {
  it('raises SubgraphQueryError on GraphQL errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ errors: [{ message: 'bad field' }] }), { status: 200 }),
      ),
    )
    await expect(queryDeployment(entry(), 'query { nope }')).rejects.toBeInstanceOf(
      SubgraphQueryError,
    )
  })

  it('raises SubgraphQueryError on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    )
    await expect(queryDeployment(entry(), 'query { deposits { id } }')).rejects.toThrow(/HTTP 429/)
  })

  it('classifies 429 as rate limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('slow down', { status: 429 })),
    )
    const err = (await queryDeployment(entry(), 'query { a }').catch(
      (e: unknown) => e,
    )) as SubgraphQueryError
    expect(err.isRateLimited).toBe(true)
    expect(err.isAuthFailure).toBe(false)
    expect(err.isPaymentRequired).toBe(false)
  })

  it('classifies 402 as payment required, not an auth failure', async () => {
    // Unfunded gateway escrow / sender not whitelisted by Indexers. The
    // credential is fine; conflating this with 401 sends an operator hunting
    // a key problem that does not exist.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('payment required', { status: 402 })),
    )
    const err = (await queryDeployment(entry(), 'query { a }').catch(
      (e: unknown) => e,
    )) as SubgraphQueryError
    expect(err.isPaymentRequired).toBe(true)
    expect(err.isAuthFailure).toBe(false)
  })

  it('classifies 401/403 as auth failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    )
    const err = (await queryDeployment(entry(), 'query { a }').catch(
      (e: unknown) => e,
    )) as SubgraphQueryError
    expect(err.isAuthFailure).toBe(true)
  })

  it('one failing deployment does not abort the whole family', async () => {
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++
        return call === 1
          ? new Response('boom', { status: 500 })
          : respond({ deposits: [] }, META_OK)
      }),
    )
    const results = await queryFamily(
      [entry({ protocol: 'aave-v3' }), entry({ id: 'reg2', protocol: 'compound-v3' })],
      'query { deposits { id } }',
    )
    expect(results).toHaveLength(2)
    expect(results.filter((r) => 'error' in r)).toHaveLength(1)
    expect(results.filter((r) => 'result' in r)).toHaveLength(1)
  })
})

describe('one query module per SCHEMA FAMILY, not per protocol', () => {
  it('runs two different deployments through one function with no protocol branch', async () => {
    // This is the Phase 4 acceptance test, literally.
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        seen.push(url.toString())
        return respond(
          { account: null, deposits: [], borrows: [], repays: [], withdraws: [] },
          META_OK,
        )
      }),
    )

    const results = await lendingActivity('0xWALLET', {
      deployments: [
        entry({ protocol: 'aave-v3', deploymentId: 'QmAave' }),
        entry({ id: 'reg2', protocol: 'compound-v3', deploymentId: 'QmCompound' }),
      ],
    })

    expect(results).toHaveLength(2)
    expect(seen[0]).toContain('QmAave')
    expect(seen[1]).toContain('QmCompound')
  })

  it('lower-cases the account before querying', async () => {
    let body = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: URL | string, init?: RequestInit) => {
        body = String(init?.body ?? '')
        return respond(
          { account: null, deposits: [], borrows: [], repays: [], withdraws: [] },
          META_OK,
        )
      }),
    )
    await lendingActivity('0xAbCdEf', { deployments: [entry()] })
    expect(JSON.parse(body).variables.account).toBe('0xabcdef')
  })

  it('dex-amm queries pools and swaps, which lending has no equivalent of', async () => {
    let body = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: URL | string, init?: RequestInit) => {
        body = String(init?.body ?? '')
        return respond({ account: null, swaps: [], deposits: [], withdraws: [] }, META_OK)
      }),
    )
    await dexActivity('0xwallet', {
      deployments: [entry({ schemaFamily: 'dex-amm', deploymentId: 'QmUni' })],
    })
    const q = JSON.parse(body).query as string
    expect(q).toContain('swaps(')
    expect(q).toContain('pool { id name }')
    expect(q).not.toContain('market {')
  })

  it('yield-aggregator queries vaults and has no swap entity', async () => {
    let body = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: URL | string, init?: RequestInit) => {
        body = String(init?.body ?? '')
        return respond({ account: null, deposits: [], withdraws: [] }, META_OK)
      }),
    )
    await yieldActivity('0xwallet', {
      deployments: [entry({ schemaFamily: 'yield-aggregator', deploymentId: 'QmYearn' })],
    })
    const q = JSON.parse(body).query as string
    expect(q).toContain('vault { id name symbol }')
    expect(q).not.toContain('swaps(')
    expect(q).not.toContain('borrows(')
  })
})
