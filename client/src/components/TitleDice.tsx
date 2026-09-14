import { useState } from 'react';
import './TitleDice.css';

// Emerald dice with inlaid gold pips, pre-rendered in Blender (Cycles) with a transparent background.
// Each die comes in two poses (`a` turned left, `b` turned right) for every top value, all lit by the
// same rig, so any pairing looks like one throw. Files are named die_<pose><value>.webp.
const urls = import.meta.glob('../../../assets/title/dice/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function dieArt(pose: 'a' | 'b', value: number): string | undefined {
  return Object.entries(urls).find(([path]) => path.endsWith(`/die_${pose}${value}.webp`))?.[1];
}

const roll = () => 1 + Math.floor(Math.random() * 6);

/** A freshly rolled pair of emerald dice resting in the upper-right corner of the title screen. */
export function TitleDice() {
  const [dice] = useState(() => [
    { pose: 'a' as const, value: roll() },
    { pose: 'b' as const, value: roll() },
  ]);
  return (
    <div className="title__dice" aria-hidden="true">
      {dice.map((d, i) => {
        const src = dieArt(d.pose, d.value);
        return src ? <img key={i} className="tdie" src={src} alt="" draggable={false} /> : null;
      })}
    </div>
  );
}
