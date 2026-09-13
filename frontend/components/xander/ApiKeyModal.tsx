'use client'

import { useEffect, useState } from 'react'
import { getConsoleApiKey, setConsoleApiKey } from '@/lib/api/console'

/**
 * One-time modal on first load, storing to localStorage (frontend spec §4.0).
 * This is a dev/demo console — the modal says so. Never put the key in a URL.
 *
 * `key` starts `undefined` (not read from localStorage yet) rather than
 * `null` so the server-rendered markup and the client's first paint match —
 * localStorage doesn't exist during SSR, so reading it in a `useState`
 * initializer produces a value the server could never have rendered, which
 * is a real hydration-mismatch bug, not just a lint nit.
 */
export function ApiKeyModal({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState<string | null | undefined>(undefined)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setKey(getConsoleApiKey())
  }, [])

  if (key === undefined) return null
  if (key) return <>{children}</>

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          setConsoleApiKey(draft.trim())
          setKey(draft.trim())
        }}
        className="w-full max-w-[440px] border-[3px] border-hard bg-paper p-8"
      >
        <p className="mb-1 font-tele text-[0.68rem] font-bold tracking-[0.2em] text-signal uppercase">Operator desk</p>
        <h1 className="mb-4 font-shout text-[1.8rem] leading-none uppercase">Enter the API key</h1>
        <p className="mb-5 max-w-[40ch] text-[0.88rem] leading-relaxed text-dim">
          This is a dev/demo console. The key is kept in this browser&apos;s local storage only, and is never sent
          anywhere except this backend&apos;s <code>X-API-Key</code> header. Find it in <code>backend/.env</code> as{' '}
          <code>BACKEND_API_KEY</code>.
        </p>
        <input
          autoFocus
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="BACKEND_API_KEY"
          className="mb-4 w-full border border-field bg-paper px-3 py-2.5 font-tele text-[0.85rem] text-ink outline-none focus:border-signal"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="w-full border border-hard bg-hard px-5 py-3 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-40"
        >
          Open console
        </button>
      </form>
    </div>
  )
}
