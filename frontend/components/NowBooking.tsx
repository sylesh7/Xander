export default function NowBooking() {
  return (
    <section id="ethonline" className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 08</b>
          <span>ETHOnline 2026</span>
          <span className="bar" />
          <span>two sponsor tracks</span>
        </div>

        <div className="grid items-center gap-8 border-l-[3px] border-signal bg-paper-2 px-6 py-6 md:grid-cols-[1fr_1.05fr] md:gap-10">
          <div>
            <p className="m-0 font-shout text-[clamp(1.4rem,3.2vw,2rem)] uppercase">
              <span className="text-signal" aria-hidden="true">●</span> Built for ETHOnline 2026
            </p>
            <p className="m-0 mt-1 max-w-[48ch] text-[0.95rem] text-dim">
              Targeting two sponsor prizes: Best Use of Composable or Standardized Graph Products
              (The Graph, $5,000) and Selfie Check (World, $7,000 pool across up to 3 teams).
            </p>
            <div className="mt-5 flex flex-wrap gap-4">
              <a
                href="https://github.com/sylesh7/Xander"
                target="_blank"
                rel="noopener"
                className="dn-split border border-hard bg-hard px-6 py-3 font-tele text-[0.74rem] font-bold tracking-[0.18em] text-paper uppercase no-underline"
              >
                Read the README
              </a>
              <a
                href="#team"
                className="dn-split border border-hard px-6 py-3 font-tele text-[0.74rem] font-bold tracking-[0.18em] text-ink uppercase no-underline"
              >
                See the architecture
              </a>
            </div>
          </div>

          <div>
            <div className="relative aspect-[19/12] w-full overflow-hidden border border-rule bg-[#0a0a0c] flex flex-col items-center justify-center gap-2 p-6 text-center">
              <span className="font-tele text-[0.62rem] tracking-[0.22em] text-paper/50 uppercase">
                Prize tracks
              </span>
              <span className="font-shout text-[clamp(1.6rem,4vw,2.4rem)] leading-tight text-paper uppercase">
                The Graph · World
              </span>
              <span className="font-tele text-[0.7rem] tracking-[0.14em] text-paper/70 uppercase">
                $5,000 + $7,000 pool
              </span>
            </div>
            <p className="mt-2 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">
              The prize tracks this build is aimed at — not a neon sign
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
