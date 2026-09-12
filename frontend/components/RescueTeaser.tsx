export default function RescueTeaser() {
  return (
    <section className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 02</b>
          <span>Rescue</span>
          <span className="bar" />
          <span>for the site nobody wants to touch</span>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12">
          <h2 className="font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
            We support sites we didn&apos;t build. Whoever built them.
          </h2>
          <div>
            <p className="mb-3 max-w-[var(--measure)]">
              Builder&apos;s gone, updates stopped, everyone quotes a rebuild? Think of a rescue like a portage:
              heavy for a stretch, then the lake opens up. A $2,500 flat assessment tells you what you actually
              have before you commit to anything.
            </p>
            <a
              href="/rescue"
              className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              How a rescue runs →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
