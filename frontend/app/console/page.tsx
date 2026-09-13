'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bot, Siren, KeyRound, FileSignature, Database, Share2, Radio, SearchCheck, CircleHelp } from 'lucide-react'
import { consoleApi } from '@/lib/api/console'
import type { AgentRow, HealthResponse, IncidentRow } from '@/lib/types'
import { StatusBadge } from '@/components/xander/StatusBadge'
import { LiveBadge } from '@/components/xander/LiveBadge'
import { EmptyState } from '@/components/xander/EmptyState'
import { DataTable } from '@/components/xander/DataTable'

function StatTile({ label, value, href, icon: Icon }: { label: string; value: React.ReactNode; href?: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }) {
  const body = (
    <div className="border border-rule p-4 transition-colors hover:border-ink">
      <div className="mb-2 flex items-center justify-between">
        <Icon size={16} strokeWidth={1.5} className="text-faint" />
      </div>
      <div className="mb-1 font-shout text-[2.2rem] leading-none tabular-nums">{value}</div>
      <div className="font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">{label}</div>
    </div>
  )
  return href ? <Link href={href} className="no-underline text-ink">{body}</Link> : body
}

function UnknownTile({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="border border-dashed border-bolt p-4">
      <div className="mb-2 flex items-center gap-1.5 font-tele text-[0.85rem] tracking-[0.1em] text-bolt uppercase">
        <CircleHelp size={14} strokeWidth={1.5} />
        Unknown
      </div>
      <div className="mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">{label}</div>
      <p className="m-0 text-[0.68rem] leading-snug text-dim">{reason}</p>
    </div>
  )
}

export default function ConsoleOverview() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null)
  const [incidents, setIncidents] = useState<IncidentRow[] | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [now, setNow] = useState<string>('')

  useEffect(() => {
    setNow(new Date().toISOString())
    let cancelled = false
    async function load() {
      const [a, i, h] = await Promise.all([
        consoleApi.get<{ agents: AgentRow[] }>('/v2/agents').catch(() => null),
        consoleApi.get<{ incidents: IncidentRow[] }>('/v2/incidents').catch(() => null),
        consoleApi.get<HealthResponse>('/health').catch(() => null),
      ])
      if (cancelled) return
      if (a) setAgents(a.data.agents)
      if (i) setIncidents(i.data.incidents)
      if (h) setHealth(h.data)
    }
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const openIncidents = incidents?.filter((i) => i.status === 'OPEN' || i.status === 'INVESTIGATING' || i.status === 'MITIGATED') ?? null
  const sortedIncidents = openIncidents
    ? [...openIncidents].sort((a, b) => {
        const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
        return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9)
      })
    : null

  const provenance = health?.provenance
  const tokenApiOk = provenance?.tokenApi ? !provenance.tokenApi.stale : null
  const deployments = provenance?.deployments ?? []
  const substreams = provenance?.substreams ?? []

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-shout text-[2.2rem] leading-none uppercase">Trust runtime</h1>
        <div className="flex items-center gap-3">
          <LiveBadge />
          <span className="font-tele text-[0.66rem] tracking-[0.1em] text-faint">{now}</span>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active agents" value={agents ? agents.filter((a) => a.status === 'ACTIVE').length : '···'} href="/console/agents" icon={Bot} />
        <UnknownTile label="Live capabilities" reason="No aggregate endpoint — capabilities are per-actor only (GET /v2/actors/:id/capabilities)." />
        <StatTile label="Open incidents" value={openIncidents ? openIncidents.length : '···'} href="/console/incidents" icon={Siren} />
        <UnknownTile label="Decisions (24h)" reason="No GET /v2/intents list endpoint exists yet — only POST and GET by id." />
      </div>

      <div className="mb-8">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Trust band distribution</h2>
        <EmptyState
          icon={FileSignature}
          title="NO ACTOR-LISTING ENDPOINT"
          body="A distribution across the six trust bands requires enumerating actors. The backend has no GET /v2/actors list — flagged in docs/frontendfinal.md §9 as an open backend ask."
        />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="m-0 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Recent decisions</h2>
          </div>
          <EmptyState
            icon={FileSignature}
            title="NO DECISION LOG YET"
            body="Same gap as above — there is no endpoint that lists intents. Individual decisions are reachable by id once created."
          />
        </div>

        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="m-0 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Open incidents</h2>
            <Link href="/console/incidents" className="dn-split font-tele text-[0.7rem] text-ink uppercase">
              All →
            </Link>
          </div>
          {sortedIncidents === null ? (
            <p className="font-tele text-[0.78rem] text-faint uppercase">Loading…</p>
          ) : sortedIncidents.length === 0 ? (
            <EmptyState icon={Siren} title="NOTHING OPEN" body="No incidents in OPEN, INVESTIGATING, or MITIGATED status." />
          ) : (
            <DataTable
              columns={[
                { key: 'type', label: 'Type' },
                { key: 'severity', label: 'Severity' },
                { key: 'status', label: 'Status' },
                { key: 'opened', label: 'Opened' },
              ]}
              rows={sortedIncidents.slice(0, 10)}
              rowKey={(r) => r.id}
              cell={(r, key) => {
                if (key === 'type') return <span className="flex items-center gap-1.5"><Siren size={13} strokeWidth={1.5} />{r.type.replace(/_/g, ' ')}</span>
                if (key === 'severity') return <StatusBadge kind="severity" value={r.severity} />
                if (key === 'status') return <StatusBadge kind="incident" value={r.status} severity={r.severity} />
                if (key === 'opened') return new Date(r.openedAt).toLocaleString()
                return null
              }}
            />
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Evidence pipeline</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="border border-rule p-4">
            <Database size={16} strokeWidth={1.5} className="mb-2 text-faint" />
            <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Token API</div>
            {tokenApiOk === null ? (
              <div className="font-tele text-[0.72rem] text-faint uppercase">No signal</div>
            ) : (
              <div className={`font-tele text-[0.72rem] uppercase ${tokenApiOk ? 'text-acid' : 'text-signal'}`}>
                {tokenApiOk ? 'Fresh' : 'Stale'}
                {provenance?.tokenApi?.ageSeconds != null ? ` · ${provenance.tokenApi.ageSeconds}s ago` : ''}
              </div>
            )}
          </div>
          <div className="border border-rule p-4">
            <Share2 size={16} strokeWidth={1.5} className="mb-2 text-faint" />
            <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Subgraphs</div>
            <div className="font-tele text-[0.72rem] text-ink uppercase">{deployments.length} deployment{deployments.length === 1 ? '' : 's'}</div>
          </div>
          <div className="border border-rule p-4">
            <Radio size={16} strokeWidth={1.5} className="mb-2 text-faint" />
            <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Substreams</div>
            <div className="font-tele text-[0.72rem] text-ink uppercase">{substreams.length} active cursor{substreams.length === 1 ? '' : 's'}</div>
          </div>
          <div className="border border-rule p-4">
            <SearchCheck size={16} strokeWidth={1.5} className="mb-2 text-faint" />
            <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Subgraph MCP</div>
            <div className="font-tele text-[0.72rem] text-faint uppercase">No /health signal</div>
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center gap-2 border border-rule p-3">
        <KeyRound size={14} strokeWidth={1.5} className="text-faint" />
        <span className="font-tele text-[0.68rem] text-dim">
          Try <Link href="/console/evidence" className="dn-split text-ink">Evidence</Link> — pull a real wallet through the Graph pipeline and open its trust dossier.
        </span>
      </div>
    </div>
  )
}
