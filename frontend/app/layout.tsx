import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Minneapolis Web & Drupal Studio — Builds, Rescue, Maintenance',
  description:
    'Senior Minneapolis web studio: Drupal-deep, WordPress-fluent, mobile and .NET capable. A $950 site health check to start, maintenance from $150/mo, and honest advice first — even when it\'s "don\'t hire us."',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/anton-400.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/courier-prime-400.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>
        <div className="dn-ground" aria-hidden="true" />
        <div className="dn-scan" aria-hidden="true" />
        <div className="dn-grain" aria-hidden="true" />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:bg-ink focus:px-3 focus:py-2 focus:font-tele focus:text-xs focus:tracking-widest focus:text-paper focus:uppercase"
        >
          Skip to content
        </a>
        <div className="relative z-[1]">{children}</div>
      </body>
    </html>
  )
}
