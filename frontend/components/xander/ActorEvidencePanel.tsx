'use client'

import { useEffect, useState } from 'react'
import { Database, Share2, Radio } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type { ClusterEvidenceResponse, WalletRiskResponse } from '@/lib/types'
import { Measure } from './Measure'
import { ProvenanceChip } from './ProvenanceChip'
import { DataTable } from './DataTable'
import { EmptyState } from './EmptyState'
import { ReasonPanel } from './ReasonPanel'
import { Address } from './Mono'

/** The evidence explorer's payoff (source strip + rows + derived signals), reused wherever a wallet's evidence needs showing. */
export function ActorEvidencePanel({ wallet }: { wallet: string }) {
  const [risk, setRisk] = useState<WalletRiskResponse | null>(null)
  const [evidence, setEvidence] = useState<ClusterEvidenceResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await consoleApi.get<WalletRiskResponse>(`/wallets/${wallet}/risk`)
        if (cancelled) return
        setRisk(data)
        if (data.clusterId) {
          const ev = await consoleApi.get<ClusterEvidenceResponse>(`/clusters/${data.clusterId}/evidence`)
          if (!cancelled) setEvidence(ev.data)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [wallet])

  if (error) return <ReasonPanel outcome="Request failed" summary={error} />
  if (!risk) return <div className="h-[120px] animate-pulse border border-rule bg-paper-2" />

  const hasTokenApi = risk.sources.some((s) => s.type === 'token-api')
  const hasSubgraph = risk.sources.some((s) => s.type.includes('subgraph'))
  const hasSubstreams = risk.sources.some((s) => s.type.includes('substream'))

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={`border p-4 ${hasTokenApi ? 'border-rule' : 'border-dashed border-faint'}`}>
          <Database size={16} strokeWidth={1.5} className="mb-2 text-faint" />
          <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Token API</div>
          <div className={`font-tele text-[0.72rem] uppercase ${hasTokenApi ? 'text-acid' : 'text-faint'}`}>
            {hasTokenApi ? 'Evidence fetched' : 'No rows'}
          </div>
        </div>
        <div className={`border p-4 ${hasSubgraph ? 'border-rule' : 'border-dashed border-faint'}`}>
          <Share2 size={16} strokeWidth={1.5} className="mb-2 text-faint" />
          <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Subgraphs</div>
          <div className={`font-tele text-[0.72rem] uppercase ${hasSubgraph ? 'text-acid' : 'text-faint'}`}>
            {hasSubgraph ? 'Evidence fetched' : 'No rows'}
          </div>
        </div>
        <div className={`border p-4 ${hasSubstreams ? 'border-rule' : 'border-dashed border-faint'}`}>
          <Radio size={16} strokeWidth={1.5} className="mb-2 text-faint" />
          <div className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.1em] uppercase">Substreams</div>
          <div className={`font-tele text-[0.72rem] uppercase ${hasSubstreams ? 'text-acid' : 'text-faint'}`}>
            {hasSubstreams ? 'Evidence fetched' : 'No rows'}
          </div>
        </div>
      </div>

      <div className="mb-6">
        {!risk.clusterId ? (
          <EmptyState icon={Database} title="NO CLUSTER, NO LISTING ENDPOINT" body="Not in a cluster — no endpoint lists a single wallet's raw rows outside one." />
        ) : evidence && evidence.events.length > 0 ? (
          <DataTable
            columns={[
              { key: 'time', label: 'Time' },
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
          <EmptyState icon={Database} title="EMPTY CLUSTER EVIDENCE" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {risk.features.map((f) => (
          <Measure key={f.name} value={f.value} state="KNOWN" basis={`Computed under policy ${risk.policyVersion}`} label={f.name.replace(/_/g, ' ')} />
        ))}
      </div>
    </div>
  )
}
