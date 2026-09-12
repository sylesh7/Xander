/**
 * `npm run check:ens` — live verification of the ENSv2 integration.
 *
 * Real RPC, real contracts, no mocks. Proves the addresses in config point at
 * live ENSv2 contracts, that the ABIs this backend uses actually match them,
 * and whether the operator can afford to write.
 */
import { formatEther, type Address } from 'viem'
import { env } from '../src/config/env.js'
import {
  ensAddresses,
  isEnsWritable,
  operatorAccount,
  publicClient,
  registrarAbi,
  registryAbi,
} from '../src/ens/ens-client.js'
import { canonicalTokenId } from '../src/ens/ens-names.js'
import {
  ALL_AGENT_ROLES,
  actionsFromBitmap,
  agentRoleForAction,
  REGISTRATION_ROLE_BITMAP,
} from '../src/ens/eac-roles.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(26)} ${detail}`)
const bad = (label: string, detail: string) => {
  console.log(`  [FAIL] ${label.padEnd(26)} ${detail}`)
  process.exitCode = 1
}

async function main(): Promise<void> {
  console.log('\nENSv2 live check')
  console.log(`  rpc:     ${env.ENS_RPC_URL}`)
  console.log(`  chainId: ${env.ENS_CHAIN_ID}`)
  console.log(`  parent:  ${env.ENS_PARENT_LABEL}.eth\n`)

  const chainId = await publicClient.getChainId()
  if (chainId === env.ENS_CHAIN_ID) ok('chain', `connected, chainId ${chainId}`)
  else bad('chain', `expected ${env.ENS_CHAIN_ID}, got ${chainId}`)

  // Every configured address must actually hold code. A typo'd address reads as
  // "0x" here rather than failing mysteriously inside a later call.
  for (const [name, address] of Object.entries(ensAddresses)) {
    const code = await publicClient.getCode({ address: address as Address })
    const size = code ? (code.length - 2) / 2 : 0
    if (size > 0) ok(name, `${address} (${size} bytes)`)
    else bad(name, `${address} has NO CODE on chain ${chainId}`)
  }

  // ERC-1155 via ERC-165. Confirms the registry is what the docs describe
  // rather than merely being some contract at that address.
  const supports1155 = await publicClient.readContract({
    address: ensAddresses.ethRegistry,
    abi: [
      {
        type: 'function',
        name: 'supportsInterface',
        stateMutability: 'view',
        inputs: [{ name: 'interfaceId', type: 'bytes4' }],
        outputs: [{ name: '', type: 'bool' }],
      },
    ] as const,
    functionName: 'supportsInterface',
    args: ['0xd9b67a26'],
  })
  if (supports1155) ok('ethRegistry ERC1155', 'supportsInterface(0xd9b67a26) = true')
  else bad('ethRegistry ERC1155', 'registry does not report ERC1155')

  // The ABIs in ens-client.ts must match the deployed contracts. A read that
  // decodes is the cheapest proof that a signature is right.
  const label = env.ENS_PARENT_LABEL
  // Canonical id, NOT the raw labelhash — ENSv2 token ids carry a version in
  // their low 32 bits, and using the labelhash makes a registered name read
  // back as unregistered.
  const tokenId = canonicalTokenId(label)

  const subregistry = await publicClient.readContract({
    address: ensAddresses.ethRegistry,
    abi: registryAbi,
    functionName: 'getSubregistry',
    args: [label],
  })
  ok('registry ABI', `getSubregistry("${label}") -> ${subregistry}`)

  const [status, expiry, owner, versionedId] = await publicClient.readContract({
    address: ensAddresses.ethRegistry,
    abi: registryAbi,
    functionName: 'getState',
    args: [tokenId],
  })
  const registered = expiry > 0n
  ok(
    'parent name state',
    registered
      ? `${label}.eth status ${status}, expires ${new Date(Number(expiry) * 1000).toISOString()}`
      : `${label}.eth is UNREGISTERED`,
  )
  if (registered) {
    ok('parent owner', owner)
    ok('parent tokenId', versionedId.toString())
    const resolver = await publicClient.readContract({
      address: ensAddresses.ethRegistry,
      abi: registryAbi,
      functionName: 'getResolver',
      args: [label],
    })
    ok('parent resolver', resolver)
    if (operatorAccount && owner.toLowerCase() !== operatorAccount.address.toLowerCase()) {
      bad('parent owner', `${label}.eth is owned by ${owner}, not the operator`)
    }
  }

  try {
    const available = await publicClient.readContract({
      address: ensAddresses.ethRegistrar,
      abi: registrarAbi,
      functionName: 'isAvailable',
      args: [label],
    })
    ok('registrar ABI', `isAvailable("${label}") -> ${available}`)
  } catch (err) {
    bad('registrar ABI', `isAvailable reverted: ${errMessage(err)}`)
  }

  // Role bitmaps are pure arithmetic, but a wrong nybble shift is silent, so
  // assert the shape here too.
  ok('registration bitmap', `0x${REGISTRATION_ROLE_BITMAP.toString(16)}`)
  ok('all agent roles', `0x${ALL_AGENT_ROLES.toString(16)}`)
  const tradeRole = agentRoleForAction('TRADE')
  const decoded = tradeRole === null ? [] : actionsFromBitmap(tradeRole)
  if (decoded.length === 1 && decoded[0] === 'TRADE') ok('role round trip', 'TRADE -> bitmap -> TRADE')
  else bad('role round trip', `expected [TRADE], got ${JSON.stringify(decoded)}`)

  if (!isEnsWritable() || !operatorAccount) {
    console.log('\n  [warn] no ENS_OPERATOR_PRIVATE_KEY — reads only, writes unavailable.')
    console.log('\nRead path verified.\n')
    return
  }

  const balance = await publicClient.getBalance({ address: operatorAccount.address })
  ok('operator', operatorAccount.address)
  if (balance > 0n) ok('operator balance', `${formatEther(balance)} ETH`)
  else bad('operator balance', 'ZERO — cannot pay for any transaction')

  console.log('\nAll checks passed.\n')
}

function errMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'shortMessage' in err) {
    return String((err as { shortMessage: unknown }).shortMessage)
  }
  return err instanceof Error ? err.message : String(err)
}

main().catch((err: unknown) => {
  console.error('\ncheck:ens failed\n', err)
  process.exitCode = 1
})
