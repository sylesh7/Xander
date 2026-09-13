export default function ServicesTeaser() {
  return (
    <section id="evidence" className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 02</b>
          <span>Evidence layer</span>
          <span className="bar" />
          <span>one query pattern, four Graph products</span>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12">
          <h2 className="font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
            One pipeline. Four Graph products.
          </h2>
          <div>
            <p className="mb-3 max-w-[var(--measure)]">
              Token API, Standardized Subgraphs, Substreams, and Subgraph MCP compose into one
              evidence pipeline — driven by one schema-family query pattern reused across every
              protocol supported. That reuse, not any single API call, is the actual
              composability claim.
            </p>
            <p className="mb-5 max-w-[var(--measure)] font-tele text-[0.78rem] tracking-[0.08em] text-dim uppercase">
              Token API · Standardized Subgraphs · Substreams · Subgraph MCP
            </p>
            <a
              href="#try-it"
              className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              See how each product is used →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
