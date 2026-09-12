/**
 * `npm run check:enforcement` — Phase 8, section 18, proven on real Sepolia.
 *
 * The question this script answers is the only one that matters for Phase 8:
 * when Xander says an action is authorized, is that claim backed by something
 * outside Xander's own database — and when it says no, does the action actually
 * not happen?
 *
 *   agent with a real ENS identity
 *     -> BOTH boundaries confirm            -> executor runs
 *     -> on-chain role revoked for real     -> executor never runs again
 *
 * Real Postgres, real ENSv2 EAC on Sepolia, real transactions, real gas.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { prisma } from '../src/lib/prisma.js'
import { env } from '../src/config/env.js'
import { resolveActorForWallet } from '../src/actor/actor-resolver.js'
import { createAgentWithIdentity, establishAssurance } from '../src/agents/agent-service.js'
import { agentRegistryAddress, operatorAccount } from '../src/ens/ens-client.js'
import {
  adaptersForActor,
  enforcementStatus,
  verifyEnforcement,
} from '../src/authorization/enforcement/enforcement-service.js'
import { ensEacEnforcementAdapter } from '../src/authorization/enforcement/ens-eac-adapter.js'
import { executeAuthorizedAction } from '../src/authorization/enforcement/execution-service.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(30)} ${detail}`)
const bad = (label: string, detail: string) => {
  console.log(`  [FAIL] ${label.padEnd(30)} ${detail}`)
  process.exitCode = 1
}

const labelArg = process.argv.indexOf('--label')
const LABEL =
  labelArg >= 0 ? (process.argv[labelArg + 1] ?? 'enf') : `e${randomBytes(3).toString('hex')}`

/** A side effect that is observable, so "blocked" means blocked. */
function spyExecutor(): { run: () => Promise<{ txHash: string }>; calls: () => number } {
  let calls = 0
  return {
    run: async () => {
      calls++
      return { txHash: `0xside-effect-${calls}` }
    },
    calls: () => calls,
  }
}

