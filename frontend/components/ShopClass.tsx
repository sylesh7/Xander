export default function ShopClass() {
  return (
    <section id="try-it" className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 07</b>
          <span>Try it live</span>
          <span className="bar" />
          <span>no setup, no mocks</span>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12">
          <h2 className="font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
            Query it yourself. No setup.
          </h2>
          <div>
            <p className="mb-3 max-w-[var(--measure)]">
              The <code>xander</code> subgraph is deployed and fully synced on Base Sepolia at
              v0.0.3 — open the GraphiQL playground and pull the five most recent real USDC
              Transfer events, live, with no fixture data involved.
            </p>
            <a
              href="https://api.studio.thegraph.com/query/1758823/xander/v0.0.3"
              target="_blank"
              rel="noopener"
              className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              Open the GraphiQL playground →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
