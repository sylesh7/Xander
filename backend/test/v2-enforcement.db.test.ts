/**
 * V2 Phase 8 — the execution boundary, against real Postgres. NO MOCKS.
 *
 * THE ACCEPTANCE CONDITION, asserted literally: a high-value agent action is
 * PREVENTED at the actual execution boundary — the executor function is never
 * invoked — and the receipt refuses to claim it ran.
 *
 * Every refusal below is produced by the real `executeAuthorizedAction`, and
 * the executor is a real closure whose side effect is observable, so "blocked"
 * means the side effect did not happen rather than a status string saying so.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'

const { prisma } = await import('../src/lib/prisma.js')
const { resolveActorForWallet } = await import('../src/actor/actor-resolver.js')
const { grantCapability } = await import('../src/capabilities/capability-service.js')
const { executeAuthorizedAction, NoSuchIntentError } = await import(
  '../src/authorization/enforcement/execution-service.js'
)
const { verifyEnforcement, revokeEverywhere, enforcementStatus, adaptersForActor } = await import(
  '../src/authorization/enforcement/enforcement-service.js'
)
const { localEnforcementAdapter } = await import(
  '../src/authorization/enforcement/local-adapter.js'
)
const { isEnforced } = await import('../src/authorization/enforcement/enforcement-adapter.js')
const { app } = await import('../src/server.js')

const auth = <T extends { set: (a: string, b: string) => T }>(req: T): T =>
  req.set('X-API-Key', 'test-api-key')

const createdActorIds: string[] = []

const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`

afterAll(async () => {
  await prisma.actor.deleteMany({ where: { id: { in: createdActorIds } } })
  await prisma.$disconnect()
})

/**
 * Builds a complete authorized action: actor, capability, intent, decision and
 * receipt — written the same shape `intent-service` writes them, because the
 * execution path reads all five and a shortcut through any one of them would
 * test a situation that cannot occur.
 */
async function authorizedAction(opts: {
  amountLimit?: string | null
  intentAmount?: string | null
  actionType?: string
  decisionResult?: string
  capabilityStatus?: string
  expiresAt?: Date
  allowedTargets?: string[]
  targetAddress?: string | null
}): Promise<{ actorId: string; intentId: string; capabilityId: string; receiptId: string }> {
  const actionType = opts.actionType ?? 'TRADE'
  const wallet = randomWallet()
  const actor = await resolveActorForWallet(wallet)
  createdActorIds.push(actor.id)

  const capability = await grantCapability({
    actorId: actor.id,
    actionType,
    resourceScope: 'enforcement-test',
    limits: {
      amountLimit: opts.amountLimit === undefined ? '1000000' : opts.amountLimit,
      frequencyLimit: 5,
      frequencyWindowSeconds: 86_400,
      allowedTargets: opts.allowedTargets ?? [],
      expiresAt: null,
    },
    attenuated: false,
  })
  if (opts.capabilityStatus) {
    await prisma.capability.update({
      where: { id: capability.id },
      data: { status: opts.capabilityStatus },
    })
  }

  const intent = await prisma.intent.create({
    data: {
      actorId: actor.id,
      resourceType: 'test',
      resourceId: 'enforcement',
      actionType,
      amount: opts.intentAmount === undefined ? '1000' : opts.intentAmount,
      targetAddress: opts.targetAddress ?? null,
      parametersHash: randomBytes(16).toString('hex'),
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 3_600_000),
      idempotencyKey: randomUUID(),
      status: 'DECIDED',
    },
  })

  const decision = await prisma.authorizationDecision.create({
    data: {
      intentId: intent.id,
      policyVersion: 'test-v1',
      result: opts.decisionResult ?? 'ALLOW',
      reasonCode: 'TEST',
      reasonSummary: 'fixture',
      evidenceIds: [],
      riskScore: 0,
      confidence: 'HIGH',
    },
  })

  const receipt = await prisma.actionReceipt.create({
    data: {
      intentId: intent.id,
      decisionId: decision.id,
      actorId: actor.id,
      policyVersion: 'test-v1',
      evidenceSnapshotHash: 'test',
      decisionPayloadHash: 'test',
    },
  })

  return {
    actorId: actor.id,
    intentId: intent.id,
    capabilityId: capability.id,
    receiptId: receipt.id,
  }
}

