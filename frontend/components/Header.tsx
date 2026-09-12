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
        Dead North
      </a>

      <span className="flex flex-wrap items-baseline gap-x-6 gap-y-2 font-tele text-[0.92rem] font-bold tracking-[0.1em] uppercase">
        <ServicesMenu />
        <ProgrammingMenu />
        <a href="/work" className="dn-split inline-flex min-h-6 items-center no-underline transition-colors text-ink hover:text-signal">Work</a>
        <a href="/about" className="dn-split inline-flex min-h-6 items-center no-underline transition-colors text-ink hover:text-signal">About</a>
        <a href="/contact" className="dn-split inline-flex min-h-6 items-center no-underline transition-colors text-ink hover:text-signal">Contact</a>
        <a href="/contact" className="dn-split text-signal no-underline">
          <span aria-hidden="true">● </span>
          <span className="sr-only">Availability: </span>Now booking · Fall 2026
        </a>
        <a
          href="https://polaris.deadnorth.io/user/login"
          target="_blank"
          rel="noopener"
          className="dn-split inline-flex min-h-6 items-center border border-field px-2.5 py-1 text-[0.72rem] tracking-[0.14em] text-ink no-underline"
        >
          Client portal<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </span>
    </nav>
  )
}

function ServicesMenu() {
  const items = [
    { href: '/services', label: 'Prices & plans', sub: 'every price, one table' },
    { href: '/maintenance', label: 'Maintenance', sub: 'someone watching it' },
    { href: '/diagnostics', label: 'Diagnostics', sub: 'a fixed-price answer' },
    { href: '/build', label: 'Build', sub: 'new platforms and stores' },
    { href: '/bands', label: 'For small bands', sub: 'a site that loads fast' },
    { href: '/ai', label: 'AI & data', sub: 'the model is the easy part' },
    { href: '/fractional', label: 'Fractional lead', sub: 'a lead you can borrow' },
    { href: '/rescue', label: 'Rescue', sub: 'someone else built it' },
    { href: '/drupal-upgrade', label: 'Drupal upgrade', sub: 'D10 support ends Dec 9' },
    { href: '/agencies', label: 'For agencies', sub: 'your brand, our bench' },
  ]

  return (
    <details className="dn-menu relative">
      <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 transition-colors select-none [&::-webkit-details-marker]:hidden text-ink hover:text-signal">
        Services<span aria-hidden="true" className="dn-menu-caret inline-block text-[0.7em] transition-transform">▾</span>
      </summary>
      <ul className="absolute top-[calc(100%+0.6rem)] left-1/2 z-40 m-0 -translate-x-1/2 list-none border-2 border-hard bg-paper p-0 shadow-[6px_6px_0_var(--color-hard)] w-72">
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
    </details>
  )
}

function ProgrammingMenu() {
  const items = [
    { href: '/notes/', label: 'Field notes', sub: 'the war stories' },
    { href: '/tutorials/', label: 'Shop class', sub: 'the how-tos' },
    { href: '/lab', label: 'The Lab', sub: 'the working demos' },
  ]

  return (
    <details className="dn-menu relative">
      <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 transition-colors select-none [&::-webkit-details-marker]:hidden text-ink hover:text-signal">
        Programming<span aria-hidden="true" className="dn-menu-caret inline-block text-[0.7em] transition-transform">▾</span>
      </summary>
      <ul className="absolute top-[calc(100%+0.6rem)] left-1/2 z-40 m-0 -translate-x-1/2 list-none border-2 border-hard bg-paper p-0 shadow-[6px_6px_0_var(--color-hard)] w-56">
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
    </details>
  )
}
