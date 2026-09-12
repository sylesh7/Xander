export default function SmallBands() {
  return (
    <section
      id="small-bands"
      className="border-t-[3px] border-signal bg-hard px-[var(--gutter)] py-[clamp(3.4rem,8vw,6.5rem)] text-paper"
    >
      <div className="mx-auto max-w-[1140px]">
        <div className="dn-rail mb-6 text-paper">
          <b className="font-bold text-paper">CH 01</b>
          <span>Dead North gives back</span>
          <span className="bar" />
          <span>for independent small bands</span>
        </div>

        <div className="grid items-end gap-8 lg:grid-cols-[1.25fr_.75fr] lg:gap-14">
          <div>
            <p className="mb-4 font-tele text-[0.7rem] font-bold tracking-[0.2em] text-paper uppercase">
              Not a limited promotion. A standing program.
            </p>
            <h2 className="mb-5 max-w-[14ch] font-shout text-[clamp(2.7rem,7vw,5.2rem)] leading-[0.88] tracking-[-0.02em] uppercase">
              Small band. Proper stage.
            </h2>
            <p className="max-w-[60ch] text-[1.05rem] leading-[1.7] text-paper/80">
              Independent small bands should not have to choose between a generic link page and a five-figure
              agency site. Dead North builds a fast, distinctive home for your music, shows, and story — because
              the local music ecosystem is worth showing up for.
            </p>
          </div>

          <div className="border-[3px] border-signal bg-paper p-6 text-ink shadow-[8px_8px_0_var(--color-signal)]">
            <p className="m-0 font-tele text-[0.66rem] font-bold tracking-[0.18em] text-signal uppercase">
              The give-back price
            </p>
            <p className="mt-3 mb-1 font-shout text-[clamp(3.4rem,8vw,5.6rem)] leading-none tabular-nums">
              $1,500
            </p>
            <p className="m-0 font-tele text-[0.68rem] tracking-[0.12em] text-dim uppercase">
              75% below the $6,000 standard scope
            </p>
            <p className="mt-5 mb-0 text-[0.95rem] leading-[1.6] text-dim">
              Four pages — home, shows, music, press — plus launch help and a free Still On Tour band-portal
              setup session.
            </p>
            <a
              href="/bands"
              className="dn-split mt-6 inline-block border border-hard bg-hard px-5 py-3 font-tele text-[0.72rem] font-bold tracking-[0.16em] text-paper uppercase no-underline"
            >
              See the small-band program →
            </a>
          </div>
        </div>

        <div className="mt-10 border-y border-[#3a3530] py-5">
          <p className="mb-5 font-tele text-[0.66rem] font-bold tracking-[0.2em] text-paper uppercase">
            A site with a job to do
          </p>
          <div className="grid border-l border-[#3a3530] sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                num: '01 / Home',
                title: 'Make the case.',
                body: 'What the band sounds like, looks like, and why someone should stay.',
              },
              {
                num: '02 / Shows',
                title: 'Fill the room.',
                body: 'A clean, current place to find the next date and get out the door.',
              },
              {
                num: '03 / Music',
                title: 'Press play.',
                body: 'Your releases, embeds, and links without a platform swallowing the story.',
              },
              {
                num: '04 / Press',
                title: 'Get booked.',
                body: 'Bio, photo, links, and practical details for the people putting bills together.',
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
