import { COLOR_CLASSES, semanticColor, type BadgeKind } from '@/lib/semantics'

/**
 * Square, hairline-bordered status badge. Reads `lib/semantics.ts` — no
 * component decides its own colour (frontend spec §3).
 */
export function StatusBadge({
  kind,
  value,
  severity,
}: {
  kind: BadgeKind
  value: string
  /** Only meaningful for kind="incident" — OPEN recolours at HIGH/CRITICAL. */
  severity?: string | null
}) {
  const color = semanticColor(kind, value, severity)
  const classes = COLOR_CLASSES[color]
  const filled = color === 'signal'

  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 font-tele text-[11px] font-bold tracking-widest uppercase ${classes.border} ${
        filled ? `${classes.dot} text-paper` : classes.text
      }`}
    >
      {value.replace(/_/g, ' ')}
    </span>
  )
}
