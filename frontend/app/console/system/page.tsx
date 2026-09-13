'use client'

import { useEffect, useState } from 'react'
import { Activity, CircleHelp } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type { HealthResponse, ReadinessResponse } from '@/lib/types'
import { DEPENDENCY_POLICIES } from '@/lib/dependencyPolicy'
import { DataTable } from '@/components/xander/DataTable'
import { EmptyState } from '@/components/xander/EmptyState'
import { LiveBadge } from '@/components/xander/LiveBadge'

export default function SystemPage() {
  const [ready, setReady] = useState<ReadinessResponse | null>(null)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [r, h] = await Promise.all([
          consoleApi.get<ReadinessResponse>('/ready'),
          consoleApi.get<HealthResponse>('/health'),
        ])
        if (!cancelled) {
          setReady(r.data)
          setHealth(h.data)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
      }
    }
    void load()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return (
    <div className="mx-auto max-w-[1000px]">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="m-0 font-shout text-[2.2rem] leading-none uppercase">System</h1>
        <LiveBadge />
      </div>

      {error ? <EmptyState icon={Activity} title="UNREACHABLE" body={error} /> : null}

      <div className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="m-0 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Readiness</h2>
          {ready ? (
            <span className={`font-tele text-[0.72rem] font-bold uppercase ${ready.ready ? 'text-acid' : 'text-signal'}`}>
              {ready.summary}
            </span>
          ) : null}
        </div>
        {ready ? (
          <DataTable
            columns={[
              { key: 'dependency', label: 'Dependency' },
              { key: 'up', label: 'Up' },
              { key: 'degraded', label: 'Degraded behaviour' },
              { key: 'detail', label: 'Detail' },
            ]}
            rows={ready.dependencies}
            rowKey={(d) => d.dependency}
            cell={(d, key) => {
              switch (key) {
                case 'dependency':
                  return d.dependency
                case 'up':
                  return d.up ? <span className="text-acid uppercase">Up</span> : <span className="text-signal uppercase">Down</span>
                case 'degraded':
                  return d.degradedBehaviour ? (
                    <span className="text-amber uppercase">{d.degradedBehaviour.replace(/_/g, ' ')}</span>
                  ) : (
                    <span className="text-faint">—</span>
                  )
                case 'detail':
                  return <span className="text-dim">{d.detail}</span>
                default:
                  return null
              }
            }}
          />
        ) : (
          <div className="h-[100px] animate-pulse border border-rule bg-paper-2" />
        )}
        <p className="mt-3 max-w-[70ch] font-tele text-[0.68rem] leading-relaxed text-faint uppercase">
          This is the live subset the backend actually checks at <code>/ready</code> (3 of 12). The full matrix below
          is a static mirror of <code>backend/src/hardening/dependency-policy.ts</code> — no endpoint exposes it live yet.
        </p>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">
          Dependency matrix — authorization-critical vs. safe to lose
        </h2>
        <DataTable
          columns={[
            { key: 'dependency', label: 'Dependency' },
            { key: 'critical', label: 'Can still authorize?' },
            { key: 'behaviour', label: 'Degraded behaviour' },
            { key: 'rationale', label: 'Rationale' },
          ]}
          rows={DEPENDENCY_POLICIES}
          rowKey={(d) => d.dependency}
          cell={(d, key) => {
            switch (key) {
              case 'dependency':
                return d.dependency
              case 'critical':
                return d.canStillAuthorize ? (
                  <span className="text-acid uppercase">Yes — safe to lose</span>
                ) : (
                  <span className="text-signal uppercase">No — critical</span>
                )
              case 'behaviour':
                return <span className="text-amber uppercase">{d.behaviour.replace(/_/g, ' ')}</span>
              case 'rationale':
                return <span className="text-dim">{d.rationale}</span>
              default:
                return null
            }
          }}
        />
        <p className="mt-3 font-tele text-[0.68rem] leading-relaxed text-faint uppercase">
          7 critical, 5 safe to lose. There is deliberately no "ignore" behaviour — every row withholds or degrades
          something, because "carry on as if nothing happened" is the bypass this table exists to prevent.
        </p>
      </div>

      <div className="mb-8 border border-rule p-4">
        <h2 className="mb-2 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Reconciliation & retention</h2>
        <p className="m-0 max-w-[70ch] text-[0.82rem] text-dim">
          Retention is a real, dry-run-by-default backend script (<code>npm run retention</code>, add{' '}
          <code>--apply</code> to actually prune). Reconciliation (<code>reconcileEnforcement</code> /{' '}
          <code>repairDrift</code> in <code>src/hardening/reconciliation.ts</code>) is exercised by{' '}
          <code>npm run check:hardening</code>. Neither has an HTTP endpoint, so there is nothing for this console to
          call or poll — flagged rather than wired to a button that would do nothing.
        </p>
      </div>

      <div>
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Provenance (/health)</h2>
        {health?.provenance ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border border-rule p-4">
              <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Token API</div>
              {health.provenance.tokenApi ? (
                <p className="m-0 text-[0.82rem] text-dim">
                  {health.provenance.tokenApi.stale ? 'Stale' : 'Fresh'} · last success{' '}
                  {health.provenance.tokenApi.lastSuccessAt ? new Date(health.provenance.tokenApi.lastSuccessAt).toLocaleString() : 'never'}
                  {health.provenance.tokenApi.ageSeconds != null ? ` (${health.provenance.tokenApi.ageSeconds}s ago)` : ''}
                </p>
              ) : (
                <p className="m-0 flex items-center gap-1 text-[0.82rem] text-bolt"><CircleHelp size={13} strokeWidth={1.5} /> No signal</p>
              )}
            </div>
            <div className="border border-rule p-4">
              <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Deployments</div>
              <ul className="m-0 list-none space-y-1 p-0">
                {(health.provenance.deployments ?? []).map((d) => (
                  <li key={d.deploymentId} className="font-tele text-[0.72rem] text-dim">
                    {d.protocol} · {d.chain} · {d.schemaFamily}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="h-[100px] animate-pulse border border-rule bg-paper-2" />
        )}
      </div>
    </div>
  )
}