/** An executor whose side effect is observable, so "blocked" is provable. */
function spyExecutor(): { run: () => Promise<{ txHash: string }>; calls: () => number } {
  let calls = 0
  return {
    run: async () => {
      calls++
      return { txHash: `0xexecuted${calls}` }
    },
    calls: () => calls,
  }
}

describe('V2 Phase 8 — THE ACCEPTANCE CONDITION', () => {
  it('PREVENTS A HIGH-VALUE ACTION AT THE EXECUTION BOUNDARY', async () => {
    // Authorized for 1,000,000 base units. The intent asks for 900 billion.
    const { intentId, receiptId } = await authorizedAction({
      amountLimit: '1000000',
      intentAmount: '900000000000',
    })
    const executor = spyExecutor()

    const outcome = await executeAuthorizedAction(intentId, executor.run)

    // The side effect never happened. This is the assertion that matters.
    expect(executor.calls()).toBe(0)
    expect(outcome.executed).toBe(false)
    expect(outcome.status).toBe('BLOCKED_UNENFORCEABLE')
    // The refusal names the actual number it refused on, so an operator can
    // explain it without reading the policy table.
    expect(outcome.reason).toContain('900000000000')
    expect(outcome.reason).toContain('1000000')

    // And the receipt refuses to claim otherwise — section 18.2.
    const receipt = await prisma.actionReceipt.findUnique({ where: { id: receiptId } })
    expect(receipt!.executionStatus).toBe('BLOCKED_UNENFORCEABLE')
    expect(receipt!.executedAt).toBeNull()
    expect(receipt!.executionTxHash).toBeNull()
  }, 60_000)

  it('lets a genuinely authorized action through, and records what proved it', async () => {
    // The control. A gate that blocks everything is not enforcement.
    const { intentId, receiptId, capabilityId } = await authorizedAction({
      amountLimit: '1000000',
      intentAmount: '1000',
    })
    const executor = spyExecutor()

    const outcome = await executeAuthorizedAction(intentId, executor.run)

    expect(executor.calls()).toBe(1)
    expect(outcome.executed).toBe(true)
    expect(outcome.status).toBe('EXECUTED_AS_AUTHORIZED')
    expect(outcome.adapters).toContain('local')

    const receipt = await prisma.actionReceipt.findUnique({ where: { id: receiptId } })
    expect(receipt!.executionStatus).toBe('EXECUTED_AS_AUTHORIZED')
    expect(receipt!.executedAt).not.toBeNull()
    expect(receipt!.executionTxHash).toBe('0xexecuted1')
    // The receipt NAMES its boundary. A proof nobody can trace is not a proof.
    expect(receipt!.enforcementAdapters).toContain('local')
    expect(receipt!.enforcementReason).toContain('local')

    // Usage was recorded against the real capability, so the frequency limit
    // is not a counter that only moves in tests.
    const usage = await prisma.capabilityUsage.count({ where: { capabilityId } })
    expect(usage).toBe(1)
  }, 60_000)
})

