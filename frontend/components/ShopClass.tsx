export default function ShopClass() {
  return (
    <section className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 06</b>
          <span>Shop class</span>
          <span className="bar" />
          <span>step-by-step, no gatekeeping</span>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12">
          <h2 className="font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
            Learn it the way we do it.
          </h2>
          <div>
            <p className="mb-3 max-w-[var(--measure)]">
              How-to tutorials from the workbench — Drupal security updates done safely, WordPress updates that
              don&apos;t break the site, backups that provably restore. The same procedures we run for clients,
              published with the commands included.
            </p>
            <a
              href="/tutorials/"
              className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              Into the shop →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
