'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, Copy, Database, ShieldCheck, CircleHelp } from 'lucide-react'
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { consoleApi, ApiError } from '@/lib/api/console'
import type {
  ActorView,
  CapabilitiesResponse,
  EnforcementResponse,
  TrustContextResponse,
  TrustHistoryResponse,
} from '@/lib/types'
import { TRUST_DIMENSIONS } from '@/lib/types'
import { COLOR_CLASSES, semanticColor } from '@/lib/semantics'
import { Measure } from '@/components/xander/Measure'
import { StatusBadge } from '@/components/xander/StatusBadge'
import { DataTable } from '@/components/xander/DataTable'
import { EmptyState } from '@/components/xander/EmptyState'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { Timeline, type TimelineItem } from '@/components/xander/Timeline'
import { Address } from '@/components/xander/Mono'

const BAND_RANK: Record<string, number> = {
  VERIFIED_LOW: 0,
  ESTABLISHED_LOW: 1,
  UNCERTAIN: 2,
  INSUFFICIENT_EVIDENCE: 2,
  HIGH_RISK: 3,
  CRITICAL: 4,
}

export default function ActorDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [actor, setActor] = useState<ActorView | null>(null)
  const [trust, setTrust] = useState<TrustContextResponse | null>(null)
  const [history, setHistory] = useState<TrustHistoryResponse | null>(null)
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null)
  const [enforcement, setEnforcement] = useState<EnforcementResponse | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * `?fresh=false` returns a deliberately short shape — `{actorId, band,
   * snapshotId, cached}`, no `vector` — because it's meant for cheap polling
   * across many rows, not for this page. This dossier's whole point is the
   * vector, so it always calls the full endpoint; the one-time cost of a
   * human opening one actor's page is not the "polling" the spec warns
   * against, which is about timers, not page loads.
   */
  async function loadAll() {
    try {
      const actorRes = await consoleApi.get<ActorView>(`/v2/actors/${id}`)
      if (actorRes.status === 404) {
        setNotFound(true)
        return
      }
      setActor(actorRes.data)

      const [trustRes, historyRes, capRes, enfRes] = await Promise.all([
        consoleApi.get<TrustContextResponse>(`/v2/actors/${id}/trust`),
        consoleApi.get<TrustHistoryResponse>(`/v2/actors/${id}/trust/history`),
        consoleApi.get<CapabilitiesResponse>(`/v2/actors/${id}/capabilities`),
        consoleApi.get<EnforcementResponse>(`/v2/actors/${id}/enforcement`),
      ])
      setTrust(trustRes.data)
      setHistory(historyRes.data)
      setCapabilities(capRes.data)
      setEnforcement(enfRes.data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function rebuild() {
    setRebuilding(true)
    try {
      await loadAll()
    } finally {
      setRebuilding(false)
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-[720px] py-10">
        <ReasonPanel outcome="Not found" code="404" summary={`No actor with id ${id}.`} />
      </div>
    )
  }

  if (error && !actor) {
    return (
      <div className="mx-auto max-w-[720px] py-10">
        <ReasonPanel outcome="Request failed" summary={error} />
      </div>
    )
  }

  if (!actor) {
    return <div className="font-tele text-[0.8rem] text-faint uppercase">Loading…</div>
  }

  const band = trust?.band
  const bandColor = band ? semanticColor('band', band) : 'bolt'

  const radarData = TRUST_DIMENSIONS.map(({ key, label }) => {
    const dim = trust?.vector?.[key]
    return {
      axis: label,
      value: dim && dim.state === 'KNOWN' ? dim.value : null,
    }
  })

  const sparkline = history
    ? [...history.snapshots]
        .slice()
        .reverse()
        .map((s, i) => ({ i, rank: BAND_RANK[s.band] ?? 2, band: s.band, createdAt: s.createdAt }))
    : []

  const timelineItems: TimelineItem[] = history
    ? [
        ...history.snapshots.map((s) => ({
          id: `snap-${s.snapshotId}`,
          label: `Snapshot · ${s.band}`,
          detail: `Engine ${s.engineVersion} · policy ${s.policyVersion}`,
          timestamp: new Date(s.createdAt).toLocaleString(),
          color: semanticColor('band', s.band),
        })),
        ...history.signals.map((sig, i) => ({
          id: `sig-${i}-${sig.kind}`,
          label: `Signal · ${sig.kind.replace(/_/g, ' ')}`,
          detail: `${sig.positive ? 'Positive' : 'Negative'} · weight ${sig.weight} · ${sig.detail} · source: ${sig.source}`,
          timestamp: sig.createdAt ? new Date(sig.createdAt).toLocaleString() : undefined,
          color: sig.positive ? ('acid' as const) : ('signal' as const),
        })),
      ].sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
    : []

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 font-tele text-[0.68rem] tracking-[0.16em] text-faint uppercase">
            {actor.actorType} · {actor.status}
          </div>
          <div className="flex items-center gap-2">
            <h1 className="m-0 font-tele text-[1.1rem] text-ink">{actor.id}</h1>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(actor.id).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                })
              }}
              className="text-faint hover:text-ink"
              title="Copy actor id"
            >
              <Copy size={14} strokeWidth={1.5} />
            </button>
            {copied ? <span className="font-tele text-[0.62rem] text-acid uppercase">Copied</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {actor.identities.map((idn) => (
              <span key={idn.externalId} className="font-tele text-[0.72rem] text-dim">
                {idn.kind}: <Address value={idn.externalId} />
              </span>
            ))}
          </div>
          <div className="mt-1 font-tele text-[0.64rem] text-faint uppercase">
            Created {new Date(actor.createdAt).toLocaleString()}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/console/evidence"
            className="dn-split flex items-center gap-1.5 border border-field px-4 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-ink uppercase no-underline"
          >
            <Database size={14} strokeWidth={1.5} />
            View evidence
          </Link>
          <button
            type="button"
            onClick={() => void rebuild()}
            disabled={rebuilding}
            className="flex items-center gap-1.5 border border-hard bg-hard px-4 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase disabled:opacity-50"
            title="Live Graph rebuild — spends quota"
          >
            <RefreshCw size={14} strokeWidth={1.5} className={rebuilding ? 'animate-spin' : ''} />
            Rebuild trust
          </button>
        </div>
      </div>

      {error ? <div className="mb-6"><ReasonPanel outcome="Partial data" summary={error} /></div> : null}

      <div className="mb-8 border-[3px] border-hard bg-paper-2 p-6">
        {band ? (
          <>
            <div className={`font-shout text-[clamp(2.4rem,6vw,4rem)] leading-none uppercase ${COLOR_CLASSES[bandColor].text}`}>
              {band.replace(/_/g, ' ')}
            </div>
            <div className="mt-2 font-tele text-[0.72rem] tracking-[0.1em] text-dim uppercase">
              Engine {trust?.engineVersion} · Policy {trust?.policyVersion} · {trust?.cached ? 'cached snapshot' : 'live rebuild'}
            </div>
          </>
        ) : (
          <div className="font-tele text-[0.85rem] text-faint uppercase">Loading trust band…</div>
        )}
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Trust vector</h2>
          <div className="h-[300px] border border-rule p-2">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="70%">
                <PolarGrid stroke="var(--color-rule)" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: 'var(--color-dim)', fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 1]} tick={false} axisLine={false} />
                <Radar
                  dataKey="value"
                  connectNulls={false}
                  stroke="var(--color-ink)"
                  fill="var(--color-ink)"
                  fillOpacity={0.15}
                  isAnimationActive={false}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 font-tele text-[0.62rem] leading-relaxed text-faint uppercase">
            A gap in the polygon is an unmeasured axis — never rendered as zero.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {trust
            ? TRUST_DIMENSIONS.map(({ key, label }) => (
                <Measure key={key} value={trust.vector[key].value} state={trust.vector[key].state} basis={trust.vector[key].basis} label={label} />
              ))
            : Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-[92px] animate-pulse border border-rule bg-paper-2" />
              ))}
        </div>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Drift</h2>
        {sparkline.length > 1 ? (
          <div className="h-[120px] border border-rule p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline}>
                <XAxis dataKey="i" hide />
                <YAxis domain={[0, 4]} hide />
                <Tooltip
                  formatter={(_value, _name, item) => [item.payload.band, 'Band']}
                  labelFormatter={() => ''}
                  contentStyle={{ fontFamily: 'var(--font-tele)', fontSize: 11 }}
                />
                <Line type="stepAfter" dataKey="rank" stroke="var(--color-ink)" dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState icon={CircleHelp} title="NOT ENOUGH SNAPSHOTS FOR A DRIFT LINE" body="Rebuild trust a few times to see the band move." />
        )}
        {trust ? (
          <p className="mt-2 font-tele text-[0.68rem] text-dim">
            Peak drift magnitude: {trust.drift.peakMagnitude} · baseline {trust.drift.hadBaseline ? 'established' : 'not yet established'}
          </p>
        ) : null}
      </div>

      <div className="mb-8">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Capabilities</h2>
        {capabilities ? (
          <>
            <div className="mb-3 font-tele text-[0.72rem] text-dim uppercase">
              Assurance: {capabilities.assurance.hasLiveLease ? (
                <span className="text-acid">{capabilities.assurance.level} · expires {capabilities.assurance.expiresAt}</span>
              ) : (
                <span className="text-faint">no live lease</span>
              )}
            </div>
            {capabilities.capabilities.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="NO AUTHORITY" body="Zero capabilities. A name is not an authorisation." />
            ) : (
              <DataTable
                columns={[
                  { key: 'action', label: 'Action' },
                  { key: 'status', label: 'Status' },
                  { key: 'limit', label: 'Amount limit' },
                  { key: 'freq', label: 'Frequency' },
                  { key: 'expiry', label: 'Expiry' },
                ]}
                rows={capabilities.capabilities}
                rowKey={(c) => c.id}
                cell={(c, key) => {
                  switch (key) {
                    case 'action':
                      return c.actionType
                    case 'status':
                      return <StatusBadge kind="capability" value={c.live ? c.status : 'EXPIRED'} />
                    case 'limit':
                      return c.amountLimit ?? '—'
                    case 'freq':
                      return c.frequencyLimit ? `${c.frequencyLimit} / ${c.frequencyWindowSeconds}s` : '—'
                    case 'expiry':
                      return c.expiresAt ? new Date(c.expiresAt).toLocaleString() : '—'
                    default:
                      return null
                  }
                }}
              />
            )}
          </>
        ) : (
          <div className="h-[80px] animate-pulse border border-rule bg-paper-2" />
        )}
      </div>

      <div className="mb-8">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Enforcement boundaries</h2>
        {enforcement ? (
          enforcement.boundaries.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="NO BOUNDARIES REPORTED" />
          ) : (
            <DataTable
              columns={[
                { key: 'adapter', label: 'Adapter' },
                { key: 'action', label: 'Action' },
                { key: 'enforceable', label: 'Enforceable' },
                { key: 'detail', label: 'Detail' },
              ]}
              rows={enforcement.boundaries}
              rowKey={(b) => `${b.adapter}-${b.actionType}`}
              cell={(b, key) => {
                switch (key) {
                  case 'adapter':
                    return b.adapter
                  case 'action':
                    return b.actionType
                  case 'enforceable':
                    return b.enforceable === null ? (
                      <span className="inline-flex items-center gap-1 font-tele text-[0.7rem] text-bolt uppercase">
                        <CircleHelp size={12} strokeWidth={1.5} /> Unknown
                      </span>
                    ) : b.enforceable ? (
                      <span className="font-tele text-[0.7rem] text-acid uppercase">Yes</span>
                    ) : (
                      <span className="font-tele text-[0.7rem] text-signal uppercase">No</span>
                    )
                  case 'detail':
                    return <span className="text-dim">{b.detail}</span>
                  default:
                    return null
                }
              }}
            />
          )
        ) : (
          <div className="h-[80px] animate-pulse border border-rule bg-paper-2" />
        )}
      </div>

      <div>
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Trust history</h2>
        {timelineItems.length > 0 ? <Timeline items={timelineItems} /> : <EmptyState icon={CircleHelp} title="NO HISTORY YET" />}
      </div>
    </div>
  )
}
