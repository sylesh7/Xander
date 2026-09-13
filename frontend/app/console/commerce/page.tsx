'use client'

import { useEffect, useState } from 'react'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { Coins } from 'lucide-react'
import { decodeX402Header, encodeX402Header, x402Request, X402_HEADERS } from '@/lib/api/x402'
import type { X402Info, X402PaymentRequirements, X402PaymentRow } from '@/lib/types'
import { X402_RATE_LADDER } from '@/lib/policyRules'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { EmptyState } from '@/components/xander/EmptyState'
import { DataTable } from '@/components/xander/DataTable'
import { StatusBadge } from '@/components/xander/StatusBadge'
import { TxLink, Address } from '@/components/xander/Mono'

interface UnpaidState {
  kind: 'unpaid'
  trustBand: string
  reasonCode: string
  allowanceRemaining: number | null
  accepts: X402PaymentRequirements[]
}
interface RefusedState {
  kind: 'refused'
  status: 403 | 429
  message: string
  trustBand: string | null
  reasonCode: string | null
}
interface PaidState {
  kind: 'paid'
  paidBy: string | null
  transaction: string | null
  network: string | null
  allowanceRemaining: number | null
  report: unknown
}
type TryState = UnpaidState | RefusedState | PaidState | null

function chainIdFromCaip2(network: string): number | null {
  const m = /^eip155:(\d+)$/.exec(network)
  return m ? Number(m[1]) : null
}

