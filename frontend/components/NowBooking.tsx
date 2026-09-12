import Image from 'next/image'

export default function NowBooking() {
  return (
    <section className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 07</b>
          <span>Now booking</span>
          <span className="bar" />
          <span>the lamp is on</span>
        </div>

        <div className="grid items-center gap-8 border-l-[3px] border-signal bg-paper-2 px-6 py-6 md:grid-cols-[1fr_1.05fr] md:gap-10">
          <div>
            <p className="m-0 font-shout text-[clamp(1.4rem,3.2vw,2rem)] uppercase">
              <span className="text-signal" aria-hidden="true">●</span> Now booking · Fall 2026
            </p>
            <p className="m-0 mt-1 max-w-[48ch] text-[0.95rem] text-dim">
              Projects and Air Time seats both. The roster stays small on purpose — when it&apos;s full,
              it&apos;s full. The sign out front runs on the same truth, and it&apos;s already burning.
            </p>
            <div className="mt-5 flex flex-wrap gap-4">
              <a
                href="/contact"
                className="dn-split border border-hard bg-hard px-6 py-3 font-tele text-[0.74rem] font-bold tracking-[0.18em] text-paper uppercase no-underline"
              >
                Start a project
              </a>
              <a
                href="/services"
                className="dn-split border border-hard px-6 py-3 font-tele text-[0.74rem] font-bold tracking-[0.18em] text-ink uppercase no-underline"
              >
                See the plans
              </a>
            </div>
          </div>

          <div>
            <div className="relative aspect-[19/12] w-full overflow-hidden border border-rule bg-[#0a0a0c]">
              <Image
                src="/assets/vacancy-poster.webp"
                alt="A 1950s roadside motel sign for Dead North at night: DEAD NORTH in red neon, an amber panel reading Now booking · Fall 2026, chase lights on a googie arrow."
                fill
                className="object-cover"
                loading="lazy"
              />
            </div>
            <p className="mt-2 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">
              The roadside sign, from{' '}
              <a href="/lab/vacancy" className="dn-split text-ink">the lab</a> — it wakes when you get here
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
