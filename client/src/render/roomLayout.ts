import { BOARD, coordKey, getCard, type Coord, type RoomLayout } from 'shared';
import type { Pt, Rect } from './roomPacking';
import busyData from './boardBusyness.json';

// Room geometry the board and its scripts share: bounds, the rectangle a room's painting is
// stretched onto, where the name bubble sits, and where the weapon tokens should gather. Kept free
// of Vite-only imports (no import.meta.glob) so client/scripts can run it under plain tsx.

/** Board units per tile. */
export const TS = 26;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
  minX: number;
  minY: number;
}

export function roomBounds(room: RoomLayout): Bounds {
  const xs = room.tiles.map((t) => t.x);
  const ys = room.tiles.map((t) => t.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX * TS, y: minY * TS, w: (Math.max(...xs) - minX + 1) * TS, h: (Math.max(...ys) - minY + 1) * TS, minX, minY };
}

/**
 * Rooms painted by a single shared image, listed with the room whose title names the file first.
 * The image is stretched over the union of the group's bounding boxes and each room clips its own
 * share out of it, so a wall drawn between them lands on the tile boundary they actually share.
 * The Master Suite and its Walk-in Closet are one such pair: the closet is a 2x2 notch bitten out
 * of the suite, and together they fill one rectangle.
 */
const SHARED_ART: readonly (readonly string[])[] = [['room-master-suite', 'room-walk-in-closet']];

/** The group this room shares its art with, primary room first, or undefined if it paints alone. */
export function sharedArtGroup(roomId: string): readonly string[] | undefined {
  return SHARED_ART.find((group) => group.includes(roomId));
}

/** "Clock Tower" -> "clock_tower", matching how the art files are named. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Obstacles that stand INSIDE a room rather than beside it — the Courtyard's fountain, the
 *  Cemetery's graves. They are not room tiles, so a room's art would be clipped into a ring around
 *  them and they would be cut out of their own painting. Where the room has art, it paints them and
 *  the board's own stand-in for them stands down. */
export function insideObstacles(room: RoomLayout): Coord[] {
  const xs = room.tiles.map((t) => t.x);
  const ys = room.tiles.map((t) => t.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const own = new Set(room.tiles.map((t) => coordKey(t)));
  /** Does the room close in on this tile along `dir`, before the bounding box runs out? */
  const reaches = (c: Coord, dx: number, dy: number) => {
    for (let x = c.x + dx, y = c.y + dy; x >= minX && x <= maxX && y >= minY && y <= maxY; x += dx, y += dy) {
      if (own.has(coordKey({ x, y }))) return true;
    }
    return false;
  };
  return BOARD.cells.filter((c) => {
    if (c.type !== 'obstacle' && c.type !== 'fountain') return false;
    if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY || own.has(coordKey(c))) return false;
    // Enclosed, not merely inside the box: the room must close in on both sides along one axis.
    // That takes in the Cemetery's graves and the Courtyard's fountain while leaving out the tiles
    // bitten off an octagonal room's corners, which lie outside it and belong to the grounds.
    return (reaches(c, -1, 0) && reaches(c, 1, 0)) || (reaches(c, 0, -1) && reaches(c, 0, 1));
  });
}

/** Tiles a room's floor art is painted over: its own, plus the obstacles standing inside it. */
export function artTiles(room: RoomLayout): Coord[] {
  const extra = insideObstacles(room);
  return extra.length ? [...room.tiles, ...extra] : room.tiles;
}

/** The rectangle a room's floor art is stretched onto. Normally its own bounds; for rooms that
 *  share one painting it is the union of the group's bounds, so every room in the group lays the
 *  image down on the same rectangle and their shares line up. */
export function artBounds(room: RoomLayout): Rect {
  const group = sharedArtGroup(room.id);
  if (!group) return roomBounds(room);
  const boxes = group.map((id) => BOARD.rooms[id]).filter(Boolean).map(roomBounds);
  const x = Math.min(...boxes.map((r) => r.x));
  const y = Math.min(...boxes.map((r) => r.y));
  return { x, y, w: Math.max(...boxes.map((r) => r.x + r.w)) - x, h: Math.max(...boxes.map((r) => r.y + r.h)) - y };
}

