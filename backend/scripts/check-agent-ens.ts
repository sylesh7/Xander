/**
 * `npm run check:agent-ens` — the whole agent story, end to end, on-chain.
 *
 * Real Postgres, real ENSv2 on Sepolia, real transactions. Proves that an
 * agent's authority in Xander and its authority on the public chain are the
 * same thing, kept in step:
 *
 *   create + mint identity -> World assurance -> capability envelope
 *   -> EAC roles granted -> freeze -> EAC roles revoked
 *
 * Idempotent on the ENS name; pass --label to use a fresh one.
 */
import { randomBytes } from 'node:crypto'
import { prisma } from '../src/lib/prisma.js'
import { env } from '../src/config/env.js'
import { resolveActorForWallet } from '../src/actor/actor-resolver.js'
import {
  createAgentWithIdentity,
  establishAssurance,
  freezeAgent,
} from '../src/agents/agent-service.js'
import { readAgentEnsState } from '../src/agents/agent-ens.js'
import { agentRegistryAddress, operatorAccount } from '../src/ens/ens-client.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(26)} ${detail}`)
const bad = (label: string, detail: string) => {
  console.log(`  [FAIL] ${label.padEnd(26)} ${detail}`)
  process.exitCode = 1
}

const labelArg = process.argv.indexOf('--label')
const LABEL =
  labelArg >= 0 ? (process.argv[labelArg + 1] ?? 'demo') : `a${randomBytes(3).toString('hex')}`

async function main(): Promise<void> {
  if (!operatorAccount) throw new Error('ENS_OPERATOR_PRIVATE_KEY is required.')
  if (!agentRegistryAddress) throw new Error('ENS_AGENT_REGISTRY is required.')

  console.log('\nAgent + ENS end-to-end')
  console.log(`  registry: ${agentRegistryAddress}`)
  console.log(`  agent:    ${LABEL}.${env.ENS_PARENT_LABEL}.eth\n`)

  const wallet = `0x${randomBytes(20).toString('hex')}`
  const actor = await resolveActorForWallet(wallet)

  // --- 1. create the agent and mint its on-chain identity -------------------
  const { agent, ens } = await createAgentWithIdentity({
    actorId: actor.id,
    name: 'ENS demo agent',
    ensLabel: LABEL,
  })
  if (ens.succeeded) ok('identity minted', `${agent.ensName} (tx ${ens.txHash ?? 'existing'})`)
  else bad('identity minted', ens.detail)

  const afterMint = await readAgentEnsState(agent.id)
  if (afterMint?.registered) {
    ok('registered on-chain', afterMint.fqdn ?? '?')
    ok('on-chain expiry', afterMint.expiresAt?.toISOString() ?? '?')
  } else {
    bad('registered on-chain', 'the registry does not show this name')
  }
  // Nothing has been authorised yet, so the public record must show nothing.
  if ((afterMint?.onChainActions.length ?? 0) === 0) {
    ok('roles before assurance', 'none — a name is not an authorisation')
  } else {
    bad('roles before assurance', `unexpected roles: ${afterMint?.onChainActions.join(', ')}`)
  }

  // --- 2. World assurance -> capability envelope -> EAC roles ---------------
  const claim = await prisma.claim.create({
    data: { wallet, campaignId: `ens-demo-${randomBytes(3).toString('hex')}`, riskDecision: 'CHALLENGE' },
  })
  const world = await prisma.verificationChallenge.create({
    data: {
      claimId: claim.id,
      wallet,
      status: 'PASSED',
      worldActionId: `claim-ens-${randomBytes(3).toString('hex')}`,
      signalHash: randomBytes(32).toString('hex'),
      resolvedAt: new Date(),
    },
  })

  const assured = await establishAssurance({ agentId: agent.id, worldChallengeId: world.id })
  ok('agent status', assured.agent.status)
  ok('assurance lease', `${assured.level}, expires ${assured.expiresAt.toISOString()}`)
  ok('capabilities granted', `${assured.capabilityIds.length}`)
  if (assured.ens.succeeded) ok('roles mirrored on-chain', assured.ens.detail)
  else bad('roles mirrored on-chain', assured.ens.detail)

  const afterGrant = await readAgentEnsState(agent.id)
  const granted = afterGrant?.onChainActions ?? []
  if (granted.length > 0) ok('roles readable by anyone', granted.join(', '))
  else bad('roles readable by anyone', 'no roles visible on-chain after assurance')

  // The database and the chain must agree on WHICH actions are permitted.
  const dbActions = (
    await prisma.capability.findMany({
      where: { actorId: actor.id, status: 'ACTIVE' },
      select: { actionType: true },
      distinct: ['actionType'],
    })
  ).map((c) => c.actionType)
  const missing = dbActions.filter((a) => !granted.includes(a as never))
  if (missing.length === 0) ok('db and chain agree', `${dbActions.join(', ')}`)
  else bad('db and chain agree', `in the database but not on-chain: ${missing.join(', ')}`)

  // --- 3. freeze -> real on-chain revocation --------------------------------
  const frozen = await freezeAgent(agent.id, 'end-to-end check')
  ok('frozen', `${frozen.agent.status}, ${frozen.suspended} capabilities suspended`)
  if (frozen.ens.succeeded) ok('roles revoked on-chain', `tx ${frozen.ens.txHash}`)
  else bad('roles revoked on-chain', frozen.ens.detail)

  const afterFreeze = await readAgentEnsState(agent.id)
  if ((afterFreeze?.onChainActions.length ?? 0) === 0) {
    ok('authority actually gone', 'no roles remain on-chain')
  } else {
    bad('authority actually gone', `still holds ${afterFreeze?.onChainActions.join(', ')}`)
  }
  // The name survives a freeze — the agent still exists, it just cannot act.
  if (afterFreeze?.registered) ok('identity survives freeze', afterFreeze.fqdn ?? '?')
  else bad('identity survives freeze', 'the name disappeared')

  console.log('\nAgent identity and authority verified on-chain, end to end.\n')
  await prisma.$disconnect()
}

main().catch(async (err: unknown) => {
  console.error('\ncheck:agent-ens failed\n', err)
  process.exitCode = 1
  await prisma.$disconnect()
})
