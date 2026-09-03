import type { Coord } from 'shared';

// Packs the tokens standing in a room — player pawns and weapon tokens — onto a lattice of slots
// that all lie strictly inside the room's own tiles, never on its border and never over a notch.
// The lattice pitch is the largest that gives every token a slot, so a couple of pawns sit at full
// size and a crowd of forty shrinks and closes ranks. Weapons take the topmost slots (they read as
// sitting on the mantel); pawns gather just under the name bubble and spread outward from there.

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackOptions {
  /** The room's tiles, in tile coordinates. */
  tiles: Coord[];
  /** Tile size in board units. */
  ts: number;
  /** Areas tokens must stay off (the name bubble, a staircase icon). */
  reserved: Rect[];
  pawns: number;
  weapons: number;
  /** Token radius to start from (a lone pawn's size) and the smallest we'll shrink to. */
  rMax: number;
  rMin?: number;
  /** Pawns fill outward from here — normally just under the name bubble. */
  anchor: Pt;
  /** Weapons fill from the slot nearest here — normally the middle of the top wall. */
  top: Pt;
}

export interface Packing {
  /** The token radius everything in this room is drawn at. */
  r: number;
  pawnSlots: Pt[];
  weaponSlots: Pt[];
  /** True when even the smallest lattice couldn't seat everyone; slots are then reused. */
  overflow: boolean;
}

const GAP = 2; // clear space between neighbouring tokens
const EDGE = 1.5; // keep-out from the room's wall line
const STEP = 0.5; // radius shrink per attempt

function circleHitsRect(c: Pt, r: number, q: Rect): boolean {
  const nx = Math.max(q.x, Math.min(c.x, q.x + q.w));
  const ny = Math.max(q.y, Math.min(c.y, q.y + q.h));
  const dx = c.x - nx;
  const dy = c.y - ny;
  return dx * dx + dy * dy < r * r;
}

/** All lattice points whose token (radius r, plus the wall keep-out) sits inside the room. */
function slotsFor(tiles: Set<string>, bounds: Rect, ts: number, r: number, reserved: Rect[]): Pt[] {
  const inTile = (x: number, y: number) => tiles.has(`${Math.floor(x / ts)},${Math.floor(y / ts)}`);
  const rr = r + EDGE;
  // A token's bounding square is never wider than a tile (r <= ts/2), so if its four corners all
  // fall on room tiles the whole square does — including across a concave corner.
  const fits = (x: number, y: number) => inTile(x - rr, y - rr) && inTile(x + rr, y - rr) && inTile(x - rr, y + rr) && inTile(x + rr, y + rr);
  const pitch = 2 * r + GAP;
  const cols = Math.floor(bounds.w / pitch);
  const rows = Math.floor(bounds.h / pitch);
  const x0 = bounds.x + (bounds.w - cols * pitch) / 2 + pitch / 2;
  const y0 = bounds.y + (bounds.h - rows * pitch) / 2 + pitch / 2;
  const out: Pt[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = { x: x0 + i * pitch, y: y0 + j * pitch };
      if (!fits(p.x, p.y)) continue;
      if (reserved.some((q) => circleHitsRect(p, r + 1, q))) continue;
      out.push(p);
    }
  }
  return out;
}

const dist2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function packRoom(o: PackOptions): Packing {
  const need = o.pawns + o.weapons;
  const tiles = new Set(o.tiles.map((t) => `${t.x},${t.y}`));
  const xs = o.tiles.map((t) => t.x);
  const ys = o.tiles.map((t) => t.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const bounds: Rect = {
    x: minX * o.ts,
    y: minY * o.ts,
    w: (Math.max(...xs) - minX + 1) * o.ts,
    h: (Math.max(...ys) - minY + 1) * o.ts,
  };
  const rMin = o.rMin ?? 2.5;
  if (need === 0) return { r: o.rMax, pawnSlots: [], weaponSlots: [], overflow: false };

  let r = o.rMax;
  let slots = slotsFor(tiles, bounds, o.ts, r, o.reserved);
  while (slots.length < need && r - STEP >= rMin) {
    r = Math.round((r - STEP) * 2) / 2;
    slots = slotsFor(tiles, bounds, o.ts, r, o.reserved);
  }
  // Last resort for a room too small even at the minimum size: let go of the reserved areas,
  // and if that still isn't enough, seat the extras on already-taken slots (still inside).
  if (slots.length < need) slots = slotsFor(tiles, bounds, o.ts, r, []);
  if (slots.length === 0) slots = [{ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }];
  const overflow = slots.length < need;

  const take = (from: Pt[], n: number, score: (p: Pt) => number): Pt[] => {
    const sorted = [...from].sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
    const picked: Pt[] = [];
    for (let i = 0; i < n; i++) picked.push(sorted[i % sorted.length]);
    return picked;
  };
  // Weapons first: the topmost slots, centred on the top wall's midpoint.
  const weaponSlots = take(slots, o.weapons, (p) => p.y * 1000 + Math.abs(p.x - o.top.x));
  const usedW = new Set(weaponSlots.map((p) => `${p.x},${p.y}`));
  const rest = slots.filter((p) => !usedW.has(`${p.x},${p.y}`));
  const pawnSlots = take(rest.length ? rest : slots, o.pawns, (p) => dist2(p, o.anchor));
  return { r, pawnSlots, weaponSlots, overflow };
}
