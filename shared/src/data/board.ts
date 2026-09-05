import { SUSPECTS } from './suspects';
import { WEAPONS } from './weapons';
import { ROOMS } from './rooms';
import { ROOM_KEY, SECTION_MAPS, type SectionMap } from './boardMaps';

// ---------------------------------------------------------------------------------------------
// The mansion board, built from the hand-authored section maps in boardMaps.ts:
//
//                         [   The Grounds   ]
//        [ Upper Floor ]  [  Ground Floor   ]  [ Basement ]
//
// The Grounds sit directly above the Ground Floor and share the front terrace (two open rows).
// The Upper Floor and Basement are drawn either side of the Ground Floor across a 2-tile gap that
// nothing walks over: staircases (free links between landing tiles) and the elevator join the
// floors. Computed once at import and identical on client + server.
// ---------------------------------------------------------------------------------------------

export interface Coord {
  x: number;
  y: number;
}

export type SectionTheme = 'grounds' | 'ground-floor' | 'upper-floor' | 'basement';
export type FloorId = 'ground-floor' | 'upper-floor' | 'basement';
export type CellType = 'room' | 'path' | 'elevator' | 'fountain' | 'obstacle';
export type ObstacleKind = 'water' | 'lawn' | 'hedge' | 'wall' | 'chamfer';
export type ChamferCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface BoardCell {
  x: number;
  y: number;
  type: CellType;
  roomId?: string;
  elevatorFloor?: FloorId;
  obstacleKind?: ObstacleKind;
  landing?: boolean; // path tile that is a staircase landing
  sectionId: string;
}

export interface Doorway {
  roomId: string;
  roomTile: Coord;
  doorTile: Coord; // the tile the door opens onto: a hall tile, or a tile of the adjoining room
}

export type ShortcutKind = 'room';
export interface Shortcut {
  id: string;
  kind: ShortcutKind;
  a: Coord;
  b: Coord;
  aRoomId: string;
  bRoomId: string;
  story: string;
}

/** A room corner cut on the diagonal. Its tiles are obstacles (nothing walks on them); the room's
 *  art and border cross them corner to corner, so the half nearest the room reads as room and the
 *  rest as the hall or lawn around it. One tile gives a 45-degree cut; two in a row, a shallower
 *  slant. `corner` names which corner of the room the cut is on. */
export interface Chamfer {
  roomId: string;
  corner: ChamferCorner;
  tiles: Coord[];
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
  exit: Coord; // default landing tile (first free exit is used at ride time)
  exits: Coord[]; // every hall tile a rider may step out onto
}

/** A staircase: a free link between landing tiles on two sections. `a[i]` pairs with `b[i]`. */
export interface StairLink {
  id: string;
  title: string;
  from: string; // section id of the `a` landings
  to: string; // section id of the `b` landings
  a: Coord[];
  b: Coord[];
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
  stairs: StairLink[];
  /** The 4x3 fountain in the middle of the walled Courtyard — an obstacle pieces walk around. */
  fountain: Coord[];
  /** Room corners cut on the diagonal (the round Planetarium, the octagonal Gazebo). */
  chamfers: Chamfer[];
}

export const coordKey = (c: Coord): string => `${c.x},${c.y}`;

const ORTHO = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

// ---- 2D placement ----------------------------------------------------------------------------
const GAP = 2;
const sizeOf = (m: SectionMap) => ({ w: m.tiles[0].length, h: m.tiles.length });
const M = Object.fromEntries(SECTION_MAPS.map((m) => [m.id, m])) as Record<string, SectionMap>;
const UPPER_W = sizeOf(M['upper-floor']).w;
const GROUND_W = sizeOf(M['ground-floor']).w;
const GROUNDS_H = sizeOf(M['grounds']).h;
const ORIGIN: Record<string, Coord> = {
  'upper-floor': { x: 0, y: GROUNDS_H },
  grounds: { x: UPPER_W + GAP, y: 0 },
  'ground-floor': { x: UPPER_W + GAP, y: GROUNDS_H },
  basement: { x: UPPER_W + GAP + GROUND_W + GAP, y: GROUNDS_H },
};
const THEME_OF: Record<string, SectionTheme> = {
  grounds: 'grounds',
  'ground-floor': 'ground-floor',
  'upper-floor': 'upper-floor',
  basement: 'basement',
};

