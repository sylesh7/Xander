export default function ServicesTeaser() {
  return (
    <section className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 02</b>
          <span>What we do</span>
          <span className="bar" />
          <span>prices published</span>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12">
          <h2 className="font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
            Your project gets the good seat.
          </h2>
          <div>
            <p className="mb-3 max-w-[var(--measure)]">
              Builds, commerce, mobile apps, APIs and ERP integrations, custom .NET, AI, testing, and the Air
              Time maintenance program — your project rides in the bow, not in a ticket queue. And every price
              is printed below, which sounds ordinary until you go looking for a second local shop that does it.
            </p>
            <p className="mb-5 max-w-[var(--measure)] font-tele text-[0.78rem] tracking-[0.08em] text-dim uppercase">
              Start with a $950 site health check · maintenance from $150/mo · every price on the page
            </p>
            <a
              href="/services"
              className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              See services &amp; prices →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
