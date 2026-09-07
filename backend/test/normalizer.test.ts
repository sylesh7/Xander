import { describe, expect, it } from 'vitest'
import {
  normalizeDexEvents,
  normalizeLendingEvents,
  normalizeSubstreamsEvent,
  normalizeTokenApiTransfer,
  normalizeTokenApiTransfers,
  normalizeYieldEvents,
} from '../src/evidence/normalizer.js'
import { timestampFromSeconds } from '../src/evidence/types.js'
import type { TokenApiTransfer } from '../src/graph/token-api/types.js'

const WALLET = '0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa'
const FUNDER = '0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb'

const erc20 = (over: Partial<TokenApiTransfer> = {}): TokenApiTransfer =>
  ({
    kind: 'erc20',
    block_num: 21_000_000,
    datetime: '2026-01-01 00:00:00',
    timestamp: 1767225600,
    transaction_id: '0xTX1',
    log_index: 3,
    contract: '0xTOKEN',
    type: 'transfer',
    from: FUNDER,
    to: WALLET,
    amount: '1000000000000000000',
    network: 'mainnet',
    ...over,
  }) as TokenApiTransfer

const native = (over: Record<string, unknown> = {}): TokenApiTransfer =>
  ({
    kind: 'native',
    block_num: 20_999_000,
    datetime: '2026-01-01 00:00:00',
    timestamp: 1767225000,
    transaction_id: '0xTX0',
    transaction_index: 7,
    call_index: 1,
    type: 'call',
    from: FUNDER,
    to: WALLET,
    amount: '5000000000000000',
    network: 'mainnet',
    ...over,
  }) as TokenApiTransfer

const registry = {
  chain: 'mainnet',
  protocol: 'aave-v3',
  schemaFamily: 'lending-cdp',
  deploymentId: 'QmAave',
}

