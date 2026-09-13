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
        A Graph-native, cross-protocol coordinated-actor risk engine, with World Selfie Check as a selective escalation layer.
      </h1>
      <p className="mt-2 font-tele text-[0.68rem] tracking-[0.16em] text-faint uppercase">
        Go ahead, drag the sign. Hold it down and watch what happens.
      </p>

      <div className="mt-12 grid gap-6 border-t-[3px] border-hard pt-8 md:grid-cols-[1.35fr_1fr] md:gap-16">
        <h2 className="font-shout text-[clamp(2.1rem,5.4vw,3.5rem)] leading-[0.95] tracking-[-0.01em] uppercase">
          Provenance first. Never a guess.
        </h2>
        <div>
          <p className="mb-4 max-w-[var(--measure)]">
            Xander is a Graph-native risk engine built for{' '}
            <strong className="font-bold">ETHOnline 2026</strong> — it turns live on-chain
            evidence into a deterministic, explainable score per wallet or cluster, and escalates
            to a biometric check only when that score actually earns it.
          </p>
          <p className="max-w-[var(--measure)] text-dim">
            Every fact behind a score — a transfer, a deposit, a borrow — is pulled live from The
            Graph and stored with its source, its deployment, and its block number attached.
            Nothing is inferred or fabricated.
          </p>
        </div>
      </div>

      <a
        href="#try-it"
        className="dn-split mt-8 flex w-fit items-center gap-4 border-[3px] border-signal bg-paper-2 px-5 py-4 text-ink no-underline"
      >
        <span className="font-tele text-[0.66rem] font-bold tracking-[0.18em] text-signal uppercase">Live proof</span>
        <span className="font-shout text-[clamp(1.2rem,2.8vw,1.7rem)] leading-none uppercase">
          Query the real subgraph →
        </span>
      </a>
    </>
  )
}
