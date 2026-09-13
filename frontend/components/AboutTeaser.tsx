import PosterSVG from './PosterSVG'

export default function AboutTeaser() {
  return (
    <section id="team" className="border-t border-rule px-[var(--gutter)] py-[clamp(2.8rem,6vw,4.5rem)]">
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-5">
          <b className="font-bold text-signal">CH 05</b>
          <span>Team</span>
          <span className="bar" />
          <span>two tracks, one locked interface</span>
        </div>

        <div className="grid items-center gap-8 md:grid-cols-[1fr_1.1fr] md:gap-12">
          <div>
            <h2 className="mb-3 font-shout text-[clamp(1.9rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.01em] uppercase">
              Two people. One seam between them.
            </h2>
            <p className="mb-3 max-w-[var(--measure)]">
              Suganthan owns the Evidence & Risk Engine — Token API, Subgraphs, Substreams,
              clustering, scoring (Phases 1–12). Sylesh owns Decision, Escalation & API — the
              Subgraph MCP investigator, World ID Selfie Check, policy engine, the Claim Gate
              (Phases 13–25). The two tracks meet at exactly one interface: <code>getOrComputeClusterRisk</code>,
              <code> refreshWalletEvidence</code>, and the <code>risk-invalidation</code> queue. Built for
              ETHOnline 2026.
            </p>
            <a
              href="https://github.com/sylesh7/Xander/blob/main/backend/docs/EVIDENCE-RISK-INTERFACE.md"
              target="_blank"
              rel="noopener"
              className="dn-split inline-flex min-h-6 items-center font-tele text-[0.78rem] font-bold tracking-[0.16em] text-ink uppercase no-underline"
            >
              See the interface →
            </a>
          </div>

          <div>
            <div className="dn-tilt overflow-hidden border border-rule bg-paper-2">
              <PosterSVG />
            </div>
            <p className="mt-2 font-tele text-[0.6rem] tracking-[0.14em] text-faint uppercase">
              The evidence trail, in noir-o-vision — hover to lock the signal
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
