import Image from 'next/image'
import Logo from './Logo'
import NorthwaterSVG from './NorthwaterSVG'

const footerLinks = [
  { href: '/services', label: 'Prices & plans' },
  { href: '/maintenance', label: 'Maintenance' },
  { href: '/diagnostics', label: 'Diagnostics' },
  { href: '/build', label: 'Build' },
  { href: '/ai', label: 'AI & data' },
  { href: '/analytics', label: 'Power BI' },
  { href: '/rescue', label: 'Rescue' },
  { href: '/drupal-upgrade', label: 'Drupal upgrades' },
  { href: '/drupal-7-census', label: 'Drupal 7 census' },
  { href: '/fractional', label: 'Fractional lead' },
  { href: '/agencies', label: 'For agencies' },
  { href: '/work', label: 'Work' },
  { href: '/fargo', label: 'Fargo' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
  { href: '/lab', label: 'Test patterns' },
  { href: '/notes/', label: 'Field notes' },
  { href: '/tutorials/', label: 'Shop class' },
  { href: '/accessibility', label: 'Accessibility' },
  { href: 'mailto:hello@deadnorth.io', label: 'hello@deadnorth.io', noUppercase: true },
]

export default function Footer() {
  return (
    <footer className="dn-footer border-t-[3px] border-hard px-[var(--gutter)] pt-9 pb-14">
      <NorthwaterSVG variant="mouth" />

      <div className="mx-auto max-w-[1140px] font-tele text-[0.72rem] tracking-[0.06em] text-faint">
        <p className="mb-4 max-w-[70ch]">
          <strong className="font-shout text-[1.15rem] tracking-[0.02em] text-ink">
            <Logo id="dn-mk-ft" />
            DEAD NORTH
          </strong>{' '}
          — dead-on and due north, the Dead and the North, and a band if you need one. All three readings are
          correct.
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
              href="https://www.websitecarbon.com/website/deadnorth-io/"
              rel="noopener"
              className="dn-split inline-flex min-h-6 items-center gap-1.5 text-dim no-underline"
            >
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-acid" />
              Website carbon A+ · 0.03g CO2 per visit · cleaner than 94% of pages tested (Aug 2026) — re-test
              live
            </a>
          </p>
          <a
            href="https://www.thegreenwebfoundation.org/green-web-check/?url=deadnorth.io"
            rel="noopener"
            className="dn-split inline-block no-underline"
          >
            <Image
              src="/assets/greenweb.png"
              alt="This website runs on green hosting - verified by thegreenwebfoundation.org"
              width={200}
              height={95}
              loading="lazy"
            />
          </a>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6 border-t border-rule pt-6">
          <p className="m-0">
            © 2026 Dead North LLC · Minneapolis, Minnesota ·{' '}
            <a href="/llms.txt" className="dn-split text-ink">
              Prices, machine-readable
            </a>
          </p>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="flex flex-wrap gap-2" aria-label="Broadcast controls">
              <FooterButton label="SND" stateLabel="off" />
              <FooterButton label="Motion" stateLabel="on" />
              <FooterButton label="Air" stateLabel="on" />
            </div>

            <a href="/tune-in" className="dn-split no-underline" aria-label="Tune-in page — the QR landing">
              <Image
                src="/assets/tune-in.svg"
                alt=""
                width={64}
                height={64}
                className="block border border-rule"
              />
              <span className="mt-1 block text-center font-tele text-[0.5rem] tracking-[0.22em] text-faint uppercase">
                Tune in
              </span>
            </a>
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
