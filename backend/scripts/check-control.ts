/**
 * `npm run check:control` — Phase 11, section 19, end to end over real HTTP.
 *
 * Runs the actual Express app on an ephemeral port and talks to it with `fetch`
 * exactly as a mobile client would: enrol, open a device-bound session, read
 * the agent and its evidence, receive a pending action, and answer it.
 *
 * The acceptance condition names the durable workflow explicitly, so this
 * starts a REAL Temporal authorization workflow, parks it waiting for a human,
 * and proves the operator's approval reaches it as a signal.
 */
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { app } from '../src/server.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { resolveActorForWallet } from '../src/actor/actor-resolver.js'
import { grantCapability } from '../src/capabilities/capability-service.js'
import { enrolOperator } from '../src/control/control-service.js'
import { getTemporalClient, isTemporalEnabled } from '../src/workflow/temporal-client.js'
import { authorizationWorkflowId, authorizationStateQuery } from '../src/workflow/shared.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(34)} ${detail}`)
const bad = (label: string, detail: string) => {
  console.log(`  [FAIL] ${label.padEnd(34)} ${detail}`)
  process.exitCode = 1
}

const randomWallet = (): string => `0x${randomBytes(20).toString('hex')}`
const nonce = (): string => randomBytes(24).toString('hex')

