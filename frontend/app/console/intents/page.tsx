'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileSignature, Search } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type { IntentView } from '@/lib/types'
import { ACTION_TYPES } from '@/lib/types'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { EmptyState } from '@/components/xander/EmptyState'

/**
 * There is no `GET /v2/intents` list endpoint (docs/backendwiring.md §9 gap) —
 * only `POST /v2/intents` and `GET /v2/intents/:id`. So this page is a
 * create/lookup tool rather than a list, and says so rather than faking one.
 */
export default function IntentsPage() {
  const router = useRouter()
  const [lookupId, setLookupId] = useState('')

  const [wallet, setWallet] = useState('')
  const [actionType, setActionType] = useState<string>('TRADE')
  const [resourceType, setResourceType] = useState('demo')
  const [resourceId, setResourceId] = useState('console-test')
  const [amount, setAmount] = useState('')
  const [chainId, setChainId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        wallet: wallet.trim(),
        actionType,
        resourceType: resourceType.trim(),
        resourceId: resourceId.trim(),
      }
      if (amount.trim()) body.amount = amount.trim()
      if (chainId.trim()) body.chainId = Number(chainId.trim())

      const { status, data } = await consoleApi.post<IntentView & { message?: string }>('/v2/intents', body)
      if (status !== 201 && status !== 200) {
        setError((data as unknown as { message?: string }).message ?? `Could not create the intent (${status}).`)
        return
      }
      router.push(`/console/intents/${data.intentId}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1000px]">
      <h1 className="mb-1 font-shout text-[2.2rem] leading-none uppercase">Decisions</h1>
      <p className="mb-6 max-w-[64ch] text-[0.86rem] text-dim">
        Every intent is reachable by id once created. There is no endpoint that lists them — create one to see a
        real decision, or look one up.
      </p>

      <div className="mb-8 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 flex items-center gap-2 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">
            <FileSignature size={14} strokeWidth={1.5} />
            Create an intent
          </h2>
          <form onSubmit={create} className="border border-rule p-4">
            <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Wallet</label>
            <input
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="0x…"
              required
              className="mb-3 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
            />
            <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Action type</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="mb-3 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
            >
              {ACTION_TYPES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Resource type</label>
                <input
                  value={resourceType}
                  onChange={(e) => setResourceType(e.target.value)}
                  required
                  className="w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
                />
              </div>
              <div>
                <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Resource id</label>
                <input
                  value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                  required
                  className="w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
                />
              </div>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Amount (base units)</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="optional"
                  className="w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
                />
              </div>
              <div>
                <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Chain id</label>
                <input
                  value={chainId}
                  onChange={(e) => setChainId(e.target.value)}
                  placeholder="optional"
                  className="w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
                />
              </div>
            </div>
            {error ? <div className="mb-4"><ReasonPanel outcome="Could not create" summary={error} /></div> : null}
            <button
              type="submit"
              disabled={creating}
              className="w-full border border-hard bg-hard px-5 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
            >
              {creating ? 'Deciding…' : 'Submit intent'}
            </button>
          </form>
        </div>

        <div>
          <h2 className="mb-3 flex items-center gap-2 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">
            <Search size={14} strokeWidth={1.5} />
            Look up by id
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (lookupId.trim()) router.push(`/console/intents/${lookupId.trim()}`)
            }}
            className="mb-6 flex gap-2"
          >
            <input
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              placeholder="intentId"
              className="flex-1 border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
            />
            <button type="submit" className="border border-hard bg-hard px-4 py-2 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase">
              Open
            </button>
          </form>
          <EmptyState
            icon={FileSignature}
            title="NO DECISION LOG"
            body="No GET /v2/intents list endpoint exists yet (docs/backendwiring.md §9). Individual decisions are reachable by id once created — this is the workaround, not a hidden feature."
          />
        </div>
      </div>
    </div>
  )
}
