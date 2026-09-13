import Logo from './Logo'
import NorthwaterSVG from './NorthwaterSVG'

const footerLinks = [
  { href: '#the-problem', label: 'The problem' },
  { href: '#evidence', label: 'Evidence layer' },
  { href: '#fail-closed', label: 'Fail-closed design' },
  { href: '#build-status', label: 'Build status' },
  { href: '#team', label: 'Team' },
  { href: '#docs', label: 'Docs' },
  { href: '#try-it', label: 'Try it live' },
  { href: '#ethonline', label: 'ETHOnline 2026' },
  { href: '#contact', label: 'Contact' },
  { href: 'https://api.studio.thegraph.com/query/1758823/xander/v0.0.3', label: 'GraphiQL' },
  { href: 'https://thegraph.com/studio/subgraph/xander', label: 'Subgraph Studio' },
  { href: 'https://github.com/sylesh7/Xander/blob/main/Backend-Suganthan.md', label: 'Evidence & Risk spec' },
  { href: 'https://github.com/sylesh7/Xander/blob/main/Backend-Sylesh.md', label: 'Decision & API spec' },
  { href: 'https://github.com/sylesh7/Xander', label: 'github.com/sylesh7/Xander', noUppercase: true },
]

export default function Footer() {
  return (
    <footer className="dn-footer border-t-[3px] border-hard px-[var(--gutter)] pt-9 pb-14">
      <NorthwaterSVG variant="mouth" />

      <div className="mx-auto max-w-[1140px] font-tele text-[0.72rem] tracking-[0.06em] text-faint">
        <p className="mb-4 max-w-[70ch]">
          <strong className="font-shout text-[1.15rem] tracking-[0.02em] text-ink">
            <Logo id="dn-mk-ft" />
            XANDER
          </strong>{' '}
          — a Graph-native, cross-protocol coordinated-actor risk engine, with World Selfie
          Check as a selective escalation layer. Built for ETHOnline 2026.
        </p>

        <nav className="mb-8 flex flex-wrap gap-x-6 gap-y-2">
          {footerLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={`dn-split inline-flex min-h-6 items-center text-dim no-underline${link.noUppercase ? '' : ' uppercase'}`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <p className="m-0">
            <a
              href="https://github.com/sylesh7/Xander"
              target="_blank"
              rel="noopener"
              className="dn-split inline-flex min-h-6 items-center gap-1.5 text-dim no-underline"
            >
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-acid" />
              Test suite: 330 passing · 5 skipped without live credentials · 0 failing (2026-09-12)
            </a>
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6 border-t border-rule pt-6">
          <p className="m-0">
            © 2026 Xander · ETHOnline 2026 submission ·{' '}
            <a href="https://github.com/sylesh7/Xander" target="_blank" rel="noopener" className="dn-split text-ink">
              Full source →
            </a>
          </p>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="flex flex-wrap gap-2" aria-label="Broadcast controls">
              <FooterButton label="SND" stateLabel="off" />
              <FooterButton label="Motion" stateLabel="on" />
              <FooterButton label="Air" stateLabel="on" />
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterButton({ label, stateLabel }: { label: string; stateLabel: string }) {
  return (
    <button
      type="button"
      className="dn-split min-h-6 cursor-pointer border border-field bg-transparent px-2 py-1 font-tele text-[0.62rem] tracking-[0.16em] text-dim uppercase"
    >
      {label} <span>{stateLabel}</span>
    </button>
  )
}
