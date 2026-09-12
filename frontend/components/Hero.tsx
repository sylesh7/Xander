import NorthwaterSVG from './NorthwaterSVG'
import DeadNorthTuner from './DeadNorthTuner'

export default function Hero() {
  return (
    <>
      <div className="hero-northwater-banner">
        <NorthwaterSVG variant="hero" />
        <DeadNorthTuner />
      </div>

      <h1 className="mt-4 font-tele text-[clamp(0.82rem,1.6vw,1rem)] font-normal tracking-[0.14em] text-ink uppercase">
        Minneapolis web development — platforms, stores, and apps for organizations that can&apos;t afford downtime.
      </h1>
      <p className="mt-2 font-tele text-[0.68rem] tracking-[0.16em] text-faint uppercase">
        Minneapolis — go ahead, drag the sign. Hold it down and watch what happens.
      </p>

      <div className="mt-12 grid gap-6 border-t-[3px] border-hard pt-8 md:grid-cols-[1.35fr_1fr] md:gap-16">
        <h2 className="font-shout text-[clamp(2.1rem,5.4vw,3.5rem)] leading-[0.95] tracking-[-0.01em] uppercase">
          Dead-on work. Due-north advice.
        </h2>
        <div>
          <p className="mb-4 max-w-[var(--measure)]">
            Dead North is a small senior studio led by{' '}
            <strong className="font-bold">Dane Petersen</strong> — no junior bench, no handoffs, no account
            layer: the senior lead who quotes your project is the one who ships it. Minnesota-built, touring
            everywhere.
          </p>
          <p className="max-w-[var(--measure)] text-dim">
            Building since 2013 — Drupal to .NET, native mobile to cloud — the kind of miles where migrations
            land every record and checkouts stop dropping orders because we&apos;ve already seen every way they
            can. The launch is just the first set. The run is the show.
          </p>
        </div>
      </div>

      <a
        href="/bands"
        className="dn-split mt-8 flex w-fit items-center gap-4 border-[3px] border-signal bg-paper-2 px-5 py-4 text-ink no-underline"
      >
        <span className="font-tele text-[0.66rem] font-bold tracking-[0.18em] text-signal uppercase">Small bands</span>
        <span className="font-shout text-[clamp(1.2rem,2.8vw,1.7rem)] leading-none uppercase">
          A proper site for $1,500 →
        </span>
      </a>
    </>
  )
}
