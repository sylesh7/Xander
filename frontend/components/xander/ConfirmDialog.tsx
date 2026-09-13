'use client'

import { useState } from 'react'

/**
 * Reusable danger-zone confirmation — freeze/unfreeze/revoke all need a typed
 * reason, and revoke additionally needs the agent's name typed out (frontend
 * spec §4.6: "Require typing the agent name to confirm").
 */
export function ConfirmDialog({
  title,
  warning,
  confirmLabel,
  requireTypedValue,
  onCancel,
  onConfirm,
}: {
  title: string
  warning: string
  confirmLabel: string
  /** If set, the confirm button stays disabled until the user types this exact string. */
  requireTypedValue?: string
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canConfirm = reason.trim().length > 0 && (!requireTypedValue || typed === requireTypedValue) && !submitting

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/50 px-4" onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] border-[3px] border-signal bg-paper p-6 shadow-[6px_6px_0_var(--color-hard)]"
      >
        <h2 className="mb-3 font-shout text-[1.5rem] leading-none uppercase text-signal">{title}</h2>
        <p className="mb-4 text-[0.86rem] leading-relaxed text-ink">{warning}</p>

        <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">Reason (required)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mb-4 w-full resize-none border border-field bg-paper px-3 py-2 font-tele text-[0.82rem] text-ink outline-none focus:border-signal"
        />

        {requireTypedValue ? (
          <>
            <label className="mb-1 block font-tele text-[0.62rem] tracking-[0.14em] text-faint uppercase">
              Type <span className="text-ink">{requireTypedValue}</span> to confirm
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="mb-4 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.82rem] text-ink outline-none focus:border-signal"
            />
          </>
        ) : null}

        {error ? <p className="mb-4 font-tele text-[0.76rem] text-signal">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="border border-field px-4 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-ink uppercase"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              setSubmitting(true)
              setError(null)
              onConfirm(reason.trim())
                .catch((err) => setError(err instanceof Error ? err.message : 'Request failed.'))
                .finally(() => setSubmitting(false))
            }}
            className="border border-signal bg-signal px-4 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase disabled:opacity-40"
          >
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
