/**
 * Health data — Backend-Suganthan.md Phase 11.
 *
 * "Extend /health (owned by Sylesh's server.ts, but you own the data it
 * reports) to include: Token API last-successful-call timestamp, each
 * enabled deployment's block lag, Substreams cursor lag."
 *
 * Deliberately DB-only, no outbound network calls. A health endpoint that
 * hits the gateway or Token API on every poll is a real anti-pattern — it
 * turns routine monitoring into rate-limit risk and slow responses under
 * load. The live, network-calling check belongs to `freshness-guard.ts`,
 * which runs rarely (on a risk-computation cache miss); this runs on every
 * health poll, so it only reports what is already known in Postgres.
 *
 * "Block lag" per deployment here is intentionally NOT a live comparison —
 * it is the freshest block we have STORED evidence at, which is what an
 * operator staring at /health actually wants ("is data still arriving for
 * this deployment"), not a number that requires a live gateway round trip to
 * produce.
 */
import { env } from '../config/env.js'
import { prisma } from '../lib/prisma.js'
import { getDeployments } from '../graph/standardized-subgraphs/deployment-registry.js'

export interface DeploymentHealth {
  protocol: string
  chain: string
  schemaFamily: string
  deploymentId: string
  /** Highest block we have stored evidence for from this deployment. Null = never seen. */
  lastSeenBlock: string | null
  lastSeenAt: string | null
}

export interface SubstreamsHealth {
  chain: string
  moduleName: string
  blockNumber: string
  updatedAt: string
  lagSeconds: number
  stale: boolean
}

export interface ProvenanceHealth {
  tokenApi: {
    lastSuccessAt: string | null
    ageSeconds: number | null
    stale: boolean
  }
  deployments: DeploymentHealth[]
  substreams: SubstreamsHealth[]
}

export async function getProvenanceHealth(now: Date = new Date()): Promise<ProvenanceHealth> {
  const [tokenApiLatest, registry, substreamsCursors, evidenceByDeployment] = await Promise.all([
    prisma.evidenceEvent.findFirst({
      where: { sourceType: 'token-api' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    getDeployments(),
    prisma.substreamsCursor.findMany(),
    prisma.evidenceEvent.groupBy({
      by: ['deploymentId'],
      where: { sourceType: 'standardized-subgraph', deploymentId: { not: null } },
      _max: { blockNumber: true, createdAt: true },
    }),
  ])

  const tokenApiAge = tokenApiLatest
    ? (now.getTime() - tokenApiLatest.createdAt.getTime()) / 1000
    : null

  const evidenceByDeploymentId = new Map(evidenceByDeployment.map((e) => [e.deploymentId, e]))

  const deployments: DeploymentHealth[] = registry.map((entry) => {
    const seen = evidenceByDeploymentId.get(entry.deploymentId)
    return {
      protocol: entry.protocol,
      chain: entry.chain,
      schemaFamily: entry.schemaFamily,
      deploymentId: entry.deploymentId,
      lastSeenBlock: seen?._max.blockNumber != null ? seen._max.blockNumber.toString() : null,
      lastSeenAt: seen?._max.createdAt?.toISOString() ?? null,
    }
  })

  const substreams: SubstreamsHealth[] = substreamsCursors.map((c) => {
    const lagSeconds = (now.getTime() - c.updatedAt.getTime()) / 1000
    return {
      chain: c.chain,
      moduleName: c.moduleName,
      blockNumber: c.blockNumber.toString(),
      updatedAt: c.updatedAt.toISOString(),
      lagSeconds: Math.round(lagSeconds),
      stale: lagSeconds > env.FRESHNESS_MAX_STREAM_LAG_SECONDS,
    }
  })

  return {
    tokenApi: {
      lastSuccessAt: tokenApiLatest?.createdAt.toISOString() ?? null,
      ageSeconds: tokenApiAge !== null ? Math.round(tokenApiAge) : null,
      stale: tokenApiAge !== null ? tokenApiAge > env.FRESHNESS_MAX_EVIDENCE_AGE_SECONDS : true,
    },
    deployments,
    substreams,
  }
}
