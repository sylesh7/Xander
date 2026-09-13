import type { LucideIcon } from 'lucide-react'

/** Noir voice: "NO EVIDENCE ON FILE", not "No data yet 🙁". */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon
  title: string
  body?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 border border-dashed border-rule px-6 py-14 text-center">
      <Icon size={28} strokeWidth={1.25} className="text-faint" />
      <div className="font-shout text-[1.3rem] tracking-[0.01em] text-ink uppercase">{title}</div>
      {body ? <p className="m-0 max-w-[46ch] text-[0.9rem] text-dim">{body}</p> : null}
      {action}
    </div>
  )
}
