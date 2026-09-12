/**
 * V2 Phase 10 — incidents against real Postgres and real HTTP. NO MOCKS.
 *
 * THE ACCEPTANCE CONDITION, asserted literally: a live anomaly produces a
 * traceable investigation that identifies SUPPORTING AND CONTRADICTING evidence
 * and feeds a DETERMINISTIC policy decision.
 *
 * The contradicting half is the part worth testing hardest. An investigator
 * that only finds support for its own hypothesis is a confirmation-bias engine,
 * and the Arbitrum false positive this whole project is built around is exactly
 * what that produces.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

const { app } = await import('../src/server.js')
const { prisma } = await import('../src/lib/prisma.js')
const { resolveActorForWallet } = await import('../src/actor/actor-resolver.js')
const { grantCapability } = await import('../src/capabilities/capability-service.js')
const { searchCounterEvidence } = await import('../src/incidents/counter-evidence.js')
const { openIncident, investigateIncident, decideIncident, resolveIncident, listIncidents } =
  await import('../src/incidents/incident-service.js')
const { resetKnownFunderCache } = await import('../src/risk/known-funders.js')

const KEY = 'test-api-key'
const auth = <T extends { set: (a: string, b: string) => T }>(req: T): T => req.set('X-API-Key', KEY)

const createdActorIds: string[] = []
const createdWallets: string[] = []
const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`

beforeAll(() => {
  resetKnownFunderCache()
})

afterAll(async () => {
  await prisma.evidenceEvent.deleteMany({ where: { wallet: { in: createdWallets } } })
  await prisma.incident.deleteMany({ where: { actorId: { in: createdActorIds } } })
  await prisma.actor.deleteMany({ where: { id: { in: createdActorIds } } })
  await prisma.$disconnect()
})

/**
 * Inserts evidence the same way the Token API sink does.
 *
 * sourceType is 'token-api', not 'substreams', for the reason Phase 7's suite
 * documents: substreams evidence needs a live cursor for its chain.
 */
async function insertEvidence(args: {
  wallet: string
  counterparty: string
  count: number
  protocol?: string
  startMsAgo?: number
  spacingMs?: number
  /** Known funders are keyed `chain|address`, so a labelled-funder test must
   *  insert evidence on the funder's OWN chain or the lookup silently misses. */
  chain?: string
}): Promise<void> {
  const now = Date.now()
  const start = args.startMsAgo ?? 3_600_000
  const spacing = args.spacingMs ?? 60_000
  await prisma.evidenceEvent.createMany({
    data: Array.from({ length: args.count }, (_, i) => ({
      chain: args.chain ?? 'seed',
      wallet: args.wallet.toLowerCase(),
      counterparty: args.counterparty.toLowerCase(),
      eventType: 'transfer',
      protocol: args.protocol ?? 'seed-protocol',
      protocolType: 'lending-cdp',
      amount: '1000000000000000000',
      timestamp: new Date(now - start + i * spacing),
      blockNumber: BigInt(8_000_000 + i),
      transactionHash: `0xinc${randomBytes(8).toString('hex')}${i}`,
      sourceType: 'token-api',
      sourceId: `0xinc${randomBytes(8).toString('hex')}${i}-0`,
      deploymentId: null,
    })),
    skipDuplicates: true,
  })
}

async function actorWithCapability(): Promise<{ actorId: string; wallet: string; capabilityId: string }> {
  const wallet = randomWallet()
  createdWallets.push(wallet.toLowerCase())
  const actor = await resolveActorForWallet(wallet)
  createdActorIds.push(actor.id)
  const capability = await grantCapability({
    actorId: actor.id,
    actionType: 'TRADE',
    resourceScope: 'incident-test',
    limits: {
      amountLimit: '1000000',
      frequencyLimit: 20,
      frequencyWindowSeconds: 86_400,
      allowedTargets: [],
      expiresAt: null,
    },
    attenuated: false,
  })
  return { actorId: actor.id, wallet, capabilityId: capability.id }
}

