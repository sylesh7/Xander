export default function RescueTeaser() {
  return (
    <section id="fail-closed" className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 03</b>
          <span>Fail-closed design</span>
          <span className="bar" />
          <span>never a silent allow</span>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12">
          <h2 className="font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
            A stale query never becomes a yes.
          </h2>
          <div>
            <p className="mb-3 max-w-[var(--measure)]">
              A stale Graph query, an unhealthy deployment, a timed-out World verification — none
              of these resolve to ALLOW. They resolve to PENDING_REVIEW. An unknown wallet is not
              a safe wallet; absence of history is missing evidence, never a clean record.
            </p>
            <a
              href="#build-status"
              className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              See the claim flow →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
