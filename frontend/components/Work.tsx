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
    <section id="build-status" className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 04</b>
          <span>Build status</span>
          <span className="bar" />
          <a href="https://github.com/sylesh7/Xander" target="_blank" rel="noopener" className="dn-split text-ink no-underline">Read the full README →</a>
        </div>

        <h2 className="mb-2 font-shout text-[clamp(2.2rem,6vw,3.8rem)] leading-[0.92] tracking-[-0.015em] text-balance uppercase">
          Verified live. Not from memory.
        </h2>
        <p className="mb-6 max-w-[54ch] font-noir text-[clamp(1.1rem,2.2vw,1.35rem)] leading-[1.5] text-dim">
          Every claim below was checked against a real Postgres, a real Redis, a real chain, and
          a real phone — not asserted in a spec and left there.
        </p>

        <div className="mb-8 flex flex-wrap gap-x-12 gap-y-5">
          {[
            { stat: '330', label: 'tests passing, 0 failing' },
            { stat: '4+', label: 'live Subgraph deployments, 2 chains' },
            { stat: '5', label: 'skipped only without live credentials' },
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
          {/* Card 1 — Coordinated cluster */}
          <li className="dn-lock group bg-paper p-6">
            <CaseFilePlaceholder num="01" label="Coordination signal, not a screenshot" />
            <div className="mb-3 flex items-baseline justify-between font-tele text-[0.66rem] tracking-[0.16em] uppercase">
              <span className="text-signal">CH 01</span>
              <span className="text-faint tabular-nums">2026</span>
            </div>
            <h3 className="mb-1 font-shout text-2xl leading-none uppercase">
              <a href="#evidence" className="dn-split text-ink no-underline">
                Coordinated cluster
              </a>
            </h3>
            <p className="mb-3 font-tele text-[0.68rem] tracking-[0.14em] text-faint uppercase">
              Funding + timing correlation
            </p>
            <p className="mb-4 text-[0.92rem] leading-[1.5] text-dim">
              A coordinated 5-wallet cluster scores BLOCK at ≈0.85 — the ceiling the model will
              ever return, because 0.15 is deliberately reserved rather than pretending the score
              is normalized to 1.0.
            </p>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {['Funding correlation', 'Timing correlation', 'Shared counterparty'].map((t) => (
                <li key={t} className="border border-rule px-2 py-[0.15rem] font-tele text-[0.62rem] tracking-[0.12em] text-dim uppercase">
                  {t}
                </li>
              ))}
            </ul>
          </li>

          {/* Card 2 — Clean wallet */}
          <li className="dn-lock group bg-paper p-6">
            <CaseFilePlaceholder num="02" label="No UI — the signal is the point" />
            <div className="mb-3 flex items-baseline justify-between font-tele text-[0.66rem] tracking-[0.16em] uppercase">
              <span className="text-signal">CH 02</span>
              <span className="text-faint tabular-nums">2026</span>
            </div>
            <h3 className="mb-1 font-shout text-2xl leading-none uppercase">
              <a href="#evidence" className="dn-split text-ink no-underline">Clean wallet</a>
            </h3>
            <p className="mb-3 font-tele text-[0.68rem] tracking-[0.14em] text-faint uppercase">Deterministic scoring</p>
            <p className="mb-4 text-[0.92rem] leading-[1.5] text-dim">
              The same five weighted features return ALLOW for a wallet with no coordination
              signal — no hardcoded exception, no manual override.
            </p>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {['Token API', 'Standardized Subgraphs', 'Postgres + Prisma'].map((t) => (
                <li key={t} className="border border-rule px-2 py-[0.15rem] font-tele text-[0.62rem] tracking-[0.12em] text-dim uppercase">
                  {t}
                </li>
              ))}
            </ul>
          </li>

          {/* Card 3 — Unknown wallet */}
          <li className="dn-lock group bg-paper p-6">
            <CaseFilePlaceholder num="03" label="Absence of evidence is not evidence of safety" />
            <div className="mb-3 flex items-baseline justify-between font-tele text-[0.66rem] tracking-[0.16em] uppercase">
              <span className="text-signal">CH 03</span>
              <span className="text-faint tabular-nums">2026</span>
            </div>
            <h3 className="mb-1 font-shout text-2xl leading-none uppercase">
              <a href="#fail-closed" className="dn-split text-ink no-underline">Unknown wallet</a>
            </h3>
            <p className="mb-3 font-tele text-[0.68rem] tracking-[0.14em] text-faint uppercase">Fail-closed policy</p>
            <p className="mb-4 text-[0.92rem] leading-[1.5] text-dim">
              A wallet Xander has no evidence for always resolves PENDING_REVIEW — never a
              confident ALLOW just because nothing bad was found.
            </p>
            <ul className="flex list-none flex-wrap gap-2 p-0">
              {['Freshness guard', 'World ID escalation', 'Provenance guard'].map((t) => (
                <li key={t} className="border border-rule px-2 py-[0.15rem] font-tele text-[0.62rem] tracking-[0.12em] text-dim uppercase">
                  {t}
                </li>
              ))}
            </ul>
          </li>
        </ol>

        <p className="mt-6">
          <a
            href="https://github.com/sylesh7/Xander"
            target="_blank"
            rel="noopener"
            className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
          >
            Read the full build status →
          </a>
        </p>
      </div>
    </section>
  )
}
