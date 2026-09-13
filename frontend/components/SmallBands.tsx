export default function SmallBands() {
  return (
    <section
      id="the-problem"
      className="border-t-[3px] border-signal bg-hard px-[var(--gutter)] py-[clamp(3.4rem,8vw,6.5rem)] text-paper"
    >
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-6 text-paper">
          <b className="font-bold text-paper">CH 01</b>
          <span>The problem</span>
          <span className="bar" />
          <span>four airdrops, one repeated failure</span>
        </div>

        <div className="grid items-end gap-8 lg:grid-cols-[1.25fr_.75fr] lg:gap-14">
          <div>
            <p className="mb-4 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-paper uppercase">
              Not a hypothetical. A repeated, documented failure.
            </p>
            <h2 className="mb-5 max-w-[14ch] font-shout text-[clamp(2.7rem,7vw,5.2rem)] leading-[0.88] tracking-[-0.02em] uppercase">
              Flagged. Not explained.
            </h2>
            <p className="max-w-[60ch] text-[1.05rem] leading-[1.7] text-paper/80">
              LayerZero flagged over 800,000 sybil addresses. Linea&apos;s sweep initially caught
              over half its eligible wallets before walking most of that back. Arbitrum&apos;s
              shared-funding heuristic restricted real users who happened to withdraw from the
              same exchange. None of it came with a reason a flagged wallet — or an outside
              reviewer — could actually inspect.
            </p>
          </div>

          <div className="border-[3px] border-signal bg-paper p-6 text-ink shadow-[8px_8px_0_var(--color-signal)]">
            <p className="m-0 font-tele text-[0.66rem] font-bold tracking-[0.18em] text-signal uppercase">
              The fix
            </p>
            <p className="mt-3 mb-1 font-shout text-[clamp(3.4rem,8vw,5.6rem)] leading-none tabular-nums">
              0.85
            </p>
            <p className="m-0 font-tele text-[0.68rem] tracking-[0.12em] text-dim uppercase">
              the ceiling this model will ever return — never sold as a normalized 1.0
            </p>
            <p className="mt-5 mb-0 text-[0.95rem] leading-[1.6] text-dim">
              A known-funder registry — 10 labeled bridge contracts, 100 exchange hot wallets —
              is checked before a shared funding source ever counts against a wallet. Labelled
              and unlabelled funders are scored separately, and the higher wins.
            </p>
            <a
              href="#evidence"
              className="dn-split mt-6 inline-block border border-hard bg-hard px-5 py-3 font-tele text-[0.72rem] font-bold tracking-[0.16em] text-paper uppercase no-underline"
            >
              See the risk model →
            </a>
          </div>
        </div>

        <div className="mt-10 border-y border-[#3a3530] py-5">
          <p className="mb-5 font-tele text-[0.66rem] font-bold tracking-[0.2em] text-paper uppercase">
            Four campaigns, the same failure
          </p>
          <div className="grid border-l border-[#3a3530] sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                num: '01 / LayerZero',
                title: '800,000 flagged.',
                body: 'May 2024 — out of a 1.28M-wallet eligible pool, with a CEO-acknowledged amnesty program on top.',
              },
              {
                num: '02 / Linea',
                title: '137,000-wallet gap.',
                body: '50.45% initially flagged, walked back to 39.85% — the cost of a detector nobody could ask "why me?"',
              },
              {
                num: '03 / Arbitrum',
                title: 'Real users caught.',
                body: 'Shared-funding clustering, no exchange or bridge exclusion list — the exact signal this registry now guards.',
              },
              {
                num: '04 / LayerZero bounty',
                title: 'Thousands, forgiven.',
                body: 'A bounty for human-reported sybils produced false positives that had to be reversed after the fact.',
              },
            ].map((col) => (
              <div key={col.num} className="border-r border-[#3a3530] px-4 py-4">
                <span className="font-tele text-[0.62rem] tracking-[0.16em] text-paper/60 uppercase">
                  {col.num}
                </span>
                <p className="mt-2 mb-0 font-shout text-[1.8rem] leading-none uppercase">{col.title}</p>
                <p className="mt-2 mb-0 text-[0.88rem] leading-relaxed text-paper/65">{col.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
