import { Database, Share2, Radio } from 'lucide-react'

/**
 * Every evidence row carries its provenance — where the fact came from, so
 * "why was this wallet flagged" is answerable by pointing at a real row.
 */
export function ProvenanceChip({
  source,
  deployment,
  block,
}: {
  source: string
  deployment?: string | null
  block?: string | null
}) {
  const normalized = source.toLowerCase()
  const Icon = normalized.includes('subgraph') ? Share2 : normalized.includes('substream') ? Radio : Database

  const parts = [source.toUpperCase().replace(/-/g, ' ')]
  if (deployment) parts.push(`${deployment.slice(0, 8)}…`)
  if (block) parts.push(`#${block}`)

  return (
    <span className="inline-flex items-center gap-1.5 border border-rule px-1.5 py-0.5 font-tele text-[0.62rem] tracking-[0.08em] text-dim uppercase">
      <Icon size={12} strokeWidth={1.5} />
      {parts.join(' · ')}
    </span>
  )
}
