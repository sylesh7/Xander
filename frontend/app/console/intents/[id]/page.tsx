'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { Play } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type { CapabilitiesResponse, ExecuteResult, IntentView } from '@/lib/types'
import { StatusBadge } from '@/components/xander/StatusBadge'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { TxLink } from '@/components/xander/Mono'

export default function IntentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [intent, setIntent] = useState<IntentView | null>(null)
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await consoleApi.get<IntentView>(`/v2/intents/${id}`)
        if (res.status === 404) {
          setNotFound(true)
          return
        }
        if (cancelled) return
        setIntent(res.data)
        const capRes = await consoleApi.get<CapabilitiesResponse>(`/v2/actors/${res.data.actorId}/capabilities`)
        if (!cancelled) setCapabilities(capRes.data)
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  async function execute() {
    setExecuting(true)
    try {
      const { data } = await consoleApi.post<ExecuteResult>(`/v2/intents/${id}/execute`)
      setExecuteResult(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Execution request failed.')
    } finally {
      setExecuting(false)
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-[720px] py-10">
        <ReasonPanel outcome="Not found" code="404" summary={`No intent with id ${id}.`} />
      </div>
    )
  }
  if (error && !intent) {
    return (
      <div className="mx-auto max-w-[720px] py-10">
        <ReasonPanel outcome="Request failed" summary={error} />
      </div>
    )
  }
  if (!intent) return <div className="font-tele text-[0.8rem] text-faint uppercase">Loading…</div>

  const decision = intent.decision
  const grantedCapability = decision ? capabilities?.capabilities.find((c) => c.sourceDecisionId === decision.decisionId) : undefined

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="mb-6">
        <p className="m-0 mb-1 font-tele text-[0.68rem] tracking-[0.16em] text-faint uppercase">Intent {intent.intentId}</p>
        <h1 className="m-0 font-shout text-[2rem] leading-none uppercase">
          {intent.actionType} · {intent.resourceType}/{intent.resourceId}
        </h1>
      </div>

      {/* The ask */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="border border-rule p-3">
          <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Actor</p>
          <Link href={`/console/actors/${intent.actorId}`} className="dn-split font-tele text-[0.76rem] text-ink">
            {intent.actorId.slice(0, 12)}…
          </Link>
        </div>
        <div className="border border-rule p-3">
          <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Status</p>
          <p className="m-0 font-tele text-[0.78rem] text-ink uppercase">{intent.status}</p>
        </div>
        <div className="border border-rule p-3">
          <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Expires</p>
          <p className="m-0 font-tele text-[0.78rem] text-ink">{new Date(intent.expiresAt).toLocaleString()}</p>
        </div>
        <div className="border border-rule p-3">
          <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Created</p>
          <p className="m-0 font-tele text-[0.78rem] text-ink">{new Date(intent.createdAt).toLocaleString()}</p>
        </div>
      </div>

      {/* The answer */}
      <div className="mb-6">
        <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">The answer</h2>
        {!decision ? (
          <ReasonPanel outcome="Pending" summary="This intent has no decision yet." />
        ) : (
          <>
            <ReasonPanel
              outcome={decision.result}
              code={decision.reasonCode}
              summary={decision.reasonSummary}
              next={
                decision.result === 'LIMIT'
                  ? 'Reduce, not refuse — see requested vs granted below.'
                  : decision.result === 'REVIEW'
                    ? 'The fail-closed path — evidence was not fresh enough to authorise or block.'
                    : undefined
              }
            />
            {decision.result === 'LIMIT' ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="border border-rule p-3">
                  <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Requested</p>
                  <p className="m-0 font-shout text-[1.3rem] tabular-nums">—</p>
                  <p className="m-0 font-tele text-[0.68rem] text-dim">amount not echoed on the intent itself</p>
                </div>
                <div className="border border-rule p-3">
                  <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Granted</p>
                  {grantedCapability ? (
                    <p className="m-0 font-shout text-[1.3rem] tabular-nums text-acid">{grantedCapability.amountLimit ?? '—'}</p>
                  ) : (
                    <p className="m-0 font-tele text-[0.76rem] text-faint uppercase">No matching capability found</p>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {decision ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-rule p-3">
              <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Policy version</p>
              <p className="m-0 font-tele text-[0.78rem] text-ink">{decision.policyVersion}</p>
            </div>
            <div className="border border-rule p-3">
              <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Risk score</p>
              <p className="m-0 font-tele text-[0.78rem] text-ink">{decision.riskScore ?? '—'}</p>
            </div>
            <div className="border border-rule p-3">
              <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Confidence</p>
              <p className="m-0 font-tele text-[0.78rem] text-ink uppercase">{decision.confidence}</p>
            </div>
            <div className="border border-rule p-3">
              <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Cluster</p>
              <p className="m-0 font-tele text-[0.78rem] text-ink">{decision.clusterId ?? '—'}</p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="mb-2 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Evidence lineage</h2>
            <div className="border border-rule p-3">
              {decision.evidenceIds.length === 0 ? (
                <p className="m-0 font-tele text-[0.74rem] text-faint uppercase">No evidence ids cited</p>
              ) : (
                <ul className="m-0 list-none space-y-1 p-0 font-tele text-[0.72rem] text-dim">
                  {decision.evidenceIds.map((eid) => (
                    <li key={eid}>{eid}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 mb-0 font-tele text-[0.64rem] text-faint uppercase">
                Opaque source references, not independently browsable rows — no endpoint resolves them further.
              </p>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="mb-2 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Receipt</h2>
            <div className="border border-rule p-3 font-tele text-[0.76rem] text-dim">
              <p className="m-0">Receipt id: {intent.receiptId ?? '—'}</p>
              <p className="m-0">Parameters hash: {intent.parametersHash}</p>
              <p className="mt-2 mb-0 font-tele text-[0.64rem] text-faint uppercase">No GET endpoint reads a receipt's full contents back yet.</p>
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Execute</h2>
            {!executeResult ? (
              <button
                type="button"
                onClick={() => void execute()}
                disabled={executing}
                className="flex items-center gap-2 border border-hard bg-hard px-6 py-3 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
              >
                <Play size={14} strokeWidth={1.5} />
                {executing ? 'Executing…' : 'Execute'}
              </button>
            ) : (
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <StatusBadge kind="execution" value={executeResult.status} />
                  <span className="font-tele text-[0.78rem] text-dim">{executeResult.executed ? 'Executed' : 'The executor was never called.'}</span>
                </div>
                <ReasonPanel outcome={executeResult.status.replace(/_/g, ' ')} summary={executeResult.reason} />
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="border border-rule p-3">
                    <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Adapters consulted</p>
                    <p className="m-0 font-tele text-[0.76rem] text-ink">{executeResult.adapters.join(', ') || '—'}</p>
                  </div>
                  <div className="border border-rule p-3">
                    <p className="m-0 mb-1 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">Transaction</p>
                    {executeResult.txHash ? <TxLink hash={executeResult.txHash} chainId={11155111} /> : <p className="m-0 font-tele text-[0.76rem] text-faint uppercase">None</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
