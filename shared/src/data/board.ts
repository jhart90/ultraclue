import { SUSPECTS } from './suspects';
import { WEAPONS } from './weapons';
import { ROOMS } from './rooms';

// ---------------------------------------------------------------------------------------------
// The mansion board. Four themed sections laid out in 2D and joined by shared border halls:
//
//                         [   The Grounds   ]
//        [ Upper Floor ]  [  Ground Floor   ]  [ Basement ]
//
// The Grounds sit directly above the Ground Floor and merge seamlessly (full-width hall). The
// Upper Floor abuts the Ground Floor's left edge, the Basement its right edge. So by geometry:
//   - the Grounds connect only to the Ground Floor (+ a Cellar-stairs link to the Basement);
//   - the Upper Floor connects only to the Ground Floor (+ the Elevator);
//   - the Basement connects only to the Ground Floor (+ the Elevator + Cellar stairs).
// A 3x3 Elevator on each indoor floor lets a player ride to another indoor floor (chosen on
// arrival). The Elevator is not a room: you can't stop, suspect, or accuse in it, and it has no
// card. Computed once at import and identical on client + server.
// ---------------------------------------------------------------------------------------------

export interface Coord {
  x: number;
  y: number;
}

export type SectionTheme = 'grounds' | 'ground-floor' | 'upper-floor' | 'basement';
export type FloorId = 'ground-floor' | 'upper-floor' | 'basement';
export type CellType = 'room' | 'path' | 'elevator';

export interface BoardCell {
  x: number;
  y: number;
  type: CellType;
  roomId?: string;
  elevatorFloor?: FloorId;
  cellar?: boolean; // path tile that is a cellar-stairs landing
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
  origin: Coord;
  width: number;
  height: number;
}

export interface ElevatorInfo {
  floor: FloorId;
  cells: Coord[];
  exit: Coord; // tile a rider lands on when arriving at this floor
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
  elevators: ElevatorInfo[];
  /** Cellar stairs: a free link between a Grounds tile and a Basement tile. */
  cellarLink: { a: Coord; b: Coord };
}

export const coordKey = (c: Coord): string => `${c.x},${c.y}`;

const ORTHO = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

// ---- section authoring via a cell grid -------------------------------------------------------
// Each section has a 1-tile border hall plus interior band columns/rows; the rectangular regions
// between them are filled per `grid` (a room id, or a token: ELEV / ENV / CELLAR / '' = open hall).

