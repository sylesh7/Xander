export default function Contact() {
  return (
    <section className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 08</b>
          <span>Contact</span>
          <span className="bar" />
          <span>say hi — it goes to a person</span>
        </div>

        <div className="grid items-start gap-x-12 gap-y-8 md:grid-cols-2">
          <div>
            <h2 className="font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
              Start the next thing.
            </h2>
            <a
              href="mailto:hello@deadnorth.io"
              className="dn-split mt-6 inline-flex min-h-6 items-center font-noir text-[clamp(1.35rem,3.4vw,2rem)] leading-none decoration-signal decoration-2 underline-offset-[0.22em]"
            >
              hello@deadnorth.io
            </a>
            <a
              href="/contact"
              className="dn-split mt-4 flex min-h-6 w-fit items-center gap-2 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              Go to the contact form →
            </a>
          </div>

          <p className="max-w-[var(--measure)] text-dim md:pt-2">
            Describe it roughly — rough is enough for a real answer, not a discovery call. Not sure it&apos;s
            my kind of project? Send it anyway: the first thing you get is honest advice, even when the honest
            advice is &quot;don&apos;t hire me.&quot;
          </p>
        </div>
      </div>
    </section>
  )
}
