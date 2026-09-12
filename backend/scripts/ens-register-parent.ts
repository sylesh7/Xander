/**
 * Registers the parent .eth name agents live under — Xander V2 Phase 3.5.
 *
 *   npm run ens:register-parent -- --dry-run   price and availability only
 *   npm run ens:register-parent                the real commit-reveal
 *
 * A REAL transaction against ENSv2 on Sepolia. Commit-reveal is two
 * transactions separated by MIN_COMMITMENT_AGE, which exists so an observer
 * cannot see your desired name in the mempool and front-run it.
 *
 * Idempotent: if the name is already owned by the operator it exits cleanly, so
 * re-running never double-registers or wastes gas.
 */
import { formatEther, formatUnits, zeroAddress, type Address, type Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { env } from '../src/config/env.js'
import { canonicalTokenId } from '../src/ens/ens-names.js'
import {
  ensAddresses,
  erc20Abi,
  operatorAccount,
  publicClient,
  registrarAbi,
  registryAbi,
  walletClient,
} from '../src/ens/ens-client.js'

const DRY_RUN = process.argv.includes('--dry-run')
/** Documented minimum wait between commit and reveal, plus a safety margin. */
const MIN_COMMITMENT_AGE_SECONDS = 60
const COMMIT_MARGIN_SECONDS = 15

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  if (!operatorAccount) throw new Error('ENS_OPERATOR_PRIVATE_KEY is required to register.')

  const label = env.ENS_PARENT_LABEL
  const duration = BigInt(env.ENS_PARENT_DURATION_SECONDS)

  console.log(`\nRegistering ${label}.eth on chain ${env.ENS_CHAIN_ID}`)
  console.log(`  operator: ${operatorAccount.address}`)
  console.log(`  duration: ${duration}s\n`)

  // Already ours? Then there is nothing to do and no gas to spend.
  // Canonical id, not the raw labelhash — see ens-names.ts.
  const tokenId = canonicalTokenId(label)
  const [, existingExpiry] = await publicClient.readContract({
    address: ensAddresses.ethRegistry,
    abi: registryAbi,
    functionName: 'getState',
    args: [tokenId],
  })
  if (existingExpiry > 0n) {
    const owner = await publicClient.readContract({
      address: ensAddresses.ethRegistry,
      abi: registryAbi,
      functionName: 'ownerOf',
      args: [tokenId],
    })
    console.log(`  already registered, expires ${new Date(Number(existingExpiry) * 1000).toISOString()}`)
    console.log(`  owner: ${owner}`)
    if (owner.toLowerCase() === operatorAccount.address.toLowerCase()) {
      console.log('\n  owned by the operator — nothing to do.\n')
      return
    }
    throw new Error(`${label}.eth is owned by ${owner}, not the operator.`)
  }

  const available = await publicClient.readContract({
    address: ensAddresses.ethRegistrar,
    abi: registrarAbi,
    functionName: 'isAvailable',
    args: [label],
  })
  console.log(`  isAvailable: ${available}`)
  if (!available) throw new Error(`${label}.eth is not available.`)

  // ENSv2 charges rent in an ERC20, not native ETH — quoting in the zero
  // address reverts PaymentTokenNotSupported. Gas is still paid in ETH, so the
  // operator needs both.
  const token = ensAddresses.paymentToken
  const [price, decimals, symbol, tokenBalance, gasBalance] = await Promise.all([
    publicClient.readContract({
      address: ensAddresses.ethRegistrar,
      abi: registrarAbi,
      functionName: 'getRegisterPrice',
      args: [label, duration, token],
    }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
    publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [operatorAccount.address],
    }),
    publicClient.getBalance({ address: operatorAccount.address }),
  ])

  console.log(`  price:   ${formatUnits(price, decimals)} ${symbol}`)
  console.log(`  rent balance: ${formatUnits(tokenBalance, decimals)} ${symbol}`)
  console.log(`  gas balance:  ${formatEther(gasBalance)} ETH`)
  if (gasBalance === 0n) throw new Error('Operator has no ETH for gas.')
  if (tokenBalance < price) {
    throw new Error(
      `Operator holds ${formatUnits(tokenBalance, decimals)} ${symbol} but registration costs ` +
        `${formatUnits(price, decimals)}. Fund ${operatorAccount.address} with Sepolia ${symbol}.`,
    )
  }

  if (DRY_RUN) {
    console.log('\n  --dry-run: stopping before any transaction.\n')
    return
  }

  const wallet = walletClient()

  // The registrar pulls rent with safeTransferFrom, so it needs an allowance
  // first. Approving exactly the price rather than an unlimited amount: this
  // key is long-lived and a stray infinite approval is a standing liability.
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [operatorAccount.address, ensAddresses.ethRegistrar],
  })
  if (allowance < price) {
    const approveHash = await wallet.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [ensAddresses.ethRegistrar, price],
    })
    console.log(`  approve tx: ${approveHash}`)
    await publicClient.waitForTransactionReceipt({ hash: approveHash })
    console.log('  approve confirmed')
  }
  // A fresh 32-byte secret per attempt. Reusing one across attempts would let
  // anyone who saw the first commitment reconstruct and front-run the second.
  const secret = generatePrivateKey() as Hex
  const referrer = ('0x' + '00'.repeat(32)) as Hex
  const resolver = ensAddresses.permissionedResolverImpl

  const commitment = await publicClient.readContract({
    address: ensAddresses.ethRegistrar,
    abi: registrarAbi,
    functionName: 'makeCommitment',
    args: [label, operatorAccount.address, secret, zeroAddress as Address, resolver, duration, referrer],
  })
  console.log(`\n  commitment: ${commitment}`)

  const commitHash = await wallet.writeContract({
    address: ensAddresses.ethRegistrar,
    abi: registrarAbi,
    functionName: 'commit',
    args: [commitment],
  })
  console.log(`  commit tx:  ${commitHash}`)
  await publicClient.waitForTransactionReceipt({ hash: commitHash })
  console.log('  commit confirmed')

  const waitSeconds = MIN_COMMITMENT_AGE_SECONDS + COMMIT_MARGIN_SECONDS
  console.log(`  waiting ${waitSeconds}s for the commitment to mature...`)
  await sleep(waitSeconds * 1000)

  const registerHash = await wallet.writeContract({
    address: ensAddresses.ethRegistrar,
    abi: registrarAbi,
    functionName: 'register',
    args: [
      label,
      operatorAccount.address,
      secret,
      zeroAddress as Address,
      resolver,
      duration,
      token,
      referrer,
    ],
  })
  console.log(`  register tx: ${registerHash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: registerHash })
  console.log(`  status: ${receipt.status}, gas used ${receipt.gasUsed}`)

  const [, expiry] = await publicClient.readContract({
    address: ensAddresses.ethRegistry,
    abi: registryAbi,
    functionName: 'getState',
    args: [tokenId],
  })
  const owner = await publicClient.readContract({
    address: ensAddresses.ethRegistry,
    abi: registryAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  })

  console.log(`\n  ${label}.eth owner:  ${owner}`)
  console.log(`  ${label}.eth expires: ${new Date(Number(expiry) * 1000).toISOString()}`)
  console.log(`  tokenId: ${tokenId}\n`)
}

main().catch((err: unknown) => {
  console.error('\nregistration failed\n', err)
  process.exitCode = 1
})
