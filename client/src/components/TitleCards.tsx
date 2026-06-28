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

/** Pick 3–5 random cards, half face-up / half face-down, scattered across the lower screen at random
 *  tilts. Generated once per mount so it stays put while you read the menu. */
function buildScatter(): Placed[] {
  const count = 3 + Math.floor(Math.random() * 3); // 3, 4, or 5
  const pool = [...ALL_CARDS].sort(() => Math.random() - 0.5).slice(0, count);
  // roughly half face up; shuffle which positions are up so it's not the first N
  const faces = Array.from({ length: count }, (_, i) => i < Math.round(count / 2));
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  return pool.map((card, i) => ({
    card,
    faceUp: faces[i],
    left: clamp(((i + 0.5) / count) * 100 + (Math.random() * 16 - 8), 7, 93),
    bottom: Math.random() * 18,
    angle: Math.round(-75 + Math.random() * 150),
  }));
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
