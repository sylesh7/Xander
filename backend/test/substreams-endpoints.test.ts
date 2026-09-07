import { describe, expect, it } from 'vitest'
import {
  SubstreamsEndpointError,
  assertEndpointShape,
  parseEndpoints,
} from '../src/graph/substreams/endpoints.js'

describe('endpoint shape', () => {
  it('accepts host:port', () => {
    expect(assertEndpointShape('mainnet', 'eth.substreams.pinax.network:443')).toBe(
      'eth.substreams.pinax.network:443',
    )
  })

  it('rejects an https:// prefix with an actionable message', () => {
    // The single most common way to get this wrong. Substreams is gRPC, and the
    // resulting failure is opaque if it reaches the transport.
    expect(() =>
      assertEndpointShape('mainnet', 'https://eth.substreams.pinax.network:443'),
    ).toThrow(/gRPC — use host:port/)
  })

  it('rejects a host with no port', () => {
    expect(() => assertEndpointShape('mainnet', 'eth.substreams.pinax.network')).toThrow(
      /not host:port/,
    )
  })
})

describe('parseEndpoints', () => {
  it('parses the configured mainnet + sepolia pair', () => {
    const map = parseEndpoints(
      'mainnet=eth.substreams.pinax.network:443,sepolia=sepolia.substreams.pinax.network:443',
    )
    expect(map.get('mainnet')).toBe('eth.substreams.pinax.network:443')
    expect(map.get('sepolia')).toBe('sepolia.substreams.pinax.network:443')
  })

  it('tolerates whitespace and trailing commas', () => {
    const map = parseEndpoints(' mainnet = host-a:443 , sepolia = host-b:443 , ')
    expect(map.size).toBe(2)
    expect(map.get('mainnet')).toBe('host-a:443')
  })

  it('returns an empty map for an empty spec', () => {
    expect(parseEndpoints('').size).toBe(0)
  })

  it('throws on a malformed entry rather than skipping it', () => {
    // Silently dropping a network surfaces much later as "why is Sepolia not
    // streaming?" with no clue the config line was mistyped.
    expect(() => parseEndpoints('mainnet=host:443,brokenentry')).toThrow(SubstreamsEndpointError)
  })

  it('throws on a duplicate network', () => {
    // Which one wins would be arbitrary.
    expect(() => parseEndpoints('mainnet=a:443,mainnet=b:443')).toThrow(/appears twice/)
  })

  it('validates every entry, not just the first', () => {
    expect(() => parseEndpoints('mainnet=host:443,sepolia=https://host:443')).toThrow(
      /gRPC — use host:port/,
    )
  })
})
