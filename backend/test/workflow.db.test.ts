/**
 * Temporal workflows — Xander V2 Phase 4, spec section 30.4.
 *
 * NO MOCKS. `TestWorkflowEnvironment` downloads and runs a REAL Temporal
 * server; it is not a simulation. What it adds is a controllable clock, so a
 * one-hour approval timeout is exercised in milliseconds instead of an hour.
 * That is the only way section 30.4's "human approval timeout" case is
 * testable at all.
 *
 * The activities are the real ones, hitting real Postgres. Only the clock moves.
 */
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { NativeConnection, Worker } from '@temporalio/worker'
import { Client, Connection } from '@temporalio/client'

const { prisma } = await import('../src/lib/prisma.js')
const { FIXTURE_CLEAN_WALLET, FIXTURE_CLUSTERED_WALLET } = await import(
  '../src/interfaces/stub-fixtures.js'
)
const activities = await import('../src/workflow/activities.js')
const { authorizationWorkflow } = await import('../src/workflow/authorization.workflow.js')
const { capabilityLeaseWorkflow } = await import('../src/workflow/capability.workflow.js')
const {
  assuranceCompletedSignal,
  authorizationStateQuery,
  operatorDecisionSignal,
  trustChangedSignal,
} = await import('../src/workflow/shared.js')
const { resolveActorForWallet } = await import('../src/actor/actor-resolver.js')
const { grantCapability } = await import('../src/capabilities/capability-service.js')
const { resetPolicyCache } = await import('../src/authorization/native-policy-evaluator.js')
const { env: envConfig } = await import('../src/config/env.js')

let env: TestWorkflowEnvironment
let worker: Worker
let workerRun: Promise<void>
let seeded = false

// The real docker Temporal, used only for the worker-restart test.
let realClient: Client | null = null
let realNativeConnection: NativeConnection | null = null
let realConnection: Connection | null = null
let realServerAvailable = false
const REAL_TASK_QUEUE = 'xander-restart-test'

const TASK_QUEUE = 'xander-test'
const createdActorIds: string[] = []
const createdIntentIds: string[] = []

const workflowsPath = fileURLToPath(new URL('../src/workflow/workflows.ts', import.meta.url))

beforeAll(async () => {
  resetPolicyCache()
  seeded =
    (await prisma.policy.count({ where: { active: true } })) > 0 &&
    (await prisma.evidenceEvent.count({ where: { wallet: FIXTURE_CLEAN_WALLET } })) > 0

  // A real server with a controllable clock.
  env = await TestWorkflowEnvironment.createTimeSkipping()
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities,
  })
  workerRun = worker.run()

  // Optional: the restart test needs the real server. Everything else runs
  // without it, so an unavailable Temporal skips one test rather than failing
  // the file.
  try {
    realConnection = await Connection.connect({
      address: envConfig.TEMPORAL_ADDRESS,
      connectTimeout: 5000,
    })
    realNativeConnection = await NativeConnection.connect({
      address: envConfig.TEMPORAL_ADDRESS,
    })
    realClient = new Client({
      connection: realConnection,
      namespace: envConfig.TEMPORAL_NAMESPACE,
    })
    realServerAvailable = true
  } catch {
    realServerAvailable = false
  }
}, 180_000)

afterAll(async () => {
  worker?.shutdown()
  await workerRun?.catch(() => undefined)
  await env?.teardown()
  await realNativeConnection?.close()
  await realConnection?.close()

  await prisma.intent.deleteMany({ where: { id: { in: createdIntentIds } } })
  await prisma.actor.deleteMany({ where: { id: { in: createdActorIds } } })
  await prisma.$disconnect()
}, 120_000)

