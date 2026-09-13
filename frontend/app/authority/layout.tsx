'use client'

import './authority.css'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { authorityApi, clearSession, getSession } from '@/lib/api/authority'

function useSessionGuard() {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  useEffect(() => {
    const session = getSession()
    if (!session && pathname !== '/authority/login') {
      router.replace('/authority/login')
      return
    }
    if (session && new Date(session.expiresAt).getTime() <= Date.now()) {
      clearSession()
      if (pathname !== '/authority/login') router.replace('/authority/login')
      return
    }
    setReady(true)
  }, [pathname, router])

  useEffect(() => {
    const id = setInterval(() => {
      const session = getSession()
      if (!session) {
        setSecondsLeft(null)
        return
      }
      const left = Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 1000)
      setSecondsLeft(left)
      if (left <= 0 && pathname !== '/authority/login') {
        clearSession()
        router.replace('/authority/login')
      }
    }, 1000)
    return () => clearInterval(id)
  }, [pathname, router])

  return { ready, secondsLeft }
}

export default function AuthorityLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { ready, secondsLeft } = useSessionGuard()
  const isLogin = pathname === '/authority/login'

  async function logout() {
    try {
      await authorityApi.del('/v2/control/sessions')
    } catch {
      // A session that can't be closed server-side is still cleared locally.
    }
    clearSession()
    router.replace('/authority/login')
  }

  if (!isLogin && !ready) return null

  return (
    <div className="min-h-screen bg-paper">
      <header className="flex items-center justify-between border-b border-rule px-4 py-3">
        <span className="font-shout text-[1.1rem] uppercase text-ink">Remote authority</span>
        {!isLogin ? (
          <div className="flex items-center gap-3">
            {secondsLeft !== null ? (
              <span className={`font-tele text-[0.68rem] tracking-[0.08em] uppercase ${secondsLeft < 120 ? 'text-signal' : 'text-faint'}`}>
                Session {Math.max(0, Math.floor(secondsLeft / 60))}m {Math.max(0, secondsLeft % 60)}s
              </span>
            ) : null}
            <button type="button" onClick={() => void logout()} className="flex items-center gap-1 text-faint hover:text-signal">
              <LogOut size={16} strokeWidth={1.5} />
            </button>
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-[480px] px-4 py-6">{children}</main>
    </div>
  )
}
