export default function Wire() {
  return (
    <section
      aria-label="New at the station"
      className="border-t border-rule bg-paper-2 px-[var(--gutter)] py-4"
    >
      <div className="mx-auto grid max-w-[1140px] items-baseline gap-x-10 gap-y-2.5 md:grid-cols-[auto_1fr_1fr_1fr]">
        <span className="font-tele text-[0.66rem] font-bold tracking-[0.22em] text-faint uppercase">
          On the wire
        </span>

        <a
          href="/lab/vacancy"
          className="group font-tele text-[0.76rem] leading-relaxed tracking-[0.05em] text-ink uppercase no-underline"
        >
          <b className="mr-1.5 font-bold text-acid">THE LAB</b>
          <span className="underline decoration-rule underline-offset-4 transition-colors group-hover:decoration-current">
            Vacancy — the Three.js roadside sign
          </span>
          <time dateTime="2026-08-11" className="ml-1.5 text-[0.64rem] tracking-[0.14em] whitespace-nowrap text-faint">
            AUG 11
          </time>
        </a>

        <a
          href="/notes/long-strange-trip-13-dead-north/"
          className="group font-tele text-[0.76rem] leading-relaxed tracking-[0.05em] text-ink uppercase no-underline"
        >
          <b className="mr-1.5 font-bold text-acid">FIELD NOTES</b>
          <span className="underline decoration-rule underline-offset-4 transition-colors group-hover:decoration-current">
            Long Strange Trip XIII: Dead North (2026)
          </span>
          <time dateTime="2026-08-14" className="ml-1.5 text-[0.64rem] tracking-[0.14em] whitespace-nowrap text-faint">
            AUG 14
          </time>
        </a>

        <a
          href="/tutorials/debug-drupal-commerce-price-and-promotion-problems/"
          className="group font-tele text-[0.76rem] leading-relaxed tracking-[0.05em] text-ink uppercase no-underline"
        >
          <b className="mr-1.5 font-bold text-acid">SHOP CLASS</b>
          <span className="underline decoration-rule underline-offset-4 transition-colors group-hover:decoration-current">
            How to debug Drupal Commerce price and promotion problems
          </span>
          <time dateTime="2026-07-30" className="ml-1.5 text-[0.64rem] tracking-[0.14em] whitespace-nowrap text-faint">
            JUL 30
          </time>
        </a>
      </div>
    </section>
  )
}