describe('V2 Phase 10 — THE ACCEPTANCE CONDITION', () => {
  it('AN ANOMALY PRODUCES A TRACEABLE INVESTIGATION WITH BOTH SIDES OF THE EVIDENCE', async () => {
    const { actorId, wallet } = await actorWithCapability()

    // Two wallets funded by a LABELLED exchange, acting months apart, on
    // different protocols — the Arbitrum shape, not a ring.
    const exchange = await prisma.knownFunderAddress.findFirst({ where: { category: 'EXCHANGE' } })
    await insertEvidence({
      wallet,
      counterparty: exchange?.address ?? randomWallet(),
      chain: exchange?.chain ?? 'seed',
      count: 12,
      protocol: 'aave-v3',
      startMsAgo: 200 * 86_400_000,
      spacingMs: 5 * 86_400_000,
    })

    const incident = await openIncident({
      actorId,
      type: 'COORDINATION_DETECTED',
      severity: 'HIGH',
      source: 'phase10-test',
      detail: 'shared funder detected',
    })
    expect(incident.status).toBe('OPEN')

    const result = await investigateIncident(incident.id)
    const investigation = await prisma.investigation.findUniqueOrThrow({
      where: { id: result.investigationId },
    })

    // BOTH sides are recorded, and both are traceable to real evidence rows.
    expect(investigation.supportingEvidenceIds.length).toBeGreaterThan(0)
    expect(investigation.contradictingEvidenceIds.length).toBeGreaterThan(0)
    expect(investigation.incidentId).toBe(incident.id)
    expect(investigation.hypothesis).toContain('COORDINATION_DETECTED')

    const supporting = await prisma.evidenceEvent.count({
      where: { id: { in: investigation.supportingEvidenceIds } },
    })
    expect(supporting).toBe(investigation.supportingEvidenceIds.length)

    // And it fed a DETERMINISTIC decision.
    const decided = await decideIncident({ incidentId: incident.id })
    expect(decided.reconciled.action).toBe('REVIEW') // HIGH severity
    expect(decided.incident.mitigation).toBe('RESTRICT')
    expect(decided.incident.mitigationReason).toContain('REVIEW')
  }, 120_000)

  it('CONTAINS BEFORE INVESTIGATING, not after', async () => {
    // Section 14.1's ordering. The capability must already be suspended by the
    // time `openIncident` returns — no investigation has run yet.
    const { actorId, capabilityId } = await actorWithCapability()
    expect((await prisma.capability.findUnique({ where: { id: capabilityId } }))!.status).toBe('ACTIVE')

    await openIncident({
      actorId,
      type: 'TRUST_COLLAPSE',
      severity: 'CRITICAL',
      source: 'phase10-test',
    })

    const after = await prisma.capability.findUnique({ where: { id: capabilityId } })
    expect(after!.status).toBe('REVOKED')
  }, 120_000)

  it('does not contain a LOW severity incident', async () => {
    const { actorId, capabilityId } = await actorWithCapability()
    await openIncident({ actorId, type: 'MANUAL', severity: 'LOW', source: 'phase10-test' })
    expect((await prisma.capability.findUnique({ where: { id: capabilityId } }))!.status).toBe('ACTIVE')
  }, 90_000)
})

