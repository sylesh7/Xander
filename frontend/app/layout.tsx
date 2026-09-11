import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Xander | Graph-Native Sybil Risk Engine',
  description:
    'A Graph-native, cross-protocol coordinated-actor risk engine, with World Selfie Check as a selective escalation layer.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Vite bundle's compiled stylesheet, served verbatim from /public */}
        <link rel="stylesheet" href="/assets/index_bwxw9yto.css" precedence="high" />
        {/* Hides removed template sections. The Vite bundle owns the actual
            render (createRoot, not hydrate) so we can't edit its markup
            directly — CSS is the reliable way to strip sections regardless
            of how/when the bundle mounts. */}
        <style>{`
          #demo,
          #interface,
          #browsers,
          #ecosystem,
          #faq {
            display: none !important;
          }
          .section-rail li:has(a[href="#demo"]),
          .section-rail li:has(a[href="#interface"]),
          .section-rail li:has(a[href="#browsers"]),
          .section-rail li:has(a[href="#ecosystem"]),
          .section-rail li:has(a[href="#faq"]) {
            display: none !important;
          }
        `}</style>
        {children}
      </body>
    </html>
  );
}
