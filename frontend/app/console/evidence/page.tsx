'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Database, Share2, Radio, SearchCheck, ArrowRight, RefreshCw } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type { ActorView, ClusterEvidenceResponse, WalletRiskResponse } from '@/lib/types'
import { Measure } from '@/components/xander/Measure'
import { ProvenanceChip } from '@/components/xander/ProvenanceChip'
import { DataTable } from '@/components/xander/DataTable'
import { EmptyState } from '@/components/xander/EmptyState'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { Address } from '@/components/xander/Mono'

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/

function actorCacheKey(wallet: string) {
  return `xander.actorByWallet.${wallet.toLowerCase()}`
}

export default function EvidencePage() {
  const router = useRouter()
  const [wallet, setWallet] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [risk, setRisk] = useState<WalletRiskResponse | null>(null)
  const [evidence, setEvidence] = useState<ClusterEvidenceResponse | null>(null)
  const [actorConflict, setActorConflict] = useState(false)
  const [manualActorId, setManualActorId] = useState('')
  const [creatingActor, setCreatingActor] = useState(false)

  async function pull(address: string) {
    setLoading(true)
    setError(null)
    setActorConflict(false)
    setEvidence(null)
    try {
      const { status, data } = await consoleApi.get<WalletRiskResponse>(`/wallets/${address}/risk`)
      if (status === 400) {
        setError('Malformed wallet address.')
        setRisk(null)
        return
      }
      setRisk(data)
      if (data.clusterId) {
        const ev = await consoleApi.get<ClusterEvidenceResponse>(`/clusters/${data.clusterId}/evidence`)
        setEvidence(ev.data)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    } finally {
      setLoading(false)
    }
  }

  async function openDossier() {
    if (!risk) return
    const cached = typeof window !== 'undefined' ? window.localStorage.getItem(actorCacheKey(risk.wallet)) : null
    if (cached) {
      router.push(`/console/actors/${cached}`)
      return
    }
    setCreatingActor(true)
    setActorConflict(false)
    try {
      const { status, data } = await consoleApi.post<ActorView & { message?: string }>('/v2/actors', {
        actorType: 'WALLET',
        wallet: { address: risk.wallet },
      })
      if (status === 409) {
        setActorConflict(true)
        return
      }
      if (status !== 201) {
        setError(data.message ?? `Could not create an actor (${status}).`)
        return
      }
      window.localStorage.setItem(actorCacheKey(risk.wallet), data.id)
      router.push(`/console/actors/${data.id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create an actor.')
    } finally {
      setCreatingActor(false)
    }
  }

  const hasTokenApi = risk?.sources.some((s) => s.type === 'token-api')
  const hasSubgraph = risk?.sources.some((s) => s.type.includes('subgraph'))
  const hasSubstreams = risk?.sources.some((s) => s.type.includes('substream'))

  return (
    <div className="mx-auto max-w-[1200px]">
      <h1 className="mb-1 font-shout text-[2.2rem] leading-none uppercase">Evidence explorer</h1>
      <p className="mb-6 max-w-[64ch] text-[0.9rem] text-dim">
        Every number in Xander traces back to a row here. Paste a wallet, pull it through the Graph pipeline, and see
        exactly where each signal came from.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (WALLET_PATTERN.test(wallet)) void pull(wallet)
          else setError('Enter a 0x-prefixed, 40-hex-character address.')
        }}
        className="mb-6 flex flex-wrap gap-2"
      >
        <input
          value={wallet}
          onChange={(e) => setWallet(e.target.value.trim())}
          placeholder="0x0000000000000000000000000000000000000c1e"
          className="min-w-[320px] flex-1 border border-field bg-paper px-3 py-2.5 font-tele text-[0.85rem] text-ink outline-none focus:border-signal"
        />
        <button
          type="submit"
          disabled={loading}
          className="border border-hard bg-hard px-5 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
        >
          Pull evidence
        </button>
        {risk ? (
          <button
            type="button"
            onClick={() => void pull(risk.wallet)}
            disabled={loading}
            className="flex items-center gap-1.5 border border-field px-4 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-ink uppercase disabled:opacity-50"
          >
            <RefreshCw size={14} strokeWidth={1.5} />
            Refresh
          </button>
        ) : null}
      </form>

      {error ? <div className="mb-6"><ReasonPanel outcome="Request failed" summary={error} /></div> : null}

      {!risk && !loading && !error ? (
        <EmptyState
          icon={Database}
          title="NO WALLET PULLED YET"
          body="Try the seeded clean fixture: 0x0000000000000000000000000000000000000c1e"
        />
      ) : null}

      {risk ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className={`border p-4 ${hasTokenApi ? 'border-rule' : 'border-dashed border-faint'}`}>
              <Database size={16} strokeWidth={1.5} className="mb-2 text-faint" />
              <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Token API</div>
              <div className={`font-tele text-[0.72rem] uppercase ${hasTokenApi ? 'text-acid' : 'text-faint'}`}>
                {hasTokenApi ? 'Evidence fetched' : 'No rows for this wallet'}
              </div>
            </div>
            <div className={`border p-4 ${hasSubgraph ? 'border-rule' : 'border-dashed border-faint'}`}>
              <Share2 size={16} strokeWidth={1.5} className="mb-2 text-faint" />
              <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Subgraphs</div>
              <div className={`font-tele text-[0.72rem] uppercase ${hasSubgraph ? 'text-acid' : 'text-faint'}`}>
                {hasSubgraph ? 'Evidence fetched' : 'No rows for this wallet'}
              </div>
            </div>
            <div className={`border p-4 ${hasSubstreams ? 'border-rule' : 'border-dashed border-faint'}`}>
              <Radio size={16} strokeWidth={1.5} className="mb-2 text-faint" />
              <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Substreams</div>
              <div className={`font-tele text-[0.72rem] uppercase ${hasSubstreams ? 'text-acid' : 'text-faint'}`}>
                {hasSubstreams ? 'Evidence fetched' : 'No rows for this wallet'}
              </div>
            </div>
            <div className="border border-dashed border-faint p-4">
              <SearchCheck size={16} strokeWidth={1.5} className="mb-2 text-faint" />
              <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Subgraph MCP</div>
              <div className="font-tele text-[0.72rem] text-faint uppercase">Only runs on a cluster investigation</div>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Evidence rows</h2>
            {!risk.clusterId ? (
              <EmptyState
                icon={Database}
                title="NO CLUSTER, NO LISTING ENDPOINT"
                body="This wallet isn't in a cluster, and Xander has no endpoint that lists a single wallet's raw evidence rows outside one (only GET /clusters/:id/evidence exists). The five features below were still computed from real evidence — they just aren't independently browsable here yet."
              />
            ) : evidence && evidence.events.length > 0 ? (
              <DataTable
                columns={[
                  { key: 'time', label: 'Time' },
                  { key: 'chain', label: 'Chain' },
                  { key: 'event', label: 'Event' },
                  { key: 'protocol', label: 'Protocol' },
                  { key: 'counterparty', label: 'Counterparty' },
                  { key: 'amount', label: 'Amount' },
                  { key: 'provenance', label: 'Provenance' },
                ]}
                rows={evidence.events}
                rowKey={(r) => r.id}
                cell={(r, key) => {
                  switch (key) {
                    case 'time':
                      return new Date(r.timestamp).toLocaleString()
                    case 'chain':
                      return r.chain
                    case 'event':
                      return r.eventType
                    case 'protocol':
                      return r.protocol ?? '—'
                    case 'counterparty':
                      return r.counterparty ? <Address value={r.counterparty} /> : '—'
                    case 'amount':
                      return r.amount ?? '—'
                    case 'provenance':
                      return <ProvenanceChip source={r.sourceType} deployment={r.deploymentId} block={r.blockNumber} />
                    default:
                      return null
                  }
                }}
              />
            ) : (
              <EmptyState icon={Database} title="EMPTY CLUSTER EVIDENCE" body="Cluster exists but returned no rows." />
            )}
          </div>

          <div className="mb-6">
            <h2 className="mb-3 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-faint uppercase">Derived signals</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {risk.features.map((f) => (
                <Measure
                  key={f.name}
                  value={f.value}
                  state="KNOWN"
                  basis={`Computed under policy ${risk.policyVersion}`}
                  label={f.name.replace(/_/g, ' ')}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-rule pt-5">
            {actorConflict ? (
              <div className="mb-4">
                <ReasonPanel
                  outcome="Actor exists"
                  code="409"
                  summary="This wallet already has an actor on the backend. Xander has no GET /v2/actors?wallet= lookup (docs/backendwiring.md §9 gap #6), so re-finding it needs the id from whoever created it first."
                  next="Paste a known actor id below, or pull a wallet that hasn't been onboarded yet."
                />
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (manualActorId.trim()) router.push(`/console/actors/${manualActorId.trim()}`)
                  }}
                  className="mt-3 flex gap-2"
                >
                  <input
                    value={manualActorId}
                    onChange={(e) => setManualActorId(e.target.value)}
                    placeholder="cmt…"
                    className="flex-1 border border-field bg-paper px-3 py-2 font-tele text-[0.8rem] text-ink outline-none focus:border-signal"
                  />
                  <button type="submit" className="border border-hard bg-hard px-4 py-2 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase">
                    Open
                  </button>
                </form>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void openDossier()}
              disabled={creatingActor}
              className="dn-split flex items-center gap-2 border border-hard bg-hard px-5 py-3 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-paper uppercase no-underline disabled:opacity-50"
            >
              Open trust dossier
              <ArrowRight size={14} strokeWidth={1.5} />
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
