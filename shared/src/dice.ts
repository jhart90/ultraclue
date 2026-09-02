import { SUSPECTS } from './data';
import type { DiceStyle } from './game';

/** Black or white, whichever reads better on the given hex colour (relative luminance). */
export function contrastPips(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#111111' : '#ffffff';
}

/** The dice a seat rolls with unless its human picks otherwise: the character's colour, with pips
 *  in whichever of black/white is more legible on it. */
export function defaultDice(suspectId?: string): DiceStyle {
  const color = (SUSPECTS.find((s) => s.id === suspectId)?.color ?? '#c8a24a').toLowerCase();
  return { color, pips: contrastPips(color) };
}
