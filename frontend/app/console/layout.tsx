'use client'

import './console.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ApiKeyModal } from '@/components/xander/ApiKeyModal'
import { ConnectionPill } from '@/components/xander/ConnectionPill'
import { ThemeToggle } from '@/components/xander/ThemeToggle'
import { CommandPalette } from '@/components/xander/CommandPalette'
import { NAV_ITEMS } from '@/components/xander/navItems'
import Logo from '@/components/Logo'

function Breadcrumb() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  return (
    <nav className="font-tele text-[0.72rem] tracking-[0.12em] text-dim uppercase">
      {segments.map((seg, i) => (
        <span key={i}>
          {i > 0 ? <span className="mx-1.5 text-faint">/</span> : null}
          {seg}
        </span>
      ))}
    </nav>
  )
}

function LeftRail() {
  const pathname = usePathname()
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-rule bg-paper">
      <Link href="/" className="dn-split flex items-center gap-1.5 border-b border-rule px-5 py-5 font-shout text-[1rem] uppercase text-ink no-underline">
        <Logo id="dn-mk-console" />
        Xander
      </Link>
      <nav className="flex flex-1 flex-col gap-0.5 py-3">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/console' ? pathname === '/console' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 border-l-2 px-5 py-2.5 font-tele text-[0.78rem] tracking-[0.06em] uppercase no-underline transition-colors ${
                active ? 'border-ink text-ink' : 'border-transparent text-dim hover:text-ink'
              }`}
            >
              <item.icon size={16} strokeWidth={1.5} />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-rule px-5 py-4 font-tele text-[0.62rem] tracking-[0.1em] text-faint uppercase">
        Operator desk · dev
      </div>
    </aside>
  )
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ApiKeyModal>
      <div className="flex min-h-screen bg-paper">
        <LeftRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-rule px-6 py-3">
            <Breadcrumb />
            <div className="flex items-center gap-3">
              <span className="hidden font-tele text-[0.62rem] tracking-[0.1em] text-faint uppercase sm:inline">
                ⌘K to jump
              </span>
              <ConnectionPill />
              <ThemeToggle />
            </div>
          </header>
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </div>
      <CommandPalette />
    </ApiKeyModal>
  )
}