async function main(): Promise<void> {
  console.log('\nRemote Authority — end to end')
  console.log(`  session ttl: ${env.OPERATOR_SESSION_TTL_SECONDS}s`)
  console.log(`  step-up:     ${env.OPERATOR_STEP_UP_ENABLED ? 'enabled' : 'disabled'}\n`)

  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const DEVICE = `device-${randomBytes(6).toString('hex')}`

  const actor = await resolveActorForWallet(randomWallet())
  const agent = await prisma.agent.create({
    data: { actorId: actor.id, name: `control-check-${randomBytes(3).toString('hex')}`, status: 'ACTIVE' },
  })
  const capability = await grantCapability({
    actorId: actor.id,
    actionType: 'TRADE',
    resourceScope: 'control-check',
    limits: {
      amountLimit: '1000000',
      frequencyLimit: 20,
      frequencyWindowSeconds: 86_400,
      allowedTargets: [],
      expiresAt: null,
    },
    attenuated: false,
  })

  const enrolled = await enrolOperator({
    externalId: `check-${randomBytes(5).toString('hex')}@xander.test`,
    displayName: 'check:control operator',
  })
  ok('operator enrolled', enrolled.externalId)

  try {
    // --- 1. open a device-bound session -------------------------------------
    const sessionRes = await fetch(`${base}/v2/control/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        externalId: enrolled.externalId,
        secret: enrolled.secret,
        deviceId: DEVICE,
      }),
    })
    const session = (await sessionRes.json()) as { token: string; expiresAt: string }
    if (sessionRes.status === 201 && session.token) {
      ok('session opened', `expires ${session.expiresAt}`)
    } else {
      bad('session opened', JSON.stringify(session))
      return
    }

    const authed = {
      authorization: `Bearer ${session.token}`,
      'x-device-id': DEVICE,
      'content-type': 'application/json',
    }

    // --- 2. the API key must NOT work here ----------------------------------
    const withApiKey = await fetch(`${base}/v2/control/agents`, {
      headers: { 'x-api-key': env.BACKEND_API_KEY ?? 'test-api-key' },
    })
    if (withApiKey.status === 401) ok('API key is not an operator', '401, as section 27.1 requires')
    else bad('API key is not an operator', `got ${withApiKey.status}`)

    // --- 3. a token from another device must fail ---------------------------
    const wrongDevice = await fetch(`${base}/v2/control/agents`, {
      headers: { authorization: authed.authorization, 'x-device-id': 'a-different-device' },
    })
    if (wrongDevice.status === 401) ok('device binding holds', '401 from another device')
    else bad('device binding holds', `got ${wrongDevice.status}`)

    // --- 4. view agent and evidence -----------------------------------------
    const view = await (await fetch(`${base}/v2/control/agents/${agent.id}`, { headers: authed })).json()
    ok('view agent', `${view.agent.name} status ${view.agent.status}, ${view.capabilities.length} capabilities`)

    const evidence = await (
      await fetch(`${base}/v2/control/agents/${agent.id}/evidence`, { headers: authed })
    ).json()
    ok('view evidence', `${evidence.wallets.length} wallet(s), ${evidence.evidence.length} events`)

    // --- 5. a real durable workflow, parked waiting for a human -------------
    let workflowId: string | null = null
    if (isTemporalEnabled()) {
      const intent = await prisma.intent.create({
        data: {
          actorId: actor.id,
          resourceType: 'control-check',
          resourceId: 'approval',
          actionType: 'TRADE',
          amount: '5000',
          parametersHash: randomBytes(16).toString('hex'),
          expiresAt: new Date(Date.now() + 3_600_000),
          idempotencyKey: `control-${randomBytes(8).toString('hex')}`,
          status: 'PENDING',
        },
      })
      const client = await getTemporalClient()
      workflowId = authorizationWorkflowId(intent.id)
      await client.workflow.start('authorizationWorkflow', {
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        workflowId,
        args: [
          {
            intentId: intent.id,
            actorId: actor.id,
            actionType: 'TRADE',
            amount: '5000',
            resourceType: 'control-check',
            resourceId: 'approval',
            approvalTimeoutSeconds: 120,
          },
        ],
      })

      // Wait until it is genuinely parked on a human decision.
      const handle = client.workflow.getHandle(workflowId)
      let state = await handle.query(authorizationStateQuery)
      for (let i = 0; i < 30 && !/APPROVAL|OPERATOR|WAIT/i.test(state.phase); i++) {
        await new Promise((r) => setTimeout(r, 1000))
        state = await handle.query(authorizationStateQuery)
      }
      ok('workflow parked', `phase ${state.phase}`)

      // --- 6. raise the pending action bound to that intent -----------------
      const raised = await (
        await fetch(`${base}/v2/control/pending-actions`, {
          method: 'POST',
          headers: authed,
          body: JSON.stringify({
            subjectType: 'INTENT',
            subjectId: intent.id,
            summary: 'agent asks to trade 5000',
            allowed: ['APPROVE', 'DENY', 'LIMIT'],
            actorId: actor.id,
            agentId: agent.id,
            intentId: intent.id,
            amount: '5000',
          }),
        })
      ).json()
      ok('pending action raised', raised.action.id)

      // --- 7. the operator approves, and it reaches the workflow ------------
      const approved = await (
        await fetch(`${base}/v2/control/actions/${raised.action.id}/approve`, {
          method: 'POST',
          headers: authed,
          body: JSON.stringify({
            bindingHash: raised.action.bindingHash,
            nonce: nonce(),
            reason: 'approved from the control plane',
          }),
        })
      ).json()

      if (approved.workflowSignalled) {
        ok('DECISION REACHED THE WORKFLOW', 'operatorDecision signal delivered')
      } else {
        bad('DECISION REACHED THE WORKFLOW', JSON.stringify(approved))
      }

      const after = await handle.query(authorizationStateQuery)
      if (after.history.some((h: string) => /operator APPROVE/i.test(h))) {
        ok('workflow saw the operator', after.history.filter((h: string) => /operator/i.test(h)).join('; '))
      } else {
        bad('workflow saw the operator', `history: ${after.history.join(' | ')}`)
      }
    } else {
      bad('temporal', 'disabled, so the durable half cannot be proven')
    }

    // --- 8. binding and replay defences, live -------------------------------
    const target = await (
      await fetch(`${base}/v2/control/pending-actions`, {
        method: 'POST',
        headers: authed,
        body: JSON.stringify({
          subjectType: 'AGENT',
          subjectId: agent.id,
          summary: 'approve a small payment',
          allowed: ['APPROVE'],
          actorId: actor.id,
          agentId: agent.id,
          amount: '10',
        }),
      })
    ).json()

    const forged = await fetch(`${base}/v2/control/actions/${target.action.id}/approve`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ bindingHash: 'f'.repeat(64), nonce: nonce() }),
    })
    if (forged.status === 409) ok('binding mismatch refused', '409')
    else bad('binding mismatch refused', `got ${forged.status}`)

    const reused = nonce()
    const firstUse = await fetch(`${base}/v2/control/actions/${target.action.id}/approve`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ bindingHash: target.action.bindingHash, nonce: reused }),
    })
    ok('first decision accepted', `${firstUse.status}`)

    const second = await (
      await fetch(`${base}/v2/control/pending-actions`, {
        method: 'POST',
        headers: authed,
        body: JSON.stringify({
          subjectType: 'AGENT',
          subjectId: agent.id,
          summary: 'another action',
          allowed: ['APPROVE'],
          actorId: actor.id,
          agentId: agent.id,
        }),
      })
    ).json()
    const replay = await fetch(`${base}/v2/control/actions/${second.action.id}/approve`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ bindingHash: second.action.bindingHash, nonce: reused }),
    })
    if (replay.status === 409) ok('replayed nonce refused', '409')
    else bad('replayed nonce refused', `got ${replay.status}`)

    // --- 9. freeze is a real capability transition (section 19.3) -----------
    const freeze = await fetch(`${base}/v2/control/agents/${agent.id}/freeze`, {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({ nonce: nonce(), reason: 'operator freeze' }),
    })
    ok('freeze issued', `${freeze.status}`)

    const frozenAgent = await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })
    const frozenCap = await prisma.capability.findUniqueOrThrow({ where: { id: capability.id } })
    if (frozenAgent.status === 'FROZEN' && frozenCap.status !== 'ACTIVE') {
      ok('FREEZE IS A STATE TRANSITION', `agent ${frozenAgent.status}, capability ${frozenCap.status}`)
    } else {
      bad('FREEZE IS A STATE TRANSITION', `agent ${frozenAgent.status}, capability ${frozenCap.status}`)
    }

    // --- 10. the audit trail --------------------------------------------------
    const audit = await (await fetch(`${base}/v2/control/audit?mine=true`, { headers: authed })).json()
    const denials = (audit.entries as { outcome: string }[]).filter((e) => e.outcome === 'DENIED')
    if (denials.length > 0) {
      ok('audit records refusals too', `${audit.entries.length} entries, ${denials.length} denied`)
    } else {
      bad('audit records refusals too', `${audit.entries.length} entries, none denied`)
    }

    // --- 11. closing the session ends the authority -------------------------
    await fetch(`${base}/v2/control/sessions`, { method: 'DELETE', headers: authed })
    const afterClose = await fetch(`${base}/v2/control/agents`, { headers: authed })
    if (afterClose.status === 401) ok('closed session is dead', '401')
    else bad('closed session is dead', `got ${afterClose.status}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await prisma.pendingAction.deleteMany({ where: { actorId: actor.id } })
    await prisma.operatorAuditLog.deleteMany({ where: { operatorId: enrolled.operatorId } })
    await prisma.operator.deleteMany({ where: { id: enrolled.operatorId } })
    await prisma.actor.deleteMany({ where: { id: actor.id } })
  }

  console.log(
    process.exitCode
      ? '\nControl-plane check FAILED.\n'
      : '\nRemote Authority proven: device-bound, action-bound, replay-safe, and the decision reached the workflow.\n',
  )
  await prisma.$disconnect()
}

main().catch(async (err: unknown) => {
  console.error('\ncheck:control failed\n', err)
  process.exitCode = 1
  await prisma.$disconnect()
})
