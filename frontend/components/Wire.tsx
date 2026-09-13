export default function Wire() {
  return (
    <section
      aria-label="New at the station"
      className="border-t border-rule bg-paper-2 px-[var(--gutter)] py-4"
    >
      <div className="mx-auto grid max-w-[1140px] items-baseline gap-x-10 gap-y-2.5 md:grid-cols-[auto_1fr_1fr_1fr]">
        <span className="font-tele text-[0.66rem] font-bold tracking-[0.22em] text-faint uppercase">
          On the wire
        </span>

        <a
          href="https://api.studio.thegraph.com/query/1758823/xander/v0.0.3"
          target="_blank"
          rel="noopener"
          className="group font-tele text-[0.76rem] leading-relaxed tracking-[0.05em] text-ink uppercase no-underline"
        >
          <b className="mr-1.5 font-bold text-acid">THE GRAPH</b>
          <span className="underline decoration-rule underline-offset-4 transition-colors group-hover:decoration-current">
            Live subgraph synced at v0.0.3 on Base Sepolia — query real USDC transfers
          </span>
          <time dateTime="2026-09-12" className="ml-1.5 text-[0.64rem] tracking-[0.14em] whitespace-nowrap text-faint">
            SEP 12
          </time>
        </a>

        <a
          href="#build-status"
          className="group font-tele text-[0.76rem] leading-relaxed tracking-[0.05em] text-ink uppercase no-underline"
        >
          <b className="mr-1.5 font-bold text-acid">WORLD ID</b>
          <span className="underline decoration-rule underline-offset-4 transition-colors group-hover:decoration-current">
            A real phone completed a real Selfie Check, verified end to end
          </span>
          <time dateTime="2026-09-09" className="ml-1.5 text-[0.64rem] tracking-[0.14em] whitespace-nowrap text-faint">
            SEP 09
          </time>
        </a>

        <a
          href="#build-status"
          className="group font-tele text-[0.76rem] leading-relaxed tracking-[0.05em] text-ink uppercase no-underline"
        >
          <b className="mr-1.5 font-bold text-acid">TEST SUITE</b>
          <span className="underline decoration-rule underline-offset-4 transition-colors group-hover:decoration-current">
            330 tests passing, 0 failing — no module mocks anywhere
          </span>
          <time dateTime="2026-09-12" className="ml-1.5 text-[0.64rem] tracking-[0.14em] whitespace-nowrap text-faint">
            SEP 12
          </time>
        </a>
      </div>
    </section>
  )
}