/** Rooms whose name bubble sits away from the centre, in tiles — where the painting's centrepiece
 *  would otherwise be hidden under it (the Boat House's rowing boat). */
export const LABEL_NUDGE: Record<string, { dx: number; dy: number }> = {
  'room-boat-house': { dx: 0, dy: 0.65 },
};

export interface LabelGeom {
  /** True when the room's tiles fill its whole bounding box (drawn as one rectangle). */
  isRect: boolean;
  cx: number;
  cy: number;
  /** Font size of the name, and the bubble's size. */
  fs: number;
  w: number;
  h: number;
}

/** Tiles a room's bubble may sit over: its own tiles and any cut corners (the diagonal half nearest
 *  the room is floor). */
function bubbleFloor(room: RoomLayout): Set<string> {
  const keys = new Set(room.tiles.map((t) => coordKey(t)));
  for (const ch of BOARD.chamfers) if (ch.roomId === room.id) for (const t of ch.tiles) keys.add(coordKey(t));
  return keys;
}

/** Where a room's name bubble sits and how big it is (also the keep-out for tokens). It centres on
 *  the bounding box whenever the bubble lands wholly on floor there — a plain rectangle, but also an
 *  octagon like the Gazebo, or the Cemetery between its graves — and otherwise (an L-shape whose
 *  centre is the notch, the Courtyard whose centre is the fountain) on the board's label tile. */
export function labelGeom(room: RoomLayout, title: string): LabelGeom {
  const b = roomBounds(room);
  const isRect = room.tiles.length === (b.w / TS) * (b.h / TS);
  const fs = Math.max(6.5, Math.min(11, (b.w - 12) / (title.length * 0.62)));
  const w = Math.min(b.w - 4, title.length * fs * 0.6 + 12);
  const h = fs + 7;
  let cx = b.x + b.w / 2;
  let cy = b.y + b.h / 2;
  if (!isRect) {
    const floor = bubbleFloor(room);
    const inset = 1; // the bubble's outline may kiss a tile edge
    let fits = true;
    for (let ty = Math.floor((cy - h / 2 + inset) / TS); fits && ty <= Math.floor((cy + h / 2 - inset) / TS); ty++) {
      for (let tx = Math.floor((cx - w / 2 + inset) / TS); tx <= Math.floor((cx + w / 2 - inset) / TS); tx++) {
        if (!floor.has(coordKey({ x: tx, y: ty }))) {
          fits = false;
          break;
        }
      }
    }
    if (!fits) {
      cx = room.label.x * TS + TS / 2;
      cy = room.label.y * TS + TS / 2;
    }
  }
  const nudge = LABEL_NUDGE[room.id];
  if (nudge) {
    cx += nudge.dx * TS;
    cy += nudge.dy * TS;
  }
  return { isRect, cx, cy, fs, w, h };
}

// --- busyness of the painting ----------------------------------------------------------------

interface BusyGrid {
  cols: number;
  rows: number;
  /** Two hex characters per cell, rows top to bottom; 00 = flat floor, ff = the room's busiest. */
  cells: string;
}
const BUSY = busyData as Record<string, BusyGrid>;

/** The busyness grid measured from this room's painting (see scripts/boardBusyness.py), if any. A
 *  room that shares a painting reads the group's primary. */
export function busynessFor(room: RoomLayout): BusyGrid | undefined {
  const ids = [room.id, ...(sharedArtGroup(room.id) ?? [])];
  for (const id of ids) {
    const title = getCard(id)?.title;
    const g = (title && BUSY[slug(title)]) || BUSY[slug(id)] || BUSY[slug(id.replace(/^room-/, ''))];
    if (g) return g;
  }
  return undefined;
}

