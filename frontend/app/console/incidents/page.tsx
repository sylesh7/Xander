'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Siren, Plus } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type { IncidentRow, OpenIncidentResult } from '@/lib/types'
import { StatusBadge } from '@/components/xander/StatusBadge'
import { DataTable } from '@/components/xander/DataTable'
import { EmptyState } from '@/components/xander/EmptyState'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { LiveBadge } from '@/components/xander/LiveBadge'

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

export default function IncidentsQueuePage() {
  const router = useRouter()
  const [incidents, setIncidents] = useState<IncidentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showOpen, setShowOpen] = useState(false)

  async function load() {
    try {
      const { data } = await consoleApi.get<{ incidents: IncidentRow[] }>('/v2/incidents')
      setIncidents(data.incidents)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    }
  }

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15_000)
    return () => clearInterval(id)
  }, [])

  const sorted = incidents ? [...incidents].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)) : null

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-shout text-[2.2rem] leading-none uppercase">Security operations</h1>
        <div className="flex items-center gap-3">
          <LiveBadge />
          <button
            type="button"
            onClick={() => setShowOpen(true)}
            className="flex items-center gap-1.5 border border-hard bg-hard px-4 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.16em] text-paper uppercase"
          >
            <Plus size={14} strokeWidth={2} />
            Open incident
          </button>
        </div>
      </div>

      {error ? <ReasonPanel outcome="Request failed" summary={error} /> : null}

      {!incidents && !error ? (
        <div className="h-[200px] animate-pulse border border-rule bg-paper-2" />
      ) : sorted && sorted.length === 0 ? (
        <EmptyState icon={Siren} title="NOTHING OPEN" />
      ) : sorted ? (
        <DataTable
          columns={[
            { key: 'type', label: 'Type' },
            { key: 'severity', label: 'Severity' },
            { key: 'status', label: 'Status' },
            { key: 'actor', label: 'Actor' },
            { key: 'source', label: 'Source' },
            { key: 'opened', label: 'Opened' },
          ]}
          rows={sorted}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/console/incidents/${r.id}`)}
          cell={(r, key) => {
            switch (key) {
              case 'type':
                return (
                  <span className={`flex items-center gap-1.5 ${r.severity === 'CRITICAL' ? 'border-l-2 border-signal pl-2' : ''}`}>
                    <Siren size={13} strokeWidth={1.5} />
                    {r.type.replace(/_/g, ' ')}
                  </span>
                )
              case 'severity':
                return <StatusBadge kind="severity" value={r.severity} />
              case 'status':
                return <StatusBadge kind="incident" value={r.status} severity={r.severity} />
              case 'actor':
                return r.actorId ? r.actorId.slice(0, 10) + '…' : '—'
              case 'source':
                return r.source
              case 'opened':
                return new Date(r.openedAt).toLocaleString()
              default:
                return null
            }
          }}
        />
      ) : null}

      {showOpen ? <OpenIncidentDialog onClose={() => setShowOpen(false)} onOpened={() => void load()} /> : null}
    </div>
  )
}

function OpenIncidentDialog({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const router = useRouter()
  const [actorId, setActorId] = useState('')
  const [type, setType] = useState('COORDINATION_DETECTED')
  const [severity, setSeverity] = useState('HIGH')
  const [source, setSource] = useState('console')
  const [detail, setDetail] = useState('')
  const [startWorkflow, setStartWorkflow] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { status, data } = await consoleApi.post<OpenIncidentResult & { message?: string }>('/v2/incidents', {
        actorId: actorId.trim() || undefined,
        type,
        severity,
        source: source.trim(),
        detail: detail.trim() || undefined,
        startWorkflow,
      })
      if (status !== 201) {
        setError((data as unknown as { message?: string }).message ?? `Could not open the incident (${status}).`)
        return
      }
      onOpened()
      onClose()
      router.push(`/console/incidents/${data.incident.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/50 px-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-[440px] border-2 border-hard bg-paper p-6 shadow-[6px_6px_0_var(--color-hard)]">
        <h2 className="mb-4 font-shout text-[1.5rem] uppercase">Open incident</h2>
        <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Actor id (optional)</label>
        <input value={actorId} onChange={(e) => setActorId(e.target.value)} className="mb-3 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] outline-none focus:border-signal" />
        <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Type</label>
        <select value={type} onChange={(e) => setType(e.target.value)} className="mb-3 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] outline-none focus:border-signal">
          {['COORDINATION_DETECTED', 'TRUST_COLLAPSE', 'ENFORCEMENT_FAILURE', 'ASSURANCE_LAPSE', 'ANOMALOUS_VELOCITY', 'MANUAL'].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Severity</label>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="mb-3 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] outline-none focus:border-signal">
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Source</label>
        <input value={source} onChange={(e) => setSource(e.target.value)} required className="mb-3 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] outline-none focus:border-signal" />
        <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Detail (optional)</label>
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} className="mb-3 w-full resize-none border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] outline-none focus:border-signal" />
        <label className="mb-4 flex items-center gap-2 font-tele text-[0.7rem] text-dim uppercase">
          <input type="checkbox" checked={startWorkflow} onChange={(e) => setStartWorkflow(e.target.checked)} />
          Start durable workflow
        </label>
        {error ? <p className="mb-3 font-tele text-[0.76rem] text-signal">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="border border-field px-4 py-2 font-tele text-[0.7rem] font-bold tracking-[0.12em] uppercase">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="border border-hard bg-hard px-4 py-2 font-tele text-[0.7rem] font-bold tracking-[0.12em] text-paper uppercase disabled:opacity-50">
            {submitting ? 'Opening…' : 'Open'}
          </button>
        </div>
      </form>
    </div>
  )
}