describe('V2 Phase 8 — every refusal path', () => {
  it('BLOCKS when Phase 7 suspended the capability under it', async () => {
    // The live wire between phases: a trust collapse suspends a capability, and
    // THIS is where that suspension stops something happening.
    const { intentId } = await authorizedAction({ capabilityStatus: 'SUSPENDED' })
    const executor = spyExecutor()

    const outcome = await executeAuthorizedAction(intentId, executor.run)

    expect(executor.calls()).toBe(0)
    expect(outcome.status).toBe('BLOCKED_UNENFORCEABLE')
  }, 60_000)

  it('blocks a REVIEW decision, which authorizes nothing', async () => {
    const { intentId } = await authorizedAction({ decisionResult: 'REVIEW' })
    const executor = spyExecutor()
    const outcome = await executeAuthorizedAction(intentId, executor.run)
    expect(executor.calls()).toBe(0)
    expect(outcome.reason).toContain('REVIEW')
  }, 60_000)

  it('blocks a BLOCK decision', async () => {
    const { intentId } = await authorizedAction({ decisionResult: 'BLOCK' })
    const outcome = await executeAuthorizedAction(intentId)
    expect(outcome.executed).toBe(false)
  }, 60_000)

  it('blocks an expired intent even with a live capability', async () => {
    // An ALLOW does not keep. Section 5 gives intents an expiry precisely so a
    // decision cannot be banked and spent later.
    const { intentId } = await authorizedAction({ expiresAt: new Date(Date.now() - 1000) })
    const executor = spyExecutor()
    const outcome = await executeAuthorizedAction(intentId, executor.run)
    expect(executor.calls()).toBe(0)
    expect(outcome.reason).toContain('expired')
  }, 60_000)

  it('blocks a target outside the allow-list', async () => {
    const allowed = randomWallet().toLowerCase()
    const { intentId } = await authorizedAction({
      allowedTargets: [allowed],
      targetAddress: randomWallet(),
    })
    const executor = spyExecutor()
    const outcome = await executeAuthorizedAction(intentId, executor.run)
    expect(executor.calls()).toBe(0)
    expect(outcome.status).toBe('BLOCKED_UNENFORCEABLE')
  }, 60_000)

  it('reports a failed execution as FAILED, not as a policy refusal', async () => {
    // Authority WAS proven. Conflating a broken integration with a denial would
    // hide the outage behind something that looks intentional.
    const { intentId, receiptId } = await authorizedAction({})
    const outcome = await executeAuthorizedAction(intentId, async () => {
      throw new Error('rpc exploded')
    })

    expect(outcome.status).toBe('FAILED')
    expect(outcome.executed).toBe(false)
    expect(outcome.reason).toContain('rpc exploded')

    const receipt = await prisma.actionReceipt.findUnique({ where: { id: receiptId } })
    expect(receipt!.executionStatus).toBe('FAILED')
    expect(receipt!.executedAt).toBeNull()
  }, 60_000)

  it('does not consume a frequency slot for an action that failed', async () => {
    const { intentId, capabilityId } = await authorizedAction({})
    await executeAuthorizedAction(intentId, async () => {
      throw new Error('nope')
    })
    expect(await prisma.capabilityUsage.count({ where: { capabilityId } })).toBe(0)
  }, 60_000)

  it('404s on an intent that does not exist rather than inventing a refusal', async () => {
    await expect(executeAuthorizedAction('no-such-intent')).rejects.toBeInstanceOf(
      NoSuchIntentError,
    )
  }, 30_000)
})

describe('V2 Phase 8 — the composition rule', () => {
  it('requires a POSITIVE confirmation, never mere silence', async () => {
    const { actorId } = await authorizedAction({})
    const verdict = await verifyEnforcement({
      actorId,
      actionType: 'TRADE',
      amount: '1000',
    })
    expect(verdict.enforced).toBe(true)
    expect(verdict.states.every((s) => s.enforceable === true)).toBe(true)
  }, 60_000)

  it('is NOT enforced when a boundary cannot answer', async () => {
    // An actor with no capability at all: the local boundary answers a definite
    // no. The point of the assertion is that `enforced` is false and the reason
    // names the boundary, not that something merely threw.
    const actor = await resolveActorForWallet(randomWallet())
    createdActorIds.push(actor.id)
    const verdict = await verifyEnforcement({ actorId: actor.id, actionType: 'TRADE' })
    expect(verdict.enforced).toBe(false)
    expect(verdict.reason).toContain('local')
  }, 60_000)

  it('treats UNKNOWN as not-enforced', () => {
    // The three-state outcome exists for exactly this. A caller writing
    // `outcome !== 'FAILED'` would have turned a timeout into an authorization.
    expect(isEnforced({ outcome: 'UNKNOWN', adapter: 'x', reference: null, detail: '' })).toBe(
      false,
    )
    expect(isEnforced({ outcome: 'FAILED', adapter: 'x', reference: null, detail: '' })).toBe(false)
    expect(isEnforced({ outcome: 'CONFIRMED', adapter: 'x', reference: null, detail: '' })).toBe(
      true,
    )
  })

  it('consults only the boundaries that actually govern a bare wallet', async () => {
    // No agent, no ENS name — asking an EAC registry about this actor would
    // return "no role" and be indistinguishable from a denial.
    const actor = await resolveActorForWallet(randomWallet())
    createdActorIds.push(actor.id)
    const adapters = await adaptersForActor(actor.id)
    expect(adapters.map((a) => a.name)).toEqual(['local'])
  }, 30_000)
})

