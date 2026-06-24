import type { ReactNode } from 'react';
import { SUSPECTS, WEAPONS, ROOMS } from 'shared';
import { shade } from '../render/colorUtils';

// Auto-highlight card names in chat/log text: suspects are bold and tinted their piece colour,
// weapons and rooms are simply bold. Everything is matched against the live card data, so renamed
// characters are reflected automatically.

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Lighten a colour until it reads clearly on the dark chat background. */
function readableOnDark(hex: string): string {
  let c = hex;
  for (let i = 0; i < 8 && luminance(c) < 0.55; i++) c = shade(c, 0.22);
  return c;
}

const COLOR_BY_TITLE = new Map(SUSPECTS.map((s) => [s.title.toLowerCase(), readableOnDark(s.color)]));

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// All card titles, longest first so multi-word names win over any shorter overlap.
const TITLES = [...SUSPECTS, ...WEAPONS, ...ROOMS]
  .map((c) => c.title)
  .sort((a, b) => b.length - a.length);
const PATTERN = new RegExp(`(${TITLES.map(escapeRe).join('|')})`, 'gi');

/** Wrap any card name found in `text` with bold (and a colour for suspects). */
export function highlightChat(text: string): ReactNode {
  if (!text) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  PATTERN.lastIndex = 0;
  while ((m = PATTERN.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const matched = m[0];
    const color = COLOR_BY_TITLE.get(matched.toLowerCase());
    parts.push(
      <strong key={key++} className="chat__card" style={color ? { color } : undefined}>
        {matched}
      </strong>,
    );
    last = m.index + matched.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
