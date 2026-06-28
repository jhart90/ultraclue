import { useState } from 'react';
import { ALL_CARDS, type AnyCard } from 'shared';
import { Card } from './Card';
import { CardBack } from './CardBack';

interface Placed {
  card: AnyCard;
  faceUp: boolean;
  left: number; // percent across the screen
  bottom: number; // vh up from the bottom edge
  angle: number; // degrees from vertical, −75..+75
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Rendered card footprint (200×283 base, scaled 0.8) — generous on height since override-art cards
// vary — plus a small margin, so the centre 10% stays reliably clear of even borderline tilts.
const CARD_W = 160;
const CARD_H = 245;
const MARGIN = 2;

/** Does a card centred at horizontal `cx%` and tilted by `angle` intrude on the central 10% column
 *  (45–55% of width, plus margin) at any height? Uses the rotated width so a steeply tilted card's
 *  corners are accounted for, keeping the central strip — under the logo and menu — fully clear. */
function hitsCentre(cx: number, angle: number, vw: number): boolean {
  const rad = (Math.abs(angle) * Math.PI) / 180;
  const rotW = Math.abs(Math.cos(rad)) * CARD_W + Math.abs(Math.sin(rad)) * CARD_H;
  const halfW = (rotW / 2 / vw) * 100;
  return cx + halfW > 45 - MARGIN && cx - halfW < 55 + MARGIN;
}

/** Pick 4–7 random cards, half face-up / half face-down, scattered across the lower screen at random
 *  tilts (and never over the centre 10%). Generated once per mount so it stays put while you read the
 *  menu. */
function buildScatter(): Placed[] {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const count = 4 + Math.floor(Math.random() * 4); // 4..7
  const pool = [...ALL_CARDS].sort(() => Math.random() - 0.5).slice(0, count);
  // roughly half face up; shuffle which positions are up so it's not the first N
  const faces = Array.from({ length: count }, (_, i) => i < Math.round(count / 2));
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  return pool.map((card, i) => {
    const angle = Math.round(-75 + Math.random() * 150);
    // Always anchor one card running off the lower-left corner and one off the lower-right corner.
    if (i === 0) return { card, faceUp: faces[i], left: 1 + Math.random() * 5, bottom: -8 + Math.random() * 5, angle };
    if (i === 1) return { card, faceUp: faces[i], left: 94 + Math.random() * 5, bottom: -8 + Math.random() * 5, angle };
    const bottom = Math.random() * 20;
    let left = clamp(((i + 0.5) / count) * 100 + (Math.random() * 16 - 8), 7, 93);
    // Re-roll the horizontal position until the card clears the central 10% column entirely.
    for (let tries = 0; tries < 40 && hitsCentre(left, angle, vw); tries++) {
      left = 7 + Math.random() * 86;
    }
    return { card, faceUp: faces[i], left, bottom, angle };
  });
}

/** Decorative spread of game cards strewn across the bottom of the title screen. */
export function TitleCards() {
  const [cards] = useState(buildScatter);
  return (
    <div className="title__cards" aria-hidden="true">
      {cards.map((c, i) => (
        <div
          key={i}
          className="title__card"
          style={{ left: `${c.left}%`, bottom: `${c.bottom}vh`, transform: `translateX(-50%) rotate(${c.angle}deg) scale(0.8)` }}
        >
          {c.faceUp ? <Card card={c.card} /> : <CardBack />}
        </div>
      ))}
    </div>
  );
}