export default function CommercePage() {
  const [account, setAccount] = useState<PrivateKeyAccount | null>(null)
  const [info, setInfo] = useState<X402Info | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [tryState, setTryState] = useState<TryState>(null)
  const [trying, setTrying] = useState(false)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const [ledgerActorId, setLedgerActorId] = useState('')
  const [payments, setPayments] = useState<X402PaymentRow[] | null>(null)
  const [ledgerError, setLedgerError] = useState<string | null>(null)

  useEffect(() => {
    setAccount(privateKeyToAccount(generatePrivateKey()))
    void x402Request<X402Info>('/x402/info').then(({ status, data }) => {
      if (status === 200) setInfo(data)
      else setInfoError(`Could not load resource info (${status}).`)
    })
  }, [])

  async function tryRequest() {
    if (!account) return
    setTrying(true)
    setTryState(null)
    setPayError(null)
    try {
      const { status, data, headers } = await x402Request<Record<string, unknown>>(`/x402/risk-report?wallet=${account.address}`, {
        headers: { 'X-Wallet': account.address },
      })
      if (status === 402) {
        const required = decodeX402Header<{ accepts: X402PaymentRequirements[] }>(headers.get(X402_HEADERS.REQUIRED))
        setTryState({
          kind: 'unpaid',
          trustBand: String(data.trustBand ?? 'UNKNOWN'),
          reasonCode: String(data.reasonCode ?? ''),
          allowanceRemaining: (data.allowanceRemaining as number | null) ?? null,
          accepts: required?.accepts ?? (data.accepts as X402PaymentRequirements[]) ?? [],
        })
      } else if (status === 403 || status === 429) {
        setTryState({
          kind: 'refused',
          status,
          message: String(data.message ?? 'Refused.'),
          trustBand: (data.trustBand as string) ?? null,
          reasonCode: (data.reasonCode as string) ?? null,
        })
      } else if (status === 200) {
        setTryState({ kind: 'paid', paidBy: (data.paidBy as string) ?? null, transaction: (data.transaction as string) ?? null, network: (data.network as string) ?? null, allowanceRemaining: (data.allowanceRemaining as number | null) ?? null, report: data.report })
      } else {
        setPayError(`Unexpected status ${status}.`)
      }
    } catch {
      setPayError('Could not reach the backend.')
    } finally {
      setTrying(false)
    }
  }

  async function signAndPay() {
    if (!account || tryState?.kind !== 'unpaid') return
    const req = tryState.accepts[0]
    if (!req) {
      setPayError('No payment requirements were offered.')
      return
    }
    setPaying(true)
    setPayError(null)
    try {
      const chainId = chainIdFromCaip2(req.network)
      if (!chainId) throw new Error(`Unrecognised network ${req.network}`)

      const now = Math.floor(Date.now() / 1000)
      const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
      const nonce = ('0x' + Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`

      const authorization = {
        from: account.address,
        to: req.payTo as `0x${string}`,
        value: BigInt(req.amount),
        validAfter: BigInt(now - 60),
        validBefore: BigInt(now + req.maxTimeoutSeconds),
        nonce,
      }

      const signature = await account.signTypedData({
        domain: {
          name: req.extra?.name ?? 'USDC',
          version: req.extra?.version ?? '2',
          chainId,
          verifyingContract: req.asset as `0x${string}`,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: authorization,
      })

      const payload = {
        x402Version: 2,
        resource: { url: info?.resource ?? '' },
        accepted: req,
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

      const { status, data, headers } = await x402Request<Record<string, unknown>>(`/x402/risk-report?wallet=${account.address}`, {
        headers: { [X402_HEADERS.SIGNATURE]: encodeX402Header(payload) },
      })

      if (status === 200) {
        const settlement = decodeX402Header<{ transaction?: string; network?: string }>(headers.get(X402_HEADERS.RESPONSE))
        setTryState({
          kind: 'paid',
          paidBy: (data.paidBy as string) ?? account.address,
          transaction: (data.transaction as string) ?? settlement?.transaction ?? null,
          network: (data.network as string) ?? settlement?.network ?? null,
          allowanceRemaining: (data.allowanceRemaining as number | null) ?? null,
          report: data.report,
        })
      } else {
        setPayError(String(data.message ?? `Payment refused or unreachable (${status}). Note: this ephemeral demo wallet has no real testnet USDC — settlement failing for lack of funds is an honest, expected result, not a bug.`))
      }
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Signing failed.')
    } finally {
      setPaying(false)
    }
  }

  async function loadLedger(e: React.FormEvent) {
    e.preventDefault()
    setLedgerError(null)
    try {
      const { status, data } = await x402Request<{ payments: X402PaymentRow[] }>(`/x402/payments/${ledgerActorId.trim()}`)
      if (status !== 200) {
        setLedgerError(`Could not load the ledger (${status}).`)
        return
      }
      setPayments(data.payments)
    } catch {
      setLedgerError('Could not reach the backend.')
    }
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <h1 className="mb-1 font-shout text-[2.2rem] leading-none uppercase">x402 agent commerce</h1>
      <p className="mb-6 max-w-[64ch] text-[0.86rem] text-dim">No API key on this surface — the payment is the authorization.</p>

      {/* Resource card */}
      <div className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">
          <Coins size={14} strokeWidth={1.5} />
          Resource
        </h2>
        {infoError ? (
          <ReasonPanel outcome="Unavailable" summary={infoError} />
        ) : !info ? (
          <div className="h-[100px] animate-pulse border border-rule bg-paper-2" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-rule p-3">
              <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">x402 version</p>
              <p className="m-0 font-shout text-[1.3rem]">v{info.x402Version}</p>
            </div>
            <div className="border border-rule p-3">
              <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Price</p>
              <p className="m-0 font-tele text-[0.82rem] text-ink">
                {info.accepts[0]?.amount} {info.accepts[0]?.extra?.name ?? ''}
              </p>
            </div>
            <div className="border border-rule p-3">
              <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Network</p>
              <p className="m-0 font-tele text-[0.82rem] text-ink">{info.accepts[0]?.network}</p>
            </div>
            <div className="border border-rule p-3">
              <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Facilitator</p>
              <p className={`m-0 font-tele text-[0.82rem] uppercase ${info.facilitator.supported ? 'text-acid' : 'text-signal'}`}>
                {info.facilitator.supported ? 'Supported' : 'Unsupported'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Live purchase demo */}
      <div className="mb-8">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Live purchase demo</h2>
        <p className="mb-3 font-tele text-[0.72rem] text-dim">
          Payer wallet (ephemeral, generated in your browser, testnet-only — never funded, never persisted):{' '}
          {account ? <Address value={account.address} /> : '···'}
        </p>
        <button
          type="button"
          onClick={() => void tryRequest()}
          disabled={trying || !account}
          className="mb-4 border border-hard bg-hard px-5 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
        >
          {trying ? 'Requesting…' : 'Try request'}
        </button>

        {payError ? <div className="mb-4"><ReasonPanel outcome="Error" summary={payError} /></div> : null}

        {tryState?.kind === 'unpaid' ? (
          <div>
            <ReasonPanel
              outcome="402 Payment Required"
              code={tryState.reasonCode}
              summary={`Trust band ${tryState.trustBand}. Allowance remaining: ${tryState.allowanceRemaining ?? 'unknown'}.`}
              next="This is not an error — it's an invitation to pay."
            />
            <button
              type="button"
              onClick={() => void signAndPay()}
              disabled={paying}
              className="mt-4 border border-hard bg-hard px-5 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
            >
              {paying ? 'Signing…' : 'Sign & pay'}
            </button>
          </div>
        ) : null}

        {tryState?.kind === 'refused' ? (
          <ReasonPanel
            outcome={tryState.status === 403 ? '403 Refused' : '429 Allowance exhausted'}
            code={tryState.reasonCode ?? undefined}
            summary={tryState.message}
            next={
              tryState.status === 403
                ? 'A 402 is an invitation to pay. We do not invite payment from an agent we have refused.'
                : 'Not a refusal — it may succeed later.'
            }
          />
        ) : null}

        {tryState?.kind === 'paid' ? (
          <div className="border border-rule p-4">
            <p className="m-0 mb-2 font-shout text-[1.4rem] text-acid uppercase">Paid</p>
            {tryState.transaction ? (
              <p className="m-0 mb-2"><TxLink hash={tryState.transaction} chainId={84532} /></p>
            ) : null}
            <p className="m-0 mb-2 font-tele text-[0.74rem] text-dim">Allowance remaining: {tryState.allowanceRemaining ?? 'unknown'}</p>
            <pre className="m-0 overflow-x-auto font-tele text-[0.68rem] text-dim">{JSON.stringify(tryState.report, null, 2)}</pre>
          </div>
        ) : null}
      </div>

      {/* Rate ladder */}
      <div className="mb-8">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Rate ladder — same resource, different rate per trust</h2>
        <DataTable
          columns={[
            { key: 'band', label: 'Trust band' },
            { key: 'rate', label: 'Requests / window' },
            { key: 'reason', label: 'Reason code' },
          ]}
          rows={X402_RATE_LADDER}
          rowKey={(r) => r.reasonCode}
          cell={(r, key) => {
            switch (key) {
              case 'band':
                return r.trustBands?.join(', ') ?? '—'
              case 'rate':
                return r.effect === 'BLOCK' ? '0' : `${r.limitFrequency} / ${r.limitWindowSeconds}s`
              case 'reason':
                return r.reasonCode
              default:
                return null
            }
          }}
        />
      </div>

      {/* Ledger */}
      <div>
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Payment ledger</h2>
        <form onSubmit={loadLedger} className="mb-4 flex gap-2">
          <input
            value={ledgerActorId}
            onChange={(e) => setLedgerActorId(e.target.value)}
            placeholder="actorId"
            className="flex-1 border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
          />
          <button type="submit" className="border border-hard bg-hard px-4 py-2 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase">
            Load
          </button>
        </form>
        {ledgerError ? <ReasonPanel outcome="Error" summary={ledgerError} /> : null}
        {payments && payments.length === 0 ? (
          <EmptyState icon={Coins} title="NO PAYMENTS" body="Includes refusals — that's the point of the ledger." />
        ) : payments ? (
          <DataTable
            columns={[
              { key: 'status', label: 'Status' },
              { key: 'band', label: 'Trust band' },
              { key: 'amount', label: 'Amount' },
              { key: 'tx', label: 'Transaction' },
              { key: 'created', label: 'Created' },
            ]}
            rows={payments}
            rowKey={(p) => p.id}
            cell={(p, key) => {
              switch (key) {
                case 'status':
                  return <StatusBadge kind="payment" value={p.status} />
                case 'band':
                  return p.trustBand ?? '—'
                case 'amount':
                  return p.amount ?? '—'
                case 'tx':
                  return p.transaction ? <TxLink hash={p.transaction} chainId={84532} /> : '—'
                case 'created':
                  return new Date(p.createdAt).toLocaleString()
                default:
                  return null
              }
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