/** Section-local coord -> board coord. */
export const local = (sectionId: string, x: number, y: number): Coord => ({ x: ORIGIN[sectionId].x + x, y: ORIGIN[sectionId].y + y });

// ---- staircases (free links; landing i on one side pairs with landing i on the other) ---------
interface StairDef {
  id: string;
  title: string;
  from: string;
  to: string;
  a: [number, number][];
  b: [number, number][];
}
const STAIR_DEFS: StairDef[] = [
  // The grand staircase sweeps from the entrance hall up to the upper landing: three tiles wide.
  { id: 'stairs-grand', title: 'Grand staircase', from: 'ground-floor', to: 'upper-floor', a: [[0, 9], [0, 10], [0, 11]], b: [[23, 9], [23, 10], [23, 11]] },
  // The Clock Tower's spiral stair drops from the tower landing to the front hall below.
  { id: 'stairs-spiral', title: 'Clock Tower spiral stair', from: 'upper-floor', to: 'ground-floor', a: [[23, 2]], b: [[0, 2]] },
  // Garden steps run down from the Solarium terrace into the Rose Garden.
  { id: 'stairs-garden', title: 'Garden steps', from: 'upper-floor', to: 'grounds', a: [[8, 0]], b: [[5, 11]] },
  // The back stairs: a plain servants' flight from beside the Music Room up to the private wing.
  { id: 'stairs-back-west', title: 'Back stairs', from: 'ground-floor', to: 'upper-floor', a: [[0, 17], [0, 18]], b: [[23, 17], [23, 18]] },
  // The scullery stair drops from the Billiard Room passage down beside the Gymnasium.
  { id: 'stairs-scullery', title: 'Scullery stair', from: 'ground-floor', to: 'basement', a: [[29, 17], [29, 18]], b: [[0, 17], [0, 18]] },
  // The servants' stair drops from the Kitchen passage straight down to the Pantry.
  { id: 'stairs-servants', title: "Servants' stair", from: 'ground-floor', to: 'basement', a: [[29, 5], [29, 6]], b: [[0, 5], [0, 6]] },
  // The cellar hatch in the kitchen yard opens onto the Wine Cellar passage.
  { id: 'stairs-cellar', title: 'Cellar hatch', from: 'grounds', to: 'basement', a: [[29, 14]], b: [[0, 1]] },
];

// ---- secret passages (each with a story, each linking rooms a long walk apart) --------------
const PASSAGE_DEFS: [string, string, string][] = [
  ['room-chapel', 'room-cemetery', 'Down through the crypt'],
  ['room-smoking', 'room-stables', 'The old coal chute'],
  ['room-clock-tower', 'room-boiler', 'Down the weight shaft'],
  ['room-laboratory', 'room-gazebo', "Dr Orchid's poison garden"],
  ['room-theatre', 'room-workshop', 'The trapdoor under the stage'],
  ['room-boat-house', 'room-bunker', "The smugglers' tunnel"],
  ['room-walk-in-closet', 'room-wine-cellar', 'The empty barrel'],
  ['room-trophy', 'room-armory', 'Behind the bear'],
];

