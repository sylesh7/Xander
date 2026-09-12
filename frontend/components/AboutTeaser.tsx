import PosterSVG from './PosterSVG'

export default function AboutTeaser() {
  return (
    <section className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 04</b>
          <span>About</span>
          <span className="bar" />
          <span>the person on the other end</span>
        </div>

        <div className="grid items-center gap-8 md:grid-cols-[1fr_1.1fr] md:gap-12">
          <div>
            <h2 className="mb-3 font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
              A small studio, a lot of miles.
            </h2>
            <p className="mb-3 max-w-[var(--measure)]">
              Led by Dane Petersen — building since 2013, Drupal to .NET, native mobile to cloud, with two
              contrib modules on drupal.org and a canoe in the garage. Small studio, big lakes: you talk to the
              senior lead, never an account layer.
            </p>
            <a
              href="/about"
              className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              Meet Dane →
            </a>
          </div>

          <div>
            <div className="dn-tilt overflow-hidden border border-rule bg-paper-2">
              <PosterSVG />
            </div>
            <p className="mt-2 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">
              The Twin Cities in noir-o-vision — hover to lock the signal
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