/** A real Actor + Intent for a workflow to decide on. */
async function makeIntent(wallet: string, actionType: string, amount: string | null) {
  const actor = await resolveActorForWallet(wallet)
  createdActorIds.push(actor.id)
  const intent = await prisma.intent.create({
    data: {
      actorId: actor.id,
      resourceType: 'campaign',
      resourceId: `wf-${randomBytes(4).toString('hex')}`,
      actionType,
      parametersHash: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
      idempotencyKey: `wf-${randomBytes(8).toString('hex')}`,
      status: 'PENDING',
      amount,
    },
  })
  createdIntentIds.push(intent.id)
  return { actor, intent }
}

const input = (actorId: string, intent: { id: string; resourceId: string }, actionType: string, amount: string | null) => ({
  intentId: intent.id,
  actorId,
  actionType,
  resourceType: 'campaign',
  resourceId: intent.resourceId,
  amount,
  approvalTimeoutSeconds: 3600,
})

describe('Phase 4 — authorization workflow', () => {
  it('completes without waiting when policy allows outright', async () => {
    if (!seeded) return
    const { actor, intent } = await makeIntent(FIXTURE_CLEAN_WALLET, 'CLAIM', '50000000')

    const result = await env.client.workflow.execute(authorizationWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `wf-allow-${intent.id}`,
      args: [input(actor.id, intent, 'CLAIM', '50000000')],
    })

    expect(result.result).toBe('ALLOW')
    expect(result.capabilityId).not.toBeNull()
    expect(result.timedOut).toBe(false)
  }, 120_000)

  it('WAITS for a human, then completes when the approval arrives', async () => {
    if (!seeded) return
    // BORROW requires assurance, so policy returns CHALLENGE and the workflow
    // parks rather than answering.
    const { actor, intent } = await makeIntent(FIXTURE_CLEAN_WALLET, 'BORROW', '1000000000')

    const handle = await env.client.workflow.start(authorizationWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `wf-wait-${intent.id}`,
      args: [input(actor.id, intent, 'BORROW', '1000000000')],
    })

    // It is genuinely parked, not finished.
    await vi.waitFor(async () => {
      expect(await handle.query('phase')).toBe('AWAITING_ASSURANCE')
    }, { timeout: 30_000 })

    await handle.signal(operatorDecisionSignal, {
      command: 'APPROVE',
      operatorId: 'op-test',
    })

    const result = await handle.result()
    expect(result.timedOut).toBe(false)
    expect(result.history.some((h) => h.includes('operator APPROVE'))).toBe(true)
    expect(result.history.some((h) => h.includes('re-evaluating'))).toBe(true)
  }, 180_000)

  it('A TIMEOUT IS NOT AN APPROVAL — it holds for REVIEW', async () => {
    if (!seeded) return
    // Section 27.5, fail closed. The clock is skipped forward past the hour;
    // nobody answers.
    const { actor, intent } = await makeIntent(FIXTURE_CLEAN_WALLET, 'BORROW', '1000000000')

    const result = await env.client.workflow.execute(authorizationWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `wf-timeout-${intent.id}`,
      args: [input(actor.id, intent, 'BORROW', '1000000000')],
    })

    expect(result.timedOut).toBe(true)
    expect(result.result).toBe('REVIEW')
    expect(result.result).not.toBe('ALLOW')
    expect(result.reasonCode).toBe('APPROVAL_TIMED_OUT')
    expect(result.capabilityId).toBeNull()
  }, 180_000)

  it('an operator DENY is final and grants nothing', async () => {
    if (!seeded) return
    const { actor, intent } = await makeIntent(FIXTURE_CLEAN_WALLET, 'BORROW', '1000000000')

    const handle = await env.client.workflow.start(authorizationWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `wf-deny-${intent.id}`,
      args: [input(actor.id, intent, 'BORROW', '1000000000')],
    })
    await vi.waitFor(async () => {
      expect(await handle.query('phase')).toBe('AWAITING_ASSURANCE')
    }, { timeout: 30_000 })

    await handle.signal(operatorDecisionSignal, { command: 'DENY', operatorId: 'op-test' })

    const result = await handle.result()
    expect(result.result).toBe('BLOCK')
    expect(result.reasonCode).toBe('OPERATOR_DENY')
    expect(result.capabilityId).toBeNull()
  }, 180_000)

  it('AN OPERATOR CANNOT OVERRIDE A POLICY THAT BLOCKS', async () => {
    if (!seeded) return
    // Invariant 3.1 — the human is a gate in ADDITION to policy, never a
    // bypass of it. The ring wallet bands CRITICAL, which policy blocks
    // outright, and an APPROVE must not turn that into a grant.
    const { actor, intent } = await makeIntent(FIXTURE_CLUSTERED_WALLET, 'CLAIM', '10000000')

    const handle = await env.client.workflow.start(authorizationWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `wf-noverride-${intent.id}`,
      args: [input(actor.id, intent, 'CLAIM', '10000000')],
    })
    await handle.signal(operatorDecisionSignal, { command: 'APPROVE', operatorId: 'op-test' })

    const result = await handle.result()
    expect(result.result).toBe('BLOCK')
    expect(result.capabilityId).toBeNull()
  }, 180_000)

  it('re-evaluates when trust changes during the wait', async () => {
    if (!seeded) return
    // Section 30.4's "live trust change during wait".
    const { actor, intent } = await makeIntent(FIXTURE_CLEAN_WALLET, 'BORROW', '1000000000')

    const handle = await env.client.workflow.start(authorizationWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `wf-trust-${intent.id}`,
      args: [input(actor.id, intent, 'BORROW', '1000000000')],
    })
    await vi.waitFor(async () => {
      expect(await handle.query('phase')).toBe('AWAITING_ASSURANCE')
    }, { timeout: 30_000 })

    await handle.signal(trustChangedSignal, { band: 'HIGH_RISK', snapshotId: 'snap-test' })
    await handle.signal(assuranceCompletedSignal, {
      level: 'WORLD_ONLY',
      leaseId: 'lease-test',
      verifiedAt: new Date().toISOString(),
    })

    const result = await handle.result()
    expect(result.history.some((h) => h.includes('trust changed'))).toBe(true)
    expect(result.history.some((h) => h.includes('re-evaluated'))).toBe(true)
  }, 180_000)

  it('exposes progress by query while parked', async () => {
    if (!seeded) return
    const { actor, intent } = await makeIntent(FIXTURE_CLEAN_WALLET, 'BORROW', '1000000000')
    const handle = await env.client.workflow.start(authorizationWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `wf-query-${intent.id}`,
      args: [input(actor.id, intent, 'BORROW', '1000000000')],
    })

    await vi.waitFor(async () => {
      const state = (await handle.query(authorizationStateQuery)) as {
        awaiting: string | null
        history: string[]
      }
      expect(state.awaiting).toBe('assurance')
      expect(state.history.length).toBeGreaterThan(0)
    }, { timeout: 30_000 })

    await handle.signal(operatorDecisionSignal, { command: 'DENY', operatorId: 'op-test' })
    await handle.result()
  }, 180_000)
})

