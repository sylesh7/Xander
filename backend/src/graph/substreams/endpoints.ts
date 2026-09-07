/**
 * Substreams endpoint resolution — Backend-Suganthan.md Phase 9/10 groundwork.
 *
 * Endpoints are config, never a hardcoded map (Section 0.2 rule 1). Adding a
 * chain is an edit to SUBSTREAMS_ENDPOINTS, not a code change — and the spec is
 * explicit that these are third-party-hosted and "do move", so a hostname baked
 * into source would eventually be a silent outage.
 *
 * Format: `network=host:port` pairs, comma-separated.
 *   mainnet=eth.substreams.pinax.network:443,sepolia=sepolia.substreams.pinax.network:443
 *
 * Verified reachable from this machine on 2026-09-08:
 *   eth.substreams.pinax.network:443       (mainnet)
 *   sepolia.substreams.pinax.network:443   (sepolia)
 *   sepolia.eth.streamingfast.io:443       (sepolia, alternative provider)
 *   mainnet.eth.streamingfast.io:443       (mainnet, alternative provider)
 * Holesky (holesky.substreams.pinax.network) did NOT resolve — that testnet has
 * been sunset. Do not re-add it without checking.
 */
import { env } from '../../config/env.js'

export class SubstreamsEndpointError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubstreamsEndpointError'
  }
}

/**
 * Substreams speaks gRPC, so an endpoint is `host:port` with NO scheme.
 *
 * Pasting `https://eth.substreams.pinax.network` is the single most common way
 * to get this wrong, and the resulting gRPC failure is opaque. Reject it here
 * with a message that says what to do.
 */
export function assertEndpointShape(network: string, endpoint: string): string {
  if (/^[a-z]+:\/\//i.test(endpoint)) {
    throw new SubstreamsEndpointError(
      `Substreams endpoint for "${network}" has a URL scheme: "${endpoint}". ` +
        `Substreams is gRPC — use host:port with no https:// prefix ` +
        `(e.g. eth.substreams.pinax.network:443).`,
    )
  }
  if (!/^[A-Za-z0-9.-]+:\d+$/.test(endpoint)) {
    throw new SubstreamsEndpointError(
      `Substreams endpoint for "${network}" is not host:port: "${endpoint}".`,
    )
  }
  return endpoint
}

/**
 * Parses the `network=host:port,...` spec.
 *
 * A malformed entry throws rather than being skipped: silently dropping one
 * network would surface much later as "why is Sepolia not streaming?" with no
 * clue that its config line was mistyped.
 */
export function parseEndpoints(spec: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of spec.split(',')) {
    const entry = raw.trim()
    if (entry === '') continue

    const eq = entry.indexOf('=')
    if (eq === -1) {
      throw new SubstreamsEndpointError(
        `Malformed SUBSTREAMS_ENDPOINTS entry "${entry}". Expected network=host:port.`,
      )
    }

    const network = entry.slice(0, eq).trim()
    const endpoint = entry.slice(eq + 1).trim()
    if (network === '' || endpoint === '') {
      throw new SubstreamsEndpointError(
        `Malformed SUBSTREAMS_ENDPOINTS entry "${entry}". Expected network=host:port.`,
      )
    }
    if (out.has(network)) {
      throw new SubstreamsEndpointError(
        `Network "${network}" appears twice in SUBSTREAMS_ENDPOINTS. ` +
          `Which one wins would be arbitrary.`,
      )
    }
    out.set(network, assertEndpointShape(network, endpoint))
  }
  return out
}

/** Every configured network, from SUBSTREAMS_ENDPOINTS. */
export function configuredEndpoints(): Map<string, string> {
  const map = parseEndpoints(env.SUBSTREAMS_ENDPOINTS)
  // The spec's Section 0.6 SUBSTREAMS_ENDPOINT is kept as a single-endpoint
  // fallback so a config written against the original doc still works.
  if (map.size === 0 && env.SUBSTREAMS_ENDPOINT) {
    map.set(
      env.SUBSTREAMS_DEFAULT_NETWORK,
      assertEndpointShape(env.SUBSTREAMS_DEFAULT_NETWORK, env.SUBSTREAMS_ENDPOINT),
    )
  }
  return map
}

export function listSubstreamsNetworks(): string[] {
  return [...configuredEndpoints().keys()].sort()
}

/**
 * The endpoint for one network.
 *
 * Throws when the network is not configured, naming what IS available. Falling
 * back to some other chain's endpoint would stream the wrong chain's blocks
 * into the evidence table, which is far worse than a startup failure.
 */
export function resolveEndpoint(network?: string): string {
  const target = network ?? env.SUBSTREAMS_DEFAULT_NETWORK
  const map = configuredEndpoints()

  const endpoint = map.get(target)
  if (!endpoint) {
    const available = [...map.keys()].sort().join(', ') || '(none)'
    throw new SubstreamsEndpointError(
      `No Substreams endpoint configured for network "${target}". ` +
        `Configured: ${available}. Add it to SUBSTREAMS_ENDPOINTS.`,
    )
  }
  return endpoint
}
