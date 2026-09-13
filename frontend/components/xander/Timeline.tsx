import { COLOR_CLASSES, type SemanticColor } from '@/lib/semantics'

export interface TimelineItem {
  id: string
  label: string
  detail?: string
  timestamp?: string
  color?: SemanticColor
}

/** Vertical hairline with square nodes, colour from semantics. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="m-0 list-none border-l border-rule p-0 pl-5">
      {items.map((item) => {
        const dotClass = item.color ? COLOR_CLASSES[item.color].dot : 'bg-faint'
        return (
          <li key={item.id} className="relative pb-6 last:pb-0">
            <span className={`absolute top-1 -left-[1.35rem] h-2.5 w-2.5 ${dotClass}`} />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-tele text-[0.8rem] tracking-[0.04em] text-ink uppercase">{item.label}</span>
              {item.timestamp ? (
                <time className="font-tele text-[0.66rem] tracking-[0.1em] text-faint">{item.timestamp}</time>
              ) : null}
            </div>
            {item.detail ? <p className="mt-1 mb-0 text-[0.82rem] text-dim">{item.detail}</p> : null}
          </li>
        )
      })}
    </ol>
  )
}