async function intentFor(actorId: string, actionType: string, amount: string): Promise<string> {
  const intent = await prisma.intent.create({
    data: {
      actorId,
      resourceType: 'enforcement-check',
      resourceId: LABEL,
      actionType,
      amount,
      parametersHash: randomBytes(16).toString('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
      idempotencyKey: randomUUID(),
      status: 'DECIDED',
    },
  })
  const decision = await prisma.authorizationDecision.create({
    data: {
      intentId: intent.id,
      policyVersion: 'check-enforcement',
      result: 'ALLOW',
      reasonCode: 'CHECK',
      reasonSummary: 'enforcement check fixture',
      evidenceIds: [],
      riskScore: 0,
      confidence: 'HIGH',
    },
  })
  await prisma.actionReceipt.create({
    data: {
      intentId: intent.id,
      decisionId: decision.id,
      actorId,
      policyVersion: 'check-enforcement',
      evidenceSnapshotHash: 'check',
      decisionPayloadHash: 'check',
    },
  })
  return intent.id
}

async function main(): Promise<void> {
  if (!operatorAccount) throw new Error('ENS_OPERATOR_PRIVATE_KEY is required.')
  if (!agentRegistryAddress) throw new Error('ENS_AGENT_REGISTRY is required.')

  console.log('\nEnforcement boundary — end to end on Sepolia')
  console.log(`  registry: ${agentRegistryAddress}`)
  console.log(`  agent:    ${LABEL}.${env.ENS_PARENT_LABEL}.eth\n`)

  const wallet = `0x${randomBytes(20).toString('hex')}`
  const actor = await resolveActorForWallet(wallet)

  // --- 1. an agent with a real on-chain identity ---------------------------
  const { agent, ens } = await createAgentWithIdentity({
    actorId: actor.id,
    name: 'enforcement check agent',
    ensLabel: LABEL,
  })
  if (ens.succeeded) ok('identity minted', `${agent.ensName}`)
  else bad('identity minted', ens.detail)

  // The chain boundary applies from the moment the NAME exists, not from the
  // moment authority is granted — a name that holds no roles is a boundary that
  // refuses, which is exactly what it should do before assurance.
  const before = await adaptersForActor(actor.id)
  ok('boundaries before assurance', before.map((a) => a.name).join(' + '))
  const preVerdict = await verifyEnforcement({ actorId: actor.id, actionType: 'CLAIM' })
  if (!preVerdict.enforced) ok('nothing authorized yet', preVerdict.reason)
  else bad('nothing authorized yet', 'a freshly minted name authorized an action')

  // --- 2. assurance grants capabilities and mirrors them on-chain ----------
  const claim = await prisma.claim.create({
    data: {
      wallet,
      campaignId: `enf-${randomBytes(3).toString('hex')}`,
      riskDecision: 'CHALLENGE',
    },
  })
  const world = await prisma.verificationChallenge.create({
    data: {
      claimId: claim.id,
      wallet,
      status: 'PASSED',
      worldActionId: `claim-enf-${randomBytes(3).toString('hex')}`,
      signalHash: randomBytes(32).toString('hex'),
      resolvedAt: new Date(),
    },
  })
  const assured = await establishAssurance({ agentId: agent.id, worldChallengeId: world.id })
  ok('capabilities granted', `${assured.capabilityIds.length}`)
  if (assured.ens.succeeded) ok('roles mirrored on-chain', assured.ens.detail)
  else bad('roles mirrored on-chain', assured.ens.detail)

  const adapters = await adaptersForActor(actor.id)
  const names = adapters.map((a) => a.name)
  if (names.includes('ens-eac')) ok('boundaries after assurance', names.join(' + '))
  else bad('boundaries after assurance', `expected ens-eac, got ${names.join(', ')}`)

  // --- 3. pick an action BOTH boundaries actually govern -------------------
  const capabilities = await prisma.capability.findMany({
    where: { actorId: actor.id, status: 'ACTIVE' },
    select: { actionType: true, amountLimit: true },
  })
  const state = await enforcementStatus(actor.id)
  const dual = state.boundaries.filter((b) => b.adapter === 'ens-eac' && b.enforceable === true)
  if (dual.length === 0) {
    bad('dual-governed action', 'no capability is enforced on-chain')
    await prisma.$disconnect()
    return
  }
  const actionType = dual[0]!.actionType
  const limit = capabilities.find((c) => c.actionType === actionType)?.amountLimit ?? null
  ok('dual-governed action', `${actionType} (local + ens-eac)`)

  const verdict = await verifyEnforcement({ actorId: actor.id, actionType, amount: '1' })
  if (verdict.enforced && verdict.adapters.includes('ens-eac')) {
    ok('both boundaries confirm', verdict.reason)
  } else {
    bad('both boundaries confirm', verdict.reason)
  }

  // --- 4. an authorized action runs ----------------------------------------
  const goodIntent = await intentFor(actor.id, actionType, '1')
  const first = spyExecutor()
  const executed = await executeAuthorizedAction(goodIntent, first.run)
  if (executed.executed && first.calls() === 1) {
    ok('authorized action ran', `${executed.status} via ${executed.adapters.join(' + ')}`)
  } else {
    bad('authorized action ran', `${executed.status}: ${executed.reason}`)
  }

  // --- 5. a high-value action is refused by the LOCAL ceiling --------------
  if (limit) {
    const overLimit = (BigInt(limit) * 1000n).toString()
    const bigIntent = await intentFor(actor.id, actionType, overLimit)
    const spy = spyExecutor()
    const blocked = await executeAuthorizedAction(bigIntent, spy.run)
    if (!blocked.executed && spy.calls() === 0) {
      ok('high-value action refused', blocked.reason)
    } else {
      bad('high-value action refused', `executor ran ${spy.calls()} times`)
    }
  }

  // --- 6. REVOKE THE ROLE ON-CHAIN, and watch the boundary close -----------
  // This is the part that cannot be faked. The database still holds an ACTIVE
  // capability; only the public chain changed.
  const revoked = await ensEacEnforcementAdapter.revoke({
    capabilityId: assured.capabilityIds[0] ?? '',
    actorId: actor.id,
    actionType,
  })
  if (revoked.outcome === 'CONFIRMED') ok('on-chain role revoked', `tx ${revoked.reference}`)
  else bad('on-chain role revoked', `${revoked.outcome}: ${revoked.detail}`)

  const localStillActive = await prisma.capability.count({
    where: { actorId: actor.id, actionType, status: 'ACTIVE' },
  })
  if (localStillActive > 0) {
    ok('database unchanged', `${localStillActive} capability still ACTIVE locally`)
  } else {
    bad('database unchanged', 'the local capability was also revoked; this test proves less')
  }

  const afterVerdict = await verifyEnforcement({ actorId: actor.id, actionType, amount: '1' })
  if (!afterVerdict.enforced) ok('verdict now refuses', afterVerdict.reason)
  else bad('verdict now refuses', 'both boundaries still confirm after an on-chain revoke')

  const lastIntent = await intentFor(actor.id, actionType, '1')
  const last = spyExecutor()
  const finalOutcome = await executeAuthorizedAction(lastIntent, last.run)
  if (!finalOutcome.executed && last.calls() === 0) {
    ok('ACTION PREVENTED BY CHAIN', finalOutcome.reason)
  } else {
    bad('ACTION PREVENTED BY CHAIN', `executor ran ${last.calls()} times`)
  }

  console.log(
    process.exitCode
      ? '\nEnforcement check FAILED.\n'
      : '\nEnforcement proven: authority removed on-chain stops the action in Xander.\n',
  )
  await prisma.$disconnect()
}

main().catch(async (err: unknown) => {
  console.error('\ncheck:enforcement failed\n', err)
  process.exitCode = 1
  await prisma.$disconnect()
})
