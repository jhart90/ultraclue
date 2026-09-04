import { useEffect, useRef } from 'react';
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

/** How long resting dice take to fade out when the next turn begins (ms). */
export const DICE_FADE_MS = 500;

function DiceCanvas({ roll, fading }: { roll: DiceRollShow; fading?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    const sims = buildSims(roll.values, w, h, roll.color, roll.pips, bounds);
    const settleAt = simsSettleTime(sims);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - t0;
      const moving = drawFrame(ctx, sims, t, w, h);
      if (moving || t < settleAt) raf = requestAnimationFrame(tick);
      else drawFrame(ctx, sims, settleAt + 401, w, h); // final resting frame — stays until dismissed
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // A new roll remounts this component (keyed on seq), so run-once is right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`dice-overlay${fading ? ' dice-overlay--fade' : ''}`}>
      <canvas ref={canvasRef} className="dice3d-canvas" />
    </div>
  );
}

/** Full-screen, non-interactive 3D dice for the latest roll. The dice keep their resting positions
 *  on screen until the parent clears `roll` (next pop-up, next roll, or any click); `fading` plays
 *  the fade-out first, for dice left over when the next turn begins. */
export function DiceOverlay({ roll, fading }: { roll: DiceRollShow | null; fading?: boolean }) {
  if (!roll) return null;
  return <DiceCanvas key={roll.seq} roll={roll} fading={fading} />;
}
