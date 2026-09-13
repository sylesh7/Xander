'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { Snowflake, Sun, Ban, BadgeCheck, CircleHelp, Bot, Siren, Link2 } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type {
  ActorView,
  AgentDetail,
  CapabilitiesResponse,
  EnforcementResponse,
  Erc8004LinkResult,
  FreezeResult,
  IncidentRow,
  RevokeResult,
  TrustContextResponse,
  UnfreezeResult,
} from '@/lib/types'
import { ENS_CHAIN_ID } from '@/lib/types'
import { StatusBadge } from '@/components/xander/StatusBadge'
import { DataTable } from '@/components/xander/DataTable'
import { EmptyState } from '@/components/xander/EmptyState'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { ConfirmDialog } from '@/components/xander/ConfirmDialog'
import { Tabs } from '@/components/xander/Tabs'
import { Timeline, type TimelineItem } from '@/components/xander/Timeline'
import { ActorEvidencePanel } from '@/components/xander/ActorEvidencePanel'
import { TxLink } from '@/components/xander/Mono'

type DangerAction = 'freeze' | 'unfreeze' | 'revoke' | null

function challengeColor(status: string): 'acid' | 'signal' | 'amber' {
  if (status === 'PASSED') return 'acid'
  if (status === 'FAILED') return 'signal'
  return 'amber'
}

