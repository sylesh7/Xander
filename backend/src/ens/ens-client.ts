/**
 * ENSv2 clients and contract handles — Xander V2 Phase 3.5.
 *
 * The only module that talks to a chain. Everything above it works in terms of
 * names, roles and capabilities rather than addresses and calldata.
 *
 * ALL ADDRESSES COME FROM CONFIG. ENS's own documentation says the ENSv2
 * contracts "are not yet final and may change prior to mainnet deployment", so
 * baking them into code would make a redeployment a code change — exactly what
 * Section 0.2 rule 1 forbids for chain-specific data.
 *
 * Every signature below was verified against the live Sepolia deployment on
 * 2026-09-12 by computing its selector and calling it, not by trusting a docs
 * page. The registries answered `supportsInterface(ERC1155)` with true.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type HttpTransport,
  type PublicClient,
  type WalletClient,
} from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { env } from '../config/env.js'

/** Thrown when an on-chain write is attempted with no operator key configured. */
export class EnsNotWritableError extends Error {
  constructor() {
    super('ENS_OPERATOR_PRIVATE_KEY is not set, so ENS writes are unavailable.')
    this.name = 'EnsNotWritableError'
  }
}

export const ensAddresses = {
  ethRegistry: env.ENS_ETH_REGISTRY as Address,
  ethRegistrar: env.ENS_ETH_REGISTRAR as Address,
  rootRegistry: env.ENS_ROOT_REGISTRY as Address,
  universalResolver: env.ENS_UNIVERSAL_RESOLVER as Address,
  permissionedResolverImpl: env.ENS_PERMISSIONED_RESOLVER_IMPL as Address,
  verifiableFactory: env.ENS_VERIFIABLE_FACTORY as Address,
  paymentToken: env.ENS_PAYMENT_TOKEN as Address,
  userRegistryImpl: env.ENS_USER_REGISTRY_IMPL as Address,
} as const

/** The deployed agent subname registry, or null before `ens:deploy-registry` runs. */
export const agentRegistryAddress: Address | null =
  (env.ENS_AGENT_REGISTRY as Address | undefined) ?? null

/**
 * Read client. Always available — reads need no key, which is why identity
 * resolution and role inspection work even on a deployment with no operator.
 */
// The explicit annotation is required, not stylistic: viem's inferred client
// type references internal module paths that TypeScript cannot name portably
// (TS2742) once this module is imported across the project.
export const publicClient: PublicClient<HttpTransport, typeof sepolia> = createPublicClient({
  chain: sepolia,
  transport: http(env.ENS_RPC_URL),
})

/** The operator account, or null when the backend is read-only. */
export const operatorAccount = env.ENS_OPERATOR_PRIVATE_KEY
  ? privateKeyToAccount(env.ENS_OPERATOR_PRIVATE_KEY as Hex)
  : null

export function isEnsWritable(): boolean {
  return operatorAccount !== null
}

/**
 * Write client. Throws rather than returning a silently-read-only handle —
 * an enforcement adapter that cannot write must fail loudly, because section
 * 18.2 forbids reporting an action as authorised when enforcement did not
 * actually happen.
 */
export function walletClient(): WalletClient<HttpTransport, typeof sepolia, PrivateKeyAccount> {
  if (!operatorAccount) throw new EnsNotWritableError()
  return createWalletClient({
    account: operatorAccount,
    chain: sepolia,
    transport: http(env.ENS_RPC_URL),
  })
}

// ---------------------------------------------------------------------------
// ABIs — only the functions this backend actually calls.
// ---------------------------------------------------------------------------

/** PermissionedRegistry. `register` returns the ERC1155 token id for the name. */
export const registryAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'registry', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'expires', type: 'uint64' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'setSubregistry',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'registry', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setResolver',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'resolver', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getSubregistry',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getResolver',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  /**
   * Returns five words, decoded from a live call rather than the docs, which
   * describe only "a State struct". Verified against xander.eth immediately
   * after registering it:
   *   status 2, expiry 2027-09-12, owner = the operator, then the versioned and
   *   canonical token ids.
   * The earlier two-output guess silently decoded status as the expiry, which
   * made a registered name look unregistered.
   */
  {
    type: 'function',
    name: 'getState',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'status', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
      { name: 'owner', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'canonicalId', type: 'uint256' },
    ],
  },
] as const

/**
 * Enhanced Access Control — the permission system shared by registries and
 * resolvers (ENSv2 architecture docs).
 *
 * Roles are a uint256 bitmap: bits 0-127 hold 32 regular roles as 4-bit
 * nybbles, bits 128-255 the matching admin roles. `grantRoles`/`revokeRoles`
 * reject ROOT_RESOURCE; the Root variants are the contract-wide master key.
 */
export const eacAbi = [
  {
    type: 'function',
    name: 'grantRoles',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'resource', type: 'uint256' },
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'revokeRoles',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'resource', type: 'uint256' },
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'hasRoles',
    stateMutability: 'view',
    inputs: [
      { name: 'resource', type: 'uint256' },
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'roles',
    stateMutability: 'view',
    inputs: [
      { name: 'resource', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/**
 * VerifiableFactory — deterministic CREATE2 proxy deployment.
 *
 * The salt is mixed with msg.sender on-chain
 * (`keccak256(abi.encode(msg.sender, salt))`), so two deployers using the same
 * salt get different addresses and no global coordination is needed.
 */
export const factoryAbi = [
  {
    type: 'function',
    name: 'deployProxy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'implementation', type: 'address' },
      { name: 'salt', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }],
  },
  /**
   * Returns the IMPLEMENTATION the proxy was deployed from, not a boolean.
   * Learned by calling it: a `bool` ABI made viem reject the 20-byte response,
   * and those bytes decoded to the UserRegistryImpl address. Comparing the
   * result against the expected implementation is the actual verification.
   */
  {
    type: 'function',
    name: 'verifyContract',
    stateMutability: 'view',
    inputs: [{ name: 'proxy', type: 'address' }],
    outputs: [{ name: 'implementation', type: 'address' }],
  },
] as const

/**
 * The registry implementation's initializer, found by scanning the deployed
 * bytecode for candidate selectors — `initialize(address,uint256)` is present
 * as 0xcd6dc687. A UUPS proxy is inert until this runs, so the calldata is
 * passed to deployProxy rather than sent afterwards, which would leave a
 * window where anyone could initialise it.
 */
export const registryInitAbi = [
  {
    type: 'function',
    name: 'initialize',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'roleBitmap', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

/** Minimal ERC20 — rent is paid by token transfer, so an approval is required. */
export const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

/** ETHRegistrar — commit-reveal registration for .eth 2LDs. */
export const registrarAbi = [
  {
    type: 'function',
    name: 'makeCommitment',
    stateMutability: 'pure',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'secret', type: 'bytes32' },
      { name: 'subregistry', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'duration', type: 'uint64' },
      { name: 'referrer', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'commit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'register',
    stateMutability: 'payable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'secret', type: 'bytes32' },
      { name: 'subregistry', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'duration', type: 'uint64' },
      { name: 'paymentToken', type: 'address' },
      { name: 'referrer', type: 'bytes32' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isAvailable',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getRegisterPrice',
    stateMutability: 'view',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'duration', type: 'uint64' },
      { name: 'paymentToken', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'commitmentAt',
    stateMutability: 'view',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
