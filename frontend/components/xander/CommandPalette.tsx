'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NAV_ITEMS } from './navItems'

/** A minimal ⌘K jump list — the spec asks for a command palette, not a full fuzzy-search library. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const router = useRouter()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!open) return null

  const results = NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-ink/40 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] border-2 border-hard bg-paper shadow-[6px_6px_0_var(--color-hard)]"
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to…"
          className="w-full border-b border-rule bg-transparent px-4 py-3 font-tele text-[0.9rem] text-ink outline-none"
        />
        <ul className="m-0 max-h-[300px] list-none overflow-y-auto p-0">
          {results.length === 0 ? (
            <li className="px-4 py-3 font-tele text-[0.78rem] text-faint uppercase">No match</li>
          ) : (
            results.map((item) => (
              <li key={item.href}>
                <button
                  type="button"
                  onClick={() => {
                    router.push(item.href)
                    setOpen(false)
                    setQuery('')
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-tele text-[0.82rem] tracking-[0.04em] text-ink uppercase hover:bg-paper-2 hover:text-signal"
                >
                  <item.icon size={14} strokeWidth={1.5} />
                  {item.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
