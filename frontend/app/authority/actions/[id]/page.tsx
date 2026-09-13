'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronsDownUp, X, Snowflake } from 'lucide-react'
import { authorityApi, ApiError } from '@/lib/api/authority'
import type { ControlAgentRow, DecisionCommandResult, IncidentRow, PendingAction } from '@/lib/types'
import { EmptyState } from '@/components/xander/EmptyState'
import { ReasonPanel } from '@/components/xander/ReasonPanel'

type Command = 'APPROVE' | 'DENY' | 'LIMIT'

export default function DecideActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [action, setAction] = useState<PendingAction | null | undefined>(undefined) // undefined = loading, null = not found
  const [error, setError] = useState<string | null>(null)

  const [reason, setReason] = useState('')
  const [limitAmount, setLimitAmount] = useState('')
  const [submitting, setSubmitting] = useState<Command | 'FREEZE' | null>(null)
  const [result, setResult] = useState<DecisionCommandResult | null>(null)
  const [resultError, setResultError] = useState<string | null>(null)

  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await authorityApi.get<{ actions: PendingAction[] }>('/v2/control/pending-actions')
        const found = data.actions.find((a) => a.id === id) ?? null
        if (cancelled) return
        setAction(found)

        if (found?.subjectType === 'AGENT') {
          setResolvedAgentId(found.subjectId)
        } else if (found?.subjectType === 'INCIDENT' && found.allowed.includes('FREEZE')) {
          const incRes = await authorityApi.get<{ incidents: IncidentRow[] }>('/v2/control/incidents')
          const incident = incRes.data.incidents.find((i) => i.id === found.subjectId)
          if (incident?.actorId) {
            const agentsRes = await authorityApi.get<{ agents: ControlAgentRow[] }>('/v2/control/agents')
            const matches = agentsRes.data.agents.filter((a) => a.actorId === incident.actorId)
            if (matches.length === 1) setResolvedAgentId(matches[0]!.id)
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  async function decide(command: Command) {
    if (!action) return
    if ((command === 'DENY' || command === 'LIMIT') && !reason.trim()) return
    if (command === 'LIMIT' && !limitAmount.trim()) return
    setSubmitting(command)
    setResultError(null)
    try {
      const { status, data } = await authorityApi.post<DecisionCommandResult & { message?: string }>(
        `/v2/control/actions/${action.id}/${command.toLowerCase()}`,
        {
          bindingHash: action.bindingHash,
          nonce: crypto.randomUUID(),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(command === 'LIMIT' ? { limitAmount: limitAmount.trim() } : {}),
        },
      )
      if (status !== 200) {
        setResultError(interpretError(status, (data as unknown as { message?: string }).message))
        return
      }
      setResult(data)
    } catch (err) {
      setResultError(err instanceof ApiError ? err.message : 'Request failed.')
    } finally {
      setSubmitting(null)
    }
  }

  async function freeze() {
    if (!resolvedAgentId || !reason.trim()) return
    setSubmitting('FREEZE')
    setResultError(null)
    try {
      const { status, data } = await authorityApi.post<DecisionCommandResult & { message?: string }>(
        `/v2/control/agents/${resolvedAgentId}/freeze`,
        { nonce: crypto.randomUUID(), reason: reason.trim() },
      )
      if (status !== 200) {
        setResultError(interpretError(status, (data as unknown as { message?: string }).message))
        return
      }
      setResult(data)
    } catch (err) {
      setResultError(err instanceof ApiError ? err.message : 'Request failed.')
    } finally {
      setSubmitting(null)
    }
  }

  if (action === undefined) return <div className="font-tele text-[0.8rem] text-faint uppercase">Loading…</div>
  if (error) return <ReasonPanel outcome="Request failed" summary={error} />
  if (action === null) {
    return <EmptyState icon={X} title="NOT FOUND" body="This action expired, was already decided, or never existed. Expiry is a refusal, not an error." />
  }

  if (result) {
    return (
      <div>
        <p className="mb-2 font-shout text-[1.8rem] leading-none text-acid uppercase">{result.command} applied</p>
        <p className="mb-1 text-[0.9rem] text-dim">{result.detail}</p>
        <p className="mb-6 font-tele text-[0.72rem] text-faint uppercase">
          Workflow signalled: {result.workflowSignalled ? 'yes' : 'no (normal — most actions have none running)'}
        </p>
        <button type="button" onClick={() => router.push('/authority')} className="w-full min-h-[44px] border border-hard bg-hard px-5 py-3 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-paper uppercase">
          Back to queue
        </button>
      </div>
    )
  }

  const canDecide = !action.requiresStepUp

  return (
    <div>
      <p className="mb-1 font-tele text-[0.66rem] tracking-[0.14em] text-faint uppercase">{action.severity} · {action.subjectType}</p>
      <h1 className="mb-4 font-noir text-[1.5rem] leading-snug text-ink">{action.summary}</h1>

      {action.requiresStepUp ? (
        <div className="mb-5">
          <ReasonPanel
            outcome="Step-up required"
            summary="This action requires a World step-up proof before it can be decided. That flow isn't built in this console yet — decide it from a surface that supports step-up, or treat this as a documented gap."
          />
        </div>
      ) : null}

      {resultError ? <div className="mb-5"><ReasonPanel outcome="Refused" summary={resultError} /></div> : null}

      <label className="mb-1 block font-tele text-[0.66rem] tracking-[0.14em] text-faint uppercase">Reason (required for deny/limit/freeze)</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="mb-4 w-full resize-none border border-field bg-paper px-3 py-2 font-tele text-[0.85rem] text-ink outline-none focus:border-signal"
      />

      <div className="flex flex-col gap-3">
        {action.allowed.includes('APPROVE') ? (
          <button
            type="button"
            disabled={!canDecide || submitting !== null}
            onClick={() => void decide('APPROVE')}
            className="flex min-h-[44px] items-center justify-center gap-2 border border-acid bg-acid px-5 py-3 font-tele text-[0.82rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
          >
            <Check size={16} strokeWidth={2} />
            {submitting === 'APPROVE' ? 'Applying…' : 'Approve'}
          </button>
        ) : null}

        {action.allowed.includes('LIMIT') ? (
          <div>
            <input
              value={limitAmount}
              onChange={(e) => setLimitAmount(e.target.value)}
              placeholder="Limit amount (base units)"
              className="mb-2 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.82rem] text-ink outline-none focus:border-signal"
            />
            <button
              type="button"
              disabled={!canDecide || submitting !== null || !reason.trim() || !limitAmount.trim()}
              onClick={() => void decide('LIMIT')}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 border border-amber bg-amber px-5 py-3 font-tele text-[0.82rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
            >
              <ChevronsDownUp size={16} strokeWidth={2} />
              {submitting === 'LIMIT' ? 'Applying…' : 'Limit'}
            </button>
          </div>
        ) : null}

        {action.allowed.includes('DENY') ? (
          <button
            type="button"
            disabled={!canDecide || submitting !== null || !reason.trim()}
            onClick={() => void decide('DENY')}
            className="flex min-h-[44px] items-center justify-center gap-2 border border-signal bg-signal px-5 py-3 font-tele text-[0.82rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
          >
            <X size={16} strokeWidth={2} />
            {submitting === 'DENY' ? 'Applying…' : 'Deny'}
          </button>
        ) : null}

        {action.allowed.includes('FREEZE') ? (
          resolvedAgentId ? (
            <button
              type="button"
              disabled={!canDecide || submitting !== null || !reason.trim()}
              onClick={() => void freeze()}
              className="flex min-h-[44px] items-center justify-center gap-2 border border-signal px-5 py-3 font-tele text-[0.82rem] font-bold tracking-[0.16em] text-signal uppercase disabled:opacity-50"
            >
              <Snowflake size={16} strokeWidth={1.5} />
              {submitting === 'FREEZE' ? 'Freezing…' : 'Freeze agent'}
            </button>
          ) : (
            <p className="font-tele text-[0.7rem] text-faint uppercase">
              Freeze offered, but the agent behind this incident could not be uniquely resolved — freeze it from its own dossier instead.
            </p>
          )
        ) : null}
      </div>
    </div>
  )
}

function interpretError(status: number, message?: string): string {
  if (status === 409 && message?.toLowerCase().includes('binding')) return 'This action changed. Reload before deciding.'
  if (status === 409 && message?.toLowerCase().includes('already')) return 'Already submitted.'
  if (status === 409) return message ?? 'Already decided or expired.'
  if (status === 403) return message ?? 'Outside this operator\'s scope, or step-up required.'
  return message ?? `Refused (${status}).`
}
