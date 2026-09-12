export default function PosterSVG() {
  return (
    <svg
      className="poster"
      viewBox="0 0 840 500"
      role="img"
      aria-label="A film-noir postcard: a couple at a lakeshore — a woman in a red dress with a cigarette, a man in a suit and fedora — silhouetted against the Minneapolis and Saint Paul skylines across the water, under a full moon. The words DEAD NORTH run beneath."
    >
      {/* moon */}
      <circle className="moon" cx="120" cy="100" r="58" />
      <circle className="moon-crater" cx="102" cy="84" r="8" />
      <circle className="moon-crater" cx="138" cy="118" r="5.5" />
      <circle className="moon-crater" cx="128" cy="76" r="3.5" />

      {/* stars */}
      <g className="stars">
        <path d="M310 48 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3 z" />
        <path d="M420 86 l2.4 7 7 2.4 -7 2.4 -2.4 7 -2.4 -7 -7 -2.4 7 -2.4 z" />
        <path d="M530 36 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z" />
        <path d="M660 70 l2.8 8 8 2.8 -8 2.8 -2.8 8 -2.8 -8 -8 -2.8 8 -2.8 z" />
        <path d="M770 120 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z" />
        <path d="M232 128 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z" />
        <path d="M718 30 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z" />
      </g>

      {/* city glow */}
      <ellipse className="glow" cx="290" cy="320" rx="220" ry="70" />
      <ellipse className="glow" cx="680" cy="320" rx="150" ry="60" />

      {/* Minneapolis skyline */}
      <g className="skyline">
        <polygon points="162,330 170,208 192,208 200,330" />
        <rect x="174" y="192" width="14" height="18" />
        <rect x="206" y="286" width="30" height="44" />
        <polygon points="244,330 244,172 254,172 254,160 296,160 296,172 306,172 306,330" />
        <rect x="318" y="212" width="52" height="118" />
        <path d="M318 212 A 26 26 0 0 1 370 212 Z" />
        <polygon points="382,330 382,222 392,222 392,204 414,204 414,222 424,222 424,330" />
        <rect x="430" y="292" width="22" height="38" />
      </g>

      {/* Saint Paul skyline */}
      <g className="skyline">
        <rect x="596" y="288" width="34" height="42" />
        <rect x="638" y="268" width="58" height="62" />
        <path d="M638 268 A 29 29 0 0 1 696 268 Z" />
        <rect x="663" y="228" width="8" height="14" />
        <polygon points="710,330 710,240 744,240 744,330" />
        <rect x="716" y="222" width="22" height="18" />
        <rect x="752" y="284" width="28" height="46" />
      </g>

      {/* water */}
      <rect className="water" x="0" y="330" width="840" height="80" />
      <g className="moon-wake">
        <rect x="96" y="342" width="48" height="3.5" rx="1.75" />
        <rect x="106" y="356" width="30" height="3" rx="1.5" />
        <rect x="114" y="372" width="16" height="2.5" rx="1.25" />
      </g>
      <g className="city-wake">
        <rect x="250" y="338" width="6" height="26" />
        <rect x="272" y="338" width="6" height="34" />
        <rect x="330" y="338" width="6" height="22" />
        <rect x="662" y="338" width="6" height="24" />
        <rect x="722" y="338" width="6" height="30" />
      </g>

      {/* shore */}
      <path className="shore" d="M0 410 C 140 398 300 404 420 408 C 560 412 700 402 840 408 L 840 500 L 0 500 Z" />

      {/* trees */}
      <g className="trees">
        <polygon points="46,404 74,404 60,342" />
        <polygon points="50,376 70,376 60,330" />
        <rect x="56" y="404" width="8" height="14" />
        <polygon points="92,408 116,408 104,354" />
        <polygon points="95,384 113,384 104,344" />
        <rect x="100" y="408" width="7" height="12" />
        <polygon points="770,410 798,410 784,348" />
        <polygon points="774,382 794,382 784,336" />
        <rect x="780" y="410" width="8" height="14" />
        <polygon points="812,414 836,414 824,362" />
        <polygon points="815,392 833,392 824,352" />
        <rect x="820" y="414" width="7" height="12" />
      </g>

      {/* the couple — him */}
      <g className="figure">
        <path
          className="fig-ink"
          d="M560 470 L 563 388 C 560 366 562 348 570 336 C 566 326 566 318 570 312 L 610 312 C 614 318 614 326 610 336 C 618 348 620 366 617 388 L 620 470 L 604 470 L 596 412 L 584 412 L 576 470 Z"
        />
        <path className="shirt" d="M586 312 L 594 312 L 592 348 L 588 348 Z" />
        <circle className="fig-ink" cx="590" cy="298" r="13" />
        <ellipse className="fig-ink" cx="590" cy="288" rx="24" ry="4.5" />
        <path className="fig-ink" d="M574 288 C 574 272 578 266 582 264 L 598 264 C 602 266 606 272 606 288 Z" />

        {/* her */}
        <circle className="fig-ink" cx="512" cy="306" r="10" />
        <circle className="fig-ink" cx="524" cy="300" r="14" />
        <path className="fig-ink" d="M518 312 L 518 328 L 532 328 L 532 312 Z" />
        <path
          className="fig-arm"
          d="M518 336 C 502 340 490 334 482 322 C 477 314 472 308 466 302"
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <circle className="fig-ink" cx="464" cy="300" r="4.5" />
        <path
          className="dress"
          d="M508 326 C 505 344 507 356 512 364 C 504 394 500 424 498 448 C 497 462 500 468 504 470 L 556 470 C 548 452 548 424 545 400 C 542 376 540 352 536 364 C 541 356 543 344 540 326 C 530 332 518 332 508 326 Z"
        />
        <line className="cig" x1="461" y1="297" x2="447" y2="286" strokeWidth="3" strokeLinecap="round" />
        <circle className="ember" cx="446" cy="285" r="2.4" />
        <g className="smoke">
          <path
            d="M445 280 C 452 262 440 248 449 230 C 457 214 445 198 453 180 C 458 170 454 160 450 152"
            fill="none"
            strokeWidth="2.2"
          />
          <path
            d="M447 274 C 456 264 450 252 457 240 C 464 228 458 216 463 204"
            fill="none"
            strokeWidth="1.4"
          />
        </g>
        <circle className="rose" cx="509" cy="295" r="6" />
        <path
          className="rose-line"
          d="M505.5 293.5 a4 4 0 0 1 7 1.8 M507 298 a2.6 2.6 0 0 1 4.4 -2.6"
          fill="none"
          strokeWidth="0.9"
        />
      </g>

      <text className="title" x="210" y="462" textAnchor="middle">DEAD NORTH</text>
      <text className="credits" x="210" y="480" textAnchor="middle">
        A TWIN CITIES TRANSMISSION · CH 00 · IN NOIR-O-VISION
      </text>
    </svg>
  )
}
