/**
 * Temporal client — Xander V2 Phase 4.
 *
 * Lazily connected and cached. A cold connection on the first request is
 * cheaper than a connection attempt at import time, which would make the whole
 * API fail to boot whenever Temporal happens to be down — and section 29 wants
 * a dependency failure to degrade, not to take the process with it.
 */
import { Client, Connection } from '@temporalio/client'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

let client: Client | null = null
let connection: Connection | null = null

export class TemporalUnavailableError extends Error {
  constructor(cause: string) {
    super(`Temporal is unavailable: ${cause}`)
    this.name = 'TemporalUnavailableError'
  }
}

export function isTemporalEnabled(): boolean {
  return env.TEMPORAL_ENABLED
}

export async function getTemporalClient(): Promise<Client> {
  if (client) return client
  if (!env.TEMPORAL_ENABLED) throw new TemporalUnavailableError('TEMPORAL_ENABLED is false')

  try {
    connection = await Connection.connect({
      address: env.TEMPORAL_ADDRESS,
      connectTimeout: env.TEMPORAL_CONNECT_TIMEOUT_MS,
    })
    client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE })
    logger.info(
      { address: env.TEMPORAL_ADDRESS, namespace: env.TEMPORAL_NAMESPACE },
      'temporal client connected',
    )
    return client
  } catch (err) {
    throw new TemporalUnavailableError(err instanceof Error ? err.message : String(err))
  }
}

/** For graceful shutdown and tests. */
export async function closeTemporalClient(): Promise<void> {
  await connection?.close()
  connection = null
  client = null
}
