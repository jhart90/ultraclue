import { SUSPECTS } from './suspects';
import { WEAPONS } from './weapons';
import { ROOMS } from './rooms';

// ---------------------------------------------------------------------------------------------
// The mansion board, rebuilt as four themed sections (Grounds / Ground Floor / Upper Floor /
// Basement) stacked into one global grid and joined by stairs. Rooms are organic, varied-size
// footprints (not a uniform grid); the gaps between them are walkable path/corridor cells. Every
// other cell is non-walkable scenery rendered as art with NO grid square. Computed once at import
// and identical on client + server. Movement (BFS over buildAdjacency) lands in M6.
// ---------------------------------------------------------------------------------------------

export interface Coord {
  x: number;
  y: number;
}

export type SectionTheme = 'grounds' | 'ground-floor' | 'upper-floor' | 'basement';
export type CellType = 'room' | 'path';

export interface BoardCell {
  x: number;
  y: number;
  type: CellType; // only walkable cells exist; everything else is scenery (no cell)
  roomId?: string;
  sectionId: string;
}

export interface Doorway {
  roomId: string;
  roomTile: Coord;
  doorTile: Coord;
}

export type ShortcutKind = 'room' | 'world';
export interface Shortcut {
  id: string;
  kind: ShortcutKind;
  a: Coord;
  b: Coord;
  aRoomId?: string;
  bRoomId?: string;
}

/** Structural staircase joining two sections (not one of the 8 secret shortcuts). */
export interface StairLink {
  a: Coord;
  b: Coord;
}

export interface RoomLayout {
  id: string;
  sectionId: string;
  tiles: Coord[];
  entrances: Doorway[];
  label: Coord;
  weaponTile: Coord;
  weaponId: string;
  shortcutTile?: Coord;
}

export interface BoardSection {
  id: string;
  theme: SectionTheme;
  title: string;
  origin: Coord; // top-left of this section in global coords
  width: number;
  height: number;
}

export interface Board {
  width: number;
  height: number;
  cells: BoardCell[];
  sections: BoardSection[];
  rooms: Record<string, RoomLayout>;
  starts: { suspectId: string; tile: Coord }[];
  envelope: Coord;
  shortcuts: Shortcut[];
  stairs: StairLink[];
}

export const coordKey = (c: Coord): string => `${c.x},${c.y}`;

// ---- section authoring ----------------------------------------------------------------------

type Rect = [x: number, y: number, w: number, h: number];
interface SectionDef {
  id: string;
  theme: SectionTheme;
  title: string;
  width: number;
  height: number;
  rooms: { id: string; rects: Rect[] }[];
  paths: Rect[]; // walkable corridor/garden-path bands (rooms take precedence on overlap)
}

const GROUNDS: SectionDef = {
  id: 'grounds',
  theme: 'grounds',
  title: 'The Grounds',
  width: 26,
  height: 22,
  rooms: [
    { id: 'room-gazebo', rects: [[2, 1, 5, 4]] },
    { id: 'room-hedge-maze', rects: [[9, 1, 8, 6]] },
    { id: 'room-greenhouse', rects: [[19, 1, 6, 5]] },
    { id: 'room-orchard', rects: [[1, 9, 6, 5]] },
    { id: 'room-courtyard', rects: [[11, 9, 6, 5]] },
    { id: 'room-stables', rects: [[19, 8, 6, 6]] },
    { id: 'room-boat-house', rects: [[1, 17, 6, 4]] },
    { id: 'room-veranda', rects: [[9, 17, 5, 4]] },
    { id: 'room-cemetery', rects: [[16, 16, 5, 5]] },
    { id: 'room-master-suite', rects: [[23, 16, 2, 5]] },
    { id: 'room-walk-in-closet', rects: [[21, 18, 2, 2]] },
  ],
  paths: [[7, 0, 2, 22], [17, 0, 2, 22], [0, 6, 26, 2], [0, 14, 26, 2]],
};

