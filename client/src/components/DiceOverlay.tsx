import { useEffect, useRef, useState } from 'react';
import { buildSims, drawFrame, simsSettleTime, type PlayBounds } from '../dice/dice3d';
import { playDiceRoll } from '../util/sound';
import './DiceOverlay.css';

export interface DiceRollShow {
  /** The roll's sequence number — a new one restarts the animation. */
  seq: number;
  values: [number, number];
  color: string;
  pips: string;
  /** Who threw them. */
  name: string;
}

/** The dice land inside the board area, not under the chat or the header. */
function playBounds(w: number, h: number): PlayBounds {
  const r = document.querySelector('.game__board')?.getBoundingClientRect();
  if (!r || r.width < 200 || r.height < 200) return { left: 0, right: w, top: 0, bottom: h };
  return { left: r.left, right: r.right, top: Math.max(0, r.top), bottom: Math.min(h, r.bottom) };
}

function DiceCanvas({ roll }: { roll: DiceRollShow }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [settled, setSettled] = useState(false);
  const [labelTop, setLabelTop] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    playDiceRoll();
    const bounds = playBounds(w, h);
    setLabelTop(bounds.bottom - 30); // the caption sits along the bottom edge of the board area
    const sims = buildSims(roll.values, w, h, roll.color, roll.pips, bounds);
    const settleAt = simsSettleTime(sims);
    const t0 = performance.now();
    let raf = 0;
    let done = false;
    const tick = (now: number) => {
      const t = now - t0;
      const moving = drawFrame(ctx, sims, t, w, h);
      if (t >= settleAt && !done) {
        done = true;
        setSettled(true);
      }
      if (moving || t < settleAt) raf = requestAnimationFrame(tick);
      else drawFrame(ctx, sims, settleAt + 401, w, h); // final resting frame — stays until dismissed
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // A new roll remounts this component (keyed on seq), so run-once is right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dice-overlay">
      <canvas ref={canvasRef} className="dice3d-canvas" />
      <div className="dice-overlay__label" style={labelTop != null ? { top: labelTop, bottom: 'auto' } : undefined}>
        {roll.name} rolls{settled ? <span className="dice-overlay__total"> {roll.values[0]} + {roll.values[1]} = {roll.values[0] + roll.values[1]}</span> : '…'}
      </div>
    </div>
  );
}

/** Full-screen, non-interactive 3D dice for the latest roll. The dice keep their resting positions
 *  on screen until the parent clears `roll` (next pop-up, next roll, or any click). */
export function DiceOverlay({ roll }: { roll: DiceRollShow | null }) {
  if (!roll) return null;
  return <DiceCanvas key={roll.seq} roll={roll} />;
}
