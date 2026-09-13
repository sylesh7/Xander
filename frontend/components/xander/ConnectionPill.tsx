'use client'

import { useEffect, useState } from 'react'
import { consoleApi } from '@/lib/api/console'
import type { ReadinessResponse } from '@/lib/types'

/** Polls system health, shows acid when ready / signal when not (frontend spec §4.0). */
export function ConnectionPill() {
  const [ready, setReady] = useState<ReadinessResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const { data } = await consoleApi.get<ReadinessResponse>('/ready')
        if (!cancelled) {
          setReady(data)
          setFailed(false)
        }
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    void poll()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void poll()
    }, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const isReady = ready?.ready === true
  const dotClass = failed || !ready ? 'bg-faint' : isReady ? 'bg-acid' : 'bg-signal'
  const label = failed ? 'UNREACHABLE' : !ready ? 'CHECKING' : isReady ? 'READY' : 'DEGRADED'

  return (
    <span
      title={ready?.summary ?? undefined}
      className="inline-flex items-center gap-1.5 border border-rule px-2 py-1 font-tele text-[0.64rem] font-bold tracking-[0.14em] text-dim uppercase"
    >
      <span className={`h-1.5 w-1.5 ${dotClass}`} />
      {label}
    </span>
  )
}
