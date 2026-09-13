/**
 * The designed refusal (frontend spec §3, Rule 3). BLOCK, REVIEW, 402, 403, 409,
 * 429 are all the product working, not an error toast — they get a screen with
 * a reason and what the user can do next.
 */
export function ReasonPanel({
  outcome,
  code,
  summary,
  next,
}: {
  outcome: string
  code?: string | null
  summary: string
  next?: string
}) {
  return (
    <div className="border-[3px] border-hard bg-paper-2 p-6">
      <div className="mb-2 font-shout text-[clamp(1.8rem,4vw,2.6rem)] leading-none uppercase">{outcome}</div>
      {code ? <div className="mb-3 font-tele text-[0.72rem] tracking-[0.16em] text-dim uppercase">{code}</div> : null}
      <p className="mb-0 max-w-[60ch] text-[0.95rem] leading-[1.6] text-ink">{summary}</p>
      {next ? (
        <p className="mt-4 mb-0 max-w-[60ch] font-tele text-[0.78rem] leading-relaxed text-dim uppercase tracking-[0.04em]">
          → {next}
        </p>
      ) : null}
    </div>
  )
}