describe('V2 Phase 10 — SECTION 15.3 against the real database', () => {
  it('APPLIES AN AI ESCALATION', async () => {
    const { actorId, capabilityId } = await actorWithCapability()
    const incident = await openIncident({
      actorId,
      type: 'ANOMALOUS_VELOCITY',
      severity: 'MEDIUM', // deterministic floor is LIMIT
      source: 'phase10-test',
    })

    const decided = await decideIncident({ incidentId: incident.id, aiRecommendation: 'BLOCK' })
    expect(decided.reconciled.action).toBe('BLOCK')
    expect(decided.reconciled.aiChangedOutcome).toBe(true)
    expect(decided.incident.mitigation).toBe('REVOKE')
    expect((await prisma.capability.findUnique({ where: { id: capabilityId } }))!.status).toBe('REVOKED')
  }, 120_000)

  it('IGNORES AN AI DE-ESCALATION AND STILL REVOKES', async () => {
    // The authorization-bypass test, end to end. A CRITICAL incident whose
    // investigator says ALLOW must still lose its capabilities.
    const { actorId, capabilityId } = await actorWithCapability()
    const incident = await openIncident({
      actorId,
      type: 'COORDINATION_DETECTED',
      severity: 'CRITICAL',
      source: 'phase10-test',
    })

    const decided = await decideIncident({ incidentId: incident.id, aiRecommendation: 'ALLOW' })

    expect(decided.reconciled.action).toBe('BLOCK')
    expect(decided.reconciled.aiAttemptedToWiden).toBe(true)
    expect(decided.reconciled.reason).toContain('IGNORED')
    expect((await prisma.capability.findUnique({ where: { id: capabilityId } }))!.status).toBe('REVOKED')
  }, 120_000)

  it('records the AI recommendation even when it is overruled', async () => {
    // An investigator repeatedly arguing for less than the floor is a signal.
    // Discarding the recommendation would erase it.
    const { actorId } = await actorWithCapability()
    const incident = await openIncident({
      actorId,
      type: 'MANUAL',
      severity: 'CRITICAL',
      source: 'phase10-test',
    })
    const investigated = await investigateIncident(incident.id)
    await decideIncident({ incidentId: incident.id, aiRecommendation: 'ALLOW' })

    const investigation = await prisma.investigation.findUniqueOrThrow({
      where: { id: investigated.investigationId },
    })
    expect(investigation.recommendedAction).toBe('ALLOW')
  }, 120_000)
})

describe('V2 Phase 10 — counter-evidence search', () => {
  it('FINDS THE LABELLED-FUNDER DEFENCE', async () => {
    // The Arbitrum case. A shared exchange hot wallet must register as a reason
    // to DOUBT coordination, not as evidence for it.
    const exchange = await prisma.knownFunderAddress.findFirst({ where: { category: 'EXCHANGE' } })
    if (!exchange) return

    const a = randomWallet()
    const b = randomWallet()
    createdWallets.push(a.toLowerCase(), b.toLowerCase())
    await insertEvidence({ wallet: a, counterparty: exchange.address, chain: exchange.chain, count: 4 })
    await insertEvidence({ wallet: b, counterparty: exchange.address, chain: exchange.chain, count: 4 })

    const report = await searchCounterEvidence({ wallets: [a, b] })
    const labelled = report.findings.find((f) => f.kind === 'SHARED_FUNDER_IS_LABELLED')
    expect(labelled).toBeDefined()
    expect(labelled!.detail).toContain(exchange.label)
    expect(report.doubt).toBeGreaterThan(0.5)
  }, 120_000)

  it('finds divergent timing when wallets act months apart', async () => {
    const a = randomWallet()
    const b = randomWallet()
    createdWallets.push(a.toLowerCase(), b.toLowerCase())
    await insertEvidence({ wallet: a, counterparty: randomWallet(), count: 3, startMsAgo: 300 * 86_400_000 })
    await insertEvidence({ wallet: b, counterparty: randomWallet(), count: 3, startMsAgo: 86_400_000 })

    const report = await searchCounterEvidence({ wallets: [a, b] })
    expect(report.findings.some((f) => f.kind === 'ACTIVITY_IS_NOT_SYNCHRONISED')).toBe(true)
  }, 120_000)

  it('finds divergent protocol usage', async () => {
    const a = randomWallet()
    const b = randomWallet()
    createdWallets.push(a.toLowerCase(), b.toLowerCase())
    await insertEvidence({ wallet: a, counterparty: randomWallet(), count: 3, protocol: 'aave-v3' })
    await insertEvidence({ wallet: b, counterparty: randomWallet(), count: 3, protocol: 'uniswap-v3' })

    const report = await searchCounterEvidence({ wallets: [a, b] })
    expect(report.findings.some((f) => f.kind === 'PROTOCOL_USAGE_DIVERGES')).toBe(true)
  }, 120_000)

  it('RETURNS NULL DOUBT, NOT ZERO, WHEN THERE IS NO EVIDENCE', async () => {
    // Zero would read as "we checked and found nothing exculpatory", which is a
    // far stronger claim than "we had nothing to check".
    const report = await searchCounterEvidence({ wallets: [randomWallet()] })
    expect(report.doubt).toBeNull()
    expect(report.findings).toEqual([])
    expect(report.summary).toContain('no counter-evidence')
  }, 60_000)

  it('finds nothing to say about a single wallet acting alone', async () => {
    // Timing, protocol and history checks all compare wallets against each
    // other. With one wallet there is no comparison to make, and inventing a
    // finding would be worse than reporting none.
    const a = randomWallet()
    createdWallets.push(a.toLowerCase())
    await insertEvidence({ wallet: a, counterparty: randomWallet(), count: 3 })
    const report = await searchCounterEvidence({ wallets: [a] })
    expect(report.findings.every((f) => f.kind === 'SHARED_FUNDER_IS_LABELLED')).toBe(true)
  }, 90_000)
})

