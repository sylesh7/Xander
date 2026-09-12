/**
 * `npm run check:ens-agent` — the full agent-identity lifecycle, on-chain.
 *
 * Real transactions against ENSv2 on Sepolia. Proves, end to end:
 *   1. an agent exists as a subname with a real on-chain expiry
 *   2. capabilities become EAC roles, readable by anyone
 *   3. freeze is a REAL revocation, not a database flag
 *
 * Idempotent — re-running reuses the same agent name and re-grants.
 */
import { formatEther } from 'viem'
import { env } from '../src/config/env.js'
import { agentRegistryAddress, operatorAccount, publicClient } from '../src/ens/ens-client.js'
import {
  grantAgentRoles,
  hasOnChainRole,
  readAgentName,
  registerAgentName,
  revokeAgentRoles,
} from '../src/ens/agent-identity.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(24)} ${detail}`)
const bad = (label: string, detail: string) => {
  console.log(`  [FAIL] ${label.padEnd(24)} ${detail}`)
  process.exitCode = 1
}

// From argv, not process.env: env.ts is the only file permitted to read the
// environment (Section 0.2), and that rule holds for scripts too.
const labelArgIndex = process.argv.indexOf('--label')
const AGENT_LABEL = labelArgIndex >= 0 ? (process.argv[labelArgIndex + 1] ?? 'alpha') : 'alpha'

async function main(): Promise<void> {
  if (!operatorAccount) throw new Error('ENS_OPERATOR_PRIVATE_KEY is required.')
  if (!agentRegistryAddress) throw new Error('ENS_AGENT_REGISTRY is required.')

  console.log('\nENSv2 agent identity — live lifecycle')
  console.log(`  registry: ${agentRegistryAddress}`)
  console.log(`  agent:    ${AGENT_LABEL}.${env.ENS_PARENT_LABEL}.eth\n`)

  const holder = operatorAccount.address

  // --- 1. identity -----------------------------------------------------------
  const registered = await registerAgentName({ label: AGENT_LABEL, owner: holder })
  ok(
    'agent name',
    registered.alreadyRegistered
      ? `${registered.fqdn} already registered`
      : `${registered.fqdn} registered, tx ${registered.txHash}`,
  )
  ok('agent owner', registered.owner)
  ok('on-chain expiry', registered.expiresAt.toISOString())

  const daysLeft = (registered.expiresAt.getTime() - Date.now()) / 86_400_000
  if (daysLeft > 0) ok('identity is time-bound', `${daysLeft.toFixed(1)} days remaining`)
  else bad('identity is time-bound', 'already expired')

  // --- 2. capabilities as roles ---------------------------------------------
  // TREASURY_TRANSFER has no on-chain analogue on purpose, to show that an
  // unsupported action is reported rather than silently dropped.
  const grant = await grantAgentRoles({
    label: AGENT_LABEL,
    holder,
    actionTypes: ['CLAIM', 'TRADE', 'API_REQUEST', 'TREASURY_TRANSFER'],
  })
  ok('granted roles', `${grant.granted.join(', ')} (tx ${grant.txHash})`)
  if (grant.unsupported.length > 0) {
    ok('unsupported reported', grant.unsupported.join(', '))
  } else {
    bad('unsupported reported', 'expected TREASURY_TRANSFER to be reported unsupported')
  }

  const afterGrant = await readAgentName(AGENT_LABEL, holder)
  ok('roles read back', afterGrant.onChainActions.join(', ') || '(none)')

  for (const action of ['CLAIM', 'TRADE', 'API_REQUEST']) {
    const has = await hasOnChainRole(AGENT_LABEL, holder, action)
    if (has) ok(`hasRoles(${action})`, 'true')
    else bad(`hasRoles(${action})`, 'false — grant did not take effect')
  }

  const borrowBefore = await hasOnChainRole(AGENT_LABEL, holder, 'BORROW')
  if (!borrowBefore) ok('hasRoles(BORROW)', 'false — never granted')
  else bad('hasRoles(BORROW)', 'true, but BORROW was never granted')

  // --- 3. freeze is real -----------------------------------------------------
  const revoked = await revokeAgentRoles({ label: AGENT_LABEL, holder, actionTypes: ['TRADE'] })
  ok('revoked TRADE', `tx ${revoked.txHash}`)

  const tradeAfter = await hasOnChainRole(AGENT_LABEL, holder, 'TRADE')
  const claimAfter = await hasOnChainRole(AGENT_LABEL, holder, 'CLAIM')
  if (!tradeAfter) ok('TRADE after revoke', 'false — authority actually removed on-chain')
  else bad('TRADE after revoke', 'still true')
  if (claimAfter) ok('CLAIM after revoke', 'true — revocation was scoped, not blanket')
  else bad('CLAIM after revoke', 'false — revoking TRADE should not touch CLAIM')

  const gas = await publicClient.getBalance({ address: holder })
  ok('operator gas left', `${formatEther(gas)} ETH`)

  console.log('\nAgent identity lifecycle verified on-chain.\n')
}

main().catch((err: unknown) => {
  console.error('\ncheck:ens-agent failed\n', err)
  process.exitCode = 1
})