const GROUND_FLOOR: SectionDef = {
  id: 'ground-floor',
  theme: 'ground-floor',
  title: 'Ground Floor',
  width: 26,
  height: 17,
  rooms: [
    { id: 'room-theatre', rects: [[1, 1, 7, 5]] },
    { id: 'room-ballroom', rects: [[10, 1, 7, 5]] },
    { id: 'room-library', rects: [[19, 1, 6, 4]] },
    { id: 'room-dining', rects: [[1, 8, 5, 4]] },
    { id: 'room-kitchen', rects: [[1, 13, 5, 3]] },
    { id: 'room-pantry', rects: [[7, 13, 3, 3]] },
    { id: 'room-parlour', rects: [[8, 8, 5, 4]] },
    { id: 'room-drawing', rects: [[15, 8, 5, 4]] },
    { id: 'room-lounge', rects: [[19, 7, 6, 4]] },
    { id: 'room-billiard', rects: [[12, 13, 8, 3]] },
  ],
  paths: [[6, 0, 2, 17], [13, 0, 2, 17], [0, 6, 26, 1], [0, 12, 26, 1], [17, 0, 2, 17]],
};

const UPPER_FLOOR: SectionDef = {
  id: 'upper-floor',
  theme: 'upper-floor',
  title: 'Upper Floor',
  width: 26,
  height: 17,
  rooms: [
    { id: 'room-study', rects: [[1, 1, 5, 4]] },
    { id: 'room-music', rects: [[8, 1, 6, 4]] },
    { id: 'room-gallery', rects: [[16, 1, 8, 4]] },
    { id: 'room-boudoir', rects: [[1, 7, 5, 4]] },
    { id: 'room-smoking', rects: [[8, 7, 5, 4]] },
    { id: 'room-trophy', rects: [[15, 7, 5, 4]] },
    { id: 'room-gymnasium', rects: [[19, 7, 6, 4]] },
    { id: 'room-den', rects: [[1, 13, 6, 3]] },
    { id: 'room-clock-tower', rects: [[9, 13, 4, 3]] },
    { id: 'room-solarium', rects: [[15, 13, 9, 3]] },
  ],
  paths: [[6, 0, 2, 17], [13, 0, 2, 17], [0, 5, 26, 2], [0, 11, 26, 2]],
};

const BASEMENT: SectionDef = {
  id: 'basement',
  theme: 'basement',
  title: 'Basement',
  width: 26,
  height: 15,
  rooms: [
    { id: 'room-wine-cellar', rects: [[1, 1, 6, 4]] },
    { id: 'room-chapel', rects: [[9, 1, 6, 5]] },
    { id: 'room-laboratory', rects: [[18, 1, 7, 4]] },
    { id: 'room-armory', rects: [[1, 7, 5, 4]] },
    { id: 'room-boiler', rects: [[8, 8, 5, 3]] },
    { id: 'room-workshop', rects: [[15, 7, 4, 4]] },
    { id: 'room-planetarium', rects: [[20, 7, 5, 4]] },
    { id: 'room-bathhouse', rects: [[1, 12, 7, 3]] },
    { id: 'room-sauna', rects: [[16, 12, 8, 3]] },
  ],
  paths: [[6, 0, 2, 15], [13, 0, 2, 15], [0, 5, 26, 2], [0, 11, 26, 1]],
};

const SECTION_DEFS = [GROUNDS, GROUND_FLOOR, UPPER_FLOOR, BASEMENT].map((s) => ({
  ...s,
  rooms: s.rooms.filter((r) => r.rects.length > 0),
}));

// 6 distant room-to-room secret passages + 2 open-world ones (filled in after assembly).
const ROOM_SHORTCUTS: [string, string][] = [
  ['room-gazebo', 'room-sauna'],
  ['room-greenhouse', 'room-wine-cellar'],
  ['room-boat-house', 'room-clock-tower'],
  ['room-stables', 'room-laboratory'],
  ['room-theatre', 'room-planetarium'],
  ['room-hedge-maze', 'room-chapel'],
];

const ORTHO = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function inRect(x: number, y: number, [rx, ry, rw, rh]: Rect): boolean {
  return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
}

/** Reorder so the middle element comes first (used to centre doors on each wall). */
function middleOut<T>(arr: T[]): T[] {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  const res: T[] = [arr[mid]];
  for (let off = 1; res.length < arr.length; off++) {
    if (mid - off >= 0) res.push(arr[mid - off]);
    if (mid + off < arr.length) res.push(arr[mid + off]);
  }
  return res;
}