// ---- chamfers: room corners cut on the diagonal, on the '/' tiles of the maps -------------------
interface ChamferDef {
  room: string;
  section: string;
  corner: ChamferCorner;
  tiles: [number, number][]; // section-local; one tile, or two in a row for a shallower slant
}
const CHAMFER_DEFS: ChamferDef[] = [
  // The round Planetarium: single-tile cuts on the west, two-tile slants on the east.
  { room: 'room-planetarium', section: 'upper-floor', corner: 'nw', tiles: [[9, 1]] },
  { room: 'room-planetarium', section: 'upper-floor', corner: 'ne', tiles: [[16, 1], [17, 1]] },
  { room: 'room-planetarium', section: 'upper-floor', corner: 'sw', tiles: [[9, 4]] },
  { room: 'room-planetarium', section: 'upper-floor', corner: 'se', tiles: [[16, 4], [17, 4]] },
  // The octagonal Gazebo.
  { room: 'room-gazebo', section: 'grounds', corner: 'nw', tiles: [[0, 8]] },
  { room: 'room-gazebo', section: 'grounds', corner: 'ne', tiles: [[3, 8]] },
  { room: 'room-gazebo', section: 'grounds', corner: 'sw', tiles: [[0, 11]] },
  { room: 'room-gazebo', section: 'grounds', corner: 'se', tiles: [[3, 11]] },
];

// ---- start tiles: every suspect starts near a room that suits them, 3–4 steps from its door ---
// Listed in turn order, sections interleaved so early seats are spread across the whole house.
const START_DEFS: [string, string][] = [
  ['suspect-scarlet', 'room-theatre'],
  ['suspect-mustard', 'room-armory'],
  ['suspect-peacock', 'room-solarium'],
  ['suspect-plum', 'room-hedge-maze'],
  ['suspect-green', 'room-lounge'],
  ['suspect-orchid', 'room-laboratory'],
  ['suspect-slate', 'room-trophy'],
  ['suspect-rose', 'room-cemetery'],
  ['suspect-indigo', 'room-billiard'],
  ['suspect-crimson', 'room-gallery'],
  ['suspect-saffron', 'room-wine-cellar'],
  ['suspect-teal', 'room-gazebo'], // Lieutenant Lilac
  ['suspect-violet', 'room-ballroom'],
  ['suspect-amber', 'room-gallery'],
  ['suspect-sable', 'room-boiler'],
  ['suspect-navy', 'room-boat-house'],
  ['suspect-coral', 'room-drawing'],
  ['suspect-jade', 'room-library'],
  ['suspect-cobalt', 'room-wine-cellar'],
  ['suspect-sterling', 'room-rose-garden'],
  ['suspect-olive', 'room-kitchen'],
  ['suspect-maroon', 'room-study'],
  ['suspect-ivory', 'room-chapel'],
  ['suspect-charcoal', 'room-stables'],
  ['suspect-magenta', 'room-music'],
  ['suspect-sienna', 'room-den'],
  ['suspect-onyx', 'room-dining'],
  ['suspect-hazel', 'room-greenhouse'],
  ['suspect-cerulean', 'room-gymnasium'],
  ['suspect-pearl', 'room-master-suite'],
  ['suspect-mint', 'room-greenhouse'],
  ['suspect-fuchsia', 'room-parlour'],
  ['suspect-burgundy', 'room-wine-cellar'],
  ['suspect-turquoise', 'room-clock-tower'],
  ['suspect-azure', 'room-boat-house'],
  ['suspect-periwinkle', 'room-veranda'],
  ['suspect-copper', 'room-workshop'],
  ['suspect-chartreuse', 'room-boudoir'],
  ['suspect-cinnamon', 'room-cemetery'],
  ['suspect-lilac', 'room-laboratory'], // Nurse Nutmeg
];

const ARROWS: Record<string, Coord> = { '^': { x: 0, y: -1 }, v: { x: 0, y: 1 }, '<': { x: -1, y: 0 }, '>': { x: 1, y: 0 } };

