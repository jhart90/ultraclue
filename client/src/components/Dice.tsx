import { useEffect, useRef, useState } from 'react';
import './Dice.css';

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
    <div className="gdie__grid">
      {Array.from({ length: 9 }, (_, i) => {
        const c = i % 3;
        const r = Math.floor(i / 3);
        const on = PIPS[value]?.some(([pc, pr]) => pc === c && pr === r);
        return <span key={i} className={`gdie__pip${on ? ' gdie__pip--on' : ''}`} />;
      })}
    </div>
  );
}

/** The in-game roll: a gold + maroon pair styled to match the title-screen dice (flat, top-down),
 *  plus the rolled total. Pops briefly on each new roll. */
export function Dice({ values }: { values: [number, number] }) {
  const [rolling, setRolling] = useState(false);
  const prev = useRef<string>('');
  useEffect(() => {
    const key = values.join(',');
    if (prev.current && prev.current !== key) {
      setRolling(true);
      const t = setTimeout(() => setRolling(false), 450);
      return () => clearTimeout(t);
    }
    prev.current = key;
  }, [values]);

  return (
    <div className="dice">
      <div className={`gdie gdie--gold${rolling ? ' gdie--roll' : ''}`}>
        <div className="gdie__face">
          <Pips value={values[0]} />
        </div>
      </div>
      <div className={`gdie gdie--maroon${rolling ? ' gdie--roll' : ''}`}>
        <div className="gdie__face">
          <Pips value={values[1]} />
        </div>
      </div>
      <span className="dice__sum">= {values[0] + values[1]}</span>
    </div>
  );
}
