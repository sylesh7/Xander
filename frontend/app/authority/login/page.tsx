'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authorityApi, getDeviceId, setSession, ApiError } from '@/lib/api/authority'
import type { ControlSession } from '@/lib/types'

export default function AuthorityLoginPage() {
  const router = useRouter()
  const [externalId, setExternalId] = useState('demo-operator')
  const [secret, setSecret] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Reading localStorage synchronously during render (rather than here, in an
  // effect) is the exact hydration-mismatch bug already found and fixed once
  // in ApiKeyModal — the server can never render this value, so computing it
  // during the render body diverges from the server-rendered markup.
  useEffect(() => {
    setDeviceId(getDeviceId())
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const { status, data } = await authorityApi.post<ControlSession & { message?: string }>('/v2/control/sessions', {
        externalId: externalId.trim(),
        secret,
        deviceId,
      })
      if (status !== 201) {
        // The backend deliberately returns the same message for bad secret vs
        // unknown operator (spec §27.1) — don't leak the difference here either.
        setError('Sign-in refused. Check the operator id and secret.')
        return
      }
      setSession(data)
      router.replace('/authority')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="mb-1 font-shout text-[1.8rem] leading-none uppercase">Open a session</h1>
      <p className="mb-6 text-[0.85rem] text-dim">
        Sessions are short by design. A stolen device stops being an authority plane on its own.
      </p>
      <form onSubmit={submit}>
        <label className="mb-1 block font-tele text-[0.66rem] tracking-[0.14em] text-faint uppercase">Operator id</label>
        <input
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          required
          className="mb-4 w-full border border-field bg-paper px-3 py-3 font-tele text-[0.9rem] text-ink outline-none focus:border-signal"
        />
        <label className="mb-1 block font-tele text-[0.66rem] tracking-[0.14em] text-faint uppercase">Secret</label>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          required
          className="mb-4 w-full border border-field bg-paper px-3 py-3 font-tele text-[0.9rem] text-ink outline-none focus:border-signal"
        />
        <label className="mb-1 block font-tele text-[0.66rem] tracking-[0.14em] text-faint uppercase">Device id</label>
        <input
          value={deviceId}
          readOnly
          className="mb-6 w-full border border-rule bg-paper-2 px-3 py-3 font-tele text-[0.8rem] text-faint outline-none"
        />
        {error ? <p className="mb-4 font-tele text-[0.8rem] text-signal">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[44px] border border-hard bg-hard px-5 py-3 font-tele text-[0.82rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
        >
          {submitting ? 'Opening…' : 'Open session'}
        </button>
      </form>
    </div>
  )
}