describe('V2 Phase 10 — the incident lifecycle', () => {
  it('DEDUPLICATES a repeating anomaly instead of flooding the queue', async () => {
    // A Substreams stream re-firing every block must not create a thousand
    // incidents nobody can triage.
    const { actorId } = await actorWithCapability()
    const first = await openIncident({ actorId, type: 'ANOMALOUS_VELOCITY', severity: 'MEDIUM', source: 'stream' })
    const second = await openIncident({ actorId, type: 'ANOMALOUS_VELOCITY', severity: 'MEDIUM', source: 'stream' })
    expect(second.id).toBe(first.id)
    expect((await listIncidents({ actorId })).length).toBe(1)
  }, 120_000)

  it('ESCALATES rather than deduplicating when the repeat is more severe', async () => {
    // Deduplication must never mask a worsening situation.
    const { actorId, capabilityId } = await actorWithCapability()
    await openIncident({ actorId, type: 'TRUST_COLLAPSE', severity: 'LOW', source: 'stream' })
    const escalated = await openIncident({ actorId, type: 'TRUST_COLLAPSE', severity: 'CRITICAL', source: 'stream' })

    expect(escalated.severity).toBe('CRITICAL')
    expect((await listIncidents({ actorId })).length).toBe(1)
    // And the escalation actually contained it.
    expect((await prisma.capability.findUnique({ where: { id: capabilityId } }))!.status).toBe('REVOKED')
  }, 120_000)

  it('REFUSES TO CLOSE AN INCIDENT WITH NO ROOT CAUSE', async () => {
    const { actorId } = await actorWithCapability()
    const incident = await openIncident({ actorId, type: 'MANUAL', severity: 'LOW', source: 'test' })
    await expect(
      resolveIncident({ incidentId: incident.id, status: 'RESOLVED', rootCause: '   ' }),
    ).rejects.toThrow(/root cause/i)
  }, 90_000)

  it('REFUSES TO REOPEN A CLOSED INCIDENT', async () => {
    const { actorId } = await actorWithCapability()
    const incident = await openIncident({ actorId, type: 'MANUAL', severity: 'LOW', source: 'test' })
    await resolveIncident({ incidentId: incident.id, status: 'RESOLVED', rootCause: 'benign' })

    await expect(investigateIncident(incident.id)).rejects.toThrow(/cannot be reopened/i)
    await expect(
      resolveIncident({ incidentId: incident.id, status: 'FALSE_POSITIVE', rootCause: 'changed my mind' }),
    ).rejects.toThrow()
  }, 120_000)

  it('restores authority ONLY on a false positive', async () => {
    const { actorId, capabilityId } = await actorWithCapability()
    const incident = await openIncident({ actorId, type: 'COORDINATION_DETECTED', severity: 'HIGH', source: 'test' })
    expect((await prisma.capability.findUnique({ where: { id: capabilityId } }))!.status).toBe('SUSPENDED')

    // A genuine incident may not hand authority back.
    await expect(
      resolveIncident({ incidentId: incident.id, status: 'RESOLVED', rootCause: 'real', restore: true }),
    ).rejects.toThrow(/FALSE_POSITIVE/)

    const cleared = await resolveIncident({
      incidentId: incident.id,
      status: 'FALSE_POSITIVE',
      rootCause: 'shared funder was a labelled exchange',
      restore: true,
    })
    expect(cleared.restored).toBeGreaterThan(0)
    expect((await prisma.capability.findUnique({ where: { id: capabilityId } }))!.status).toBe('ACTIVE')
  }, 120_000)
})

