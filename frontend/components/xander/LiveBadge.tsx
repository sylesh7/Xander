/** Pulsing acid dot + "LIVE" — for anything polling. */
export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 font-tele text-[0.66rem] font-bold tracking-[0.16em] text-acid uppercase">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping bg-acid opacity-75" />
        <span className="relative inline-flex h-2 w-2 bg-acid" />
      </span>
      Live
    </span>
  )
}
