import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Textmode Overlay | Turn the web into textmode',
  description:
    'A free browser extension that turns visible canvas and video elements into live ASCII and textmode art.',
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
        {children}
      </body>
    </html>
  );
}
