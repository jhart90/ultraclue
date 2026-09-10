/** The sealed manila case envelope, as SVG content: paper gradient + grain, a closed flap casting a
 *  soft shadow, and a red wax seal. Rendered inside an <svg> of ENVELOPE_VIEWBOX proportions by the
 *  title screen (huge, off the corner) and the board (in the empty corner above the Upper Floor).
 *  `idPrefix` keeps the gradient/filter ids distinct when two copies share one document.
 *
 *  The drawing is split into pieces — defs, body, flap shadow, flap, seal — so the accusation reveal
 *  (AccusationReveal) can put each in its own layer and move them apart: the seal lifts off, the
 *  flap swings open about its fold, cards rise out of the body. `EnvelopeArt` composes the pieces
 *  in the original order, so everywhere else the envelope is unchanged. */
export const ENVELOPE_VIEWBOX = { w: 640, h: 440 };
/** The flap's fold line (its hinge) and the seal's centre, in viewBox units. */
export const ENVELOPE_FOLD_Y = 60;
export const ENVELOPE_SEAL = { cx: 320, cy: 250, r: 40 };

const url = (idPrefix: string, s: string) => `url(#${idPrefix}-${s})`;

/** Gradients, filters and the body clip every piece refers to. Render once per <svg>. */
export function EnvelopeDefs({ idPrefix = 'env' }: { idPrefix?: string }) {
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <defs>
      <linearGradient id={id('paper')} x1="0" y1="0" x2="0.15" y2="1">
        <stop offset="0" stopColor="#f6eed8" />
        <stop offset="0.55" stopColor="#e9ddc0" />
        <stop offset="1" stopColor="#d8c8a4" />
      </linearGradient>
      <linearGradient id={id('flap')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f2e8cd" />
        <stop offset="1" stopColor="#d2c19c" />
      </linearGradient>
      {/* the flap's plain inside, seen once it has swung open */}
      <linearGradient id={id('flapin')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#cdbd93" />
        <stop offset="1" stopColor="#e2d5b3" />
      </linearGradient>
      {/* the dark of the mouth, just inside the top edge, once the flap is open */}
      <linearGradient id={id('mouth')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="rgba(40,28,10,0.5)" />
        <stop offset="1" stopColor="rgba(40,28,10,0)" />
      </linearGradient>
      <radialGradient id={id('wax')} cx="38%" cy="32%" r="75%">
        <stop offset="0" stopColor="#c0303a" />
        <stop offset="0.6" stopColor="#9a1f2b" />
        <stop offset="1" stopColor="#6e121c" />
      </radialGradient>
      {/* fine paper grain */}
      <filter id={id('grain')}>
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" stitchTiles="stitch" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" />
      </filter>
      {/* soft cast shadow under the flap edges */}
      <filter id={id('soft')} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <clipPath id={id('clip')}>
        <rect x="18" y="60" width="604" height="340" rx="12" />
      </clipPath>
      {/* rubber-stamp ink: coarse noise eats into the letters and border so the impression is
          patchy and slightly ragged, the way a hand stamp prints on paper */}
      <filter id={id('ink')} x="-5%" y="-10%" width="110%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.12" numOctaves="3" seed="7" result="noise" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.7" result="wear" />
        <feComposite in="SourceGraphic" in2="wear" operator="in" result="worn" />
        <feGaussianBlur in="worn" stdDeviation="0.35" />
      </filter>
    </defs>
  );
}

/** The envelope body: the paper pocket with its grain and the faint seams of the bottom flaps.
 *  `mouth` adds a dark line just inside the top edge, for when the flap is drawn open. */
export function EnvelopeBody({ idPrefix = 'env', mouth = false }: { idPrefix?: string; mouth?: boolean }) {
  return (
    <>
      <rect x="18" y="60" width="604" height="340" rx="12" fill={url(idPrefix, 'paper')} stroke="#b9a578" strokeWidth="2" />
      {/* grain overlay, clipped to the body */}
      <rect x="18" y="60" width="604" height="340" rx="12" filter={url(idPrefix, 'grain')} opacity="0.5" clipPath={url(idPrefix, 'clip')} />
      {/* bottom flap seams (faint) */}
      <path d="M18 400 L320 250 L622 400" fill="none" stroke="rgba(120,98,52,0.35)" strokeWidth="2" />
      {mouth && <rect x="20" y="61" width="600" height="16" fill={url(idPrefix, 'mouth')} />}
    </>
  );
}

/** The soft shadow the closed flap casts onto the body. */
export function EnvelopeFlapShadow({ idPrefix = 'env' }: { idPrefix?: string }) {
  return <path d="M40 66 L320 268 L600 66" fill="none" stroke="rgba(70,52,22,0.4)" strokeWidth="8" filter={url(idPrefix, 'soft')} />;
}

/** The closed top flap (apex at centre), its fold highlight, and an optional ink stamp across it.
 *  The paper and stamp carry class names (`env-flap__paper`, `env-flap__stamp`) so a reveal can swap
 *  the flap to its inside once it has swung past vertical. */
export function EnvelopeFlap({ idPrefix = 'env', stamp }: { idPrefix?: string; stamp?: string }) {
  // The stamp sits on the top flap, above the seal, where the flap is still wide enough: the flap
  // runs from 604 wide at y=60 to its apex at y=252, so a 270x54 box centred at y=124 clears its edges.
  return (
    <>
      <path className="env-flap__paper" d="M18 60 L622 60 L320 252 Z" fill={url(idPrefix, 'flap')} stroke="#bda878" strokeWidth="2" strokeLinejoin="round" />
      {/* highlight along the flap fold */}
      <path d="M18 60 L622 60" fill="none" stroke="rgba(255,250,232,0.6)" strokeWidth="2" />
      {stamp && (
        <g className="env-flap__stamp">
          <InkStamp idPrefix={idPrefix} text={stamp} box={{ x: 185, y: 97, w: 270, h: 54 }} />
        </g>
      )}
    </>
  );
}

/** A red ink stamp: double border and Impact capitals, worn by the `ink` filter, pressed on a little
 *  crooked. Multiplied into the paper it sits on. */
export function InkStamp({
  idPrefix = 'env',
  text,
  box,
  color = '#b8121c',
  rotate = -7,
  fontSize = 36,
  letterSpacing = 5,
}: {
  idPrefix?: string;
  text: string;
  box: { x: number; y: number; w: number; h: number };
  color?: string;
  rotate?: number;
  fontSize?: number;
  letterSpacing?: number;
}) {
  return (
    <g transform={`rotate(${rotate} ${box.x + box.w / 2} ${box.y + box.h / 2})`} filter={url(idPrefix, 'ink')} opacity="0.82" style={{ mixBlendMode: 'multiply' }}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="4" fill="none" stroke={color} strokeWidth="4" />
      <rect x={box.x + 7} y={box.y + 7} width={box.w - 14} height={box.h - 14} rx="2" fill="none" stroke={color} strokeWidth="1.5" />
      <text
        x={box.x + box.w / 2}
        y={box.y + box.h / 2 + 13}
        textAnchor="middle"
        fontFamily="Impact, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"
        fontWeight="900"
        fontSize={fontSize}
        letterSpacing={letterSpacing}
        fill={color}
      >
        {text}
      </text>
    </g>
  );
}

/** The red wax seal at the flap tip, with its own soft shadow. */
export function EnvelopeSeal({ idPrefix = 'env' }: { idPrefix?: string }) {
  const { cx, cy, r } = ENVELOPE_SEAL;
  return (
    <g>
      <ellipse cx={cx} cy={cy + 6} rx={r + 2} ry={r} fill="rgba(0,0,0,0.28)" filter={url(idPrefix, 'soft')} />
      <circle cx={cx} cy={cy} r={r} fill={url(idPrefix, 'wax')} stroke="#5e0f18" strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={r - 7} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      <path d={`M${cx} ${cy - 20} L${cx + 14} ${cy} L${cx} ${cy + 20} L${cx - 14} ${cy} Z`} fill="rgba(60,8,14,0.55)" stroke="rgba(255,200,200,0.18)" strokeWidth="1" />
    </g>
  );
}

/** The whole sealed envelope, as before: body, flap shadow, flap (with an optional stamp), seal. */
export function EnvelopeArt({ idPrefix = 'env', stamp }: { idPrefix?: string; stamp?: string }) {
  return (
    <>
      <EnvelopeDefs idPrefix={idPrefix} />
      <EnvelopeBody idPrefix={idPrefix} />
      <EnvelopeFlapShadow idPrefix={idPrefix} />
      <EnvelopeFlap idPrefix={idPrefix} stamp={stamp} />
      <EnvelopeSeal idPrefix={idPrefix} />
    </>
  );
}

/**
 * A stamp big enough to cover the screen — the accusation's verdict. One or two lines of capitals in
 * a double-bordered box, worn by a coarser noise than the flap's small stamp so the wear reads at
 * size. The viewBox width follows the longest line so every stamp's letters come out the same height
 * when the caller scales it by `viewBox.w` (see AccusationReveal.css).
 */
export function BigStamp({ idPrefix, lines, color }: { idPrefix: string; lines: string[]; color: string }) {
  const id = (s: string) => `${idPrefix}-${s}`;
  const longest = Math.max(...lines.map((l) => l.length));
  const w = Math.max(440, Math.min(1000, longest * 50));
  const rowH = 120;
  const h = 50 + rowH * lines.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg" overflow="visible" aria-hidden="true">
      <defs>
        <filter id={id('inkbig')} x="-5%" y="-10%" width="110%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="11" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.0 1.6" result="wear" />
          <feComposite in="SourceGraphic" in2="wear" operator="in" result="worn" />
          <feGaussianBlur in="worn" stdDeviation="0.8" />
        </filter>
      </defs>
      <g filter={`url(#${id('inkbig')})`} opacity="0.93">
        <rect x="14" y="14" width={w - 28} height={h - 28} rx="8" fill="none" stroke={color} strokeWidth="10" />
        <rect x="30" y="30" width={w - 60} height={h - 60} rx="4" fill="none" stroke={color} strokeWidth="4" />
        {lines.map((line, i) => (
          <text
            key={line}
            x={w / 2}
            y={122 + i * rowH}
            textAnchor="middle"
            textLength={w - 120}
            lengthAdjust="spacingAndGlyphs"
            fontFamily="Impact, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif"
            fontWeight="900"
            fontSize="96"
            letterSpacing="6"
            fill={color}
          >
            {line}
          </text>
        ))}
      </g>
    </svg>
  );
}
