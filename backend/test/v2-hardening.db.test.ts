/**
 * V2 Phase 12 — hardening against real Postgres and real HTTP. NO MOCKS.
 *
 * Covers the parts of production hardening that touch real state: retention,
 * readiness, API key rotation, index presence and enforcement reconciliation.
 *
 * The retention tests are the ones worth reading carefully. A deletion job is
 * the only code in this repo that can destroy evidence, so what it REFUSES to
 * delete matters more than what it removes.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'

const { app } = await import('../src/server.js')
const { prisma } = await import('../src/lib/prisma.js')
const { resolveActorForWallet } = await import('../src/actor/actor-resolver.js')
const { applyRetention, NEVER_PRUNED } = await import('../src/hardening/retention.js')
const { checkReadiness } = await import('../src/hardening/readiness.js')
const { reconcileEnforcement, repairDrift } = await import('../src/hardening/reconciliation.js')
const { acceptedBackendApiKeys } = await import('../src/config/env.js')

const createdActorIds: string[] = []
const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`

afterAll(async () => {
  await prisma.actor.deleteMany({ where: { id: { in: createdActorIds } } })
  await prisma.$disconnect()
})

async function actorWithSnapshots(count: number, ageDays: number): Promise<string> {
  const actor = await resolveActorForWallet(randomWallet())
  createdActorIds.push(actor.id)
  const old = new Date(Date.now() - ageDays * 86_400_000)
  await prisma.trustSnapshot.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      actorId: actor.id,
      overallBand: 'UNCERTAIN',
      engineVersion: 'test',
      policyVersion: 'test',
      dimensionsJson: {} as object,
      evidenceIds: [],
      createdAt: new Date(old.getTime() + i * 1000),
    })),
  })
  return actor.id
}

describe('V2 Phase 12 — retention', () => {
  it('DEFAULTS TO A DRY RUN', async () => {
    // A deletion job that runs for real unless told otherwise is one
    // misconfiguration away from destroying an audit trail.
    const actorId = await actorWithSnapshots(40, 200)
    const before = await prisma.trustSnapshot.count({ where: { actorId } })

    const report = await applyRetention()
    expect(report.dryRun).toBe(true)
    expect(await prisma.trustSnapshot.count({ where: { actorId } })).toBe(before)
  }, 120_000)

  it('prunes old snapshots but KEEPS THE NEWEST PER ACTOR', async () => {
    const actorId = await actorWithSnapshots(40, 200)
    await applyRetention({ dryRun: false })

    const remaining = await prisma.trustSnapshot.count({ where: { actorId } })
    // The configured keep-count, never zero.
    expect(remaining).toBeGreaterThan(0)
    expect(remaining).toBeLessThan(40)
  }, 120_000)

  it('NEVER DELETES AN ACTOR’S ONLY SNAPSHOT, however old', async () => {
    // Deleting the last snapshot makes an actor unmeasurable, which would turn
    // a cleanup job into a mass denial of service.
    const actorId = await actorWithSnapshots(1, 5000)
    await applyRetention({ dryRun: false })
    expect(await prisma.trustSnapshot.count({ where: { actorId } })).toBe(1)
  }, 120_000)

  it('keeps recent snapshots even for a very busy actor', async () => {
    const actorId = await actorWithSnapshots(50, 0)
    await applyRetention({ dryRun: false })
    // All are recent, so the age cutoff spares every one of them.
    expect(await prisma.trustSnapshot.count({ where: { actorId } })).toBe(50)
  }, 120_000)

  it('NEVER PRUNES A PENDING ACTION, at any age', async () => {
    // An unanswered action is a live obligation. Deleting it silently drops a
    // decision somebody owes.
    const actor = await resolveActorForWallet(randomWallet())
    createdActorIds.push(actor.id)
    const stale = await prisma.pendingAction.create({
      data: {
        subjectType: 'AGENT',
        subjectId: 'x',
        summary: 'ancient but unanswered',
        allowed: ['APPROVE'],
        actorId: actor.id,
        bindingHash: 'a'.repeat(64),
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 999 * 86_400_000),
        createdAt: new Date(Date.now() - 999 * 86_400_000),
      },
    })
    await applyRetention({ dryRun: false })
    expect(await prisma.pendingAction.findUnique({ where: { id: stale.id } })).not.toBeNull()
    await prisma.pendingAction.delete({ where: { id: stale.id } })
  }, 120_000)

  it('states what it will never delete', () => {
    // "Which tables are permanent?" is a security-review question and deserves
    // an answer in code, not a comment.
    expect(NEVER_PRUNED.some((n) => n.startsWith('ActionReceipt'))).toBe(true)
    expect(NEVER_PRUNED.some((n) => n.startsWith('AuthorizationDecision'))).toBe(true)
    expect(NEVER_PRUNED.some((n) => n.startsWith('EvidenceEvent'))).toBe(true)
    expect(NEVER_PRUNED.some((n) => n.startsWith('Incident'))).toBe(true)
  })

  it('reports per table rather than one opaque number', async () => {
    const report = await applyRetention()
    const tables = report.results.map((r) => r.table)
    expect(tables).toContain('TrustSnapshot')
    expect(tables).toContain('OperatorAuditLog')
    for (const r of report.results) expect(r.kept.length).toBeGreaterThan(5)
  }, 90_000)
})

describe('V2 Phase 12 — readiness', () => {
  it('reports ready when Postgres is reachable', async () => {
    const report = await checkReadiness()
    expect(report.ready).toBe(true)
    expect(report.canAuthorize).toBe(true)
    expect(report.dependencies.some((d) => d.dependency === 'POSTGRES' && d.up)).toBe(true)
  }, 60_000)

  it('names the degraded behaviour for anything that is down', async () => {
    const report = await checkReadiness()
    for (const d of report.dependencies) {
      // Up means no degradation; down must say what the degradation IS.
      if (d.up) expect(d.degradedBehaviour).toBeNull()
      else expect(d.degradedBehaviour).not.toBeNull()
    }
  }, 60_000)

  it('serves /ready WITHOUT an API key, separately from /health', async () => {
    // A probe that needs a credential silently stops working when that
    // credential rotates.
    const ready = await request(app).get('/ready')
    expect(ready.status).toBe(200)
    expect(ready.body.ready).toBe(true)

    const health = await request(app).get('/health')
    expect(health.status).toBe(200)
    expect(health.body.ok).toBe(true)
  }, 60_000)
})

describe('V2 Phase 12 — secrets rotation', () => {
  it('accepts the primary key', async () => {
    const res = await request(app).get('/v2/incidents').set('X-API-Key', 'test-api-key')
    expect(res.status).toBe(200)
  }, 60_000)

  it('still refuses a wrong key', async () => {
    const res = await request(app).get('/v2/incidents').set('X-API-Key', 'not-the-key')
    expect(res.status).toBe(401)
  }, 60_000)

  it('NEVER ACCEPTS AN EMPTY KEY, even with a trailing comma in the rotation list', async () => {
    // A blank entry would otherwise match a request sending no key at all.
    const keys = acceptedBackendApiKeys()
    expect(keys.every((k) => k.length > 0)).toBe(true)
    expect(keys).not.toContain('')
  })

  it('always includes the primary key', () => {
    expect(acceptedBackendApiKeys()).toContain('test-api-key')
  })
})

describe('V2 Phase 12 — enforcement reconciliation', () => {
  it('runs and reports without transacting', async () => {
    const report = await reconcileEnforcement({ limit: 5 })
    expect(report).toHaveProperty('drift')
    expect(report).toHaveProperty('checkedAgents')
    expect(typeof report.summary).toBe('string')
  }, 120_000)

  it('DEFAULTS TO A DRY RUN and repairs nothing', async () => {
    // Repair means real on-chain transactions. A reconciler that transacts
    // unless told not to is one bad read away from a lot of gas.
    const report = await reconcileEnforcement({ limit: 5 })
    const result = await repairDrift(report)
    expect(result.repaired).toBe(0)
  }, 120_000)

  it('only ever repairs by REVOKING, never by granting', async () => {
    // Direction is one-way on purpose: a bug that dropped a capability locally
    // must not be "repaired" into re-granting authority nobody re-authorised.
    const fabricated = {
      checkedAgents: 1,
      checkedActions: 2,
      unreadable: false,
      summary: 'test',
      drift: [
        {
          kind: 'CHAIN_MISSING' as const,
          agentId: 'a',
          actorId: 'b',
          label: 'l',
          actionType: 'TRADE',
          urgent: false,
          detail: 'x',
        },
      ],
    }
    const result = await repairDrift(fabricated)
    // CHAIN_MISSING is not repairable at all.
    expect(result.repaired).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.details).toEqual([])
  }, 60_000)

  it('marks chain-excess as urgent and chain-missing as not', async () => {
    // The chain granting MORE than Xander is a live hole; the reverse is
    // already refused by the Phase 8 execution gate.
    const report = await reconcileEnforcement({ limit: 10 })
    for (const d of report.drift) {
      if (d.kind === 'CHAIN_EXCESS') expect(d.urgent).toBe(true)
      if (d.kind === 'CHAIN_MISSING') expect(d.urgent).toBe(false)
    }
  }, 120_000)
})

describe('V2 Phase 12 — required indexes exist in the database', () => {
  /** Reads the real indexes Postgres has, not what the schema file claims. */
  async function indexesFor(table: string): Promise<string[]> {
    const rows = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = $1`,
      table,
    )
    return rows.map((r) => r.indexdef)
  }

  /**
   * Does an index definition cover these columns?
   *
   * Postgres only QUOTES identifiers that need it, so a camelCase column shows
   * as `"actorId"` while a lowercase one shows as bare `kind`. Matching only
   * the quoted form silently found nothing and made this whole test vacuous.
   */
  const covers = (indexdef: string, columns: string[]): boolean =>
    columns.every((c) => new RegExp(`[(,]\\s*"?${c}"?[\\s,)]`).test(indexdef))

  it('has section 26’s required indexes, verified against Postgres', async () => {
    // Asserted against pg_indexes rather than the schema file: a migration
    // that was written but never applied would pass a file check and fail here.
    const required: [string, string[]][] = [
      ['ActorIdentity', ['kind', 'externalId']],
      ['TrustSnapshot', ['actorId', 'createdAt']],
      ['Intent', ['actorId', 'status', 'expiresAt']],
      ['Capability', ['actorId', 'status', 'expiresAt']],
      ['AuthorizationDecision', ['intentId']],
      ['Incident', ['status', 'severity', 'openedAt']],
      ['ActionReceipt', ['intentId']],
      ['KnownFunderAddress', ['chain', 'address']],
    ]

    for (const [table, columns] of required) {
      const defs = await indexesFor(table)
      const found = defs.some((d) => covers(d, columns))
      expect(found, `${table}(${columns.join(', ')}) is missing`).toBe(true)
    }
  }, 120_000)

  it('has the Phase 12 hot-path indexes', async () => {
    const evidence = await indexesFor('EvidenceEvent')
    expect(
      evidence.some((d) => covers(d, ['wallet', 'timestamp'])),
      `EvidenceEvent(wallet, timestamp) is missing; have: ${evidence.join(' | ')}`,
    ).toBe(true)

    const wallet = await indexesFor('Wallet')
    expect(
      wallet.some((d) => covers(d, ['clusterId'])),
      `Wallet(clusterId) is missing; have: ${wallet.join(' | ')}`,
    ).toBe(true)
  }, 120_000)
})
