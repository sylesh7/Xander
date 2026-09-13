import { CircleHelp } from 'lucide-react'
import type { DimensionState } from '@/lib/types'

/**
 * The most important component in the app (frontend spec §3, Rule 2).
 *
 * `null` means UNKNOWN, never zero. A missing measurement rendered as `0` is a
 * correctness bug, not a styling choice — it invents a measurement nobody made.
 * Never call this with `value ?? 0` or `value || 0` upstream; pass the raw
 * value/state pair straight through.
 */
export function Measure({
  value,
  state,
  basis,
  label,
}: {
  value: number | null
  state: DimensionState
  basis: string
  label: string
}) {
  return (
    <div className="border border-rule p-3">
      <div className="mb-1.5 font-tele text-[0.62rem] tracking-[0.18em] text-faint uppercase">{label}</div>
      {state === 'KNOWN' && value !== null ? (
        <>
          <div className="mb-1.5 font-shout text-[1.9rem] leading-none tabular-nums">
            {(value * 100).toFixed(0)}
            <span className="ml-1 text-[0.9rem] text-faint">/100</span>
          </div>
          <div className="mb-1.5 h-1.5 w-full bg-paper-2">
            <div className="h-full bg-ink" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
          </div>
        </>
      ) : state === 'NOT_APPLICABLE' ? (
        <div className="mb-1.5 font-tele text-[1.1rem] tracking-[0.1em] text-faint uppercase">N/A</div>
      ) : (
        <div className="mb-1.5 flex items-center gap-1.5 border border-dashed border-bolt px-2 py-1 font-tele text-[0.85rem] tracking-[0.1em] text-bolt uppercase">
          <CircleHelp size={14} strokeWidth={1.5} />
          Unknown
        </div>
      )}
      <div className="font-tele text-[0.68rem] leading-snug text-dim">{basis}</div>
    </div>
  )
}
