/**
 * The paying side of x402 — a real EIP-3009 signer.
 *
 * This is the AGENT's half, not Xander's. Xander the resource server never
 * signs a payment and never holds funds; it quotes a price, asks a facilitator
 * to check the signature, and asks the same facilitator to move the money. This
 * module exists so the end-to-end check can act as a genuine paying client
 * against the real protocol rather than asserting against a hand-built payload.
 *
 * The signature is a real EIP-712 `TransferWithAuthorization` over the token's
 * own domain, which is the only thing the token contract will accept — there is
 * no way to fake it and still have the facilitator settle.
 */
import { randomBytes } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import { env } from '../config/env.js'
import {
  chainIdFromCaip2,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  X402_VERSION,
  type PaymentPayload,
  type PaymentRequirements,
  type ResourceInfo,
} from './x402-types.js'

/**
 * Signs a payment authorization for the given requirements.
 *
 * `validAfter` is backdated by a minute. Clock skew between this machine and
 * the settling node is real, and an authorization stamped "valid from now"
 * intermittently lands a second or two in the future and reverts.
 */
export async function signPaymentPayload(args: {
  privateKey: string
  requirements: PaymentRequirements
  resource?: ResourceInfo
  now?: Date
}): Promise<PaymentPayload> {
  const chainId = chainIdFromCaip2(args.requirements.network)
  if (chainId === null) {
    throw new Error(`Cannot sign for non-EVM network ${args.requirements.network}`)
  }

  const account = privateKeyToAccount(args.privateKey as Hex)
  const now = args.now ?? new Date()
  const seconds = Math.floor(now.getTime() / 1000)

  const extra = args.requirements.extra ?? {}
  const tokenName = typeof extra.name === 'string' ? extra.name : env.X402_ASSET_NAME
  const tokenVersion = typeof extra.version === 'string' ? extra.version : env.X402_ASSET_VERSION

  const authorization = {
    from: account.address,
    to: args.requirements.payTo as Hex,
    value: BigInt(args.requirements.amount),
    validAfter: BigInt(seconds - 60),
    validBefore: BigInt(seconds + args.requirements.maxTimeoutSeconds),
    // 32 bytes of real randomness. The nonce is what makes an authorization
    // single-use, so a predictable one would be a replay waiting to happen.
    nonce: `0x${randomBytes(32).toString('hex')}` as Hex,
  }

  const signature = await account.signTypedData({
    domain: {
      name: tokenName,
      version: tokenVersion,
      chainId,
      verifyingContract: args.requirements.asset as Hex,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: authorization,
  })

  return {
    x402Version: X402_VERSION,
    ...(args.resource ? { resource: args.resource } : {}),
    accepted: args.requirements,
    payload: {
      signature,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
    },
    extensions: {},
  }
}

/** The address that will pay, without signing anything. */
export function payerAddress(privateKey: string): string {
  return privateKeyToAccount(privateKey as Hex).address
}