function buildBoard(): Board {
  const cellAt = new Map<string, BoardCell>();
  const cells: BoardCell[] = [];
  const sections: BoardSection[] = [];
  const rooms: Record<string, RoomLayout> = {};
  const elevators: ElevatorInfo[] = [];
  const fountain: Coord[] = [];
  const errors: string[] = [];
  const put = (cell: BoardCell) => {
    cells.push(cell);
    cellAt.set(coordKey(cell), cell);
  };

  // ---- tiles ----
  for (const map of SECTION_MAPS) {
    const { w, h } = sizeOf(map);
    const origin = ORIGIN[map.id];
    sections.push({ id: map.id, theme: THEME_OF[map.id], title: map.title, origin, width: w, height: h });
    const roomTiles: Record<string, Coord[]> = {};
    for (let ly = 0; ly < h; ly++) {
      const row = map.tiles[ly];
      if (row.length !== w) throw new Error(`board map ${map.id} row ${ly} is ${row.length} wide, expected ${w}`);
      for (let lx = 0; lx < w; lx++) {
        const ch = row[lx];
        const gx = origin.x + lx;
        const gy = origin.y + ly;
        if (ch === ' ') continue;
        if (ch === '.') put({ x: gx, y: gy, type: 'path', sectionId: map.id });
        else if (ch === '#') put({ x: gx, y: gy, type: 'elevator', elevatorFloor: map.id as FloorId, sectionId: map.id });
        else if (ch === 'F') {
          put({ x: gx, y: gy, type: 'fountain', sectionId: map.id });
          fountain.push({ x: gx, y: gy });
        } else if (ch === '~') put({ x: gx, y: gy, type: 'obstacle', obstacleKind: 'water', sectionId: map.id });
        else if (ch === ',') put({ x: gx, y: gy, type: 'obstacle', obstacleKind: 'lawn', sectionId: map.id });
        else if (ch === 'H') put({ x: gx, y: gy, type: 'obstacle', obstacleKind: 'hedge', sectionId: map.id });
        else if (ch === 'x') put({ x: gx, y: gy, type: 'obstacle', obstacleKind: 'wall', sectionId: map.id });
        else if (ch === '/') put({ x: gx, y: gy, type: 'obstacle', obstacleKind: 'chamfer', sectionId: map.id });
        else if (ROOM_KEY[ch]) {
          const roomId = ROOM_KEY[ch];
          put({ x: gx, y: gy, type: 'room', roomId, sectionId: map.id });
          (roomTiles[roomId] ??= []).push({ x: gx, y: gy });
        } else throw new Error(`board map ${map.id}: unknown tile '${ch}' at ${lx},${ly}`);
      }
    }
    for (const [roomId, tiles] of Object.entries(roomTiles)) {
      if (rooms[roomId]) throw new Error(`room ${roomId} appears in two sections`);
      const roomIndex = ROOMS.findIndex((r) => r.id === roomId);
      const xs = tiles.map((t) => t.x);
      const ys = tiles.map((t) => t.y);
      const mcx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const mcy = (Math.min(...ys) + Math.max(...ys)) / 2;
      let label = tiles[0];
      let bestD = Infinity;
      for (const t of tiles) {
        const d = (t.x - mcx) ** 2 + (t.y - mcy) ** 2;
        if (d < bestD) (bestD = d), (label = t);
      }
      rooms[roomId] = {
        id: roomId,
        sectionId: map.id,
        tiles,
        entrances: [],
        label: { x: label.x, y: label.y },
        weaponTile: { x: Math.max(...xs), y: Math.max(...ys) },
        weaponId: WEAPONS[(roomIndex >= 0 ? roomIndex : 0) % WEAPONS.length].id,
      };
    }

    // ---- doors (arrow layer) ----
    for (let ly = 0; ly < h; ly++) {
      const row = map.doors[ly] ?? '';
      for (let lx = 0; lx < row.length; lx++) {
        const dir = ARROWS[row[lx]];
        if (!dir) continue;
        const from = cellAt.get(coordKey({ x: origin.x + lx, y: origin.y + ly }));
        if (!from || from.type !== 'room' || !from.roomId) {
          errors.push(`${map.id}: door arrow at ${lx},${ly} is on '${map.tiles[ly][lx]}', not a room tile`);
          continue;
        }
        const to = cellAt.get(coordKey({ x: from.x + dir.x, y: from.y + dir.y }));
        const ok = to && (to.type === 'path' || (to.type === 'room' && to.roomId !== from.roomId));
        if (!ok) {
          errors.push(`${map.id}: door at ${lx},${ly} (${from.roomId}) opens onto '${to ? to.type + (to.roomId ? ':' + to.roomId : '') : 'void'}'`);
          continue;
        }
        rooms[from.roomId].entrances.push({ roomId: from.roomId, roomTile: { x: from.x, y: from.y }, doorTile: { x: to!.x, y: to!.y } });
      }
    }
  }
  for (const r of ROOMS) if (!rooms[r.id]) errors.push(`room ${r.id} is missing from the board maps`);
  for (const r of Object.values(rooms)) if (!r.entrances.length) errors.push(`room ${r.id} has no door`);

  // ---- chamfers: every '/' tile belongs to exactly one cut, and every cut touches its room ----
  const chamferTiles = new Set(cells.filter((c) => c.obstacleKind === 'chamfer').map((c) => coordKey(c)));
  const claimed = new Set<string>();
  const chamfers: Chamfer[] = CHAMFER_DEFS.map((d) => {
    const tiles = d.tiles.map(([x, y]) => local(d.section, x, y));
    for (const t of tiles) {
      const k = coordKey(t);
      if (!chamferTiles.has(k)) errors.push(`chamfer on ${d.room}: ${k} is not a '/' tile`);
      if (claimed.has(k)) errors.push(`chamfer on ${d.room}: ${k} is claimed twice`);
      claimed.add(k);
    }
    const room = rooms[d.room];
    const touches = !!room && tiles.some((t) => ORTHO.some((o) => room.tiles.some((r) => r.x === t.x + o.x && r.y === t.y + o.y)));
    if (!touches) errors.push(`chamfer on ${d.room}: ${tiles.map((t) => coordKey(t)).join(' ')} does not touch the room`);
    return { roomId: d.room, corner: d.corner, tiles };
  });
  for (const k of chamferTiles) if (!claimed.has(k)) errors.push(`'/' tile ${k} belongs to no chamfer`);
  if (errors.length) throw new Error('board maps: ' + errors.join(' | '));

  // ---- elevators ----
  for (const sec of sections) {
    const ecells = cells.filter((c) => c.sectionId === sec.id && c.type === 'elevator');
    if (!ecells.length) continue;
    const exits: Coord[] = [];
    const seen = new Set<string>();
    for (const e of ecells) {
      for (const d of ORTHO) {
        const n = cellAt.get(coordKey({ x: e.x + d.x, y: e.y + d.y }));
        if (n && n.type === 'path' && !seen.has(coordKey(n))) {
          seen.add(coordKey(n));
          exits.push({ x: n.x, y: n.y });
        }
      }
    }
    elevators.push({ floor: sec.id as FloorId, cells: ecells.map((c) => ({ x: c.x, y: c.y })), exit: exits[0], exits });
  }

  // ---- staircases ----
  const stairs: StairLink[] = STAIR_DEFS.map((d) => {
    const a = d.a.map(([x, y]) => local(d.from, x, y));
    const b = d.b.map(([x, y]) => local(d.to, x, y));
    for (const t of [...a, ...b]) {
      const c = cellAt.get(coordKey(t));
      if (!c || c.type !== 'path') throw new Error(`stair ${d.id}: landing ${coordKey(t)} is not a hall tile`);
      c.landing = true;
    }
    return { id: d.id, title: d.title, from: d.from, to: d.to, a, b };
  });

  // ---- secret passages: the passage sits on the room tile farthest from its doors ----
  const shortcuts: Shortcut[] = PASSAGE_DEFS.map(([aId, bId, story], i) => {
    const pick = (room: RoomLayout): Coord => {
      let best = room.tiles[0];
      let bestD = -1;
      for (const t of room.tiles) {
        const d = Math.min(...room.entrances.map((e) => Math.abs(e.roomTile.x - t.x) + Math.abs(e.roomTile.y - t.y)));
        if (d > bestD) (bestD = d), (best = t);
      }
      return { x: best.x, y: best.y };
    };
    const a = pick(rooms[aId]);
    const b = pick(rooms[bId]);
    rooms[aId].shortcutTile = a;
    rooms[bId].shortcutTile = b;
    return { id: `sc-room-${i + 1}`, kind: 'room', a, b, aRoomId: aId, bRoomId: bId, story };
  });

  // ---- envelope: the centre of the Courtyard fountain ----
  const fx = fountain.map((t) => t.x);
  const fy = fountain.map((t) => t.y);
  const envelope = { x: Math.floor((Math.min(...fx) + Math.max(...fx)) / 2), y: Math.floor((Math.min(...fy) + Math.max(...fy)) / 2) };

  // ---- start tiles ----
  // Hall tiles are ranked by walking distance from the themed room's doors; a start is the tile
  // 3 steps out that is not a door tile, not beside one, not a landing, and farthest from the
  // starts already placed (so neighbours in turn order don't crowd each other).
  const doorTiles = new Set<string>();
  for (const r of Object.values(rooms)) for (const e of r.entrances) if (cellAt.get(coordKey(e.doorTile))?.type === 'path') doorTiles.add(coordKey(e.doorTile));
  const nearDoor = (c: Coord) => doorTiles.has(coordKey(c)) || ORTHO.some((d) => doorTiles.has(coordKey({ x: c.x + d.x, y: c.y + d.y })));
  const hallDist = (fromDoors: Coord[]): Map<string, number> => {
    const dist = new Map<string, number>();
    const q: Coord[] = [];
    for (const t of fromDoors) {
      const c = cellAt.get(coordKey(t));
      if (c?.type === 'path') dist.set(coordKey(t), 1), q.push(t);
    }
    while (q.length) {
      const cur = q.shift()!;
      const d = dist.get(coordKey(cur))!;
      for (const o of ORTHO) {
        const n = cellAt.get(coordKey({ x: cur.x + o.x, y: cur.y + o.y }));
        if (!n || n.type !== 'path' || dist.has(coordKey(n))) continue;
        dist.set(coordKey(n), d + 1);
        q.push({ x: n.x, y: n.y });
      }
    }
    return dist;
  };
  const orderedSuspects = [...SUSPECTS].sort((a, b) => a.turnOrder - b.turnOrder);
  const used = new Set<string>();
  const placed: Coord[] = [];
  const starts = orderedSuspects.map((s) => {
    const def = START_DEFS.find(([id]) => id === s.id);
    if (!def) throw new Error(`no start defined for ${s.id}`);
    const room = rooms[def[1]];
    const dist = hallDist(room.entrances.map((e) => e.doorTile));
    let best: Coord | undefined;
    let bestScore = -Infinity;
    for (const want of [3, 4, 2, 5]) {
      for (const [k, d] of dist) {
        if (d !== want) continue;
        const c = cellAt.get(k)!;
        if (used.has(k) || c.landing || nearDoor(c) || c.sectionId !== room.sectionId) continue;
        const spread = placed.length ? Math.min(...placed.map((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y))) : 99;
        if (spread > bestScore) (bestScore = spread), (best = { x: c.x, y: c.y });
      }
      if (best) break;
    }
    if (!best) throw new Error(`no start tile available near ${def[1]} for ${s.id}`);
    used.add(coordKey(best));
    placed.push(best);
    return { suspectId: s.id, tile: best };
  });

  const width = Math.max(...cells.map((c) => c.x)) + 1;
  const height = Math.max(...cells.map((c) => c.y)) + 1;
  return { width, height, cells, sections, rooms, starts, envelope, shortcuts, elevators, stairs, fountain, chamfers };
}

export const BOARD: Board = buildBoard();

// ---- movement graph (tile level; used by tests and tooling) ----------------------------------

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
      const aWalk = c.type === 'path' || c.type === 'elevator';
      const bWalk = n.type === 'path' || n.type === 'elevator';
      if (aWalk && bWalk) link(c, n);
      else if (c.type === 'room' && n.type === 'room' && c.roomId === n.roomId) link(c, n);
    }
  }
  for (const room of Object.values(board.rooms)) {
    for (const e of room.entrances) link(e.roomTile, e.doorTile);
  }
  for (const st of board.stairs) st.a.forEach((t, i) => link(t, st.b[i]));
  if (includeShortcuts) for (const sc of board.shortcuts) link(sc.a, sc.b);

  return adj;
}
