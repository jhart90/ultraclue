import { useState } from 'react';
import './TitleDice.css';

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function Pips({ value }: { value: number }) {
  return (
    <div className="tdie__grid">
      {Array.from({ length: 9 }, (_, i) => {
        const c = i % 3;
        const r = Math.floor(i / 3);
        const on = PIPS[value]?.some(([pc, pr]) => pc === c && pr === r);
        return <span key={i} className={`tdie__pip${on ? ' tdie__pip--on' : ''}`} />;
      })}
    </div>
  );
}

/** One die seen from above, lying on the table: its top face (the rolled value) with a thin visible
 *  edge and a soft cast shadow, turned a little in-plane so the pair looks freshly tossed. */
function Die({ value, tone, spin }: { value: number; tone: 'gold' | 'maroon'; spin: number }) {
  return (
    <div className={`tdie tdie--${tone}`} style={{ transform: `rotate(${spin}deg)` }}>
      <div className="tdie__face">
        <Pips value={value} />
      </div>
    </div>
  );
}

/** A rolled pair of dice — one gold, one maroon — lying flat (top-down) to the upper-right of the
 *  title logo. */
export function TitleDice() {
  const [dice] = useState(() => [
    { tone: 'gold' as const, value: 1 + Math.floor(Math.random() * 6), spin: Math.round(-30 + Math.random() * 22) },
    { tone: 'maroon' as const, value: 1 + Math.floor(Math.random() * 6), spin: Math.round(8 + Math.random() * 26) },
  ]);
  return (
    <div className="title__dice" aria-hidden="true">
      {dice.map((d, i) => (
        <Die key={i} value={d.value} tone={d.tone} spin={d.spin} />
      ))}
    </div>
  );
}
