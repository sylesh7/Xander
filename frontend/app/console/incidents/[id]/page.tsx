'use client'

import { use, useEffect, useState } from 'react'
import { Search, ShieldAlert, CircleHelp } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type { CounterEvidence, IncidentDetailResponse, MitigateResult, ResolveResult } from '@/lib/types'
import { StatusBadge } from '@/components/xander/StatusBadge'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { Timeline, type TimelineItem } from '@/components/xander/Timeline'
import { EmptyState } from '@/components/xander/EmptyState'

export default function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [detail, setDetail] = useState<IncidentDetailResponse | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [investigating, setInvestigating] = useState(false)
  const [counterEvidence, setCounterEvidence] = useState<CounterEvidence | null>(null)

  const [aiRecommendation, setAiRecommendation] = useState('ALLOW')
  const [mitigating, setMitigating] = useState(false)
  const [mitigateResult, setMitigateResult] = useState<MitigateResult | null>(null)

  const [resolveStatus, setResolveStatus] = useState<'RESOLVED' | 'FALSE_POSITIVE'>('RESOLVED')
  const [rootCause, setRootCause] = useState('')
  const [restore, setRestore] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveResult, setResolveResult] = useState<ResolveResult | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await consoleApi.get<IncidentDetailResponse>(`/v2/incidents/${id}`)
      if (res.status === 404) {
        setNotFound(true)
        return
      }
      setDetail(res.data)
      if (res.data.investigation?.recommendedAction) setAiRecommendation(res.data.investigation.recommendedAction)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function investigate() {
    setInvestigating(true)
    try {
      const { data } = await consoleApi.post<{ incidentId: string; investigationId: string; counterEvidence: CounterEvidence }>(
        `/v2/incidents/${id}/investigate`,
      )
      setCounterEvidence(data.counterEvidence)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Investigation failed to run.')
    } finally {
      setInvestigating(false)
    }
  }

  async function mitigate() {
    setMitigating(true)
    try {
      const { data } = await consoleApi.post<MitigateResult>(`/v2/incidents/${id}/mitigate`, { aiRecommendation })
      setMitigateResult(data)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Mitigation failed.')
    } finally {
      setMitigating(false)
    }
  }

  async function resolve(e: React.FormEvent) {
    e.preventDefault()
    if (!rootCause.trim()) return
    setResolving(true)
    setResolveError(null)
    try {
      const { status, data } = await consoleApi.post<ResolveResult & { message?: string }>(`/v2/incidents/${id}/resolve`, {
        status: resolveStatus,
        rootCause: rootCause.trim(),
        ...(resolveStatus === 'FALSE_POSITIVE' ? { restore } : {}),
      })
      if (status !== 200) {
        setResolveError((data as unknown as { message?: string }).message ?? `Could not resolve (${status}).`)
        return
      }
      setResolveResult(data)
      await load()
    } catch (err) {
      setResolveError(err instanceof ApiError ? err.message : 'Resolve request failed.')
    } finally {
      setResolving(false)
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-[720px] py-10">
        <ReasonPanel outcome="Not found" code="404" summary={`No incident with id ${id}.`} />
      </div>
    )
  }
  if (error && !detail) {
    return (
      <div className="mx-auto max-w-[720px] py-10">
        <ReasonPanel outcome="Request failed" summary={error} />
      </div>
    )
  }
  if (!detail) return <div className="font-tele text-[0.8rem] text-faint uppercase">Loading…</div>

  const { incident, investigation } = detail
  const contained = incident.severity === 'HIGH' || incident.severity === 'CRITICAL'
  const closed = incident.status === 'RESOLVED' || incident.status === 'FALSE_POSITIVE'

  const timelineItems: TimelineItem[] = [
    { id: 'opened', label: 'Opened', detail: incident.detail ?? undefined, timestamp: new Date(incident.openedAt).toLocaleString(), color: 'signal' },
    ...(contained ? [{ id: 'contained', label: incident.severity === 'CRITICAL' ? 'Capabilities revoked' : 'Capabilities suspended', timestamp: new Date(incident.openedAt).toLocaleString(), color: 'amber' as const }] : []),
    ...(investigation ? [{ id: 'investigated', label: 'Investigated', detail: investigation.hypothesis ?? undefined, timestamp: new Date(investigation.createdAt).toLocaleString(), color: 'bolt' as const }] : []),
    ...(incident.mitigation ? [{ id: 'mitigated', label: `Mitigated · ${incident.mitigation}`, detail: incident.mitigationReason ?? undefined, timestamp: new Date(incident.updatedAt).toLocaleString(), color: 'amber' as const }] : []),
    ...(closed ? [{ id: 'closed', label: `${incident.status.replace(/_/g, ' ')}`, detail: incident.rootCause ?? undefined, timestamp: incident.closedAt ? new Date(incident.closedAt).toLocaleString() : undefined, color: 'acid' as const }] : []),
  ]

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h1 className="m-0 font-shout text-[2rem] leading-none uppercase">{incident.type.replace(/_/g, ' ')}</h1>
          <StatusBadge kind="severity" value={incident.severity} />
          <StatusBadge kind="incident" value={incident.status} severity={incident.severity} />
        </div>
        <p className="m-0 font-tele text-[0.72rem] tracking-[0.08em] text-faint uppercase">
          Source: {incident.source} · Opened {new Date(incident.openedAt).toLocaleString()}
          {incident.closedAt ? ` · Closed ${new Date(incident.closedAt).toLocaleString()}` : ''}
        </p>
      </div>

      {error ? <div className="mb-6"><ReasonPanel outcome="Partial failure" summary={error} /></div> : null}

      {contained ? (
        <div className="mb-6 border-l-4 border-amber bg-paper-2 p-4">
          <p className="m-0 font-tele text-[0.78rem] font-bold tracking-[0.04em] text-ink uppercase">
            Contained before investigation
          </p>
          <p className="mt-1 mb-0 text-[0.85rem] text-dim">
            {incident.severity === 'CRITICAL' ? 'Capabilities were revoked' : 'Capabilities were suspended'} on severity
            alone, before anything was known. This ordering is deliberate.
          </p>
        </div>
      ) : null}

      {/* Investigation */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Investigation</h2>
          <button
            type="button"
            onClick={() => void investigate()}
            disabled={investigating || closed}
            className="flex items-center gap-1.5 border border-hard bg-hard px-4 py-2 font-tele text-[0.7rem] font-bold tracking-[0.14em] text-paper uppercase disabled:opacity-50"
          >
            <Search size={13} strokeWidth={1.5} />
            {investigating ? 'Investigating…' : 'Investigate'}
          </button>
        </div>

        {!counterEvidence && !investigation ? (
          <EmptyState icon={Search} title="NOT YET INVESTIGATED" body="Run the deterministic counter-evidence search." />
        ) : (
          <>
            <div className="mb-4 border border-rule p-4 text-center">
              <p className="m-0 mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">Doubt gauge</p>
              {counterEvidence ? (
                counterEvidence.doubt === null ? (
                  <p className="m-0 flex items-center justify-center gap-1.5 font-tele text-[1rem] text-bolt uppercase">
                    <CircleHelp size={16} strokeWidth={1.5} /> Unknown — nothing to check
                  </p>
                ) : (
                  <p className="m-0 font-shout text-[1.8rem] tabular-nums">{counterEvidence.doubt.toFixed(2)}</p>
                )
              ) : (
                <p className="m-0 font-tele text-[0.8rem] text-faint uppercase">Re-run to compute</p>
              )}
              {counterEvidence?.summary ? <p className="mt-1 mb-0 text-[0.8rem] text-dim">{counterEvidence.summary}</p> : null}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 border-b-2 border-signal pb-1 font-tele text-[0.68rem] font-bold tracking-[0.16em] text-signal uppercase">
                  Supporting
                </h3>
                {(investigation?.supportingEvidenceIds ?? []).length === 0 ? (
                  <p className="font-tele text-[0.76rem] text-faint uppercase">None recorded</p>
                ) : (
                  <ul className="m-0 list-none space-y-1 p-0 font-tele text-[0.72rem] text-dim">
                    {investigation!.supportingEvidenceIds.map((eid) => (
                      <li key={eid}>{eid}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 border-b-2 border-acid pb-1 font-tele text-[0.68rem] font-bold tracking-[0.16em] text-acid uppercase">
                  Contradicting
                </h3>
                {counterEvidence ? (
                  counterEvidence.findings.length === 0 ? (
                    <p className="font-tele text-[0.76rem] text-faint uppercase">No exculpatory findings</p>
                  ) : (
                    <ul className="m-0 list-none space-y-3 p-0">
                      {counterEvidence.findings.map((f, i) => (
                        <li key={i} className="border border-rule p-2">
                          <p className="m-0 font-tele text-[0.68rem] font-bold tracking-[0.06em] text-ink uppercase">{f.kind.replace(/_/g, ' ')}</p>
                          <p className="m-0 mt-1 text-[0.8rem] text-dim">{f.detail}</p>
                          <p className="m-0 mt-1 font-tele text-[0.66rem] text-faint uppercase">Weight {f.weight}</p>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (investigation?.contradictingEvidenceIds ?? []).length > 0 ? (
                  <ul className="m-0 list-none space-y-1 p-0 font-tele text-[0.72rem] text-dim">
                    {investigation!.contradictingEvidenceIds.map((eid) => (
                      <li key={eid}>{eid}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-tele text-[0.76rem] text-faint uppercase">Re-run investigate for full findings</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Recommendation vs decision */}
      <div className="mb-8">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Mitigate</h2>
        <div className="mb-3 flex items-end gap-2">
          <div>
            <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">AI recommendation</label>
            <select
              value={aiRecommendation}
              onChange={(e) => setAiRecommendation(e.target.value)}
              className="border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
            >
              {['ALLOW', 'LIMIT', 'REVIEW', 'BLOCK'].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void mitigate()}
            disabled={mitigating || closed}
            className="border border-hard bg-hard px-5 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase disabled:opacity-50"
          >
            {mitigating ? 'Applying…' : 'Mitigate'}
          </button>
        </div>

        {mitigateResult ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-rule p-4">
                <p className="m-0 mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">AI recommended</p>
                <p className="m-0 font-shout text-[1.4rem] uppercase">{aiRecommendation}</p>
              </div>
              <div className="border border-rule p-4">
                <p className="m-0 mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">Policy applied</p>
                <p className="m-0 font-shout text-[1.4rem] uppercase">{mitigateResult.reconciliation.action}</p>
              </div>
            </div>
            {mitigateResult.reconciliation.aiAttemptedToWiden ? (
              <div className="mt-3 border-2 border-signal bg-paper-2 p-4">
                <p className="m-0 font-tele text-[0.78rem] font-bold tracking-[0.06em] text-signal uppercase">
                  AI de-escalation ignored
                </p>
                <p className="mt-1 mb-0 text-[0.85rem] text-dim">{mitigateResult.reconciliation.reason}</p>
                <p className="mt-1 mb-0 font-tele text-[0.68rem] text-faint uppercase">
                  The investigator may tighten a decision, never loosen it.
                </p>
              </div>
            ) : null}
            <p className="mt-2 font-tele text-[0.72rem] text-dim">Capabilities affected: {mitigateResult.capabilitiesAffected}</p>
          </>
        ) : null}
      </div>

      {/* Resolve */}
      <div>
        <h2 className="mb-3 flex items-center gap-2 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">
          <ShieldAlert size={14} strokeWidth={1.5} />
          Resolve
        </h2>
        {closed ? (
          <ReasonPanel outcome={incident.status.replace(/_/g, ' ')} summary={incident.rootCause ?? 'No root cause recorded.'} next="Closed is terminal — reopening is refused with a 409." />
        ) : (
          <form onSubmit={resolve} className="max-w-[520px] border border-rule p-4">
            <div className="mb-3 flex gap-4 font-tele text-[0.72rem] text-dim uppercase">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={resolveStatus === 'RESOLVED'} onChange={() => setResolveStatus('RESOLVED')} /> Resolved
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={resolveStatus === 'FALSE_POSITIVE'} onChange={() => setResolveStatus('FALSE_POSITIVE')} /> False positive
              </label>
            </div>
            <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Root cause (required)</label>
            <textarea
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              rows={3}
              required
              className="mb-3 w-full resize-none border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
            />
            {resolveStatus === 'FALSE_POSITIVE' ? (
              <label className="mb-3 flex items-center gap-2 font-tele text-[0.72rem] text-dim uppercase">
                <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} />
                Restore authority
              </label>
            ) : null}
            {resolveError ? <p className="mb-3 font-tele text-[0.76rem] text-signal">{resolveError}</p> : null}
            <button
              type="submit"
              disabled={resolving || !rootCause.trim()}
              className="border border-hard bg-hard px-5 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase disabled:opacity-50"
            >
              {resolving ? 'Resolving…' : 'Resolve'}
            </button>
            {resolveResult ? <p className="mt-3 font-tele text-[0.74rem] text-acid uppercase">Restored {resolveResult.restored} capabilities.</p> : null}
          </form>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Timeline</h2>
        <Timeline items={timelineItems} />
      </div>
    </div>
  )
}
