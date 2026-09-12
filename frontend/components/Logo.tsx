export default function Logo({ id = 'dn-mk-nav' }: { id?: string }) {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 200 200" className="mr-1.5 inline-block -translate-y-[2px]">
      <defs>
        <clipPath id={id}>
          <circle cx="100" cy="100" r="88" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <path d="M-20 -20 H220 L-20 220 Z" fill="var(--color-signal)" />
        <path d="M220 -20 V220 H-20 Z" fill="currentColor" />
      </g>
      <circle cx="100" cy="100" r="88" fill="none" stroke="currentColor" strokeWidth="10" />
      <polygon
        points="101,8 121,52 105,58 125,108 109,114 129,162 93,190 81,140 97,134 77,84 93,78 73,28 89,22"
        fill="var(--color-paper)"
      />
    </svg>
  )
}
