/**
 * Deploys the agent subname registry — Xander V2 Phase 3.5.
 *
 *   npm run ens:deploy-registry
 *
 * ENSv2's hierarchy is what makes agents-as-namespaces work: the parent name
 * points at its OWN registry, and that registry decides who may hold a subname
 * under it and on what terms. This deploys that registry for the parent and
 * wires it in.
 *
 * Two real transactions:
 *   1. VerifiableFactory.deployProxy(UserRegistryImpl, salt, initCalldata)
 *   2. ETHRegistry.setSubregistry(parentTokenId, proxy)
 *
 * Idempotent: if the parent already points at a registry it prints it and
 * exits, so re-running never orphans a deployment.
 */
import { encodeFunctionData, type Address } from 'viem'
import { env } from '../src/config/env.js'
import {
  ensAddresses,
  factoryAbi,
  operatorAccount,
  publicClient,
  registryAbi,
  registryInitAbi,
  walletClient,
} from '../src/ens/ens-client.js'
import { canonicalTokenId } from '../src/ens/ens-names.js'
import { combineRoles, REGISTRY_ROLES } from '../src/ens/eac-roles.js'

async function main(): Promise<void> {
  if (!operatorAccount) throw new Error('ENS_OPERATOR_PRIVATE_KEY is required.')

  const label = env.ENS_PARENT_LABEL
  const parentTokenId = canonicalTokenId(label)

  console.log(`\nDeploying the agent registry for ${label}.eth`)
  console.log(`  operator: ${operatorAccount.address}`)

  // The parent must be ours before we can point it anywhere.
  const [, expiry, owner] = await publicClient.readContract({
    address: ensAddresses.ethRegistry,
    abi: registryAbi,
    functionName: 'getState',
    args: [parentTokenId],
  })
  if (expiry === 0n) throw new Error(`${label}.eth is not registered. Run ens:register-parent first.`)
  if (owner.toLowerCase() !== operatorAccount.address.toLowerCase()) {
    throw new Error(`${label}.eth is owned by ${owner}, not the operator.`)
  }
  console.log(`  parent owner confirmed, expires ${new Date(Number(expiry) * 1000).toISOString()}`)

  const existing = await publicClient.readContract({
    address: ensAddresses.ethRegistry,
    abi: registryAbi,
    functionName: 'getSubregistry',
    args: [label],
  })
  if (existing !== '0x0000000000000000000000000000000000000000') {
    console.log(`\n  ${label}.eth already points at registry ${existing}`)
    console.log(`  set ENS_AGENT_REGISTRY=${existing}\n`)
    return
  }

  const wallet = walletClient()

  // Recovery path: a proxy that deployed but was never wired in (the deploy and
  // the setSubregistry are separate transactions, so a failure between them is
  // real). Re-deploying instead would orphan the first one and burn gas.
  const proxyArgIndex = process.argv.indexOf('--proxy')
  const existingProxy =
    proxyArgIndex >= 0 ? (process.argv[proxyArgIndex + 1] as Address | undefined) : undefined

  // The owner needs REGISTRAR and RENEW on the new registry, or it could not
  // mint the agent subnames it exists to mint. Passed as initializer calldata
  // rather than granted afterwards: a UUPS proxy is inert until initialised,
  // and a gap between deploy and initialise is a window in which anyone else
  // could initialise it and take ownership.
  const roleBitmap = combineRoles(REGISTRY_ROLES.ROLE_REGISTRAR, REGISTRY_ROLES.ROLE_RENEW)
  const initData = encodeFunctionData({
    abi: registryInitAbi,
    functionName: 'initialize',
    args: [operatorAccount.address, roleBitmap],
  })
  console.log(`  init roles: 0x${roleBitmap.toString(16)}`)

  // Salt is derived from the parent so redeploying for the same parent is
  // deterministic, and the factory mixes msg.sender in on-chain anyway.
  const salt = parentTokenId

  let proxy: Address | null = existingProxy ?? null
  if (proxy) {
    console.log(`  reusing already-deployed proxy ${proxy}`)
  } else {
  const deployHash = await wallet.writeContract({
    address: ensAddresses.verifiableFactory,
    abi: factoryAbi,
    functionName: 'deployProxy',
    args: [ensAddresses.userRegistryImpl, salt, initData],
  })
  console.log(`  deploy tx: ${deployHash}`)
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash })
  console.log(`  status: ${deployReceipt.status}, gas ${deployReceipt.gasUsed}`)

  // The proxy address comes from the receipt rather than a return value —
  // writeContract gives a hash, not the function's output.
  proxy = await findDeployedProxy(deployReceipt.logs)
  if (!proxy) throw new Error('Could not determine the deployed proxy address from the receipt.')
  console.log(`  proxy: ${proxy}`)
  }

  // Verification is comparing the reported implementation against the one we
  // asked for — a proxy pointing somewhere else is not our registry.
  const reportedImpl = await publicClient.readContract({
    address: ensAddresses.verifiableFactory,
    abi: factoryAbi,
    functionName: 'verifyContract',
    args: [proxy],
  })
  console.log(`  verifyContract -> ${reportedImpl}`)
  if (reportedImpl.toLowerCase() !== ensAddresses.userRegistryImpl.toLowerCase()) {
    throw new Error(
      `Proxy reports implementation ${reportedImpl}, expected ${ensAddresses.userRegistryImpl}.`,
    )
  }

  const wireHash = await wallet.writeContract({
    address: ensAddresses.ethRegistry,
    abi: registryAbi,
    functionName: 'setSubregistry',
    args: [parentTokenId, proxy],
  })
  console.log(`  setSubregistry tx: ${wireHash}`)
  const wireReceipt = await publicClient.waitForTransactionReceipt({ hash: wireHash })
  console.log(`  status: ${wireReceipt.status}`)

  const wired = await publicClient.readContract({
    address: ensAddresses.ethRegistry,
    abi: registryAbi,
    functionName: 'getSubregistry',
    args: [label],
  })

  console.log(`\n  ${label}.eth subregistry: ${wired}`)
  console.log(`\n  Add to .env:\n    ENS_AGENT_REGISTRY=${wired}\n`)
}

/**
 * Picks the proxy out of the deployment receipt.
 *
 * A CREATE2 deployment shows up as logs emitted BY the new address, so the
 * proxy is the one address in the receipt that is neither the factory nor the
 * implementation and now holds code.
 */
async function findDeployedProxy(
  logs: readonly { address: string }[],
): Promise<Address | null> {
  const known = new Set(
    [ensAddresses.verifiableFactory, ensAddresses.userRegistryImpl].map((a) => a.toLowerCase()),
  )
  const candidates = [...new Set(logs.map((l) => l.address.toLowerCase()))].filter(
    (a) => !known.has(a),
  )
  for (const candidate of candidates) {
    const code = await publicClient.getCode({ address: candidate as Address })
    if (code && code !== '0x') return candidate as Address
  }
  return null
}

main().catch((err: unknown) => {
  console.error('\nregistry deployment failed\n', err)
  process.exitCode = 1
})
