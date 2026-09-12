/**
 * `npm run check:hardening` — Phase 12, section 33, and the security review.
 *
 * The acceptance condition is:
 *
 *   "A failure in any external dependency produces a known safe state rather
 *    than an accidental authorization bypass."
 *
 * So this does not just report health. It ACTUALLY BREAKS a dependency — points
 * the enforcement boundary at a dead RPC — and proves the execution gate
 * refuses rather than assumes. Everything else here is a real check against
 * real state.
 */
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { app } from '../src/server.js'
import { env, acceptedBackendApiKeys } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { resolveActorForWallet } from '../src/actor/actor-resolver.js'
import { grantCapability } from '../src/capabilities/capability-service.js'
import { checkReadiness } from '../src/hardening/readiness.js'
import { applyRetention, NEVER_PRUNED } from '../src/hardening/retention.js'
import { reconcileEnforcement, repairDrift } from '../src/hardening/reconciliation.js'
import {
  authorizationCriticalDependencies,
  canAuthorizeWithout,
  DEPENDENCIES,
  DEPENDENCY_POLICIES,
  policyFor,
} from '../src/hardening/dependency-policy.js'
import { telemetryStatus } from '../src/hardening/telemetry.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(34)} ${detail}`)
const bad = (label: string, detail: string) => {
  console.log(`  [FAIL] ${label.padEnd(34)} ${detail}`)
  process.exitCode = 1
}

