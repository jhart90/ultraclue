import type { AnyCard, SuspectCard } from 'shared';
import { shade, contrastInk, hashString } from './colorUtils';

// Procedural SVG "illustrations" for each card type. Drawn into a 200x150 illustration area that
// the Card frame sits around. These are intentional placeholders — clean, themed, and varied per
// card — until real art is dropped into assets/overrides/.

const W = 200;
const H = 150;

function surnameInitial(title: string): string {
  const parts = title.trim().split(/\s+/);
  return (parts[parts.length - 1][0] ?? '?').toUpperCase();
}

function firstInitial(title: string): string {
  return (title.trim()[0] ?? '?').toUpperCase();
}

/** A heraldic crest in the suspect's piece colour. */
function SuspectArt({ card }: { card: SuspectCard }) {
  const h = hashString(card.id);
  const base = card.color;
  const dark = shade(base, -0.35);
  const light = shade(base, 0.25);
  const ink = contrastInk(base);
  const gid = `g-${card.id}`;
  const shield = 'M100 24 L150 40 L150 78 Q150 112 100 134 Q50 112 50 78 L50 40 Z';
  const crest = h % 3; // 0 diamond, 1 star, 2 circle

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label={card.title}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="1" stopColor={dark} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="#211c2e" />
      <path d={shield} fill={`url(#${gid})`} stroke={shade(base, -0.5)} strokeWidth="3" />
      {/* chief stripe */}
      <path d="M50 40 L150 40 L150 56 L50 56 Z" fill={dark} opacity="0.55" />
      {/* crest emblem */}
      <g fill={ink} opacity="0.9" transform="translate(100 48)">
        {crest === 0 && <path d="M0 -7 L7 0 L0 7 L-7 0 Z" />}
        {crest === 1 && (
          <path d="M0 -8 L2.4 -2.5 L8 -2.5 L3.3 1.2 L5 7 L0 3.4 L-5 7 L-3.3 1.2 L-8 -2.5 L-2.4 -2.5 Z" />
        )}
        {crest === 2 && <circle r="6" />}
      </g>
      {/* monogram */}
      <text
        x="100"
        y="92"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="44"
        fill={ink}
      >
        {surnameInitial(card.title)}
      </text>
    </svg>
  );
}

/** A pewter medallion for a weapon token. */
function WeaponArt({ card }: { card: AnyCard }) {
  const h = hashString(card.id);
  const studs = 8 + (h % 6); // 8..13 rim studs
  const cx = 100;
  const cy = 75;
  const gid = `pw-${card.id}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label={card.title}>
      <defs>
        <radialGradient id={gid} cx="40%" cy="32%" r="75%">
          <stop offset="0" stopColor="#eef0f2" />
          <stop offset="0.45" stopColor="#b9bcc1" />
          <stop offset="0.8" stopColor="#7b7f86" />
          <stop offset="1" stopColor="#55585e" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="#23232b" />
      <circle cx={cx} cy={cy} r="56" fill="#3a3a42" />
      <circle cx={cx} cy={cy} r="52" fill={`url(#${gid})`} stroke="#4b4e54" strokeWidth="2" />
      <circle cx={cx} cy={cy} r="40" fill="none" stroke="#6b6e74" strokeWidth="1.5" opacity="0.7" />
      {/* rim studs */}
      {Array.from({ length: studs }).map((_, i) => {
        const a = (i / studs) * Math.PI * 2;
        return (
          <circle
            key={i}
            cx={cx + Math.cos(a) * 47}
            cy={cy + Math.sin(a) * 47}
            r="2.1"
            fill="#5c5f65"
          />
        );
      })}
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="40"
        fill="#3c3e44"
      >
        {firstInitial(card.title)}
      </text>
    </svg>
  );
}

/** A tinted floor-plan tile for a room. */
function RoomArt({ card }: { card: AnyCard }) {
  const h = hashString(card.id);
  const hue = h % 360;
  const wall = '#caa24a';
  const floor = `hsl(${hue} 30% 22%)`;
  const floorLine = `hsl(${hue} 25% 32%)`;
  const door = h % 4; // which wall has the doorway: 0 top,1 right,2 bottom,3 left
  const x = 30;
  const y = 20;
  const w = 140;
  const ht = 110;

  // Door gap drawn as a lighter break in one wall.
  const gap = 26;
  const doorRect =
    door === 0
      ? { x: x + w / 2 - gap / 2, y: y - 2, w: gap, h: 4 }
      : door === 1
        ? { x: x + w - 2, y: y + ht / 2 - gap / 2, w: 4, h: gap }
        : door === 2
          ? { x: x + w / 2 - gap / 2, y: y + ht - 2, w: gap, h: 4 }
          : { x: x - 2, y: y + ht / 2 - gap / 2, w: 4, h: gap };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label={card.title}>
      <rect width={W} height={H} fill="#1b1f26" />
      <rect x={x} y={y} width={w} height={ht} fill={floor} stroke={wall} strokeWidth="3" rx="2" />
      {/* parquet lines */}
      {Array.from({ length: 8 }).map((_, i) => (
        <line
          key={i}
          x1={x + 6}
          x2={x + w - 6}
          y1={y + 12 + i * 12}
          y2={y + 12 + i * 12}
          stroke={floorLine}
          strokeWidth="1"
          opacity="0.6"
        />
      ))}
      {/* doorway break */}
      <rect x={doorRect.x} y={doorRect.y} width={doorRect.w} height={doorRect.h} fill="#1b1f26" />
      {/* compass marker */}
      <text x={x + 10} y={y + 18} fontFamily="Georgia, serif" fontSize="11" fill={wall} opacity="0.8">
        N
      </text>
      {/* room initial as a subtle floor monogram */}
      <text
        x={x + w / 2}
        y={y + ht / 2 + 12}
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontWeight="700"
        fontSize="34"
        fill={wall}
        opacity="0.85"
      >
        {firstInitial(card.title)}
      </text>
    </svg>
  );
}

export function CardArt({ card }: { card: AnyCard }) {
  if (card.type === 'suspect') return <SuspectArt card={card as SuspectCard} />;
  if (card.type === 'weapon') return <WeaponArt card={card} />;
  return <RoomArt card={card} />;
}
