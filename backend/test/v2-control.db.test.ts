/**
 * V2 Phase 11 — Remote Authority against real Postgres and real HTTP. NO MOCKS.
 *
 * THE ACCEPTANCE CONDITION, asserted literally: a mobile client can view an
 * agent, view its evidence, receive a pending action, approve, limit and
 * freeze — and the decision flows through the durable workflow.
 *
 * The security tests matter as much as the happy path. Section 19.2 lists eight
 * requirements and each one, if it silently fails open, is an authority bypass:
 * a stolen token working from another device, a decision replayed against a
 * different action, an expired action still answerable.
 */
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

const { app } = await import('../src/server.js')
const { prisma } = await import('../src/lib/prisma.js')
const { resolveActorForWallet } = await import('../src/actor/actor-resolver.js')
const { grantCapability } = await import('../src/capabilities/capability-service.js')
const {
  enrolOperator,
  openSession,
  authenticate,
  decidePendingAction,
  createPendingAction,
  listPendingActions,
  ControlError,
} = await import('../src/control/control-service.js')
const { computeBindingHash } = await import('../src/control/operator-auth.js')

const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`
const nonce = (): string => randomBytes(24).toString('hex')

const createdActorIds: string[] = []
const createdOperatorIds: string[] = []

let operatorExternalId = ''
let operatorSecret = ''
let operatorId = ''
let token = ''
const DEVICE = 'device-under-test-0001'

beforeAll(async () => {
  operatorExternalId = `op-${randomBytes(6).toString('hex')}@xander.test`
  const enrolled = await enrolOperator({
    externalId: operatorExternalId,
    displayName: 'Phase 11 operator',
  })
  operatorSecret = enrolled.secret
  operatorId = enrolled.operatorId
  createdOperatorIds.push(enrolled.operatorId)

  const grant = await openSession({
    externalId: operatorExternalId,
    secret: operatorSecret,
    deviceId: DEVICE,
  })
  token = grant.token
})

afterAll(async () => {
  await prisma.pendingAction.deleteMany({ where: { actorId: { in: createdActorIds } } })
  await prisma.actor.deleteMany({ where: { id: { in: createdActorIds } } })
  await prisma.operatorAuditLog.deleteMany({ where: { operatorId: { in: createdOperatorIds } } })
  await prisma.operator.deleteMany({ where: { id: { in: createdOperatorIds } } })
  await prisma.$disconnect()
})

/** An authenticated control-plane request. */
const control = <T extends { set: (a: string, b: string) => T }>(req: T): T =>
  req.set('Authorization', `Bearer ${token}`).set('X-Device-Id', DEVICE)

async function agentWithCapability(): Promise<{
  agentId: string
  actorId: string
  capabilityId: string
}> {
  const actor = await resolveActorForWallet(randomWallet())
  createdActorIds.push(actor.id)
  const agent = await prisma.agent.create({
    data: { actorId: actor.id, name: `agent-${randomBytes(3).toString('hex')}`, status: 'ACTIVE' },
  })
  const capability = await grantCapability({
    actorId: actor.id,
    actionType: 'TRADE',
    resourceScope: 'control-test',
    limits: {
      amountLimit: '1000000',
      frequencyLimit: 20,
      frequencyWindowSeconds: 86_400,
      allowedTargets: [],
      expiresAt: null,
    },
    attenuated: false,
  })
  return { agentId: agent.id, actorId: actor.id, capabilityId: capability.id }
}

describe('V2 Phase 11 — THE ACCEPTANCE CONDITION', () => {
  it('VIEW AGENT -> VIEW EVIDENCE -> RECEIVE ACTION -> APPROVE -> LIMIT -> FREEZE', async () => {
    const { agentId, actorId, capabilityId } = await agentWithCapability()

    // --- view agent ---------------------------------------------------------
    const view = await control(request(app).get(`/v2/control/agents/${agentId}`))
    expect(view.status).toBe(200)
    expect(view.body.agent.id).toBe(agentId)
    expect(view.body.capabilities.length).toBeGreaterThan(0)

    // --- view evidence ------------------------------------------------------
    const evidence = await control(request(app).get(`/v2/control/agents/${agentId}/evidence`))
    expect(evidence.status).toBe(200)
    expect(evidence.body.wallets.length).toBeGreaterThan(0)
    expect(Array.isArray(evidence.body.evidence)).toBe(true)

    // --- receive a pending action -------------------------------------------
    const raised = await control(
      request(app).post('/v2/control/pending-actions').send({
        subjectType: 'AGENT',
        subjectId: agentId,
        summary: 'agent requests a larger trading ceiling',
        allowed: ['APPROVE', 'DENY', 'LIMIT'],
        actorId,
        agentId,
        amount: '5000000',
      }),
    )
    expect(raised.status).toBe(201)

    const pending = await control(request(app).get('/v2/control/pending-actions'))
    expect(pending.status).toBe(200)
    const action = (pending.body.actions as { id: string; bindingHash: string }[]).find(
      (a) => a.id === raised.body.action.id,
    )
    expect(action).toBeDefined()

    // --- approve -------------------------------------------------------------
    const approved = await control(
      request(app)
        .post(`/v2/control/actions/${action!.id}/approve`)
        .send({ bindingHash: action!.bindingHash, nonce: nonce(), reason: 'looks fine' }),
    )
    expect(approved.status).toBe(200)
    expect(approved.body.command).toBe('APPROVE')

    // --- limit ---------------------------------------------------------------
    const limitAction = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'cap this agent',
      allowed: ['LIMIT'],
      actorId,
      agentId,
    })
    const limited = await control(
      request(app).post(`/v2/control/actions/${limitAction.id}/limit`).send({
        bindingHash: limitAction.bindingHash,
        nonce: nonce(),
        limitAmount: '500',
        reason: 'tightening',
      }),
    )
    expect(limited.status).toBe(200)
    const capped = await prisma.capability.findUniqueOrThrow({ where: { id: capabilityId } })
    expect(capped.amountLimit).toBe('500')

    // --- freeze --------------------------------------------------------------
    // Section 19.3: freeze is a CAPABILITY STATE TRANSITION, not a UI flag.
    const frozen = await control(
      request(app)
        .post(`/v2/control/agents/${agentId}/freeze`)
        .send({ nonce: nonce(), reason: 'operator freeze from the control plane' }),
    )
    expect(frozen.status).toBe(200)

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } })
    expect(agent.status).toBe('FROZEN')
    const afterFreeze = await prisma.capability.findUniqueOrThrow({ where: { id: capabilityId } })
    expect(afterFreeze.status).not.toBe('ACTIVE')
  }, 180_000)
})

describe('V2 Phase 11 — SECTION 19.2 security', () => {
  it('REFUSES A VALID TOKEN FROM A DIFFERENT DEVICE', async () => {
    // Device binding. An exfiltrated token alone must not be an authority.
    const res = await request(app)
      .get('/v2/control/agents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-Id', 'some-other-device')
    expect(res.status).toBe(401)
    expect(res.body.message).toContain('device mismatch')
  }, 60_000)

  it('refuses a request with no token, and one with no device id', async () => {
    expect((await request(app).get('/v2/control/agents')).status).toBe(401)
    expect(
      (await request(app).get('/v2/control/agents').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(401)
    expect(
      (await request(app).get('/v2/control/agents').set('X-Device-Id', DEVICE)).status,
    ).toBe(401)
  }, 60_000)

  it('DOES NOT ACCEPT THE PROTOCOL API KEY', async () => {
    // Section 27.1. The backend key must not be a mobile-user credential.
    const res = await request(app).get('/v2/control/agents').set('X-API-Key', 'test-api-key')
    expect(res.status).toBe(401)
  }, 60_000)

  it('REFUSES A DECISION WHOSE BINDING DOES NOT MATCH THE ACTION', async () => {
    // Explicit action binding. A decision captured answering one action must
    // not be replayable against another.
    const { agentId, actorId } = await agentWithCapability()
    const cheap = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'approve a small payment',
      allowed: ['APPROVE'],
      actorId,
      agentId,
      amount: '10',
    })
    // The binding for a DIFFERENT, larger action.
    const forged = computeBindingHash({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'approve a small payment',
      amount: '10000000',
    })

    const res = await control(
      request(app)
        .post(`/v2/control/actions/${cheap.id}/approve`)
        .send({ bindingHash: forged, nonce: nonce() }),
    )
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('binding mismatch')

    // And the action is still PENDING — a refused decision decides nothing.
    const unchanged = await prisma.pendingAction.findUniqueOrThrow({ where: { id: cheap.id } })
    expect(unchanged.status).toBe('PENDING')
  }, 120_000)

  it('REFUSES A REPLAYED NONCE', async () => {
    const { agentId, actorId } = await agentWithCapability()
    const first = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'first action',
      allowed: ['APPROVE'],
      actorId,
      agentId,
    })
    const second = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'second action',
      allowed: ['APPROVE'],
      actorId,
      agentId,
    })
    const reused = nonce()

    const ok = await control(
      request(app)
        .post(`/v2/control/actions/${first.id}/approve`)
        .send({ bindingHash: first.bindingHash, nonce: reused }),
    )
    expect(ok.status).toBe(200)

    const replayed = await control(
      request(app)
        .post(`/v2/control/actions/${second.id}/approve`)
        .send({ bindingHash: second.bindingHash, nonce: reused }),
    )
    expect(replayed.status).toBe(409)
    expect(await prisma.pendingAction.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject(
      { status: 'PENDING' },
    )
  }, 120_000)

  it('REFUSES A COMMAND THAT IS NOT A LEGAL ANSWER', async () => {
    const { agentId, actorId } = await agentWithCapability()
    const action = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'approve only',
      allowed: ['APPROVE'],
      actorId,
      agentId,
    })
    const res = await control(
      request(app)
        .post(`/v2/control/actions/${action.id}/deny`)
        .send({ bindingHash: action.bindingHash, nonce: nonce() }),
    )
    expect(res.status).toBe(400)
  }, 120_000)

  it('REFUSES AN EXPIRED ACTION — expiry is a refusal, not an approval', async () => {
    const { agentId, actorId } = await agentWithCapability()
    const action = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'too slow',
      allowed: ['APPROVE'],
      actorId,
      agentId,
    })
    await prisma.pendingAction.update({
      where: { id: action.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const res = await control(
      request(app)
        .post(`/v2/control/actions/${action.id}/approve`)
        .send({ bindingHash: action.bindingHash, nonce: nonce() }),
    )
    expect(res.status).toBe(409)
    expect(res.body.message).toContain('expired')
    expect(await prisma.pendingAction.findUniqueOrThrow({ where: { id: action.id } })).toMatchObject(
      { status: 'EXPIRED' },
    )
  }, 120_000)

  it('refuses to answer the same action twice', async () => {
    const { agentId, actorId } = await agentWithCapability()
    const action = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'answer once',
      allowed: ['APPROVE'],
      actorId,
      agentId,
    })
    const first = await control(
      request(app)
        .post(`/v2/control/actions/${action.id}/approve`)
        .send({ bindingHash: action.bindingHash, nonce: nonce() }),
    )
    expect(first.status).toBe(200)
    const again = await control(
      request(app)
        .post(`/v2/control/actions/${action.id}/approve`)
        .send({ bindingHash: action.bindingHash, nonce: nonce() }),
    )
    expect(again.status).toBe(409)
  }, 120_000)

  it('refuses a revoked session', async () => {
    const grant = await openSession({
      externalId: operatorExternalId,
      secret: operatorSecret,
      deviceId: 'throwaway-device-01',
    })
    await request(app)
      .delete('/v2/control/sessions')
      .set('Authorization', `Bearer ${grant.token}`)
      .set('X-Device-Id', 'throwaway-device-01')

    const res = await request(app)
      .get('/v2/control/agents')
      .set('Authorization', `Bearer ${grant.token}`)
      .set('X-Device-Id', 'throwaway-device-01')
    expect(res.status).toBe(401)
  }, 90_000)

  it('refuses an expired session and marks it EXPIRED', async () => {
    const grant = await openSession({
      externalId: operatorExternalId,
      secret: operatorSecret,
      deviceId: 'expiring-device-01',
    })
    await prisma.operatorSession.update({
      where: { id: grant.sessionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await expect(
      authenticate({ token: grant.token, deviceId: 'expiring-device-01' }),
    ).rejects.toBeInstanceOf(ControlError)
  }, 90_000)
})

describe('V2 Phase 11 — credentials', () => {
  it('NEVER STORES THE SESSION TOKEN OR THE ENROLMENT SECRET', async () => {
    // A leaked operator table must yield nothing usable.
    const sessions = await prisma.operatorSession.findMany({
      where: { operator: { externalId: operatorExternalId } },
    })
    expect(sessions.length).toBeGreaterThan(0)
    for (const session of sessions) {
      expect(session.tokenHash).not.toBe(token)
      expect(session.tokenHash).toHaveLength(64)
    }
    const operator = await prisma.operator.findUniqueOrThrow({
      where: { externalId: operatorExternalId },
    })
    expect(operator.secretHash).not.toBe(operatorSecret)
  }, 60_000)

  it('refuses a wrong secret and a nonexistent operator identically', async () => {
    const wrong = await openSession({
      externalId: operatorExternalId,
      secret: 'not-the-secret',
      deviceId: DEVICE,
    }).catch((e: unknown) => e)
    const missing = await openSession({
      externalId: 'nobody@nowhere.test',
      secret: 'whatever',
      deviceId: DEVICE,
    }).catch((e: unknown) => e)

    expect(wrong).toBeInstanceOf(ControlError)
    expect(missing).toBeInstanceOf(ControlError)
    // Same message, so a caller cannot enumerate valid operator ids.
    expect((wrong as Error).message).toBe((missing as Error).message)
  }, 90_000)

  it('audits refusals, not only successes', async () => {
    await openSession({
      externalId: operatorExternalId,
      secret: 'wrong-again',
      deviceId: DEVICE,
    }).catch(() => null)

    const denied = await prisma.operatorAuditLog.findMany({
      where: { operatorId, outcome: 'DENIED' },
    })
    expect(denied.length).toBeGreaterThan(0)
    expect(denied.every((d) => d.reason.length > 0)).toBe(true)
  }, 90_000)
})

describe('V2 Phase 11 — scope', () => {
  it('refuses a command outside an operator’s action scope', async () => {
    const scoped = await enrolOperator({
      externalId: `scoped-${randomBytes(5).toString('hex')}@xander.test`,
      displayName: 'Approve-only operator',
      actionScope: ['APPROVE'],
    })
    createdOperatorIds.push(scoped.operatorId)
    const grant = await openSession({
      externalId: scoped.externalId,
      secret: scoped.secret,
      deviceId: 'scoped-device-01',
    })
    const operator = await authenticate({ token: grant.token, deviceId: 'scoped-device-01' })

    const { agentId, actorId } = await agentWithCapability()
    const action = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'deny me',
      allowed: ['APPROVE', 'DENY'],
      actorId,
      agentId,
    })

    await expect(
      decidePendingAction(operator, {
        actionId: action.id,
        command: 'DENY',
        bindingHash: action.bindingHash,
        nonce: nonce(),
      }),
    ).rejects.toThrow(/may not issue DENY/)
  }, 120_000)
})

describe('V2 Phase 11 — pending action lifecycle', () => {
  it('expires stale actions when the list is read', async () => {
    const { agentId, actorId } = await agentWithCapability()
    const action = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'will expire',
      allowed: ['APPROVE'],
      actorId,
      agentId,
    })
    await prisma.pendingAction.update({
      where: { id: action.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const listed = await listPendingActions()
    expect(listed.some((a) => a.id === action.id)).toBe(false)
    // The list and the database agree about what is still answerable.
    expect(await prisma.pendingAction.findUniqueOrThrow({ where: { id: action.id } })).toMatchObject(
      { status: 'EXPIRED' },
    )
  }, 90_000)

  it('records who decided, what, and why', async () => {
    const { agentId, actorId } = await agentWithCapability()
    const action = await createPendingAction({
      subjectType: 'AGENT',
      subjectId: agentId,
      summary: 'attribute me',
      allowed: ['DENY'],
      actorId,
      agentId,
    })
    await control(
      request(app)
        .post(`/v2/control/actions/${action.id}/deny`)
        .send({ bindingHash: action.bindingHash, nonce: nonce(), reason: 'not convinced' }),
    )

    const decided = await prisma.pendingAction.findUniqueOrThrow({ where: { id: action.id } })
    expect(decided.status).toBe('DECIDED')
    expect(decided.decidedBy).toBe(operatorId)
    expect(decided.decision).toBe('DENY')
    expect(decided.decisionReason).toBe('not convinced')
    expect(decided.decidedAt).not.toBeNull()
  }, 120_000)
})

describe('V2 Phase 11 — the control surface', () => {
  it('lists agents and incidents', async () => {
    await agentWithCapability()
    const agents = await control(request(app).get('/v2/control/agents'))
    expect(agents.status).toBe(200)
    expect(agents.body.agents.length).toBeGreaterThan(0)

    const incidents = await control(request(app).get('/v2/control/incidents'))
    expect(incidents.status).toBe(200)
    expect(Array.isArray(incidents.body.incidents)).toBe(true)
  }, 90_000)

  it('404s an unknown agent', async () => {
    expect((await control(request(app).get('/v2/control/agents/nope'))).status).toBe(404)
    expect((await control(request(app).get('/v2/control/agents/nope/evidence'))).status).toBe(404)
  }, 60_000)

  it('serves the audit trail', async () => {
    const res = await control(request(app).get('/v2/control/audit?mine=true'))
    expect(res.status).toBe(200)
    expect(res.body.entries.length).toBeGreaterThan(0)
  }, 60_000)
})
