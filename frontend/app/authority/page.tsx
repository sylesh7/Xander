'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Siren } from 'lucide-react'
import { authorityApi, ApiError } from '@/lib/api/authority'
import type { PendingAction } from '@/lib/types'
import { EmptyState } from '@/components/xander/EmptyState'
import { LiveBadge } from '@/components/xander/LiveBadge'
import { StatusBadge } from '@/components/xander/StatusBadge'

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [left, setLeft] = useState(() => Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)), 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  return (
    <span className={`font-tele text-[0.7rem] uppercase ${left < 60 ? 'text-signal' : 'text-faint'}`}>
      {left <= 0 ? 'expired' : `expires in ${Math.floor(left / 60)}m ${left % 60}s`}
    </span>
  )
}

export default function AuthorityQueuePage() {
  const router = useRouter()
  const [actions, setActions] = useState<PendingAction[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const { data } = await authorityApi.get<{ actions: PendingAction[] }>('/v2/control/pending-actions')
      setActions(data.actions)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    }
  }

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 10_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="m-0 font-shout text-[1.7rem] leading-none uppercase">Pending</h1>
        <LiveBadge />
      </div>

      {error ? <p className="font-tele text-[0.8rem] text-signal">{error}</p> : null}

      {!actions && !error ? (
        <div className="h-[140px] animate-pulse border border-rule bg-paper-2" />
      ) : actions && actions.length === 0 ? (
        <EmptyState icon={Siren} title="NOTHING AWAITING YOU" />
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {actions?.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => router.push(`/authority/actions/${a.id}`)}
                className={`w-full border-l-4 bg-paper-2 p-4 text-left ${
                  a.severity === 'CRITICAL' || a.severity === 'HIGH' ? 'border-signal' : 'border-amber'
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <StatusBadge kind="severity" value={a.severity} />
                  {a.requiresStepUp ? <span className="font-tele text-[0.62rem] text-bolt uppercase">Step-up required</span> : null}
                </div>
                <p className="m-0 font-noir text-[1.05rem] leading-snug text-ink">{a.summary}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-tele text-[0.66rem] tracking-[0.08em] text-dim uppercase">{a.allowed.join(' · ')}</span>
                  <Countdown expiresAt={a.expiresAt} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
