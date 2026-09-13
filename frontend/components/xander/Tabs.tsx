'use client'

import { useState } from 'react'

export function Tabs({
  tabs,
  initial,
}: {
  tabs: { key: string; label: string; content: React.ReactNode }[]
  initial?: string
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key)
  const current = tabs.find((t) => t.key === active) ?? tabs[0]

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1 border-b border-rule">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`border-b-2 px-4 py-2.5 font-tele text-[0.76rem] font-bold tracking-[0.12em] uppercase transition-colors ${
              active === t.key ? 'border-ink text-ink' : 'border-transparent text-faint hover:text-dim'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current?.content}
    </div>
  )
}
