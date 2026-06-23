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

function Face({ value, rolling }: { value: number; rolling: boolean }) {
  return (
    <div className={`die${rolling ? ' die--rolling' : ''}`}>
      <div className="die__grid">
        {Array.from({ length: 9 }, (_, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const on = PIPS[value]?.some(([c, r]) => c === col && r === row);
          return <span key={i} className={on ? 'pip pip--on' : 'pip'} />;
        })}
      </div>
    </div>
  );
}

export function Dice({ values }: { values: [number, number] }) {
  const [rolling, setRolling] = useState(false);
  const prev = useRef<string>('');
  useEffect(() => {
    const key = values.join(',');
    if (prev.current && prev.current !== key) {
      setRolling(true);
      const t = setTimeout(() => setRolling(false), 550);
      return () => clearTimeout(t);
    }
    prev.current = key;
  }, [values]);

  return (
    <div className="dice">
      <Face value={values[0]} rolling={rolling} />
      <Face value={values[1]} rolling={rolling} />
      <span className="dice__sum">= {values[0] + values[1]}</span>
    </div>
  );
}