describe('V2 Phase 8 — the local adapter', () => {
  it('revokes for real, and confirms by reading back', async () => {
    const { actorId, capabilityId } = await authorizedAction({})
    const result = await localEnforcementAdapter.revoke({
      capabilityId,
      actorId,
      actionType: 'TRADE',
    })
    expect(result.outcome).toBe('CONFIRMED')
    expect(
      (await prisma.capability.findUnique({ where: { id: capabilityId } }))!.status,
    ).toBe('REVOKED')
  }, 60_000)

  it('FAILS rather than confirming a grant that does not exist', async () => {
    const result = await localEnforcementAdapter.grant({
      capabilityId: 'nonexistent',
      actorId: 'nobody',
      actionType: 'TRADE',
      limits: {
        amountLimit: null,
        frequencyLimit: null,
        frequencyWindowSeconds: null,
        allowedTargets: [],
        expiresAt: null,
      },
    })
    expect(result.outcome).toBe('FAILED')
  }, 30_000)

  it('narrows a ceiling without withdrawing the capability', async () => {
    const { actorId, capabilityId } = await authorizedAction({ amountLimit: '1000000' })
    const result = await localEnforcementAdapter.attenuate({
      capabilityId,
      actorId,
      actionType: 'TRADE',
      limits: {
        amountLimit: '500',
        frequencyLimit: 5,
        frequencyWindowSeconds: 86_400,
        allowedTargets: [],
        expiresAt: null,
      },
    })
    expect(result.outcome).toBe('CONFIRMED')
    const capability = await prisma.capability.findUnique({ where: { id: capabilityId } })
    expect(capability!.status).toBe('ACTIVE')
    expect(capability!.amountLimit).toBe('500')
    expect(capability!.capabilityType).toBe('ATTENUATED_GRANT')
  }, 60_000)

  it('an attenuation is immediately felt at the execution boundary', async () => {
    // End to end: narrow the ceiling, then watch the same action stop passing.
    const { intentId, capabilityId } = await authorizedAction({
      amountLimit: '1000000',
      intentAmount: '5000',
    })
    const first = spyExecutor()
    expect((await executeAuthorizedAction(intentId, first.run)).executed).toBe(true)

    await prisma.capability.update({ where: { id: capabilityId }, data: { amountLimit: '100' } })

    const second = spyExecutor()
    const blocked = await executeAuthorizedAction(intentId, second.run)
    expect(second.calls()).toBe(0)
    expect(blocked.status).toBe('BLOCKED_UNENFORCEABLE')
  }, 90_000)
})

describe('V2 Phase 8 — revoking everywhere', () => {
  it('withdraws authority at every applicable boundary', async () => {
    const { actorId, capabilityId, intentId } = await authorizedAction({})
    const verdict = await revokeEverywhere({ capabilityId, actorId, actionType: 'TRADE' })
    expect(verdict.enforced).toBe(true)

    // And the execution boundary now refuses.
    const executor = spyExecutor()
    const outcome = await executeAuthorizedAction(intentId, executor.run)
    expect(executor.calls()).toBe(0)
    expect(outcome.executed).toBe(false)
  }, 90_000)

  it('reports what each boundary currently believes', async () => {
    const { actorId } = await authorizedAction({})
    const status = await enforcementStatus(actorId)
    expect(status.actorId).toBe(actorId)
    expect(status.boundaries.length).toBeGreaterThan(0)
    expect(status.boundaries[0]!.adapter).toBe('local')
    expect(status.boundaries[0]!.enforceable).toBe(true)
  }, 60_000)
})

describe('V2 Phase 8 — over real HTTP', () => {
  it('refuses a blocked execution with 409 and permits an authorized one with 200', async () => {
    const blocked = await authorizedAction({
      amountLimit: '100',
      intentAmount: '900000000000',
    })
    const refused = await auth(request(app).post(`/v2/intents/${blocked.intentId}/execute`))
    expect(refused.status).toBe(409)
    expect(refused.body.executed).toBe(false)
    expect(refused.body.status).toBe('BLOCKED_UNENFORCEABLE')

    const allowed = await authorizedAction({ amountLimit: '1000000', intentAmount: '10' })
    const ran = await auth(request(app).post(`/v2/intents/${allowed.intentId}/execute`))
    expect(ran.status).toBe(200)
    expect(ran.body.executed).toBe(true)
    expect(ran.body.adapters).toContain('local')
  }, 90_000)

  it('404s an unknown intent, and reports an actor’s boundaries', async () => {
    const missing = await auth(request(app).post('/v2/intents/nope/execute'))
    expect(missing.status).toBe(404)

    const { actorId } = await authorizedAction({})
    const status = await auth(request(app).get(`/v2/actors/${actorId}/enforcement`))
    expect(status.status).toBe(200)
    expect(status.body.boundaries[0].adapter).toBe('local')
  }, 90_000)
})
