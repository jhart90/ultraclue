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

// Rotation that brings each value's face toward the viewer (opposite faces sum to 7).
const VAL_ROT: Record<number, string> = {
  1: '',
  2: 'rotateX(90deg)',
  3: 'rotateY(-90deg)',
  4: 'rotateY(90deg)',
  5: 'rotateX(-90deg)',
  6: 'rotateY(180deg)',
};
// Which value sits on each cube face (front 1 / back 6, right 3 / left 4, top 5 / bottom 2).
const FACES: { cls: string; value: number }[] = [
  { cls: 'front', value: 1 },
  { cls: 'back', value: 6 },
  { cls: 'right', value: 3 },
  { cls: 'left', value: 4 },
  { cls: 'top', value: 5 },
  { cls: 'bottom', value: 2 },
];

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

function Die({ value, tone }: { value: number; tone: 'gold' | 'maroon' }) {
  // Rest at a 3D angle with the rolled value facing the viewer; the cube tumbles in to it on mount.
  const rest = `rotateX(-20deg) rotateY(26deg) ${VAL_ROT[value]}`;
  return (
    <div className={`tdie tdie--${tone}`}>
      <div className="tdie__cube" style={{ ['--rest' as string]: rest }}>
        {FACES.map((f) => (
          <div key={f.cls} className={`tdie__face tdie__face--${f.cls}`}>
            <Pips value={f.value} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A rolled pair of 3D dice — one gold, one maroon — shown to the upper-right of the title logo. */
export function TitleDice() {
  const [vals] = useState<[number, number]>(() => [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
  return (
    <div className="title__dice" aria-hidden="true">
      <Die value={vals[0]} tone="gold" />
      <Die value={vals[1]} tone="maroon" />
    </div>
  );
}
