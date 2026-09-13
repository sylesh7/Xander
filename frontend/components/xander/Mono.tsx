'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { CHAIN_EXPLORERS } from '@/lib/types'

export function Mono({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`font-tele ${className}`}>{children}</span>
}

/** Truncates `0x1234…abcd`, click-to-copy the full value. */
export function Address({ value, chars = 4 }: { value: string; chars?: number }) {
  const [copied, setCopied] = useState(false)
  const short = value.length > chars * 2 + 3 ? `${value.slice(0, chars + 2)}…${value.slice(-chars)}` : value

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      title={value}
      className="dn-split inline-flex items-center gap-1 font-tele text-[0.85em] text-ink hover:text-signal"
    >
      {short}
      {copied ? <Check size={12} strokeWidth={1.5} /> : <Copy size={12} strokeWidth={1.5} />}
    </button>
  )
}

/** Truncates to 10 chars with a native tooltip carrying the full hash. */
export function Hash({ value }: { value: string }) {
  const short = value.length > 12 ? `${value.slice(0, 10)}…` : value
  return (
    <span title={value} className="font-tele text-[0.85em] text-dim">
      {short}
    </span>
  )
}

/** Links to the right explorer by chain id — never hardcoded. */
export function TxLink({ hash, chainId }: { hash: string; chainId: number }) {
  const explorer = CHAIN_EXPLORERS[chainId]
  const short = `${hash.slice(0, 10)}…${hash.slice(-6)}`
  if (!explorer) {
    return <Hash value={hash} />
  }
  return (
    <a
      href={`${explorer.txBase}${hash}`}
      target="_blank"
      rel="noopener"
      className="dn-split inline-flex items-center gap-1 font-tele text-[0.85em] text-bolt hover:text-signal"
    >
      {short}
      <span className="text-[0.7em] text-faint uppercase">{explorer.name}</span>
    </a>
  )
}
