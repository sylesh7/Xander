'use client'

import { useState } from 'react'
import Logo from './Logo'
import HeroSection from './Hero'

export default function Header() {
  return (
    <header className="px-[var(--gutter)] pt-6 pb-[clamp(2.5rem,5vw,3.75rem)]">
      <div className="mx-auto max-w-[1140px]">
        <Nav />
        <HeroSection />
      </div>
    </header>
  )
}

function Nav() {
  return (
    <nav
      className="mb-6 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-rule pb-4"
      aria-label="Main"
    >
      <a
        href="/"
        aria-current="page"
        className="dn-split font-shout text-[1.15rem] tracking-[0.04em] text-ink uppercase no-underline"
      >
        <Logo id="dn-mk-nav" />
        Xander
      </a>

      <span className="flex flex-wrap items-baseline gap-x-6 gap-y-2 font-tele text-[0.92rem] font-bold tracking-[0.1em] uppercase">
        <ServicesMenu />
        <ProgrammingMenu />
        <a href="#build-status" className="dn-split inline-flex min-h-6 items-center no-underline transition-colors text-ink hover:text-signal">Build status</a>
        <a href="#team" className="dn-split inline-flex min-h-6 items-center no-underline transition-colors text-ink hover:text-signal">Team</a>
        <a href="#contact" className="dn-split inline-flex min-h-6 items-center no-underline transition-colors text-ink hover:text-signal">Contact</a>
        <a href="#ethonline" className="dn-split text-signal no-underline">
          <span aria-hidden="true">● </span>
          <span className="sr-only">Status: </span>Built for ETHOnline 2026
        </a>
        <a
          href="https://github.com/sylesh7/Xander"
          target="_blank"
          rel="noopener"
          className="dn-split inline-flex min-h-6 items-center border border-field px-2.5 py-1 text-[0.72rem] tracking-[0.14em] text-ink no-underline"
        >
          View source<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </span>
    </nav>
  )
}

function NavMenu({
  label,
  width,
  items,
}: {
  label: string
  width: string
  items: { href: string; label: string; sub: string }[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`dn-menu relative${open ? ' dn-menu-open' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 border-0 bg-transparent p-0 font-inherit transition-colors select-none text-ink hover:text-signal"
      >
        {label}<span aria-hidden="true" className="dn-menu-caret inline-block text-[0.7em] transition-transform">▾</span>
      </button>
      <ul className={`dn-menu-panel absolute top-[calc(100%+0.6rem)] left-1/2 z-40 m-0 -translate-x-1/2 list-none border-2 border-hard bg-paper p-0 shadow-[6px_6px_0_var(--color-hard)] ${width}`}>
        {items.map((item) => (
          <li key={item.href} className="border-b border-rule last:border-b-0">
            <a
              href={item.href}
              className="block px-4 py-2.5 no-underline transition-colors focus-visible:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal text-ink hover:bg-paper-2 hover:text-signal"
            >
              {item.label}
              <span className="mt-0.5 block font-normal text-[0.64rem] tracking-[0.14em] text-faint normal-case">{item.sub}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ServicesMenu() {
  const items = [
    { href: '#the-problem', label: 'The problem', sub: 'why airdrops keep misfiring' },
    { href: '#evidence', label: 'Evidence layer', sub: 'Token API, Subgraphs, Substreams' },
    { href: '#fail-closed', label: 'Fail-closed design', sub: 'never a silent allow' },
    { href: '#build-status', label: 'Build status', sub: '330 tests, verified live' },
    { href: '#team', label: 'Architecture & team', sub: 'two tracks, one seam' },
    { href: '#docs', label: 'Docs', sub: 'specs and progress logs' },
    { href: '#try-it', label: 'Try it live', sub: 'query the real subgraph' },
    { href: '#ethonline', label: 'ETHOnline 2026', sub: 'two sponsor tracks' },
    { href: '#contact', label: 'Repo & links', sub: 'source, subgraph, docs' },
    { href: 'https://api.studio.thegraph.com/query/1758823/xander/v0.0.3', label: 'GraphiQL playground', sub: 'query it yourself' },
  ]

  return <NavMenu label="Product" width="w-72" items={items} />
}

function ProgrammingMenu() {
  const items = [
    { href: 'https://github.com/sylesh7/Xander/blob/main/Backend-Suganthan.md', label: 'Evidence & Risk spec', sub: 'phases 1-12' },
    { href: 'https://github.com/sylesh7/Xander/blob/main/Backend-Sylesh.md', label: 'Decision & API spec', sub: 'phases 13-25' },
    { href: 'https://github.com/sylesh7/Xander', label: 'Source', sub: 'the real repo' },
  ]

  return <NavMenu label="Resources" width="w-56" items={items} />
}