/** How busy the painting is at a board point, 0 (flat floor) to 1 (the room's busiest patch). */
function busyAt(g: BusyGrid, ab: Rect, x: number, y: number): number {
  const col = Math.max(0, Math.min(g.cols - 1, Math.floor(((x - ab.x) / ab.w) * g.cols)));
  const row = Math.max(0, Math.min(g.rows - 1, Math.floor(((y - ab.y) / ab.h) * g.rows)));
  const i = (row * g.cols + col) * 2;
  return parseInt(g.cells.slice(i, i + 2), 16) / 255;
}

const GAP = 2; // matches the packer's spacing between tokens
const EDGE = 1.5; // and its keep-out from the wall line

/** Rooms whose weapon spot is placed by hand, as fractions of the room's bounding box, where the
 *  measured search would land on the painting's centrepiece: the Boat House's weapons sit on the
 *  water beside the boat's bow rather than in the boat. */
export const WEAPON_SPOT: Record<string, { x: number; y: number }> = {
  'room-boat-house': { x: 0.26, y: 0.44 },
};

/**
 * Where the weapon tokens should gather in this room: the calmest patch of the painting that can
 * take a row of three tokens, clear of the name bubble and of the spot just under it where the
 * pawns collect. Above the bubble is preferred (the pawns are below, so the two clusters read as
 * separate groups), and a patch only wins a place lower down by being clearly calmer. A room with
 * no painting simply uses the spot just above its name.
 */
export function weaponAnchor(room: RoomLayout, lg: LabelGeom, reserved: Rect[], r: number): Pt {
  const pitch = 2 * r + GAP;
  const preferred: Pt = { x: lg.cx, y: lg.cy - lg.h / 2 - 2 - r };
  const pawns: Pt = { x: lg.cx, y: lg.cy + lg.h / 2 + r };
  const b = roomBounds(room);
  const fixed = WEAPON_SPOT[room.id];
  if (fixed) return { x: b.x + fixed.x * b.w, y: b.y + fixed.y * b.h };
  const g = busynessFor(room);
  if (!g) return preferred;
  const ab = artBounds(room);
  const tiles = new Set(room.tiles.map((t) => coordKey(t)));
  const onFloor = (x: number, y: number) => tiles.has(coordKey({ x: Math.floor(x / TS), y: Math.floor(y / TS) }));
  const fw = 3 * pitch; // the cluster's footprint: three tokens abreast
  const fh = pitch;
  const overlaps = (a: Rect, q: Rect) => a.x < q.x + q.w && a.x + a.w > q.x && a.y < q.y + q.h && a.y + a.h > q.y;
  const diag = Math.hypot(b.w, b.h);
  let best: { p: Pt; score: number } | undefined;
  const step = TS / 4;
  for (let cy = b.y + fh / 2 + EDGE; cy <= b.y + b.h - fh / 2 - EDGE; cy += step) {
    for (let cx = b.x + fw / 2 + EDGE; cx <= b.x + b.w - fw / 2 - EDGE; cx += step) {
      const rect: Rect = { x: cx - fw / 2 - EDGE, y: cy - fh / 2 - EDGE, w: fw + 2 * EDGE, h: fh + 2 * EDGE };
      // the whole footprint must be floor: check its corners and the midpoints of its long edges
      const xs = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
      const ys = [rect.y, rect.y + rect.h];
      if (!xs.every((x) => ys.every((y) => onFloor(x, y)))) continue;
      if (reserved.some((q) => overlaps(rect, q))) continue;
      // average the painting under the footprint
      let sum = 0;
      let n = 0;
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 6; i++) {
          sum += busyAt(g, ab, cx - fw / 2 + ((i + 0.5) * fw) / 6, cy - fh / 2 + ((j + 0.5) * fh) / 2);
          n++;
        }
      }
      let score = sum / n;
      if (cy > lg.cy) score += 0.12; // the pawns' side of the bubble
      if (Math.abs(cy - pawns.y) < pitch && Math.abs(cx - pawns.x) < fw) score += 1; // right where they gather
      score += (0.08 * Math.hypot(cx - preferred.x, cy - preferred.y)) / diag; // all else equal, stay near the name
      if (!best || score < best.score) best = { p: { x: cx, y: cy }, score };
    }
  }
  return best?.p ?? preferred;
}