describe('Phase 4 — THE ACCEPTANCE CONDITION: surviving a worker restart', () => {
  it('a parked workflow survives the worker dying and completes on a new one', async () => {
    if (!seeded || !realServerAvailable) return
    // Phase 4's "done when", asserted literally: a workflow can survive worker
    // restart, wait for human input, receive a new signal, re-evaluate policy
    // and complete correctly.
    //
    // Run against the REAL Temporal server, not the time-skipping harness. In
    // time-skipping mode the clock jumps forward whenever nothing can make
    // progress, so killing the worker is indistinguishable from an hour
    // elapsing and the approval simply times out. Real wall-clock time is the
    // only way "the worker was gone and it still worked" means anything.
    const { actor, intent } = await makeIntent(FIXTURE_CLEAN_WALLET, 'BORROW', '1000000000')

    let liveWorker = await Worker.create({
      connection: realNativeConnection!,
      namespace: envConfig.TEMPORAL_NAMESPACE,
      taskQueue: REAL_TASK_QUEUE,
      workflowsPath,
      activities,
    })
    let liveRun = liveWorker.run()

    const handle = await realClient!.workflow.start(authorizationWorkflow, {
      taskQueue: REAL_TASK_QUEUE,
      workflowId: `wf-restart-${intent.id}`,
      args: [input(actor.id, intent, 'BORROW', '1000000000')],
    })

    await vi.waitFor(
      async () => {
        expect(await handle.query('phase')).toBe('AWAITING_ASSURANCE')
      },
      { timeout: 60_000 },
    )

    // Kill the worker that started it. Nothing is polling the queue now.
    liveWorker.shutdown()
    await liveRun.catch(() => undefined)

    // The signal lands while NO worker exists. Temporal records it in the
    // workflow's history rather than dropping it on the floor.
    await handle.signal(operatorDecisionSignal, {
      command: 'APPROVE',
      operatorId: 'op-after-restart',
    })

    // A brand new worker — a different process object entirely — picks the
    // workflow up mid-wait and drives it to completion.
    liveWorker = await Worker.create({
      connection: realNativeConnection!,
      namespace: envConfig.TEMPORAL_NAMESPACE,
      taskQueue: REAL_TASK_QUEUE,
      workflowsPath,
      activities,
    })
    liveRun = liveWorker.run()

    try {
      const result = await handle.result()
      expect(result.history.some((h) => h.includes('op-after-restart'))).toBe(true)
      expect(result.history.some((h) => h.includes('re-evaluating'))).toBe(true)
      expect(result.timedOut).toBe(false)
    } finally {
      liveWorker.shutdown()
      await liveRun.catch(() => undefined)
    }
  }, 240_000)
})

