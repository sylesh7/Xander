'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, BadgeCheck, Snowflake, Bot } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { consoleApi, ApiError } from '@/lib/api/console'
import type { AgentRow, CapabilitiesResponse, IncidentRow, TrustBand } from '@/lib/types'
import { StatusBadge } from '@/components/xander/StatusBadge'
import { DataTable } from '@/components/xander/DataTable'
import { EmptyState } from '@/components/xander/EmptyState'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { ConfirmDialog } from '@/components/xander/ConfirmDialog'

interface Enrichment {
  band: TrustBand | 'UNKNOWN' | 'LOADING'
  capabilityCount: number | null
  openIncidents: number | null
}

const OPEN_STATUSES = new Set(['OPEN', 'INVESTIGATING', 'MITIGATED'])

export default function AgentsRosterPage() {
  const router = useRouter()
  const [agents, setAgents] = useState<AgentRow[] | null>(null)
  const [enrichment, setEnrichment] = useState<Record<string, Enrichment>>({})
  const [error, setError] = useState<string | null>(null)
  const [freezeTarget, setFreezeTarget] = useState<AgentRow | null>(null)

  const [statusFilter, setStatusFilter] = useState('ALL')
  const [bandFilter, setBandFilter] = useState('ALL')
  const [ensFilter, setEnsFilter] = useState('ALL')
  const [incidentFilter, setIncidentFilter] = useState('ALL')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await consoleApi.get<{ agents: AgentRow[] }>('/v2/agents')
        if (cancelled) return
        setAgents(data.agents)

        for (const agent of data.agents) {
          setEnrichment((prev) => ({ ...prev, [agent.id]: { band: 'LOADING', capabilityCount: null, openIncidents: null } }))
          void Promise.allSettled([
            consoleApi.get<{ band: TrustBand }>(`/v2/actors/${agent.actorId}/trust`, { fresh: 'false' }),
            consoleApi.get<CapabilitiesResponse>(`/v2/actors/${agent.actorId}/capabilities`),
            consoleApi.get<{ incidents: IncidentRow[] }>('/v2/incidents', { actorId: agent.actorId }),
          ]).then(([bandRes, capRes, incRes]) => {
            if (cancelled) return
            const band = bandRes.status === 'fulfilled' && bandRes.value.status === 200 ? bandRes.value.data.band : 'UNKNOWN'
            const capabilityCount = capRes.status === 'fulfilled' && capRes.value.status === 200 ? capRes.value.data.capabilities.length : null
            const openIncidents =
              incRes.status === 'fulfilled' && incRes.value.status === 200
                ? incRes.value.data.incidents.filter((i) => OPEN_STATUSES.has(i.status)).length
                : null
            setEnrichment((prev) => ({ ...prev, [agent.id]: { band, capabilityCount, openIncidents } }))
          })
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = (agents ?? []).filter((a) => {
    const e = enrichment[a.id]
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false
    if (bandFilter !== 'ALL' && e?.band !== bandFilter) return false
    if (ensFilter === 'YES' && !a.ensName) return false
    if (ensFilter === 'NO' && a.ensName) return false
    if (incidentFilter === 'YES' && !(e?.openIncidents && e.openIncidents > 0)) return false
    if (incidentFilter === 'NO' && e?.openIncidents) return false
    return true
  })

  async function doFreeze(reason: string) {
    if (!freezeTarget) return
    const { status, data } = await consoleApi.post<{ status: string; message?: string }>(`/v2/agents/${freezeTarget.id}/freeze`, { reason })
    if (status !== 200) throw new Error(data.message ?? `Freeze refused (${status}).`)
    setAgents((prev) => prev?.map((a) => (a.id === freezeTarget.id ? { ...a, status: data.status } : a)) ?? null)
    setFreezeTarget(null)
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 font-shout text-[2.2rem] leading-none uppercase">Agent roster</h1>
        <Link
          href="/console/agents/new"
          className="dn-split flex items-center gap-1.5 border border-hard bg-hard px-4 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.16em] text-paper uppercase no-underline"
        >
          <Plus size={14} strokeWidth={2} />
          Create agent
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        {[
          { label: 'Status', value: statusFilter, set: setStatusFilter, options: ['ALL', 'DRAFT', 'VERIFYING', 'HUMAN_BACKED', 'ACTIVE', 'RESTRICTED', 'FROZEN', 'REVOKED'] },
          { label: 'Band', value: bandFilter, set: setBandFilter, options: ['ALL', 'VERIFIED_LOW', 'ESTABLISHED_LOW', 'UNCERTAIN', 'HIGH_RISK', 'CRITICAL', 'INSUFFICIENT_EVIDENCE', 'UNKNOWN'] },
          { label: 'Has ENS', value: ensFilter, set: setEnsFilter, options: ['ALL', 'YES', 'NO'] },
          { label: 'Has incidents', value: incidentFilter, set: setIncidentFilter, options: ['ALL', 'YES', 'NO'] },
        ].map((f) => (
          <label key={f.label} className="flex items-center gap-2 font-tele text-[0.66rem] tracking-[0.1em] text-dim uppercase">
            {f.label}
            <select
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              className="border border-field bg-paper px-2 py-1 font-tele text-[0.7rem] text-ink outline-none"
            >
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {error ? <ReasonPanel outcome="Request failed" summary={error} /> : null}

      {!agents && !error ? (
        <div className="h-[200px] animate-pulse border border-rule bg-paper-2" />
      ) : agents && filtered.length === 0 ? (
        <EmptyState icon={Bot} title="NO AGENTS MATCH" body={agents.length === 0 ? 'No agents created yet.' : 'Adjust the filters above.'} />
      ) : agents ? (
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'status', label: 'Status' },
            { key: 'ens', label: 'ENS' },
            { key: 'band', label: 'Trust band' },
            { key: 'caps', label: 'Capabilities' },
            { key: 'incidents', label: 'Open incidents' },
            { key: 'active', label: 'Last active' },
            { key: 'actions', label: '' },
          ]}
          rows={filtered}
          rowKey={(a) => a.id}
          onRowClick={(a) => router.push(`/console/agents/${a.id}`)}
          cell={(a, key) => {
            const e = enrichment[a.id]
            switch (key) {
              case 'name':
                return a.name
              case 'status':
                return <StatusBadge kind="agentStatus" value={a.status} />
              case 'ens':
                return a.ensName ? (
                  <span className="flex items-center gap-1.5 text-dim">
                    <BadgeCheck size={14} strokeWidth={1.5} className="text-acid" />
                    {a.ensName}
                  </span>
                ) : (
                  <span className="text-faint">—</span>
                )
              case 'band':
                return !e || e.band === 'LOADING' ? (
                  <span className="text-faint">···</span>
                ) : e.band === 'UNKNOWN' ? (
                  <span className="text-bolt uppercase">Unknown</span>
                ) : (
                  <StatusBadge kind="band" value={e.band} />
                )
              case 'caps':
                return e?.capabilityCount ?? <span className="text-faint">···</span>
              case 'incidents':
                return e?.openIncidents ?? <span className="text-faint">···</span>
              case 'active':
                return new Date(a.updatedAt).toLocaleString()
              case 'actions':
                return a.status !== 'FROZEN' && a.status !== 'REVOKED' ? (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      setFreezeTarget(a)
                    }}
                    className="flex items-center gap-1 border border-field px-2 py-1 font-tele text-[0.62rem] tracking-[0.08em] text-dim uppercase opacity-0 transition-opacity hover:border-signal hover:text-signal group-hover:opacity-100"
                    title="Freeze"
                  >
                    <Snowflake size={12} strokeWidth={1.5} />
                    Freeze
                  </button>
                ) : null
              default:
                return null
            }
          }}
        />
      ) : null}

      {freezeTarget ? (
        <ConfirmDialog
          title={`Freeze ${freezeTarget.name}`}
          warning="This is a capability state transition, not a flag. An ENS-backed agent's on-chain roles will be revoked in a real transaction."
          confirmLabel="Freeze agent"
          onCancel={() => setFreezeTarget(null)}
          onConfirm={doFreeze}
        />
      ) : null}
    </div>
  )
}