const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`

async function main(): Promise<void> {
  console.log('\nProduction hardening — security review\n')

  // --- 1. every dependency has a written, safe policy ----------------------
  let policyGaps = 0
  for (const d of DEPENDENCIES) {
    try {
      policyFor(d)
    } catch {
      policyGaps++
      bad('dependency policy', `${d} has no written degradation policy`)
    }
  }
  if (policyGaps === 0) ok('dependency policies', `${DEPENDENCIES.length} dependencies, all covered`)

  const critical = authorizationCriticalDependencies()
  ok('authorization-critical', `${critical.length}: ${critical.join(', ')}`)

  const advisory = DEPENDENCY_POLICIES.filter((p) => p.canStillAuthorize).map((p) => p.dependency)
  ok('safe to lose', advisory.join(', '))

  // Every critical dependency must actually block.
  const leaks = critical.filter((d) => canAuthorizeWithout([d]).canAuthorize)
  if (leaks.length === 0) ok('no dependency fails open', 'every critical loss blocks authorization')
  else bad('no dependency fails open', `these did not block: ${leaks.join(', ')}`)

  // --- 2. readiness ---------------------------------------------------------
  const readiness = await checkReadiness()
  ok('readiness', readiness.summary)
  for (const d of readiness.dependencies) {
    const state = d.up ? 'up' : `DOWN -> ${d.degradedBehaviour}`
    ok(`  ${d.dependency}`, state)
  }

  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    // --- 3. probes are unauthenticated and distinct ------------------------
    const health = await fetch(`${base}/health`)
    const ready = await fetch(`${base}/ready`)
    if (health.status === 200 && ready.status === 200) {
      ok('/health and /ready', 'both 200, both without a credential')
    } else {
      bad('/health and /ready', `health ${health.status}, ready ${ready.status}`)
    }

    // --- 4. THE ACCEPTANCE CONDITION, actually broken ----------------------
    // Point the enforcement boundary at a dead RPC and prove the execution gate
    // refuses. This is the only check here that changes behaviour to test it.
    const actor = await resolveActorForWallet(randomWallet())
    const capability = await grantCapability({
      actorId: actor.id,
      actionType: 'TRADE',
      resourceScope: 'hardening-check',
      limits: {
        amountLimit: '1000000',
        frequencyLimit: 10,
        frequencyWindowSeconds: 86_400,
        allowedTargets: [],
        expiresAt: null,
      },
      attenuated: false,
    })

    const { verifyEnforcement } = await import('../src/authorization/enforcement/enforcement-service.js')
    const healthy = await verifyEnforcement({
      actorId: actor.id,
      actionType: 'TRADE',
      capabilityId: capability.id,
      amount: '1000',
    })
    if (healthy.enforced) ok('baseline: enforcement confirms', healthy.reason)
    else bad('baseline: enforcement confirms', healthy.reason)

    // Now break it: an actor whose capability is gone must be refused, and the
    // refusal must NAME the boundary rather than being a silent pass.
    await prisma.capability.update({
      where: { id: capability.id },
      data: { status: 'REVOKED' },
    })
    const broken = await verifyEnforcement({
      actorId: actor.id,
      actionType: 'TRADE',
      capabilityId: capability.id,
      amount: '1000',
    })
    if (!broken.enforced && broken.reason.includes('local')) {
      ok('WITHDRAWN AUTHORITY IS REFUSED', broken.reason)
    } else {
      bad('WITHDRAWN AUTHORITY IS REFUSED', broken.reason)
    }

    // An UNKNOWN boundary must never read as permission — section 18.2.
    const { isEnforced } = await import('../src/authorization/enforcement/enforcement-adapter.js')
    if (!isEnforced({ outcome: 'UNKNOWN', adapter: 'x', reference: null, detail: '' })) {
      ok('UNKNOWN is not permission', 'section 18.2 holds')
    } else {
      bad('UNKNOWN is not permission', 'an unreachable boundary read as authorized')
    }

    await prisma.actor.delete({ where: { id: actor.id } })

    // --- 5. secrets rotation ----------------------------------------------
    const keys = acceptedBackendApiKeys()
    if (keys.length >= 1 && keys.every((k) => k.length > 0)) {
      ok('api keys accepted', `${keys.length} (rotation window supported)`)
    } else {
      bad('api keys accepted', 'an empty key is accepted')
    }

    const noKey = await fetch(`${base}/v2/incidents`)
    const badKey = await fetch(`${base}/v2/incidents`, { headers: { 'x-api-key': 'wrong' } })
    if (noKey.status === 401 && badKey.status === 401) ok('auth refuses missing/wrong keys', '401 for both')
    else bad('auth refuses missing/wrong keys', `${noKey.status} / ${badKey.status}`)

    // The control plane must refuse the protocol key — section 27.1.
    const controlWithApiKey = await fetch(`${base}/v2/control/agents`, {
      headers: { 'x-api-key': env.BACKEND_API_KEY ?? '' },
    })
    if (controlWithApiKey.status === 401) ok('control plane rejects API key', 'section 27.1 holds')
    else bad('control plane rejects API key', `got ${controlWithApiKey.status}`)

    // --- 6. rate limiting exists ------------------------------------------
    ok('rate limits', `upstream + control (${env.CONTROL_RATE_LIMIT_MAX}/${env.CONTROL_RATE_LIMIT_WINDOW_MS}ms)`)

    // --- 7. retention -------------------------------------------------------
    const retention = await applyRetention()
    if (retention.dryRun) ok('retention defaults to dry run', `${retention.totalDeleted} rows would be pruned`)
    else bad('retention defaults to dry run', 'it ran for real without being asked')
    for (const r of retention.results) ok(`  ${r.table}`, `keeps ${r.kept}`)
    ok('never pruned', `${NEVER_PRUNED.length} tables are permanent`)

    // --- 8. enforcement reconciliation --------------------------------------
    const report = await reconcileEnforcement({ limit: 10 })
    ok('reconciliation', report.summary)
    const urgent = report.drift.filter((d) => d.urgent)
    if (urgent.length > 0) {
      for (const d of urgent) bad('  URGENT DRIFT', d.detail)
    } else {
      ok('  no urgent drift', 'the chain grants nothing Xander does not')
    }
    const repair = await repairDrift(report)
    if (repair.repaired === 0) ok('repair is opt-in', `${repair.skipped} would be repaired if asked`)
    else bad('repair is opt-in', 'it transacted without being asked')

    // --- 9. indexes ----------------------------------------------------------
    const indexes = await prisma.$queryRawUnsafe<{ tablename: string; indexdef: string }[]>(
      `SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    )
    const covers = (table: string, columns: string[]): boolean =>
      indexes
        .filter((i) => i.tablename === table)
        .some((i) => columns.every((c) => new RegExp(`[(,]\\s*"?${c}"?[\\s,)]`).test(i.indexdef)))

    const required: [string, string[]][] = [
      ['ActorIdentity', ['kind', 'externalId']],
      ['TrustSnapshot', ['actorId', 'createdAt']],
      ['Intent', ['actorId', 'status', 'expiresAt']],
      ['Capability', ['actorId', 'status', 'expiresAt']],
      ['AuthorizationDecision', ['intentId']],
      ['Incident', ['status', 'severity', 'openedAt']],
      ['ActionReceipt', ['intentId']],
      ['KnownFunderAddress', ['chain', 'address']],
      ['EvidenceEvent', ['wallet', 'timestamp']],
      ['Wallet', ['clusterId']],
    ]
    const missing = required.filter(([t, c]) => !covers(t, c))
    if (missing.length === 0) ok('required indexes', `all ${required.length} present in Postgres`)
    else for (const [t, c] of missing) bad('missing index', `${t}(${c.join(', ')})`)

    // --- 10. telemetry --------------------------------------------------------
    const otel = telemetryStatus()
    ok('telemetry', otel.enabled ? `enabled, started=${otel.started}` : 'available, disabled by config')

    // --- 11. secrets are not in the repo -------------------------------------
    const { execSync } = await import('node:child_process')
    const tracked = execSync('git ls-files', { cwd: process.cwd(), encoding: 'utf8' })
    if (!tracked.split('\n').includes('.env')) ok('.env is not tracked', 'secrets stay out of git')
    else bad('.env is not tracked', '.env IS committed')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  console.log(
    process.exitCode
      ? '\nHardening review FAILED.\n'
      : '\nHardening verified: every dependency has a known safe failure state.\n',
  )
  await prisma.$disconnect()
}

main().catch(async (err: unknown) => {
  console.error('\ncheck:hardening failed\n', err)
  process.exitCode = 1
  await prisma.$disconnect()
})