interface SectionDef {
  id: string;
  theme: SectionTheme;
  title: string;
  w: number;
  h: number;
  vbands: number[]; // interior hall columns
  hbands: number[]; // interior hall rows
  grid: string[][]; // [rowRegion][colRegion]
  // Which borders stay a hall. A kept border is the seam shared with the neighbouring section
  // (needed for cross-floor connectivity); a dropped border lets the rooms abut the board edge.
  keep: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

const ROOM_W = 26;
const ROOM_H = 18;
const GROUNDS_H = 20;
const SIDE_W = 22;

const GROUND_FLOOR: SectionDef = {
  id: 'ground-floor',
  theme: 'ground-floor',
  title: 'Ground Floor',
  w: ROOM_W,
  h: ROOM_H,
  vbands: [8, 17],
  hbands: [5, 9, 13],
  // Top seam -> Grounds, left seam -> Upper, right seam -> Basement; only the bottom is an open edge.
  keep: { top: true, right: true, bottom: false, left: true },
  grid: [
    ['room-theatre', 'room-ballroom', 'room-library'],
    ['room-dining', 'ELEV', 'room-lounge'],
    ['room-kitchen', 'room-parlour', 'room-drawing'],
    ['room-pantry', 'ENV', 'room-billiard'],
  ],
};

const UPPER_FLOOR: SectionDef = {
  id: 'upper-floor',
  theme: 'upper-floor',
  title: 'Upper Floor',
  w: SIDE_W,
  h: ROOM_H,
  vbands: [7, 14],
  hbands: [5, 9, 13],
  // Only the right seam (-> Ground Floor) stays a hall; top, left and bottom are open edges.
  keep: { top: false, right: true, bottom: false, left: false },
  grid: [
    ['room-study', 'room-music', 'room-gallery'],
    ['room-boudoir', 'ELEV', 'room-smoking'],
    ['room-trophy', 'room-den', 'room-clock-tower'],
    ['room-gymnasium', '', 'room-solarium'],
  ],
};

const BASEMENT: SectionDef = {
  id: 'basement',
  theme: 'basement',
  title: 'Basement',
  w: SIDE_W,
  h: ROOM_H,
  vbands: [7, 14],
  hbands: [5, 9, 13],
  // Only the left seam (-> Ground Floor) stays a hall; top, right and bottom are open edges.
  keep: { top: false, right: false, bottom: false, left: true },
  grid: [
    ['room-wine-cellar', 'room-chapel', 'room-laboratory'],
    ['room-armory', 'ELEV', 'room-boiler'],
    ['room-workshop', 'room-planetarium', 'room-bathhouse'],
    ['room-sauna', 'CELLAR', ''],
  ],
};

const GROUNDS: SectionDef = {
  id: 'grounds',
  theme: 'grounds',
  title: 'The Grounds',
  w: ROOM_W,
  h: GROUNDS_H,
  vbands: [6, 13, 20],
  hbands: [6, 13],
  // Only the bottom seam (-> Ground Floor) stays a hall; top, left and right are open edges.
  keep: { top: false, right: false, bottom: true, left: false },
  grid: [
    ['room-gazebo', 'room-hedge-maze', 'room-greenhouse', 'room-stables'],
    ['room-orchard', 'room-courtyard', 'room-master-suite', 'CELLAR'],
    ['room-boat-house', 'room-veranda', 'room-cemetery', ''],
  ],
};

const SECTION_DEFS = [GROUNDS, GROUND_FLOOR, UPPER_FLOOR, BASEMENT];

// 2D placement (see header diagram).
const ORIGIN: Record<string, Coord> = {
  grounds: { x: SIDE_W, y: 0 },
  'ground-floor': { x: SIDE_W, y: GROUNDS_H },
  'upper-floor': { x: 0, y: GROUNDS_H },
  basement: { x: SIDE_W + ROOM_W, y: GROUNDS_H },
};

// 6 distant room-to-room secret passages + 2 world ones.
const ROOM_SHORTCUTS: [string, string][] = [
  ['room-gazebo', 'room-sauna'],
  ['room-greenhouse', 'room-wine-cellar'],
  ['room-boat-house', 'room-clock-tower'],
  ['room-stables', 'room-laboratory'],
  ['room-theatre', 'room-planetarium'],
  ['room-hedge-maze', 'room-chapel'],
];

const CLOSET_ID = 'room-walk-in-closet';
const MASTER_ID = 'room-master-suite';

/** Hall lines for one axis: the interior bands plus whichever of the two borders are kept. */
function splitLines(size: number, bands: number[], keepLow: boolean, keepHigh: boolean): number[] {
  return [...new Set([...bands, ...(keepLow ? [0] : []), ...(keepHigh ? [size - 1] : [])])].sort((a, b) => a - b);
}

/** Maximal runs of non-hall indices in [0, size-1], as [start, end] inclusive pairs. A run that
 *  touches a dropped border extends all the way to the board edge (0 or size-1). */
function regionsOver(size: number, lines: number[]): [number, number][] {
  const hall = new Set(lines);
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < size; i++) {
    if (hall.has(i)) {
      if (start >= 0) {
        out.push([start, i - 1]);
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }
  if (start >= 0) out.push([start, size - 1]);
  return out;
}

function buildBoard(): Board {
  const cellAt = new Map<string, BoardCell>();
  const cells: BoardCell[] = [];
  const sections: BoardSection[] = [];
  const rooms: Record<string, RoomLayout> = {};
  const elevators: ElevatorInfo[] = [];
  let envelope: Coord = { x: 0, y: 0 };
  const cellarTiles: Record<string, Coord> = {}; // sectionId -> a cellar landing tile

  const put = (cell: BoardCell) => {
    cells.push(cell);
    cellAt.set(coordKey(cell), cell);
  };

  for (const def of SECTION_DEFS) {
    const origin = ORIGIN[def.id];
    sections.push({ id: def.id, theme: def.theme, title: def.title, origin, width: def.w, height: def.h });
    const cols = splitLines(def.w, def.vbands, def.keep.left, def.keep.right);
    const rows = splitLines(def.h, def.hbands, def.keep.top, def.keep.bottom);
    const colRegions = regionsOver(def.w, cols);
    const rowRegions = regionsOver(def.h, rows);
    const isPathCol = new Set(cols);
    const isPathRow = new Set(rows);

    const roomTiles: Record<string, Coord[]> = {};

    for (let ly = 0; ly < def.h; ly++) {
      for (let lx = 0; lx < def.w; lx++) {
        const gx = origin.x + lx;
        const gy = origin.y + ly;
        if (isPathCol.has(lx) || isPathRow.has(ly)) {
          put({ x: gx, y: gy, type: 'path', sectionId: def.id });
          continue;
        }
        const ri = rowRegions.findIndex(([s, e]) => ly >= s && ly <= e);
        const ci = colRegions.findIndex(([s, e]) => lx >= s && lx <= e);
        const token = def.grid[ri]?.[ci] ?? '';
        if (token.startsWith('room-')) {
          put({ x: gx, y: gy, type: 'room', roomId: token, sectionId: def.id });
          (roomTiles[token] ??= []).push({ x: gx, y: gy });
        } else if (token === 'ELEV') {
          // a 3x3 elevator centred in the region; the rest of the region is hall
          const [rs, re] = rowRegions[ri];
          const [cs, ce] = colRegions[ci];
          const ex = Math.floor((cs + ce) / 2);
          const ey = Math.floor((rs + re) / 2);
          const inElev = lx >= ex - 1 && lx <= ex + 1 && ly >= ey - 1 && ly <= ey + 1;
          put(
            inElev
              ? { x: gx, y: gy, type: 'elevator', elevatorFloor: def.id as FloorId, sectionId: def.id }
              : { x: gx, y: gy, type: 'path', sectionId: def.id },
          );
        } else if (token === 'CELLAR') {
          const [rs, re] = rowRegions[ri];
          const [cs, ce] = colRegions[ci];
          const lx0 = Math.floor((cs + ce) / 2);
          const ly0 = Math.floor((rs + re) / 2);
          const isCellar = (lx === lx0 || lx === lx0 + 1) && ly === ly0;
          const cell: BoardCell = { x: gx, y: gy, type: 'path', sectionId: def.id, cellar: isCellar };
          put(cell);
          if (isCellar && lx === lx0) cellarTiles[def.id] = { x: gx, y: gy };
        } else if (token === 'ENV') {
          const [rs, re] = rowRegions[ri];
          const [cs, ce] = colRegions[ci];
          const cx2 = Math.floor((cs + ce) / 2);
          const cy2 = Math.floor((rs + re) / 2);
          put({ x: gx, y: gy, type: 'path', sectionId: def.id });
          if (lx === cx2 && ly === cy2) envelope = { x: gx, y: gy };
        } else {
          put({ x: gx, y: gy, type: 'path', sectionId: def.id });
        }
      }
    }

    // elevator info for this section (if any)
    const elevCells = cells.filter((c) => c.sectionId === def.id && c.type === 'elevator');
    if (elevCells.length) {
      // exit tile = a path tile orthogonally adjacent to the elevator
      let exit = { x: elevCells[0].x, y: elevCells[0].y };
      for (const e of elevCells) {
        for (const d of ORTHO) {
          const n = cellAt.get(coordKey({ x: e.x + d.x, y: e.y + d.y }));
          if (n && n.type === 'path') {
            exit = { x: n.x, y: n.y };
          }
        }
      }
      elevators.push({ floor: def.id as FloorId, cells: elevCells.map((c) => ({ x: c.x, y: c.y })), exit });
    }

    // room layouts
    for (const [roomId, tiles] of Object.entries(roomTiles)) {
      const xs = tiles.map((t) => t.x);
      const ys = tiles.map((t) => t.y);
      const roomIndex = ROOMS.findIndex((r) => r.id === roomId);
      rooms[roomId] = {
        id: roomId,
        sectionId: def.id,
        tiles,
        entrances: [],
        label: { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) },
        weaponTile: { x: Math.max(...xs), y: Math.max(...ys) },
        weaponId: WEAPONS[(roomIndex >= 0 ? roomIndex : 0) % WEAPONS.length].id,
      };
    }
  }

  // Walk-in Closet: carve a 2x2 annex out of the Master Suite's far corner, joined by one door.
  carveCloset(cells, cellAt, rooms);

  // Doorways: 2–5 per room, centred and spread; closet handled above.
  for (const room of Object.values(rooms)) {
    if (room.id === CLOSET_ID) continue;
    room.entrances = pickEntrances(collectCandidates(room, cellAt));
  }

  // Cellar stairs: free link between the Grounds landing and the Basement landing.
  const cellarLink = { a: cellarTiles['grounds'], b: cellarTiles['basement'] };

  // Start tiles: 40 path cells spread across the board, in suspect turn order.
  const pathCells = cells.filter((c) => c.type === 'path' && !c.cellar);
  const orderedSuspects = [...SUSPECTS].sort((a, b) => a.turnOrder - b.turnOrder);
  const starts = orderedSuspects.map((s, i) => {
    const cell = pathCells[Math.floor((i * pathCells.length) / orderedSuspects.length)];
    return { suspectId: s.id, tile: { x: cell.x, y: cell.y } };
  });

  // Shortcuts.
  const shortcuts: Shortcut[] = [];
  ROOM_SHORTCUTS.forEach(([aId, bId], i) => {
    const a = rooms[aId].tiles[0];
    const b = rooms[bId].tiles[0];
    rooms[aId].shortcutTile = a;
    rooms[bId].shortcutTile = b;
    shortcuts.push({ id: `sc-room-${i + 1}`, kind: 'room', a, b, aRoomId: aId, bRoomId: bId });
  });
  const top = pathCells[Math.floor(pathCells.length * 0.1)];
  const bottom = pathCells[Math.floor(pathCells.length * 0.9)];
  const tl = pathCells[Math.floor(pathCells.length * 0.3)];
  const br = pathCells[Math.floor(pathCells.length * 0.7)];
  shortcuts.push({ id: 'sc-world-1', kind: 'world', a: { x: top.x, y: top.y }, b: { x: bottom.x, y: bottom.y } });
  shortcuts.push({ id: 'sc-world-2', kind: 'world', a: { x: tl.x, y: tl.y }, b: { x: br.x, y: br.y } });

  const width = Math.max(...cells.map((c) => c.x)) + 1;
  const height = Math.max(...cells.map((c) => c.y)) + 1;

  return { width, height, cells, sections, rooms, starts, envelope, shortcuts, elevators, cellarLink };
}

function collectCandidates(
  room: RoomLayout,
  cellAt: Map<string, BoardCell>,
): { side: string; door: Doorway }[] {
  const seen = new Set<string>();
  const out: { side: string; door: Doorway }[] = [];
  for (const t of room.tiles) {
    for (const d of ORTHO) {
      const n = cellAt.get(coordKey({ x: t.x + d.x, y: t.y + d.y }));
      if (!n || n.type !== 'path') continue;
      const k = `${coordKey(t)}>${coordKey(n)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const side = d.y < 0 ? 'top' : d.y > 0 ? 'bottom' : d.x < 0 ? 'left' : 'right';
      out.push({ side, door: { roomId: room.id, roomTile: { x: t.x, y: t.y }, doorTile: { x: n.x, y: n.y } } });
    }
  }
  return out;
}

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

/** Turn the far 2x2 corner of the Master Suite into the Walk-in Closet, joined by one inner door. */
function carveCloset(cells: BoardCell[], cellAt: Map<string, BoardCell>, rooms: Record<string, RoomLayout>): void {
  const master = rooms[MASTER_ID];
  const xs = master.tiles.map((t) => t.x);
  const ys = master.tiles.map((t) => t.y);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  // top-right 2x2 of the suite becomes the closet
  const closetCoords = [
    { x: maxX - 1, y: minY },
    { x: maxX, y: minY },
    { x: maxX - 1, y: minY + 1 },
    { x: maxX, y: minY + 1 },
  ];
  const closetKeys = new Set(closetCoords.map(coordKey));
  for (const c of cells) {
    if (closetKeys.has(coordKey(c))) {
      c.roomId = CLOSET_ID;
    }
  }
  master.tiles = master.tiles.filter((t) => !closetKeys.has(coordKey(t)));
  // recompute master label/weapon
  {
    const mxs = master.tiles.map((t) => t.x);
    const mys = master.tiles.map((t) => t.y);
    master.label = { x: Math.round((Math.min(...mxs) + Math.max(...mxs)) / 2), y: Math.round((Math.min(...mys) + Math.max(...mys)) / 2) };
    master.weaponTile = { x: Math.max(...mxs), y: Math.max(...mys) };
  }
  const closetTiles = closetCoords;
  const sectionId = master.sectionId;
  rooms[CLOSET_ID] = {
    id: CLOSET_ID,
    sectionId,
    tiles: closetTiles,
    entrances: [
      // single inner door from the closet's bottom-left tile into the suite tile beneath it
      {
        roomId: CLOSET_ID,
        roomTile: { x: maxX - 1, y: minY + 1 },
        doorTile: { x: maxX - 1, y: minY + 2 },
      },
    ],
    label: { x: maxX - 1, y: minY + 1 },
    weaponTile: { x: maxX, y: minY + 1 },
    weaponId: WEAPONS[ROOMS.findIndex((r) => r.id === CLOSET_ID) % WEAPONS.length].id,
  };
  void cellAt;
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
      // halls connect to halls and to elevator cells (entry); rooms only join same-room tiles.
      const aWalk = c.type === 'path' || c.type === 'elevator';
      const bWalk = n.type === 'path' || n.type === 'elevator';
      if (aWalk && bWalk) link(c, n);
      else if (c.type === 'room' && n.type === 'room' && c.roomId === n.roomId) link(c, n);
    }
  }
  for (const room of Object.values(board.rooms)) {
    for (const e of room.entrances) link(e.roomTile, e.doorTile);
  }
  // Cellar stairs: a free Grounds <-> Basement link.
  if (board.cellarLink.a && board.cellarLink.b) link(board.cellarLink.a, board.cellarLink.b);
  if (includeShortcuts) for (const sc of board.shortcuts) link(sc.a, sc.b);

  return adj;
}
