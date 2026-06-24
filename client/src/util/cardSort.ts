import { SUSPECTS, WEAPONS, ROOMS, type AnyCard } from 'shared';

/** Suspect surnames are the colour-based last word ("Miss Scarlet" -> "Scarlet"); used for sorting. */
export const surname = (title: string): string => title.trim().split(/\s+/).pop() ?? title;

const TYPE_ORDER: Record<string, number> = { suspect: 0, weapon: 1, room: 2 };
const alphaKey = (c: { type: string; title: string }): string => (c.type === 'suspect' ? surname(c.title) : c.title);

/** Sort by type (suspect, weapon, room) then alphabetically — suspects by surname. */
export function compareCards(a: AnyCard, b: AnyCard): number {
  const byType = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
  return byType !== 0 ? byType : alphaKey(a).localeCompare(alphaKey(b));
}

export const SORTED_SUSPECTS = [...SUSPECTS].sort((a, b) => surname(a.title).localeCompare(surname(b.title)));
export const SORTED_WEAPONS = [...WEAPONS].sort((a, b) => a.title.localeCompare(b.title));
export const SORTED_ROOMS = [...ROOMS].sort((a, b) => a.title.localeCompare(b.title));

/** Convert a #rrggbb hex colour to HSL (h in 0–360, s/l in 0–1). */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

/** Sort key placing colours in a "loose rainbow": vivid hues first (red→orange→yellow→green→
 *  cyan→blue→violet→magenta), then the near-neutral greys/blacks/whites as a light-to-dark ramp.
 *  Deep reds (hue ≳345) wrap to the front so the rainbow begins on red. */
function rainbowKey(hex: string): [number, number] {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.2) return [1, -l]; // near-neutral: trailing group, lightest first
  return [0, h >= 345 ? h - 360 : h];
}

/** Suspects arranged as a loose rainbow by piece colour (used by the character picker). */
export const SORTED_SUSPECTS_RAINBOW = [...SUSPECTS].sort((a, b) => {
  const ka = rainbowKey(a.color);
  const kb = rainbowKey(b.color);
  return ka[0] - kb[0] || ka[1] - kb[1];
});
