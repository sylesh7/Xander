export default function Contact() {
  return (
    <section id="contact" className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 09</b>
          <span>Explore it</span>
          <span className="bar" />
          <span>don&apos;t take our word for it</span>
        </div>

        <div className="grid items-start gap-x-12 gap-y-8 md:grid-cols-2">
          <div>
            <h2 className="font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
              See it. Don&apos;t take our word for it.
            </h2>
            <a
              href="https://github.com/sylesh7/Xander"
              target="_blank"
              rel="noopener"
              className="dn-split mt-6 inline-flex min-h-6 items-center font-noir text-[clamp(1.35rem,3.4vw,2rem)] leading-none decoration-signal decoration-2 underline-offset-[0.22em]"
            >
              github.com/sylesh7/Xander
            </a>
            <a
              href="https://api.studio.thegraph.com/query/1758823/xander/v0.0.3"
              target="_blank"
              rel="noopener"
              className="dn-split mt-4 flex min-h-6 w-fit items-center gap-2 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              Query the live subgraph →
            </a>
          </div>

          <p className="max-w-[var(--measure)] text-dim md:pt-2">
            Every score traces back to a real transfer, a real block number, and a real
            deployment. Start with the README, or go straight to the data — nothing here is
            inferred or fabricated.
          </p>
        </div>
      </div>
    </section>
  )
}
