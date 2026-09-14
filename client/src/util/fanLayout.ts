// Where the hand fan puts its cards. Shared by the fan itself (HandFan) and the opening deal
// (OpeningDeal), which flies each of your cards to the exact spot the fan is about to give it.

export const CARD_W = 200; // the Card component's authored size
export const CARD_H = 306;
export const BASE_W = 150; // a resting card's width
export const BASE_H = (BASE_W * CARD_H) / CARD_W;
const VISIBLE = 0.5; // share of a resting card kept above the screen bottom
const MAX_STEP = 0.72; // widest exposed strip per card (as a share of its width) before they spread out

export interface Slot {
  x: number; // left edge of the unrotated card, in band coordinates
  y: number; // top edge
  rot: number; // degrees, about the card's bottom centre
}

export interface Layout {
  slots: Slot[];
  step: number;
  startX: number;
  total: number;
}

/** Resting positions for `n` cards across a band `w` wide and `h` tall. */
export function layoutFan(n: number, w: number, h: number): Layout {
  if (n === 0) return { slots: [], step: 0, startX: 0, total: 0 };
  const step = n > 1 ? Math.min(BASE_W * MAX_STEP, Math.max(1, (w - BASE_W) / (n - 1))) : 0;
  const total = BASE_W + step * (n - 1);
  const startX = (w - total) / 2;
  const centre = (n - 1) / 2;
  // Tilt grows with the hand but never beyond ±11° at the ends; the arc sags a little at the ends.
  const perCard = n > 1 ? Math.min(2.5, 22 / (n - 1)) : 0;
  const sag = Math.min(18, 1.4 * n);
  const restTop = h - BASE_H * VISIBLE;
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const t = centre > 0 ? (i - centre) / centre : 0;
    slots.push({ x: startX + step * i, y: restTop + sag * t * t, rot: (i - centre) * perCard });
  }
  return { slots, step, startX, total };
}

/** The centre of a resting card, in band coordinates. A slot turns about its bottom centre, so the
 *  centre swings with the tilt; a card of the same size turned about its own centre by the same
 *  angle and placed here covers the slot exactly. */
export function slotCentre(s: Slot): { x: number; y: number } {
  const r = (s.rot * Math.PI) / 180;
  return { x: s.x + BASE_W / 2 + (BASE_H / 2) * Math.sin(r), y: s.y + BASE_H - (BASE_H / 2) * Math.cos(r) };
}