describe('timestampFromSeconds', () => {
  it('converts seconds to a Date', () => {
    expect(timestampFromSeconds(1767225600).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('accepts a numeric string, as The Graph returns', () => {
    expect(timestampFromSeconds('1767225600').getTime()).toBe(1767225600000)
  })

  it('throws rather than producing an Invalid Date', () => {
    // An Invalid Date would surface much later inside a timing correlation
    // with no clue where it came from.
    expect(() => timestampFromSeconds('not-a-number')).toThrow(/Invalid timestamp/)
  })
})

describe('normalizeTokenApiTransfer', () => {
  it('puts the perspective wallet in `wallet` and the other side in `counterparty`', () => {
    const e = normalizeTokenApiTransfer(erc20(), WALLET)
    expect(e.wallet).toBe(WALLET.toLowerCase())
    expect(e.counterparty).toBe(FUNDER.toLowerCase())
  })

  it('flips wallet/counterparty when normalized from the other end', () => {
    const e = normalizeTokenApiTransfer(erc20(), FUNDER)
    expect(e.wallet).toBe(FUNDER.toLowerCase())
    expect(e.counterparty).toBe(WALLET.toLowerCase())
  })

  it('lower-cases addresses so one wallet never appears under two spellings', () => {
    const e = normalizeTokenApiTransfer(erc20({ from: FUNDER.toUpperCase() }), WALLET)
    expect(e.counterparty).toBe(FUNDER.toLowerCase())
  })

  it('refuses a perspective that is neither side of the transfer', () => {
    // Normalizing it would invent a relationship the chain never recorded.
    expect(() => normalizeTokenApiTransfer(erc20(), '0xdeadbeef')).toThrow(/neither side/)
  })

  it('keeps amount as a string and block as a bigint', () => {
    const e = normalizeTokenApiTransfer(erc20(), WALLET)
    expect(typeof e.amount).toBe('string')
    expect(e.amount).toBe('1000000000000000000')
    expect(typeof e.blockNumber).toBe('bigint')
  })

  it('leaves protocol null — a plain transfer has none', () => {
    const e = normalizeTokenApiTransfer(erc20(), WALLET)
    expect(e.protocol).toBeNull()
    expect(e.protocolType).toBeNull()
    expect(e.deploymentId).toBeNull()
  })

  it('distinguishes two transfers in the SAME transaction via sourceId', () => {
    // Without the log index in sourceId these collide on the uniqueness key and
    // the second silently overwrites the first.
    const a = normalizeTokenApiTransfer(erc20({ log_index: 3 }), WALLET)
    const b = normalizeTokenApiTransfer(erc20({ log_index: 9 }), WALLET)
    expect(a.transactionHash).toBe(b.transactionHash)
    expect(a.sourceId).not.toBe(b.sourceId)
    expect(a.sourceId).toBe('0xTX1-3')
  })

  it('uses transaction+call index for native transfers, which have no log index', () => {
    const e = normalizeTokenApiTransfer(native(), WALLET)
    expect(e.sourceId).toBe('0xTX0-7-1')
  })

  it('normalizes a batch', () => {
    const out = normalizeTokenApiTransfers([erc20(), native()], WALLET)
    expect(out).toHaveLength(2)
    expect(out.every((e) => e.sourceType === 'token-api')).toBe(true)
  })
})

describe('normalizeSubgraphEvent', () => {
  const lendingEvent = {
    id: '0xTXA-12',
    hash: '0xTXA',
    blockNumber: '21000001',
    timestamp: '1767225700',
    amount: '2500000',
    account: { id: WALLET },
    market: { id: '0xMARKET' },
  }

  it('takes protocol and deployment from the registry, never the response', () => {
    // The response cannot vouch for which pinned deployment produced it.
    const [e] = normalizeLendingEvents([lendingEvent], 'deposit', registry)
    expect(e?.protocol).toBe('aave-v3')
    expect(e?.protocolType).toBe('lending-cdp')
    expect(e?.deploymentId).toBe('QmAave')
    expect(e?.sourceType).toBe('standardized-subgraph')
  })

  it('uses the market as counterparty for lending', () => {
    const [e] = normalizeLendingEvents([lendingEvent], 'deposit', registry)
    expect(e?.counterparty).toBe('0xmarket')
    expect(e?.eventType).toBe('deposit')
  })

  it('uses the pool as counterparty for dex-amm', () => {
    const [e] = normalizeDexEvents([{ ...lendingEvent, pool: { id: '0xPOOL' } }], 'swap', {
      ...registry,
      protocol: 'uniswap-v3',
      schemaFamily: 'dex-amm',
    })
    expect(e?.counterparty).toBe('0xpool')
    expect(e?.protocolType).toBe('dex-amm')
  })

  it('uses the vault as counterparty for yield-aggregator', () => {
    const [e] = normalizeYieldEvents([{ ...lendingEvent, vault: { id: '0xVAULT' } }], 'deposit', {
      ...registry,
      protocol: 'yearn-v2',
      schemaFamily: 'yield-aggregator',
    })
    expect(e?.counterparty).toBe('0xvault')
  })

  it('carries the subgraph entity id as sourceId', () => {
    const [e] = normalizeLendingEvents([lendingEvent], 'deposit', registry)
    expect(e?.sourceId).toBe('0xTXA-12')
  })

  it('tolerates a missing counterparty entity rather than throwing', () => {
    const { market: _market, ...noMarket } = lendingEvent
    const [e] = normalizeLendingEvents([noMarket], 'deposit', registry)
    expect(e?.counterparty).toBeNull()
  })
})

describe('normalizeSubstreamsEvent', () => {
  it('produces the same shape as the other two sources', () => {
    const e = normalizeSubstreamsEvent({
      chain: 'mainnet',
      wallet: WALLET,
      counterparty: FUNDER,
      eventType: 'transfer',
      amount: '42',
      timestamp: 1767225800,
      blockNumber: 21_000_002,
      transactionHash: '0xTXS',
      entityId: '0xTXS-0',
    })
    expect(e.sourceType).toBe('substreams')
    expect(e.wallet).toBe(WALLET.toLowerCase())
    expect(typeof e.blockNumber).toBe('bigint')
    expect(e.deploymentId).toBeNull()
  })

  it('accepts a bigint block number', () => {
    const e = normalizeSubstreamsEvent({
      chain: 'mainnet',
      wallet: WALLET,
      eventType: 'transfer',
      timestamp: '1767225800',
      blockNumber: 21_000_002n,
      transactionHash: '0xTXS',
      entityId: '0xTXS-1',
    })
    expect(e.blockNumber).toBe(21_000_002n)
  })
})

describe('all three sources converge on one shape', () => {
  it('downstream code cannot tell which Graph product produced a fact', () => {
    const fromToken = normalizeTokenApiTransfer(erc20(), WALLET)
    const [fromSubgraph] = normalizeLendingEvents(
      [
        {
          id: '0xTXA-1',
          hash: '0xTXA',
          blockNumber: '1',
          timestamp: '1767225700',
          amount: '1',
          account: { id: WALLET },
          market: { id: '0xM' },
        },
      ],
      'deposit',
      registry,
    )
    const fromSubstreams = normalizeSubstreamsEvent({
      chain: 'mainnet',
      wallet: WALLET,
      eventType: 'transfer',
      timestamp: 1,
      blockNumber: 1,
      transactionHash: '0xTXS',
      entityId: '0xTXS-0',
    })

    const keys = (o: object) => Object.keys(o).sort().join(',')
    expect(keys(fromToken)).toBe(keys(fromSubstreams))
    expect(keys(fromToken)).toBe(keys(fromSubgraph!))
  })
})
