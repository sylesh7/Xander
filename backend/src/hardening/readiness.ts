/**
 * Readiness — Xander V2 spec section 33, Phase 12 (worker autoscaling,
 * Temporal worker HA, backup/recovery).
 *
 * LIVENESS AND READINESS ARE DIFFERENT QUESTIONS and conflating them is the
 * classic way to build an outage:
 *
 *   /health  (liveness)  "is this process alive?"    -> restart me if not
 *   /ready   (readiness) "should I get traffic?"     -> route around me if not
 *
 * A liveness probe that fails when Postgres is down restarts every replica in
 * a loop while the database recovers, turning a dependency blip into a total
 * outage. `/health` therefore stays `ok: true` for a running process, exactly
 * as it always has, and this is the separate endpoint an orchestrator uses to
 * decide whether to send work.
 *
 * Readiness reports each dependency ALONGSIDE its degradation policy, so an
 * operator reading it sees not just "Redis is down" but what that means for
 * authorization.
 */
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { policyFor, type DegradedBehaviour } from './dependency-policy.js'

export interface DependencyStatus {
  dependency: string
  up: boolean
  /** What its being down means. Null when it is up. */
  degradedBehaviour: DegradedBehaviour | null
  detail: string
}

export interface ReadinessReport {
  /** Should this instance receive traffic? */
  ready: boolean
  /** Can it still GRANT authorizations, or only refuse them? */
  canAuthorize: boolean
  dependencies: DependencyStatus[]
  /** One line an operator can page on. */
  summary: string
}

const TIMEOUT_MS = 3000

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Probes every dependency that can be checked cheaply.
 *
 * Deliberately does NOT probe the chain RPCs, the Graph or World: those cost
 * quota or gas, and a readiness endpoint scraped every few seconds must not
 * burn a rate limit. Their failure policy is still reported, and the freshness
 * guard already catches them on the request path where it matters.
 */
export async function checkReadiness(): Promise<ReadinessReport> {
  const dependencies: DependencyStatus[] = []

  // --- Postgres: the only hard requirement ---------------------------------
  let postgresUp = false
  let postgresDetail = ''
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 'postgres')
    postgresUp = true
    postgresDetail = 'reachable'
  } catch (err) {
    postgresDetail = err instanceof Error ? err.message : String(err)
  }
  dependencies.push({
    dependency: 'POSTGRES',
    up: postgresUp,
    degradedBehaviour: postgresUp ? null : policyFor('POSTGRES').behaviour,
    detail: postgresDetail,
  })

  // --- Redis: optional, and its absence is not an outage -------------------
  let redisUp = false
  let redisDetail = 'not checked'
  // A short-lived probe connection rather than the risk cache's own client:
  // that client is private to the cache module, and a probe that borrowed it
  // could mask a cache-level connection fault by testing a different socket.
  const { default: Redis } = await import('ioredis')
  const probe = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    // ioredis emits 'error' on an EventEmitter; without a listener that crashes
    // the process, which is a spectacular way for a health probe to fail.
    enableOfflineQueue: false,
  })
  probe.on('error', () => undefined)
  try {
    await withTimeout(probe.connect(), 'redis')
    await withTimeout(probe.ping(), 'redis')
    redisUp = true
    redisDetail = 'reachable'
  } catch (err) {
    redisDetail = err instanceof Error ? err.message : String(err)
  } finally {
    probe.disconnect()
  }
  dependencies.push({
    dependency: 'REDIS',
    up: redisUp,
    degradedBehaviour: redisUp ? null : policyFor('REDIS').behaviour,
    detail: redisDetail,
  })

  // --- Temporal: durability, not availability ------------------------------
  let temporalUp = false
  let temporalDetail = 'disabled'
  if (env.TEMPORAL_ENABLED) {
    try {
      const { getTemporalClient } = await import('../workflow/temporal-client.js')
      const client = await withTimeout(getTemporalClient(), 'temporal')
      await withTimeout(
        client.workflowService.getSystemInfo({}) as unknown as Promise<unknown>,
        'temporal',
      )
      temporalUp = true
      temporalDetail = `reachable at ${env.TEMPORAL_ADDRESS}`
    } catch (err) {
      temporalDetail = err instanceof Error ? err.message : String(err)
    }
  }
  dependencies.push({
    dependency: 'TEMPORAL',
    up: temporalUp,
    degradedBehaviour: temporalUp ? null : policyFor('TEMPORAL').behaviour,
    detail: temporalDetail,
  })

  // Readiness is Postgres alone: everything else degrades to a defined, safe
  // behaviour rather than an incorrect answer, so routing traffic away for them
  // would reduce availability without improving safety.
  const ready = postgresUp
  const canAuthorize = postgresUp

  return {
    ready,
    canAuthorize,
    dependencies,
    summary: ready
      ? canAuthorize
        ? 'ready'
        : 'ready, but authorizations will hold for review'
      : `NOT READY: ${dependencies.filter((d) => !d.up).map((d) => d.dependency).join(', ')} unreachable`,
  }
}
