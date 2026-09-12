/**
 * `npm run check:x402` — Phase 9, section 17, end to end over real HTTP.
 *
 * Runs the actual Express app on an ephemeral port and talks to it with `fetch`
 * exactly as a paying agent would: no supertest, no direct service calls. The
 * payment is a real EIP-3009 signature settled by the real x402.org facilitator
 * on Base Sepolia, so a pass here means real testnet USDC moved.
 *
 * Covers the spec's demo, with one honest caveat:
 *
 *   agent with history -> tiny allowance, pays, is served
 *   unvouched agent    -> denied, and never quoted a price
 *
 * A band cannot be forced from out here — every code path recomputes the trust
 * context from evidence — so the ladder's upper and BLOCK rungs are covered in
 * `test/v2-x402.db.test.ts`, which runs the real rule engine over the real
 * seeded policy rows. What THIS script proves is the part a test cannot: that
 * real money moves and the chain confirms it.
 */
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { createPublicClient, http, erc20Abi, parseEventLogs } from 'viem'
import { baseSepolia } from 'viem/chains'
import { app } from '../src/server.js'
import { env } from '../src/config/env.js'
import { prisma } from '../src/lib/prisma.js'
import { resolveActorForWallet } from '../src/actor/actor-resolver.js'
import { payerAddress, signPaymentPayload } from '../src/x402/x402-client.js'
import { facilitatorSupportsConfigured } from '../src/x402/x402-facilitator.js'
import {
  decodeHeader,
  encodeHeader,
  X402_HEADERS,
  type PaymentRequired,
  type SettlementResponse,
} from '../src/x402/x402-types.js'

const ok = (label: string, detail: string) => console.log(`  [OK]   ${label.padEnd(30)} ${detail}`)
const bad = (label: string, detail: string) => {
  console.log(`  [FAIL] ${label.padEnd(30)} ${detail}`)
  process.exitCode = 1
}

const SUBJECT = '0x2170ed0880ac9a755fd29b2688956bd959f933f8'