describe('Phase 4 — capability lease workflow', () => {
  it('revokes rather than renewing when trust has gone bad', async () => {
    if (!seeded) return
    const actor = await resolveActorForWallet(FIXTURE_CLUSTERED_WALLET)
    createdActorIds.push(actor.id)
    const capability = await grantCapability({
      actorId: actor.id,
      actionType: 'TRADE',
      resourceScope: 'test',
      limits: {
        amountLimit: '1000000000',
        frequencyLimit: null,
        frequencyWindowSeconds: null,
        allowedTargets: [],
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      attenuated: false,
    })

    const result = await env.client.workflow.execute(capabilityLeaseWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `lease-bad-${capability.id}`,
      args: [
        {
          capabilityId: capability.id,
          actorId: actor.id,
          actionType: 'TRADE',
          leaseSeconds: 3600,
          maxRenewals: 3,
        },
      ],
    })

    // The ring wallet bands CRITICAL, so the lease ends instead of rolling over.
    expect(result.finalAction).toBe('REVOKED')
    const after = await prisma.capability.findUnique({ where: { id: capability.id } })
    expect(after!.status).toBe('REVOKED')
  }, 180_000)

  it('an operator REVOKE ends the lease immediately, without waiting it out', async () => {
    if (!seeded) return
    const actor = await resolveActorForWallet(FIXTURE_CLEAN_WALLET)
    createdActorIds.push(actor.id)
    const capability = await grantCapability({
      actorId: actor.id,
      actionType: 'API_REQUEST',
      resourceScope: 'test',
      limits: {
        amountLimit: null,
        frequencyLimit: 100,
        frequencyWindowSeconds: 3600,
        allowedTargets: [],
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      attenuated: false,
    })

    const handle = await env.client.workflow.start(capabilityLeaseWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `lease-revoke-${capability.id}`,
      args: [
        {
          capabilityId: capability.id,
          actorId: actor.id,
          actionType: 'API_REQUEST',
          // A day-long lease the operator does not wait out.
          leaseSeconds: 86_400,
          maxRenewals: 5,
        },
      ],
    })

    await handle.signal(operatorDecisionSignal, { command: 'REVOKE', operatorId: 'op-test' })

    const result = await handle.result()
    expect(result.finalAction).toBe('REVOKED')
    expect(result.history.some((h) => h.includes('woken early'))).toBe(true)
  }, 180_000)
})