export default function AgentDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [agent, setAgent] = useState<AgentDetail | null>(null)
  const [actor, setActor] = useState<ActorView | null>(null)
  const [trust, setTrust] = useState<TrustContextResponse | null>(null)
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null)
  const [enforcement, setEnforcement] = useState<EnforcementResponse | null>(null)
  const [incidents, setIncidents] = useState<IncidentRow[] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dangerAction, setDangerAction] = useState<DangerAction>(null)
  const [lastTxOutcome, setLastTxOutcome] = useState<{ label: string; ens: FreezeResult['ens'] } | null>(null)

  const [erc8004Input, setErc8004Input] = useState('')
  const [erc8004Result, setErc8004Result] = useState<Erc8004LinkResult | null>(null)
  const [erc8004Error, setErc8004Error] = useState<string | null>(null)
  const [erc8004Loading, setErc8004Loading] = useState(false)

  async function loadAll() {
    try {
      const agentRes = await consoleApi.get<AgentDetail>(`/v2/agents/${id}`)
      if (agentRes.status === 404) {
        setNotFound(true)
        return
      }
      setAgent(agentRes.data)

      const actorRes = await consoleApi.get<ActorView>(`/v2/actors/${agentRes.data.actorId}`)
      setActor(actorRes.data)

      const [trustRes, capRes, enfRes, incRes] = await Promise.all([
        consoleApi.get<TrustContextResponse>(`/v2/actors/${agentRes.data.actorId}/trust`),
        consoleApi.get<CapabilitiesResponse>(`/v2/actors/${agentRes.data.actorId}/capabilities`),
        consoleApi.get<EnforcementResponse>(`/v2/actors/${agentRes.data.actorId}/enforcement`),
        consoleApi.get<{ incidents: IncidentRow[] }>('/v2/incidents', { actorId: agentRes.data.actorId }),
      ])
      setTrust(trustRes.data)
      setCapabilities(capRes.data)
      setEnforcement(enfRes.data)
      setIncidents(incRes.data.incidents)

      if (agentRes.data.erc8004AgentId) setErc8004Input(agentRes.data.erc8004AgentId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function linkErc8004() {
    if (!erc8004Input.trim()) return
    setErc8004Loading(true)
    setErc8004Error(null)
    try {
      const { status, data } = await consoleApi.post<Erc8004LinkResult & { message?: string }>(`/v2/agents/${id}/erc8004`, {
        agentId: erc8004Input.trim(),
      })
      if (status === 404) {
        setErc8004Error(`ERC-8004 agent ${erc8004Input.trim()} is not registered in the configured registry.`)
        return
      }
      if (status !== 200) {
        setErc8004Error(data.message ?? `Request refused (${status}).`)
        return
      }
      setErc8004Result(data)
    } catch (err) {
      setErc8004Error(err instanceof ApiError ? err.message : 'Request failed.')
    } finally {
      setErc8004Loading(false)
    }
  }

  /**
   * A 409 here (already frozen, lapsed lease, illegal transition) is the
   * designed refusal, not a bug — but it comes back as `{error, message}`,
   * not a FreezeResult/UnfreezeResult/RevokeResult. Blindly destructuring
   * `data.ens` off an error body was the actual crash: check status first.
   */
  async function runDanger(reason: string) {
    if (!agent) return
    if (dangerAction === 'freeze') {
      const { status, data } = await consoleApi.post<FreezeResult & { message?: string }>(`/v2/agents/${id}/freeze`, { reason })
      if (status !== 200) throw new Error(data.message ?? `Freeze refused (${status}).`)
      setAgent({ ...agent, status: data.status })
      setLastTxOutcome({ label: 'Freeze', ens: data.ens })
    } else if (dangerAction === 'unfreeze') {
      const { status, data } = await consoleApi.post<UnfreezeResult & { message?: string }>(`/v2/agents/${id}/unfreeze`, { reason })
      if (status !== 200) throw new Error(data.message ?? `Unfreeze refused (${status}).`)
      setAgent({ ...agent, status: data.status })
      setLastTxOutcome(null)
    } else if (dangerAction === 'revoke') {
      const { status, data } = await consoleApi.post<RevokeResult & { message?: string }>(`/v2/agents/${id}/revoke`, { reason })
      if (status !== 200) throw new Error(data.message ?? `Revoke refused (${status}).`)
      setAgent({ ...agent, status: data.status })
      setLastTxOutcome({ label: 'Revoke', ens: data.ens })
    }
    setDangerAction(null)
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-[720px] py-10">
        <ReasonPanel outcome="Not found" code="404" summary={`No agent with id ${id}.`} />
      </div>
    )
  }
  if (error && !agent) {
    return (
      <div className="mx-auto max-w-[720px] py-10">
        <ReasonPanel outcome="Request failed" summary={error} />
      </div>
    )
  }
  if (!agent) return <div className="font-tele text-[0.8rem] text-faint uppercase">Loading…</div>

  const wallet = actor?.identities.find((i) => i.kind === 'WALLET')?.externalId ?? null

  const overviewTab = (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="border border-rule p-4">
        <div className="mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">Status</div>
        <StatusBadge kind="agentStatus" value={agent.status} />
      </div>
      <div className="border border-rule p-4">
        <div className="mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">Actor</div>
        <Link href={`/console/actors/${agent.actorId}`} className="dn-split font-tele text-[0.82rem] text-ink">
          {agent.actorId}
        </Link>
      </div>
      <div className="border border-rule p-4">
        <div className="mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">Trust band</div>
        {trust ? <StatusBadge kind="band" value={trust.band} /> : <span className="text-faint">···</span>}
      </div>
      <div className="border border-rule p-4">
        <div className="mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">Assurance lease</div>
        {capabilities?.assurance.hasLiveLease ? (
          <span className="font-tele text-[0.78rem] text-acid uppercase">
            {capabilities.assurance.level} · expires {new Date(capabilities.assurance.expiresAt!).toLocaleString()}
          </span>
        ) : (
          <span className="font-tele text-[0.78rem] text-faint uppercase">No live lease</span>
        )}
      </div>
      <div className="border border-rule p-4 lg:col-span-2">
        <div className="mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">Configuration</div>
        <pre className="m-0 overflow-x-auto font-tele text-[0.74rem] text-dim">
          {agent.configurationJson ? JSON.stringify(agent.configurationJson, null, 2) : '{}'}
        </pre>
      </div>
    </div>
  )

  const identityTab = (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">ENS</h3>
        {agent.ens === null ? (
          <EmptyState icon={CircleHelp} title="CHAIN READ FAILED" body="ens is null because the live chain read threw — not the same as unregistered." />
        ) : (
          <div className="border border-rule p-4">
            <div className="mb-2 flex items-center gap-2">
              {agent.ens.registered ? <BadgeCheck size={16} strokeWidth={1.5} className="text-acid" /> : <CircleHelp size={16} strokeWidth={1.5} className="text-bolt" />}
              <span className="font-tele text-[0.9rem] text-ink">{agent.ens.fqdn ?? 'no name'}</span>
            </div>
            <p className="mb-2 font-tele text-[0.72rem] text-dim uppercase">{agent.ens.registered ? 'Registered on-chain' : 'Not registered on-chain'}</p>
            {agent.ens.expiresAt ? <p className="mb-2 font-tele text-[0.72rem] text-dim">Expires {new Date(agent.ens.expiresAt).toLocaleString()}</p> : null}
            <div className="flex flex-wrap gap-1">
              {agent.ens.onChainActions.length === 0 ? (
                <span className="font-tele text-[0.68rem] text-faint uppercase">No on-chain roles granted</span>
              ) : (
                agent.ens.onChainActions.map((a) => (
                  <span key={a} className="border border-rule px-1.5 py-0.5 font-tele text-[0.64rem] text-dim uppercase">
                    {a}
                  </span>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">ERC-8004</h3>
        <div className="border border-rule p-4">
          <div className="mb-3 flex gap-2">
            <input
              value={erc8004Input}
              onChange={(e) => setErc8004Input(e.target.value)}
              placeholder="registry id, e.g. 1"
              className="flex-1 border border-field bg-paper px-2 py-1.5 font-tele text-[0.78rem] text-ink outline-none focus:border-signal"
            />
            <button
              type="button"
              onClick={() => void linkErc8004()}
              disabled={erc8004Loading}
              className="flex items-center gap-1 border border-hard bg-hard px-3 py-1.5 font-tele text-[0.68rem] font-bold tracking-[0.1em] text-paper uppercase disabled:opacity-50"
            >
              <Link2 size={12} strokeWidth={1.5} />
              {agent.erc8004AgentId ? 'Refresh' : 'Link'}
            </button>
          </div>
          {erc8004Error ? <p className="mb-2 font-tele text-[0.72rem] text-signal">{erc8004Error}</p> : null}
          {erc8004Result ? (
            <div className="font-tele text-[0.76rem] text-dim">
              <p className="m-0">Owner: {erc8004Result.erc8004.owner}</p>
              <p className="m-0">Feedback: {erc8004Result.erc8004.feedbackCount} · Validations: {erc8004Result.erc8004.validationCount}</p>
              <p className="mt-2 m-0">
                Reputation:{' '}
                {erc8004Result.agentReputation === null ? (
                  <span className="text-bolt uppercase">Unknown</span>
                ) : (
                  <span className="text-ink">{(erc8004Result.agentReputation * 100).toFixed(0)}/100</span>
                )}
              </p>
              <p className="mt-1 text-[0.7rem] text-faint">{erc8004Result.basis}</p>
            </div>
          ) : agent.erc8004AgentId ? (
            <p className="m-0 font-tele text-[0.74rem] text-faint uppercase">Linked to {agent.erc8004AgentId} — refresh to read live reputation</p>
          ) : (
            <p className="m-0 font-tele text-[0.74rem] text-faint uppercase">Not linked</p>
          )}
        </div>
      </div>
    </div>
  )

  const capabilitiesTab = (
    <div>
      <h3 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Capability envelope</h3>
      {capabilities && capabilities.capabilities.length > 0 ? (
        <DataTable
          columns={[
            { key: 'action', label: 'Action' },
            { key: 'status', label: 'Status' },
            { key: 'limit', label: 'Amount limit' },
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
              case 'expiry':
                return c.expiresAt ? new Date(c.expiresAt).toLocaleString() : '—'
              default:
                return null
            }
          }}
        />
      ) : (
        <EmptyState icon={Bot} title="NO AUTHORITY" body="Zero capabilities. A name is not an authorisation." />
      )}

      <h3 className="mt-8 mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Enforcement boundaries</h3>
      {enforcement && enforcement.boundaries.length > 0 ? (
        <DataTable
          columns={[
            { key: 'adapter', label: 'Adapter' },
            { key: 'action', label: 'Action' },
            { key: 'enforceable', label: 'Enforceable' },
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
                  <span className="text-bolt uppercase">Unknown</span>
                ) : b.enforceable ? (
                  <span className="text-acid uppercase">Yes</span>
                ) : (
                  <span className="text-signal uppercase">No</span>
                )
              default:
                return null
            }
          }}
        />
      ) : (
        <EmptyState icon={CircleHelp} title="NO BOUNDARIES REPORTED" />
      )}
    </div>
  )

  const evidenceTab = wallet ? (
    <ActorEvidencePanel wallet={wallet} />
  ) : (
    <EmptyState icon={CircleHelp} title="NO WALLET IDENTITY" body="This actor has no WALLET identity to trace evidence from." />
  )

  const incidentsTab =
    incidents && incidents.length > 0 ? (
      <DataTable
        columns={[
          { key: 'type', label: 'Type' },
          { key: 'severity', label: 'Severity' },
          { key: 'status', label: 'Status' },
          { key: 'opened', label: 'Opened' },
        ]}
        rows={incidents}
        rowKey={(i) => i.id}
        onRowClick={(i) => (window.location.href = `/console/incidents/${i.id}`)}
        cell={(i, key) => {
          switch (key) {
            case 'type':
              return i.type.replace(/_/g, ' ')
            case 'severity':
              return <StatusBadge kind="severity" value={i.severity} />
            case 'status':
              return <StatusBadge kind="incident" value={i.status} severity={i.severity} />
            case 'opened':
              return new Date(i.openedAt).toLocaleString()
            default:
              return null
          }
        }}
      />
    ) : (
      <EmptyState icon={Siren} title="NO INCIDENTS" />
    )

  const timelineItems: TimelineItem[] = [
    { id: 'created', label: 'Agent created', timestamp: new Date(agent.createdAt).toLocaleString(), color: 'bolt' as const },
    ...(capabilities?.capabilities ?? []).map((c) => ({
      id: `cap-${c.id}`,
      label: `Capability granted · ${c.actionType}`,
      detail: c.amountLimit ? `Limit ${c.amountLimit}` : undefined,
      timestamp: new Date(c.createdAt).toLocaleString(),
      color: 'acid' as const,
    })),
    ...agent.challenges.map((c) => ({
      id: `chal-${c.id}`,
      label: `World/liveness challenge · ${c.status}`,
      detail: c.failureReason ?? undefined,
      timestamp: new Date(c.createdAt).toLocaleString(),
      color: challengeColor(c.status),
    })),
    { id: 'updated', label: `Current status · ${agent.status}`, timestamp: new Date(agent.updatedAt).toLocaleString(), color: 'bolt' as const },
  ].sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h1 className="m-0 font-shout text-[2rem] leading-none uppercase">{agent.name}</h1>
            <StatusBadge kind="agentStatus" value={agent.status} />
          </div>
          {agent.ensName ? (
            <span className="flex items-center gap-1.5 font-tele text-[0.78rem] text-dim">
              <BadgeCheck size={13} strokeWidth={1.5} className="text-acid" />
              {agent.ensName}
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          {agent.status === 'FROZEN' ? (
            <button
              type="button"
              onClick={() => setDangerAction('unfreeze')}
              className="flex items-center gap-1.5 border border-hard bg-hard px-4 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase"
            >
              <Sun size={14} strokeWidth={1.5} />
              Unfreeze
            </button>
          ) : agent.status !== 'REVOKED' ? (
            <button
              type="button"
              onClick={() => setDangerAction('freeze')}
              className="flex items-center gap-1.5 border border-signal px-4 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-signal uppercase"
            >
              <Snowflake size={14} strokeWidth={1.5} />
              Freeze
            </button>
          ) : null}
          {agent.status !== 'REVOKED' ? (
            <button
              type="button"
              onClick={() => setDangerAction('revoke')}
              className="flex items-center gap-1.5 border border-signal bg-signal px-4 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase"
            >
              <Ban size={14} strokeWidth={1.5} />
              Revoke
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="mb-6"><ReasonPanel outcome="Partial data" summary={error} /></div> : null}

      {lastTxOutcome ? (
        <div className="mb-6 border border-rule p-4">
          <p className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.14em] text-faint uppercase">{lastTxOutcome.label} result</p>
          <p className="mb-1 text-[0.85rem] text-dim">{lastTxOutcome.ens.detail}</p>
          {lastTxOutcome.ens.txHash ? (
            <TxLink hash={lastTxOutcome.ens.txHash} chainId={ENS_CHAIN_ID} />
          ) : lastTxOutcome.ens.skipReason ? (
            <p className="m-0 font-tele text-[0.7rem] text-bolt uppercase">No on-chain tx — {lastTxOutcome.ens.skipReason}</p>
          ) : null}
        </div>
      ) : null}

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview', content: overviewTab },
          { key: 'identity', label: 'Identity', content: identityTab },
          { key: 'capabilities', label: 'Capabilities', content: capabilitiesTab },
          { key: 'evidence', label: 'Evidence', content: evidenceTab },
          { key: 'incidents', label: 'Incidents', content: incidentsTab },
          { key: 'timeline', label: 'Timeline', content: <Timeline items={timelineItems} /> },
        ]}
      />

      {dangerAction === 'freeze' ? (
        <ConfirmDialog
          title={`Freeze ${agent.name}`}
          warning="This is a capability state transition, not a flag. An ENS-backed agent's on-chain roles will be revoked in a real transaction."
          confirmLabel="Freeze agent"
          onCancel={() => setDangerAction(null)}
          onConfirm={runDanger}
        />
      ) : null}
      {dangerAction === 'unfreeze' ? (
        <ConfirmDialog
          title={`Unfreeze ${agent.name}`}
          warning="This restores suspended capabilities. It will be refused with a 409 if the assurance lease has lapsed — re-verification would be required first."
          confirmLabel="Unfreeze agent"
          onCancel={() => setDangerAction(null)}
          onConfirm={runDanger}
        />
      ) : null}
      {dangerAction === 'revoke' ? (
        <ConfirmDialog
          title={`Revoke ${agent.name}`}
          warning="This is terminal. All capabilities and the assurance lease are revoked permanently, and any on-chain roles are removed in a real transaction. This cannot be undone."
          confirmLabel="Revoke agent"
          requireTypedValue={agent.name}
          onCancel={() => setDangerAction(null)}
          onConfirm={runDanger}
        />
      ) : null}
    </div>
  )
}
