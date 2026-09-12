/**
 * `npm run check:erc8004` — live verification of the ERC-8004 integration.
 *
 * Real Sepolia registries. Proves the configured addresses are a matched
 * deployment, that the ABIs match the deployed bytecode, and that an
 * unregistered agent id yields UNKNOWN rather than a fabricated score.
 */
import { env } from '../src/config/env.js'
import { publicClient } from '../src/ens/ens-client.js'
import {
  erc8004Addresses,
  readErc8004Snapshot,
  reputationRegistryAbi,
  toAgentReputationValue,
  validationRegistryAbi,
} from '../src/agents/erc8004.js'

const ok = (l: string, d: string) => console.log(`  [OK]   ${l.padEnd(28)} ${d}`)
const bad = (l: string, d: string) => {
  console.log(`  [FAIL] ${l.padEnd(28)} ${d}`)
  process.exitCode = 1
}

async function main(): Promise<void> {
  console.log('\nERC-8004 live check')
  console.log(`  chain: ${env.ENS_CHAIN_ID}\n`)

  for (const [name, address] of Object.entries(erc8004Addresses)) {
    const code = await publicClient.getCode({ address })
    const size = code ? (code.length - 2) / 2 : 0
    if (size > 0) ok(name, `${address} (${size} bytes)`)
    else bad(name, `${address} has NO CODE`)
  }

  // The cross-check that matters: all three must agree on one identity
  // registry, or they are three unrelated contracts rather than a deployment.
  const repIdentity = await publicClient.readContract({
    address: erc8004Addresses.reputation,
    abi: reputationRegistryAbi,
    functionName: 'getIdentityRegistry',
  })
  const valIdentity = await publicClient.readContract({
    address: erc8004Addresses.validation,
    abi: validationRegistryAbi,
    functionName: 'getIdentityRegistry',
  })
  const matched =
    repIdentity.toLowerCase() === erc8004Addresses.identity.toLowerCase() &&
    valIdentity.toLowerCase() === erc8004Addresses.identity.toLowerCase()
  if (matched) ok('registries are one deployment', 'both point at the configured identity registry')
  else bad('registries are one deployment', `reputation -> ${repIdentity}, validation -> ${valIdentity}`)

  // A real read against the deployed bytecode. The EIP's `string` tags revert
  // here; these are the bytes32 signatures actually deployed.
  const probeId = 1n
  const snapshot = await readErc8004Snapshot(probeId)
  ok('getSummary decodes', `agentId 1 -> ${snapshot.reputation?.count ?? 0} feedback, ${snapshot.validation?.count ?? 0} validations`)
  if (snapshot.errors.length === 0) ok('all three registries read', 'no errors')
  else bad('all three registries read', snapshot.errors.join('; '))

  if (snapshot.identity?.exists) {
    ok('agent 1 identity', `owner ${snapshot.identity.owner}`)
  } else {
    ok('agent 1 identity', 'not registered on this deployment')
  }

  const derived = toAgentReputationValue(snapshot)
  ok('trust dimension', derived.value === null ? `UNKNOWN — ${derived.basis}` : `${derived.value.toFixed(3)} — ${derived.basis}`)

  // An id that certainly does not exist must be UNKNOWN, never a number.
  const absent = await readErc8004Snapshot(999_999_999n)
  const absentDerived = toAgentReputationValue(absent)
  if (absentDerived.value === null) {
    ok('unregistered agent', 'UNKNOWN, not a fabricated score')
  } else {
    bad('unregistered agent', `invented a value of ${absentDerived.value}`)
  }

  console.log('\nERC-8004 read path verified.\n')
}

main().catch((err: unknown) => {
  console.error('\ncheck:erc8004 failed\n', err)
  process.exitCode = 1
})