describe('V2 Phase 10 — over real HTTP', () => {
  it('opens, investigates, mitigates and resolves an incident', async () => {
    const { actorId } = await actorWithCapability()

    const opened = await auth(
      request(app).post('/v2/incidents').send({
        actorId,
        type: 'COORDINATION_DETECTED',
        severity: 'HIGH',
        source: 'http-test',
      }),
    )
    expect(opened.status).toBe(201)
    const incidentId = opened.body.incident.id as string

    const investigated = await auth(request(app).post(`/v2/incidents/${incidentId}/investigate`))
    expect(investigated.status).toBe(200)
    expect(investigated.body.investigationId).toBeTruthy()

    const mitigated = await auth(
      request(app).post(`/v2/incidents/${incidentId}/mitigate`).send({ aiRecommendation: 'ALLOW' }),
    )
    expect(mitigated.status).toBe(200)
    // The API reports the overrule rather than hiding it.
    expect(mitigated.body.reconciliation.aiAttemptedToWiden).toBe(true)
    expect(mitigated.body.incident.mitigation).toBe('RESTRICT')

    const resolved = await auth(
      request(app)
        .post(`/v2/incidents/${incidentId}/resolve`)
        .send({ status: 'RESOLVED', rootCause: 'confirmed coordinated funding' }),
    )
    expect(resolved.status).toBe(200)
    expect(resolved.body.incident.status).toBe('RESOLVED')
  }, 180_000)

  it('lists and reads incidents', async () => {
    const { actorId } = await actorWithCapability()
    const opened = await auth(
      request(app).post('/v2/incidents').send({
        actorId,
        type: 'MANUAL',
        severity: 'LOW',
        source: 'http-test',
      }),
    )
    const id = opened.body.incident.id as string

    const list = await auth(request(app).get(`/v2/incidents?actorId=${actorId}`))
    expect(list.status).toBe(200)
    expect(list.body.incidents.length).toBeGreaterThan(0)

    const read = await auth(request(app).get(`/v2/incidents/${id}`))
    expect(read.status).toBe(200)
    expect(read.body.incident.id).toBe(id)
  }, 120_000)

  it('404s an unknown incident and rejects a bad severity', async () => {
    expect((await auth(request(app).get('/v2/incidents/nope'))).status).toBe(404)
    const bad = await auth(
      request(app).post('/v2/incidents').send({ type: 'MANUAL', severity: 'SEVERE', source: 't' }),
    )
    expect(bad.status).toBe(400)
  }, 60_000)

  it('requires an API key', async () => {
    expect((await request(app).get('/v2/incidents')).status).toBe(401)
  }, 60_000)
})