async function main(): Promise<void> {
  const payerKey = env.X402_PAYER_PRIVATE_KEY
  if (!payerKey) throw new Error('X402_PAYER_PRIVATE_KEY is required for the demo client.')
  if (!env.X402_PAY_TO) throw new Error('X402_PAY_TO is required.')

  const payer = payerAddress(payerKey)
  console.log('\nx402 agent commerce — end to end on Base Sepolia')
  console.log(`  facilitator: ${env.X402_FACILITATOR_URL}`)
  console.log(`  network:     ${env.X402_NETWORK}`)
  console.log(`  payer:       ${payer}`)
  console.log(`  payTo:       ${env.X402_PAY_TO}\n`)

  // --- 0. is the real facilitator able to take this payment? ---------------
  const support = await facilitatorSupportsConfigured()
  if (support.supported) ok('facilitator supports', support.detail)
  else bad('facilitator supports', support.detail)

  const chain = createPublicClient({ chain: baseSepolia, transport: http(env.X402_RPC_URL) })

  /**
   * The recipient's balance AT A SPECIFIC BLOCK.
   *
   * Pinned to a block rather than reading "latest": the public Base Sepolia RPC
   * is load-balanced, so a `latest` read can land on a node that has not yet
   * seen the block the settlement mined in and report the pre-transfer balance
   * for a payment that definitely settled. Observed exactly that way, twice.
   */
  const balanceAt = (blockNumber: bigint): Promise<bigint> =>
    chain.readContract({
      address: env.X402_ASSET as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [env.X402_PAY_TO as `0x${string}`],
      blockNumber,
    })

  ok('recipient balance before', `${await balanceAt(await chain.getBlockNumber())} atomic units`)

  // --- run the real server -------------------------------------------------
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  try {
    // --- 1. what does this resource cost? ----------------------------------
    const info = (await (await fetch(`${base}/x402/info`)).json()) as {
      x402Version: number
      accepts: { amount: string; asset: string; network: string }[]
    }
    ok('quoted price', `${info.accepts[0]!.amount} atomic on ${info.accepts[0]!.network}`)
    if (info.x402Version !== 2) bad('protocol version', `expected 2, got ${info.x402Version}`)

    // --- 2. UNKNOWN AGENT: asks with no payment, gets a price + tiny allowance
    const unpaid = await fetch(`${base}/x402/risk-report?wallet=${SUBJECT}`, {
      headers: { 'X-Wallet': payer },
    })
    if (unpaid.status === 402) ok('unpaid request', '402 Payment Required')
    else bad('unpaid request', `expected 402, got ${unpaid.status}`)

    const required = decodeHeader<PaymentRequired>(unpaid.headers.get(X402_HEADERS.REQUIRED))
    if (!required?.accepts?.length) {
      bad('PAYMENT-REQUIRED header', 'missing or undecodable')
      return
    }
    ok('PAYMENT-REQUIRED header', `${required.accepts.length} accepted method(s), v${required.x402Version}`)

    const unpaidBody = (await unpaid.json()) as { trustBand: string; allowanceRemaining: number | null }
    ok('unknown agent allowance', `band ${unpaidBody.trustBand}, ${unpaidBody.allowanceRemaining} left today`)
    if (unpaidBody.allowanceRemaining === null || unpaidBody.allowanceRemaining <= 0) {
      bad('unknown agent allowance', 'a new agent should get a small non-zero allowance')
    }

    // --- 3. pay for real ---------------------------------------------------
    const requirements = required.accepts[0]!
    const payload = await signPaymentPayload({
      privateKey: payerKey,
      requirements,
      resource: required.resource,
    })
    ok('signed authorization', `nonce ${payload.payload.authorization.nonce.slice(0, 18)}...`)

    const paid = await fetch(`${base}/x402/risk-report?wallet=${SUBJECT}`, {
      headers: { [X402_HEADERS.SIGNATURE]: encodeHeader(payload) },
    })
    const paidBody = (await paid.json()) as {
      report?: { band: string; wallet: string }
      transaction?: string
      allowanceRemaining?: number
      message?: string
    }
    if (paid.status === 200) {
      ok('paid request', `200, settled tx ${paidBody.transaction}`)
    } else {
      bad('paid request', `${paid.status}: ${paidBody.message ?? JSON.stringify(paidBody)}`)
      return
    }

    const settlement = decodeHeader<SettlementResponse>(paid.headers.get(X402_HEADERS.RESPONSE))
    if (settlement?.success) ok('PAYMENT-RESPONSE header', `success on ${settlement.network}`)
    else bad('PAYMENT-RESPONSE header', JSON.stringify(settlement))

    if (paidBody.report?.band) ok('resource actually served', `subject band ${paidBody.report.band}`)
    else bad('resource actually served', 'no report in the response')

    // --- 4. THE MONEY REALLY MOVED -----------------------------------------
    // Wait for the transaction to be MINED before reading the balance. The
    // facilitator returns as soon as it has broadcast, so an immediate
    // balanceOf reads a block that does not contain the transfer yet and
    // reports +0 for a payment that in fact settled. Observed exactly that way.
    if (!settlement?.transaction) {
      bad('RECIPIENT WAS PAID', 'no settlement transaction to verify')
      return
    }
    const receipt = await chain.waitForTransactionReceipt({
      hash: settlement.transaction as `0x${string}`,
      timeout: 120_000,
    })
    if (receipt.status === 'success') ok('settlement mined', `block ${receipt.blockNumber}`)
    else bad('settlement mined', `transaction reverted in block ${receipt.blockNumber}`)

    // Read the ERC-20 Transfer event out of the settlement transaction ITSELF.
    //
    // Stronger than differencing balances, and the reason this is not done with
    // balanceOf: a `latest` read races the load-balanced RPC, and a historical
    // read needs archive state the public endpoint does not serve. The log is
    // in the receipt we already hold, so it needs neither — and it proves the
    // exact amount reached the exact recipient in this exact transaction,
    // rather than inferring it from a balance that anything could have moved.
    const transfers = parseEventLogs({
      abi: erc20Abi,
      eventName: 'Transfer',
      logs: receipt.logs,
    }).filter(
      (log) =>
        log.address.toLowerCase() === env.X402_ASSET.toLowerCase() &&
        log.args.to.toLowerCase() === env.X402_PAY_TO!.toLowerCase(),
    )

    const paidToUs = transfers.reduce((sum, log) => sum + log.args.value, 0n)
    if (paidToUs === BigInt(requirements.amount)) {
      ok('RECIPIENT WAS PAID', `+${paidToUs} atomic units in block ${receipt.blockNumber}`)
    } else {
      bad('RECIPIENT WAS PAID', `expected +${requirements.amount}, transfer logs show +${paidToUs}`)
    }
    const payerSpent = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs })
      .filter((log) => log.args.from.toLowerCase() === payer.toLowerCase())
      .reduce((sum, log) => sum + log.args.value, 0n)
    ok('payer actually spent', `${payerSpent} atomic units`)

    // --- 5. the same authorization cannot be replayed ----------------------
    const replay = await fetch(`${base}/x402/risk-report?wallet=${SUBJECT}`, {
      headers: { [X402_HEADERS.SIGNATURE]: encodeHeader(payload) },
    })
    const replayBody = (await replay.json()) as { message?: string }
    if (replay.status !== 200 && /nonce/i.test(replayBody.message ?? '')) {
      ok('replay refused', replayBody.message ?? '')
    } else {
      bad('replay refused', `status ${replay.status}: ${JSON.stringify(replayBody)}`)
    }

    // --- 6. AN AGENT WE CANNOT VOUCH FOR: denied, and NOT invited to pay ----
    // An unknown wallet with no evidence. It is refused at the section 27.5
    // fail-closed gate, BEFORE the commerce ladder is consulted at all.
    //
    // Note what this does and does not show. It is a real refusal on the real
    // path, but the reason is INSUFFICIENT_EVIDENCE, not the CRITICAL rung of
    // section 17's ladder — a band cannot be forced from here, because every
    // code path recomputes the trust context from evidence and would overwrite
    // it. The ladder's BLOCK rung is covered in `test/v2-x402.db.test.ts`,
    // which runs the real rule engine over the real seeded rows.
    const unvouched = `0x${randomBytes(20).toString('hex')}`

    const denied = await fetch(`${base}/x402/risk-report?wallet=${SUBJECT}`, {
      headers: { 'X-Wallet': unvouched },
    })
    const deniedBody = (await denied.json()) as { message?: string; trustBand?: string }
    if (denied.status === 403) {
      ok('unvouched agent denied', `403, band ${deniedBody.trustBand}`)
    } else {
      bad('unvouched agent denied', `expected 403, got ${denied.status}`)
    }
    // The point of the 403: a refused agent is never quoted a price.
    if (!denied.headers.get(X402_HEADERS.REQUIRED)) {
      ok('no price quoted to a denial', 'PAYMENT-REQUIRED header absent, as it must be')
    } else {
      bad('no price quoted to a denial', 'we invited payment from an agent we refused')
    }

    // --- 7. the audit trail -------------------------------------------------
    const payerActor = await resolveActorForWallet(payer)
    const history = (await (await fetch(`${base}/x402/payments/${payerActor.id}`)).json()) as {
      payments: { status: string; transaction: string | null }[]
    }
    const settled = history.payments.filter((p) => p.status === 'SETTLED')
    if (settled.length > 0) ok('payment recorded', `${history.payments.length} rows, ${settled.length} settled`)
    else bad('payment recorded', 'no settled payment in the audit trail')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  console.log(
    process.exitCode
      ? '\nx402 check FAILED.\n'
      : '\nx402 proven: trust priced the request, the agent paid, the chain confirmed it.\n',
  )
  await prisma.$disconnect()
}

main().catch(async (err: unknown) => {
  console.error('\ncheck:x402 failed\n', err)
  process.exitCode = 1
  await prisma.$disconnect()
})
