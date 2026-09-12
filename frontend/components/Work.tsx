import Image from 'next/image'

function CaseFilePlaceholder({ num, label }: { num: string; label: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex aspect-[16/9] w-full flex-col justify-between border border-rule bg-paper-2 p-4 mb-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-tele text-[0.6rem] tracking-[0.22em] text-faint uppercase">Case file</span>
        <span className="dn-slate-bars block h-[3px] flex-1" />
      </div>
      <span className="font-shout text-[clamp(2.6rem,7vw,3.6rem)] leading-[0.8] text-faint tabular-nums">
        {num}
      </span>
      <span className="font-tele text-[0.6rem] leading-[1.5] tracking-[0.16em] text-faint uppercase">
        {label}
      </span>
    </div>
  )
}

export default function Work() {
  return (
    <section className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 03</b>
          <span>Selected work</span>
          <span className="bar" />
          <a href="/work" className="dn-split text-ink no-underline">See all recent work →</a>
        </div>

        <h2 className="mb-2 font-shout text-[clamp(2.2rem,6vw,3.8rem)] leading-[0.92] tracking-[-0.015em] text-balance uppercase">
          Things that have to work
        </h2>
        <p className="mb-6 max-w-[54ch] font-noir text-[clamp(1.1rem,2.2vw,1.35rem)] leading-[1.5] text-dim">
          The house principles: improvise where you can, rehearse where you must, and take care of the people
          in the room.
        </p>

        <div className="mb-8 flex flex-wrap gap-x-12 gap-y-5">
          {[
            { stat: '327', label: 'production sites watched' },
            { stat: '78', label: 'sites running our open source' },
            { stat: 'Millions', label: 'of records moved · zero lost' },
          ].map((s) => (
            <div key={s.label}>
              <span className="dn-ignite block font-shout text-[clamp(1.9rem,4.8vw,2.8rem)] leading-none tabular-nums">
                {s.stat}
              </span>
              <span className="font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">{s.label}</span>
            </div>
          ))}
        </div>

        <ol className="grid list-none gap-px border border-rule bg-rule p-0 md:grid-cols-3">
          {/* Card 1 — Still On Tour */}
          <li className="dn-lock group bg-paper p-6">
            <Image
              src="/assets/work-still-on-tour.webp"
              alt="Screenshot of Still On Tour"
              width={2800}
              height={960}
              sizes="(min-width: 768px) 33vw, 100vw"
              className="block aspect-[16/9] w-full border border-rule object-cover object-top mb-4"
              loading="lazy"
            />
            <div className="mb-3 flex items-baseline justify-between font-tele text-[0.66rem] tracking-[0.16em] uppercase">
              <span className="text-signal">CH 01</span>
              <span className="text-faint tabular-nums">2026</span>
            </div>
            <h3 className="mb-1 font-shout text-2xl leading-none uppercase">
              <a
                href="https://stillontour.com"
                target="_blank"
                rel="noopener"
                className="dn-split text-ink no-underline"
              >
                Still On Tour<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </h3>
            <p className="mb-3 font-tele text-[0.68rem] tracking-[0.14em] text-faint uppercase">
              Design + build — a Dead North project
            </p>
            <p className="mb-4 text-[0.92rem] leading-[1.5] text-dim">
              A full social platform for a live-music community — member accounts, profiles, friend requests,
              direct messages, crews, show walls, trips, ride and crash-space coordination, band workspaces, and
              a living concert archive giving every connection a shared place and time.
            </p>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {['Drupal 11', 'Next.js', 'TypeScript', 'MariaDB', 'Cloudflare'].map((t) => (
                <li key={t} className="border border-rule px-2 py-[0.15rem] font-tele text-[0.62rem] tracking-[0.12em] text-dim uppercase">
                  {t}
                </li>
              ))}
            </ul>
          </li>

          {/* Card 2 — V.I.N.CENT */}
          <li className="dn-lock group bg-paper p-6">
            <CaseFilePlaceholder num="02" label="Board shown in the case file" />
            <div className="mb-3 flex items-baseline justify-between font-tele text-[0.66rem] tracking-[0.16em] uppercase">
              <span className="text-signal">CH 02</span>
              <span className="text-faint tabular-nums">2026</span>
            </div>
            <h3 className="mb-1 font-shout text-2xl leading-none uppercase">
              <a href="/work/vincent" className="dn-split text-ink no-underline">V.I.N.CENT</a>
            </h3>
            <p className="mb-3 font-tele text-[0.68rem] tracking-[0.14em] text-faint uppercase">Design + build</p>
            <p className="mb-4 text-[0.92rem] leading-[1.5] text-dim">
              A fleet-monitoring platform watching 327 production sites — statistical anomaly detection against
              each site&apos;s own history, an archive of what the host discards, and one rule everywhere: an
              unchecked site must never look healthy.
            </p>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {['Drupal 11', 'Next.js', 'Pantheon'].map((t) => (
                <li key={t} className="border border-rule px-2 py-[0.15rem] font-tele text-[0.62rem] tracking-[0.12em] text-dim uppercase">
                  {t}
                </li>
              ))}
            </ul>
          </li>

          {/* Card 3 — The Migration */}
          <li className="dn-lock group bg-paper p-6">
            <CaseFilePlaceholder num="03" label="No UI — the work was underneath" />
            <div className="mb-3 flex items-baseline justify-between font-tele text-[0.66rem] tracking-[0.16em] uppercase">
              <span className="text-signal">CH 03</span>
              <span className="text-faint tabular-nums">2023</span>
            </div>
            <h3 className="mb-1 font-shout text-2xl leading-none uppercase">
              <a href="/work/the-migration" className="dn-split text-ink no-underline">The Migration</a>
            </h3>
            <p className="mb-3 font-tele text-[0.68rem] tracking-[0.14em] text-faint uppercase">Sole technical lead</p>
            <p className="mb-4 text-[0.92rem] leading-[1.5] text-dim">
              A monolithic Drupal 7 application with millions of nodes, rebuilt as Drupal 10 while the site kept
              publishing — custom migration paths, counts reconciled every run, zero records lost.
            </p>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {['Drupal 7→10', 'Migrate API', 'Behat'].map((t) => (
                <li key={t} className="border border-rule px-2 py-[0.15rem] font-tele text-[0.62rem] tracking-[0.12em] text-dim uppercase">
                  {t}
                </li>
              ))}
            </ul>
          </li>
        </ol>

        <p className="mt-6">
          <a
            href="/work"
            className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
          >
            See all recent work →
          </a>
        </p>
      </div>
    </section>
  )
}