/** Choose 2–5 doorways, centred on each wall and spread round-robin across the room's sides. */
function pickEntrances(cands: { side: string; door: Doorway }[]): Doorway[] {
  if (cands.length <= 2) return cands.map((c) => c.door);
  const target = Math.min(5, Math.max(2, Math.round(cands.length / 4)));
  const bySide = new Map<string, Doorway[]>();
  for (const c of cands) {
    const arr = bySide.get(c.side) ?? [];
    arr.push(c.door);
    bySide.set(c.side, arr);
  }
  const sideOrder = ['top', 'right', 'bottom', 'left'].filter((s) => bySide.has(s));
  for (const s of sideOrder) bySide.set(s, middleOut(bySide.get(s)!));
  const cursor = new Map(sideOrder.map((s) => [s, 0]));
  const picked: Doorway[] = [];
  while (picked.length < target) {
    let advanced = false;
    for (const s of sideOrder) {
      if (picked.length >= target) break;
      const arr = bySide.get(s)!;
      const i = cursor.get(s)!;
      if (i < arr.length) {
        picked.push(arr[i]);
        cursor.set(s, i + 1);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return picked;
}

function buildBoard(): Board {
  // Stack sections vertically with a 1-row void gap between them.
  let cursorY = 0;
  const sections: BoardSection[] = [];
  const placed = SECTION_DEFS.map((def) => {
    const origin = { x: 0, y: cursorY };
    sections.push({ id: def.id, theme: def.theme, title: def.title, origin, width: def.width, height: def.height });
    cursorY += def.height + 1;
    return { def, origin };
  });

  const width = Math.max(...SECTION_DEFS.map((s) => s.width));
  const height = cursorY - 1;

  const cells: BoardCell[] = [];
  const cellAt = new Map<string, BoardCell>();
  const rooms: Record<string, RoomLayout> = {};

  for (const { def, origin } of placed) {
    // classify every section-local cell: room wins over path; otherwise scenery (no cell).
    for (let ly = 0; ly < def.height; ly++) {
      for (let lx = 0; lx < def.width; lx++) {
        const gx = origin.x + lx;
        const gy = origin.y + ly;
        const room = def.rooms.find((r) => r.rects.some((rect) => inRect(lx, ly, rect)));
        const isPath = def.paths.some((rect) => inRect(lx, ly, rect));
        if (room) {
          const cell: BoardCell = { x: gx, y: gy, type: 'room', roomId: room.id, sectionId: def.id };
          cells.push(cell);
          cellAt.set(coordKey(cell), cell);
        } else if (isPath) {
          const cell: BoardCell = { x: gx, y: gy, type: 'path', sectionId: def.id };
          cells.push(cell);
          cellAt.set(coordKey(cell), cell);
        }
      }
    }

    // room layouts (tiles, label, weapon tile)
    def.rooms.forEach((r, ri) => {
      const tiles: Coord[] = cells
        .filter((c) => c.roomId === r.id)
        .map((c) => ({ x: c.x, y: c.y }));
      const xs = tiles.map((t) => t.x);
      const ys = tiles.map((t) => t.y);
      const roomIndex = ROOMS.findIndex((rm) => rm.id === r.id);
      rooms[r.id] = {
        id: r.id,
        sectionId: def.id,
        tiles,
        entrances: [],
        label: { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) },
        weaponTile: { x: Math.max(...xs), y: Math.max(...ys) },
        weaponId: WEAPONS[(roomIndex >= 0 ? roomIndex : ri) % WEAPONS.length].id,
      };
    });
  }

  // Doorways: each room gets 2–5 entrances (not enterable from every side), centred and spread
  // across its walls. (The Walk-in Closet keeps its single Master-Suite door, wired below.)
  for (const room of Object.values(rooms)) {
    if (room.id === 'room-walk-in-closet') continue;
    const candidates: { side: string; door: Doorway }[] = [];
    const seen = new Set<string>();
    for (const t of room.tiles) {
      for (const d of ORTHO) {
        const n = cellAt.get(coordKey({ x: t.x + d.x, y: t.y + d.y }));
        if (!n || n.type !== 'path') continue;
        const k = `${coordKey(t)}>${coordKey(n)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const side = d.y < 0 ? 'top' : d.y > 0 ? 'bottom' : d.x < 0 ? 'left' : 'right';
        candidates.push({ side, door: { roomId: room.id, roomTile: { x: t.x, y: t.y }, doorTile: { x: n.x, y: n.y } } });
      }
    }
    room.entrances = pickEntrances(candidates);
  }

  // Walk-in Closet: single door into an adjacent Master Suite tile (its only way in).
  {
    const closet = rooms['room-walk-in-closet'];
    const masterTiles = new Set(rooms['room-master-suite'].tiles.map(coordKey));
    let linked = false;
    for (const t of closet.tiles) {
      for (const d of ORTHO) {
        const nk = coordKey({ x: t.x + d.x, y: t.y + d.y });
        if (!linked && masterTiles.has(nk)) {
          const [mx, my] = nk.split(',').map(Number);
          closet.entrances = [{ roomId: closet.id, roomTile: t, doorTile: { x: mx, y: my } }];
          linked = true;
        }
      }
    }
  }

  // Stairs join consecutive sections at two corridor columns (cols 7 and 14, which are path bands).
  const stairs: StairLink[] = [];
  for (let i = 0; i < placed.length - 1; i++) {
    const top = placed[i];
    const bot = placed[i + 1];
    for (const col of [7, 14]) {
      const a = cellAt.get(coordKey({ x: col, y: top.origin.y + top.def.height - 1 }));
      const b = cellAt.get(coordKey({ x: col, y: bot.origin.y }));
      if (a && b && a.type === 'path' && b.type === 'path') stairs.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
    }
  }

  // Start tiles: 40 path cells spread across the board, assigned in suspect turn order.
  const pathCells = cells.filter((c) => c.type === 'path');
  const orderedSuspects = [...SUSPECTS].sort((a, b) => a.turnOrder - b.turnOrder);
  const starts = orderedSuspects.map((s, i) => {
    const cell = pathCells[Math.floor((i * pathCells.length) / orderedSuspects.length)];
    return { suspectId: s.id, tile: { x: cell.x, y: cell.y } };
  });

  // Envelope: a central path cell of the Ground Floor.
  const gf = placed[1];
  const envCandidate = cells.find(
    (c) => c.sectionId === 'ground-floor' && c.type === 'path' && c.x === 6 && c.y === gf.origin.y + 6,
  );
  const envelope = envCandidate ? { x: envCandidate.x, y: envCandidate.y } : { x: pathCells[0].x, y: pathCells[0].y };

  // Shortcuts.
  const shortcuts: Shortcut[] = [];
  ROOM_SHORTCUTS.forEach(([aId, bId], i) => {
    const a = rooms[aId].tiles[0];
    const b = rooms[bId].tiles[0];
    rooms[aId].shortcutTile = a;
    rooms[bId].shortcutTile = b;
    shortcuts.push({ id: `sc-room-${i + 1}`, kind: 'room', a, b, aRoomId: aId, bRoomId: bId });
  });
  // 2 world shortcuts between far-apart corridor cells.
  const top = pathCells[2];
  const bottom = pathCells[pathCells.length - 3];
  const topMid = pathCells[Math.floor(pathCells.length * 0.15)];
  const botMid = pathCells[Math.floor(pathCells.length * 0.85)];
  shortcuts.push({ id: 'sc-world-1', kind: 'world', a: { x: top.x, y: top.y }, b: { x: bottom.x, y: bottom.y } });
  shortcuts.push({ id: 'sc-world-2', kind: 'world', a: { x: topMid.x, y: topMid.y }, b: { x: botMid.x, y: botMid.y } });

  return { width, height, cells, sections, rooms, starts, envelope, shortcuts, stairs };
}

export const BOARD: Board = buildBoard();

// ---- movement graph -------------------------------------------------------------------------

export function buildAdjacency(board: Board, includeShortcuts = true): Map<string, string[]> {
  const byKey = new Map<string, BoardCell>();
  for (const c of board.cells) byKey.set(coordKey(c), c);

  const adj = new Map<string, string[]>();
  const link = (a: Coord, b: Coord) => {
    const ak = coordKey(a);
    const bk = coordKey(b);
    if (!adj.has(ak)) adj.set(ak, []);
    if (!adj.has(bk)) adj.set(bk, []);
    if (!adj.get(ak)!.includes(bk)) adj.get(ak)!.push(bk);
    if (!adj.get(bk)!.includes(ak)) adj.get(bk)!.push(ak);
  };

  for (const c of board.cells) {
    for (const d of ORTHO) {
      const n = byKey.get(coordKey({ x: c.x + d.x, y: c.y + d.y }));
      if (!n) continue;
      if (c.type === 'path' && n.type === 'path') link(c, n);
      else if (c.type === 'room' && n.type === 'room' && c.roomId === n.roomId) link(c, n);
    }
  }
  for (const room of Object.values(board.rooms)) {
    for (const e of room.entrances) link(e.roomTile, e.doorTile);
  }
  for (const s of board.stairs) link(s.a, s.b); // structural — always connected
  if (includeShortcuts) for (const sc of board.shortcuts) link(sc.a, sc.b);

  return adj;
}
