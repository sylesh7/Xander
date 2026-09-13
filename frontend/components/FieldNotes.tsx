export default function FieldNotes() {
  return (
    <section id="docs" className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 06</b>
          <span>Docs</span>
          <span className="bar" />
          <span>every claim has a receipt</span>
        </div>
        <div className="grid items-start gap-6 md:grid-cols-[1.1fr_1fr] md:gap-12">
          <h2 className="font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
            Nothing here is asserted twice.
          </h2>
          <div>
            <a
              href="https://github.com/sylesh7/Xander/tree/main/backend/docs"
              target="_blank"
              rel="noopener"
              className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              Read the docs →
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
