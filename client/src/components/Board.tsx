import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BOARD, coordKey, getCard, type Coord, type PlayerView, type RoomLayout, type SectionTheme } from 'shared';
import { resolveOverrideThumb } from '../render/overrides';
import { resolveBoardArt } from '../render/boardArt';
import { WEAPON_GLYPHS } from '../render/weaponGlyphs';
import { packRoom, type Packing, type Rect } from '../render/roomPacking';
import { BOARD_TEXTURES, textureUrl, texturePatternId, type BoardTexture } from '../render/boardTextures';
import './Board.css';

interface LastMove {
  playerId: string;
  path: Coord[];
}

const TS = 26;
const BW = BOARD.width * TS;
const BH = BOARD.height * TS;
const MIN_SCALE = 0.45;
const MAX_SCALE = 4;
/** Walk-animation cadence: ms the pawn spends on each tile of its path. */
export const WALK_STEP_MS = 300;
/** Zoom level the camera locks to while following another player's move. */
const FOLLOW_SCALE = 1.6;

const cx = (c: Coord) => c.x * TS + TS / 2;
const cy = (c: Coord) => c.y * TS + TS / 2;

// Tile -> room lookup, so reachable room tiles can be collapsed into one big space.
const ROOM_AT = new Map<string, string>();
for (const room of Object.values(BOARD.rooms)) for (const t of room.tiles) ROOM_AT.set(coordKey(t), room.id);

/** Where a pawn standing on `tile` is actually drawn: centred in the room if the tile belongs to one
 *  (so entering never flashes in the top-left corner), otherwise on the tile itself. */
function pawnWorldPos(tile: Coord): { px: number; py: number } {
  const rid = ROOM_AT.get(coordKey(tile));
  if (rid && BOARD.rooms[rid]) {
    const b = roomBounds(BOARD.rooms[rid]);
    return { px: b.x + b.w / 2, py: b.y + b.h * 0.62 };
  }
  return { px: cx(tile), py: cy(tile) };
}

function Pawn({
  px,
  py,
  color,
  r = TS / 2 - 5,
  eliminated,
  label,
  onTip,
}: {
  px: number;
  py: number;
  color: string;
  r?: number;
  eliminated?: boolean;
  label?: string;
  onTip?: TipFn;
}) {
  const hover =
    label && onTip
      ? {
          style: { cursor: 'help' as const },
          onMouseEnter: (e: React.MouseEvent) => onTip({ x: e.clientX, y: e.clientY, text: label }),
          onMouseMove: (e: React.MouseEvent) => onTip({ x: e.clientX, y: e.clientY, text: label }),
          onMouseLeave: () => onTip(null),
        }
      : {};
  return (
    <g opacity={eliminated ? 0.3 : 1} {...hover}>
      <ellipse cx={px} cy={py + 5} rx={r} ry={2.5} fill="rgba(0,0,0,0.45)" />
      <circle cx={px} cy={py - 1} r={r} fill={color} stroke="#0f0d18" strokeWidth="1.5" />
      <circle cx={px - 2} cy={py - 3} r={Math.max(1.5, r * 0.28)} fill="rgba(255,255,255,0.6)" />
    </g>
  );
}

function suspectColor(suspectId?: string): string {
  if (!suspectId) return '#888';
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? c.color : '#888';
}

// Per-theme palette: section background, path stone, room floor base.
const THEME: Record<SectionTheme, { bg: string; bg2: string; path: string; floor: string; title: string }> = {
  grounds: { bg: '#2d5530', bg2: '#27492a', path: '#8a7f63', floor: '#3a4d35', title: 'rgba(20,40,20,0.85)' },
  'ground-floor': { bg: '#332720', bg2: '#2b2019', path: '#6f5d44', floor: '#43342a', title: 'rgba(35,22,12,0.85)' },
  'upper-floor': { bg: '#322c3f', bg2: '#2a2435', path: '#5e5570', floor: '#3c3550', title: 'rgba(28,20,40,0.85)' },
  basement: { bg: '#1b1925', bg2: '#15131e', path: '#4a4658', floor: '#272336', title: 'rgba(10,8,16,0.85)' },
};

// A representative glyph for every room.
const EMOJI: Record<string, string> = {
  'room-theatre': '🎭', 'room-library': '📚', 'room-walk-in-closet': '🧥', 'room-billiard': '🎱',
  'room-ballroom': '💃', 'room-kitchen': '🍳', 'room-dining': '🍽️', 'room-lounge': '🛋️',
  'room-study': '📖', 'room-wine-cellar': '🍷', 'room-music': '🎹', 'room-gallery': '🖼️',
  'room-gymnasium': '🏋️', 'room-boat-house': '🚤', 'room-chapel': '⛪', 'room-boudoir': '💄',
  'room-smoking': '🚬', 'room-trophy': '🏆', 'room-rose-garden': '🌹', 'room-pantry': '🥫',
  'room-armory': '⚔️', 'room-solarium': '☀️', 'room-parlour': '🫖', 'room-workshop': '🔧',
  'room-cemetery': '🪦', 'room-laboratory': '⚗️', 'room-boiler': '♨️', 'room-drawing': '✏️',
  'room-planetarium': '🪐', 'room-veranda': '🪑', 'room-den': '🦊', 'room-hedge-maze': '🌿',
  'room-stables': '🐴', 'room-clock-tower': '🕰️', 'room-master-suite': '🛏️', 'room-greenhouse': '🪴',
  'room-gazebo': '⛲', 'room-bunker': '🪖', 'room-sauna': '🧖', 'room-courtyard': '⛲',
};

function roomBounds(room: RoomLayout) {
  const xs = room.tiles.map((t) => t.x);
  const ys = room.tiles.map((t) => t.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX * TS, y: minY * TS, w: (Math.max(...xs) - minX + 1) * TS, h: (Math.max(...ys) - minY + 1) * TS, minX, minY };
}

/** SVG path tracing only the outer edges of a room's tiles, so an L-shaped room gets a clean
 *  border that follows its real footprint instead of a bounding rectangle. */
/** Where a room's name bubble sits and how big it is (also the keep-out for tokens). */
function labelGeom(room: RoomLayout, title: string) {
  const b = roomBounds(room);
  const isRect = room.tiles.length === (b.w / TS) * (b.h / TS);
  const cx = isRect ? b.x + b.w / 2 : room.label.x * TS + TS / 2;
  const cy = isRect ? b.y + b.h / 2 : room.label.y * TS + TS / 2;
  const fs = Math.max(6.5, Math.min(11, (b.w - 12) / (title.length * 0.62)));
  const w = Math.min(b.w - 4, title.length * fs * 0.6 + 12);
  const h = fs + 7;
  return { isRect, cx, cy, fs, w, h };
}

/** Fill for a tile that isn't part of a room: a texture pattern when the file exists, else the flat
 *  theme colour. Halls take the floor of their level; outdoor lawn takes grass; an outdoor path
 *  tile that runs straight through (neighbours only above and below, or only left and right)
 *  takes the matching path texture, and every other outdoor path tile keeps its plain look. */
const PATH_KEYS = new Set(BOARD.cells.filter((c) => c.type === 'path').map((c) => coordKey(c)));
/** "hall tile -> room tile" pairs joined by a door or gate, so a doorway counts as a walkable
 *  neighbour when choosing a path texture (a path ending at a door is a straight, not a dead end). */
const DOOR_LINKS = new Set(Object.values(BOARD.rooms).flatMap((room) => room.entrances.map((e) => `${coordKey(e.doorTile)}>${coordKey(e.roomTile)}`)));
/** Whether the tile at (x+dx, y+dy) is walkable from the path tile at (x, y): another path tile,
 *  or a room tile reached through a door. */
function walkableFrom(x: number, y: number, dx: number, dy: number): boolean {
  const from = coordKey({ x, y });
  const to = coordKey({ x: x + dx, y: y + dy });
  return PATH_KEYS.has(to) || DOOR_LINKS.has(`${from}>${to}`);
}
const THEME_OF = new Map(BOARD.sections.map((sec) => [sec.id, sec.theme]));
function tileTexture(c: { x: number; y: number; type: string; sectionId: string; obstacleKind?: string }): BoardTexture | undefined {
  const theme = THEME_OF.get(c.sectionId);
  if (c.type === 'obstacle') {
    if (theme === 'grounds' && c.obstacleKind === 'lawn') return 'grass';
    if (theme === 'ground-floor' && c.obstacleKind === 'wall') return 'wood_floor_vertical_light_pillar'; // the hall pillars
    if (theme === 'basement' && c.obstacleKind === 'wall') return 'cobblestone_pillar'; // cellar pillars and blocked stubs
    return undefined;
  }
  if (c.type !== 'path') return undefined;
  if (theme === 'upper-floor') return 'wood_floor_horizontal';
  if (theme === 'ground-floor') return 'wood_floor_vertical_light';
  if (theme === 'basement') return 'cobblestone';
  if (theme === 'grounds') {
    const has = (dx: number, dy: number) => walkableFrom(c.x, c.y, dx, dy);
    const up = has(0, -1), down = has(0, 1), left = has(-1, 0), right = has(1, 0);
    if (up && down && !left && !right) return 'path_vertical';
    if (left && right && !up && !down) return 'path_horizontal';
    if (up && down && left && right) return 'path_plus_intersection'; // four-way crossing (symmetric, no rotation)
  }
  return undefined;
}
/** Outdoor path tiles that bend or branch are drawn from one texture each, rotated per tile (SVG
 *  rotation is clockwise). The corner texture joins the TOP and LEFT edges: 90 joins top+right,
 *  180 right+bottom, 270 bottom+left. The T texture is open on the left, top and right with grass
 *  along the BOTTOM: 90 puts the closed side on the left, 180 on the top, 270 on the right. */
function rotatedTexture(c: { x: number; y: number; type: string; sectionId: string }): { name: BoardTexture; angle: number } | undefined {
  if (c.type !== 'path' || THEME_OF.get(c.sectionId) !== 'grounds') return undefined;
  const has = (dx: number, dy: number) => walkableFrom(c.x, c.y, dx, dy);
  const up = has(0, -1), down = has(0, 1), left = has(-1, 0), right = has(1, 0);
  const n = [up, down, left, right].filter(Boolean).length;
  if (n === 2) {
    if (up && left) return { name: 'path_corner', angle: 0 };
    if (up && right) return { name: 'path_corner', angle: 90 };
    if (down && right) return { name: 'path_corner', angle: 180 };
    if (down && left) return { name: 'path_corner', angle: 270 };
  }
  if (n === 3) {
    if (!down) return { name: 'path_t_intersection', angle: 0 };
    if (!left) return { name: 'path_t_intersection', angle: 90 };
    if (!up) return { name: 'path_t_intersection', angle: 180 };
    if (!right) return { name: 'path_t_intersection', angle: 270 };
  }
  return undefined;
}
/** Hedge tiles in the maze, drawn from two files. `hedge_horizontal` is authored as a hedge running
 *  left-to-right, and the vertical stretches are the same image turned a quarter turn; a tile counts
 *  as vertical only when it continues up or down and NOT sideways, so the stubs beside the east gate
 *  -- which touch no other hedge -- keep the file's own orientation. `hedge_corner` fills its tile
 *  with grass along the RIGHT and BOTTOM edges, so at 0 degrees the foliage reaches the TOP and LEFT:
 *  90 turns it up+right, 180 right+down, 270 down+left (SVG rotation is clockwise).
 *
 *  A tile bends when it has exactly two connections and they are perpendicular. A connection is a
 *  neighbouring hedge tile OR the wall of the Hedge Maze clearing itself, which is what turns the
 *  ends of the inner wall in towards the room so the foliage runs unbroken into the room's own art. */
const HEDGE_KEYS = new Set(
  BOARD.cells.filter((c) => c.type === 'obstacle' && c.obstacleKind === 'hedge').map((c) => coordKey(c)),
);
const MAZE_ROOM_KEYS = new Set(
  (BOARD.rooms['room-hedge-maze']?.tiles ?? []).map((t) => coordKey(t)),
);
const HEDGE_CORNER_ANGLE: Record<string, number> = { 'up|left': 0, 'up|right': 90, 'down|right': 180, 'down|left': 270 };
function hedgeTexture(c: { x: number; y: number; type: string; obstacleKind?: string }): { name: BoardTexture; angle: number } | undefined {
  if (c.type !== 'obstacle' || c.obstacleKind !== 'hedge') return undefined;
  const at = (dx: number, dy: number) => coordKey({ x: c.x + dx, y: c.y + dy });
  const hedge = (dx: number, dy: number) => HEDGE_KEYS.has(at(dx, dy));
  const joins = (dx: number, dy: number) => hedge(dx, dy) || MAZE_ROOM_KEYS.has(at(dx, dy));
  const links = ([['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]] as const)
    .filter(([, dx, dy]) => joins(dx, dy))
    .map(([dir]) => dir);
  if (links.length === 2) {
    const angle = HEDGE_CORNER_ANGLE[`${links[0]}|${links[1]}`];
    if (angle !== undefined) return { name: 'hedge_corner', angle }; // perpendicular pair; a parallel one falls through
  }
  const upright = hedge(0, -1) || hedge(0, 1);
  const sideways = hedge(-1, 0) || hedge(1, 0);
  return { name: 'hedge_horizontal', angle: upright && !sideways ? 90 : 0 };
}
function tileFill(c: { x: number; y: number; type: string; sectionId: string; obstacleKind?: string }, fallback: string): string {
  const tex = tileTexture(c);
  return tex && textureUrl(tex) ? `url(#${texturePatternId(tex)})` : fallback;
}

/** Full-size pawn radius; the packer shrinks from here as a room fills up. */
const PAWN_R = TS / 2 - 6;
/** Weapon glyphs are authored for a 6.5-unit radius; they scale down with the pawns. */
const WEAPON_R = 6.5;

// Packings depend only on the room and the head-count, so they're cached across renders.
const PACK_CACHE = new Map<string, Packing>();
function packFor(room: RoomLayout, pawns: number, weapons: number): Packing {
  const key = `${room.id}:${pawns}:${weapons}`;
  let pk = PACK_CACHE.get(key);
  if (pk) return pk;
  const title = getCard(room.id)?.title ?? room.id;
  const lg = labelGeom(room, title);
  const b = roomBounds(room);
  const reserved: Rect[] = [
    // the name bubble, plus the glyph line above it
    { x: lg.cx - lg.w / 2 - 2, y: lg.cy - lg.h / 2 - 16, w: lg.w + 4, h: lg.h + 18 },
  ];
  if (room.shortcutTile) reserved.push({ x: room.shortcutTile.x * TS, y: room.shortcutTile.y * TS, w: TS, h: TS });
  pk = packRoom({
    tiles: room.tiles,
    ts: TS,
    reserved,
    pawns,
    weapons,
    rMax: PAWN_R,
    anchor: { x: lg.cx, y: lg.cy + lg.h / 2 + PAWN_R },
    top: { x: b.x + b.w / 2, y: b.y },
  });
  PACK_CACHE.set(key, pk);
  return pk;
}

function roomOutline(tiles: Coord[]): string {
  const inRoom = new Set(tiles.map(coordKey));
  const has = (x: number, y: number) => inRoom.has(`${x},${y}`);
  const segs: string[] = [];
  for (const tl of tiles) {
    const x0 = tl.x * TS, y0 = tl.y * TS, x1 = (tl.x + 1) * TS, y1 = (tl.y + 1) * TS;
    if (!has(tl.x, tl.y - 1)) segs.push(`M${x0} ${y0}L${x1} ${y0}`);
    if (!has(tl.x, tl.y + 1)) segs.push(`M${x0} ${y1}L${x1} ${y1}`);
    if (!has(tl.x - 1, tl.y)) segs.push(`M${x0} ${y0}L${x0} ${y1}`);
    if (!has(tl.x + 1, tl.y)) segs.push(`M${x1} ${y0}L${x1} ${y1}`);
  }
  return segs.join('');
}

type TipFn = (t: { x: number; y: number; text: string } | null) => void;

/** Hover helpers shared by the staircase graphics. */
function tipProps(label: string | undefined, onTip: TipFn | undefined) {
  return label && onTip
    ? {
        style: { cursor: 'help' as const },
        onMouseEnter: (e: React.MouseEvent) => onTip({ x: e.clientX, y: e.clientY, text: label }),
        onMouseMove: (e: React.MouseEvent) => onTip({ x: e.clientX, y: e.clientY, text: label }),
        onMouseLeave: () => onTip(null),
      }
    : {};
}

/** Mahogany tread colour: deep red-brown, a touch lighter towards the ends of a flight so the middle
 *  reads as the drop. `t` is 0 at the middle of the flight and 1 at either end. */
const mahogany = (t: number, base = 20) => `hsl(12 52% ${base + t * 9}%)`;

/** A straight flight of stairs drawn as ONE piece across the gap between two sections: it starts on
 *  the landing tiles of one floor, spans the void, and ends on the landing tiles of the other, with
 *  mahogany treads all the way. `carpet` lays a red velvet runner down the middle, held by brass
 *  stair rods (the grand staircase). */
function StairRun({ a, b, label, carpet, onTip }: { a: Coord[]; b: Coord[]; label?: string; carpet?: boolean; onTip?: TipFn }) {
  const tiles = [...a, ...b];
  const minX = Math.min(...tiles.map((t) => t.x));
  const maxX = Math.max(...tiles.map((t) => t.x));
  const minY = Math.min(...tiles.map((t) => t.y));
  const maxY = Math.max(...tiles.map((t) => t.y));
  const x = minX * TS + 2;
  const y = minY * TS + 3;
  const w = (maxX - minX + 1) * TS - 4;
  const h = (maxY - minY + 1) * TS - 6;
  const treadW = 7;
  const n = Math.floor((w - 4) / treadW);
  const treads = Array.from({ length: n }, (_, i) => i);
  const mid = (n - 1) / 2;
  const tx = (i: number) => x + 2 + i * treadW;
  const runInset = Math.max(4, Math.round(h * 0.2)); // wood showing either side of the runner
  return (
    <g {...tipProps(label, onTip)}>
      {/* stringers */}
      <rect x={x} y={y} width={w} height={h} rx="3" fill="#2a120c" stroke="#5a2a1a" strokeWidth="1.2" />
      {/* mahogany treads */}
      {treads.map((i) => (
        <rect key={i} x={tx(i)} y={y + 3} width={treadW - 1} height={h - 6} fill={mahogany(Math.abs(i - mid) / Math.max(1, mid))} />
      ))}
      {/* wood grain: a few faint lines running along the flight */}
      {[0.3, 0.55, 0.78].map((f) => (
        <line key={f} x1={x + 2} y1={y + 3 + (h - 6) * f} x2={x + w - 2} y2={y + 3 + (h - 6) * f + 1.5} stroke="rgba(255,190,150,0.10)" strokeWidth="0.8" />
      ))}
      {/* nosings */}
      {treads.map((i) => (
        <line key={`n${i}`} x1={tx(i)} y1={y + 3} x2={tx(i)} y2={y + h - 3} stroke="rgba(0,0,0,0.55)" strokeWidth="0.9" />
      ))}
      {treads.map((i) => (
        <line key={`h${i}`} x1={tx(i) + 1} y1={y + 3} x2={tx(i) + 1} y2={y + h - 3} stroke="rgba(255,170,120,0.18)" strokeWidth="0.6" />
      ))}
      {carpet && (
        <>
          {/* red velvet runner down the middle of the flight */}
          <rect x={x + 1.5} y={y + runInset} width={w - 3} height={h - runInset * 2} fill="#8e1526" />
          {treads.map((i) => (
            <rect key={`c${i}`} x={tx(i)} y={y + runInset} width={treadW - 1} height={h - runInset * 2} fill={`hsl(350 68% ${24 + (Math.abs(i - mid) / Math.max(1, mid)) * 8}%)`} />
          ))}
          {/* the fold of the carpet over each nosing, and the brass rod holding it */}
          {treads.map((i) => (
            <line key={`cf${i}`} x1={tx(i)} y1={y + runInset} x2={tx(i)} y2={y + h - runInset} stroke="rgba(40,0,10,0.55)" strokeWidth="1" />
          ))}
          {treads.map((i) => (
            <line key={`rod${i}`} x1={tx(i) + 1.2} y1={y + runInset - 1} x2={tx(i) + 1.2} y2={y + h - runInset + 1} stroke="#e7c66a" strokeWidth="0.9" opacity="0.85" />
          ))}
          {/* velvet sheen along the centre line */}
          <rect x={x + 1.5} y={y + h / 2 - 2} width={w - 3} height={4} fill="rgba(255,120,140,0.10)" />
        </>
      )}
      {/* polished mahogany handrails with a brass top */}
      <line x1={x + 1} y1={y + 1.5} x2={x + w - 1} y2={y + 1.5} stroke="#3c1a10" strokeWidth="2.6" strokeLinecap="round" />
      <line x1={x + 1} y1={y + h - 1.5} x2={x + w - 1} y2={y + h - 1.5} stroke="#3c1a10" strokeWidth="2.6" strokeLinecap="round" />
      <line x1={x + 1} y1={y + 1.2} x2={x + w - 1} y2={y + 1.2} stroke="#c9a85a" strokeWidth="0.8" strokeLinecap="round" />
      <line x1={x + 1} y1={y + h - 1.2} x2={x + w - 1} y2={y + h - 1.2} stroke="#c9a85a" strokeWidth="0.8" strokeLinecap="round" />
    </g>
  );
}

/** A spiral stair: a round well centred in the gap with wedge-shaped mahogany steps winding round a
 *  newel post, plus a short tread onto each of the two landing tiles it joins. */
function SpiralStair({ a, b, label, onTip }: { a: Coord; b: Coord; label?: string; onTip?: TipFn }) {
  const x0 = cx(a);
  const x1 = cx(b);
  const yc = cy(a);
  const xc = (x0 + x1) / 2;
  const r = Math.min(TS * 1.35, Math.abs(x1 - x0) / 2 - 2);
  const steps = 12;
  const wedges = Array.from({ length: steps }, (_, i) => {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    const px0 = xc + Math.cos(a0) * r;
    const py0 = yc + Math.sin(a0) * r;
    const px1 = xc + Math.cos(a1) * r;
    const py1 = yc + Math.sin(a1) * r;
    return <path key={i} d={`M${xc} ${yc}L${px0} ${py0}A${r} ${r} 0 0 1 ${px1} ${py1}Z`} fill={mahogany(i / steps, 17)} stroke="rgba(0,0,0,0.55)" strokeWidth="0.8" />;
  });
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const treadLine = (xx: number, k: string) => (
    <g key={k}>
      <line x1={xx} y1={yc - TS / 2 + 6} x2={xx} y2={yc + TS / 2 - 6} stroke="rgba(0,0,0,0.55)" strokeWidth="1" />
      <line x1={xx + 1} y1={yc - TS / 2 + 6} x2={xx + 1} y2={yc + TS / 2 - 6} stroke="rgba(255,170,120,0.2)" strokeWidth="0.6" />
    </g>
  );
  return (
    <g {...tipProps(label, onTip)}>
      {/* short straight treads from each landing tile into the well */}
      <rect x={left - TS / 2 + 2} y={yc - TS / 2 + 4} width={right - left + TS - 4} height={TS - 8} rx="3" fill={mahogany(0.6)} stroke="#5a2a1a" strokeWidth="1" />
      {[0, 1, 2].map((i) => treadLine(left - TS / 2 + 7 + i * 5, `l${i}`))}
      {[0, 1, 2].map((i) => treadLine(right + TS / 2 - 7 - i * 5, `r${i}`))}
      {/* the well */}
      <circle cx={xc} cy={yc} r={r + 2} fill="#2a120c" stroke="#5a2a1a" strokeWidth="1.6" />
      <circle cx={xc} cy={yc} r={r + 2} fill="none" stroke="#c9a85a" strokeWidth="0.8" />
      {wedges}
      {/* the newel post, turned mahogany with a brass finial */}
      <circle cx={xc} cy={yc} r={4} fill="#3c1a10" stroke="#1a0a06" strokeWidth="1" />
      <circle cx={xc} cy={yc} r={1.8} fill="#e7c66a" />
    </g>
  );
}

/** True when a staircase's two landing groups sit on the same rows facing each other across a
 *  section gap, so it can be drawn as one continuous flight. */
function spansGap(st: { a: Coord[]; b: Coord[] }): boolean {
  if (st.a.length !== st.b.length) return false;
  const dx = Math.abs(st.a[0].x - st.b[0].x);
  return dx > 1 && dx <= 5 && st.a.every((t, i) => t.y === st.b[i].y);
}

/** A weapon token: a pewter silhouette of the weapon inside the same 13-unit footprint the old
    plain circle used, with a hover tooltip naming it. Unknown ids fall back to the circle. */
function WeaponToken({ id, px, py, scale = 1, label, onTip }: { id: string; px: number; py: number; scale?: number; label?: string; onTip?: TipFn }) {
  const g = WEAPON_GLYPHS[id];
  return (
    <g transform={`translate(${px},${py}) scale(${scale})`} role="img" aria-label={label ? `${label} token` : undefined} {...tipProps(label, onTip)}>
      {/* generous invisible hit area so the thin glyphs are easy to hover */}
      <circle r={7.5} fill="transparent" stroke="none" />
      {g ? (
        <>
          {g.thick && <path d={g.thick} fill="none" stroke="#4b4e54" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
          {g.thick && <path d={g.thick} fill="none" stroke="#c9cdd3" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />}
          {g.d && <path d={g.d} fill="url(#pewter)" stroke="#4b4e54" strokeWidth={0.7} strokeLinejoin="round" />}
          {g.lines && <path d={g.lines} fill="none" stroke="#4b4e54" strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" />}
        </>
      ) : (
        <circle r={6.5} fill="url(#pewter)" stroke="#4b4e54" />
      )}
    </g>
  );
}

function Staircase({ at, label, onTip }: { at: Coord; label?: string; onTip?: TipFn }) {
  const x = at.x * TS;
  const y = at.y * TS;
  const steps = [0, 1, 2, 3];
  const hover =
    label && onTip
      ? {
          style: { cursor: 'help' as const },
          onMouseEnter: (e: React.MouseEvent) => onTip({ x: e.clientX, y: e.clientY, text: label }),
          onMouseMove: (e: React.MouseEvent) => onTip({ x: e.clientX, y: e.clientY, text: label }),
          onMouseLeave: () => onTip(null),
        }
      : {};
  return (
    <g transform={`translate(${x + 3} ${y + 3})`} {...hover}>
      <rect width={TS - 6} height={TS - 6} rx="2" fill="#0c0a14" stroke="#e7c66a" strokeWidth="1" />
      {steps.map((s) => (
        <rect key={s} x={1.5 + s * 1.4} y={1.5 + s * ((TS - 9) / steps.length)} width={TS - 9 - s * 2.8} height={(TS - 9) / steps.length - 0.8} fill={`hsl(44 55% ${60 - s * 11}%)`} />
      ))}
    </g>
  );
}

/** A room entrance: a wooden door indoors, or an iron gate out on the grounds. */
function Door({ rt, dt, gate }: { rt: Coord; dt: Coord; gate: boolean }) {
  const cxm = ((rt.x + dt.x) / 2) * TS + TS / 2;
  const cym = ((rt.y + dt.y) / 2) * TS + TS / 2;
  const vertWall = rt.x !== dt.x; // door sits on a vertical wall
  const lng = TS * 0.66;
  const thk = 6;
  const w = vertWall ? thk : lng;
  const h = vertWall ? lng : thk;
  const bars = [0.28, 0.5, 0.72].map((f) =>
    vertWall ? (
      <line key={f} x1={cxm - w / 2} y1={cym - h / 2 + f * h} x2={cxm + w / 2} y2={cym - h / 2 + f * h} stroke="#aab0b6" strokeWidth="0.7" />
    ) : (
      <line key={f} x1={cxm - w / 2 + f * w} y1={cym - h / 2} x2={cxm - w / 2 + f * w} y2={cym + h / 2} stroke="#aab0b6" strokeWidth="0.7" />
    ),
  );
  if (gate) {
    return (
      <g>
        <rect x={cxm - w / 2} y={cym - h / 2} width={w} height={h} rx="1" fill="#33333b" stroke="#71757c" strokeWidth="1" />
        {bars}
      </g>
    );
  }
  return (
    <g>
      <rect x={cxm - w / 2} y={cym - h / 2} width={w} height={h} rx="1.5" fill="#7a5230" stroke="#3a2616" strokeWidth="1" />
      <rect x={cxm - w / 2 + 1.2} y={cym - h / 2 + 1.2} width={w - 2.4} height={h - 2.4} rx="1" fill="none" stroke="#9c6b40" strokeWidth="0.6" />
      <circle cx={vertWall ? cxm + w / 4 : cxm + w / 4} cy={vertWall ? cym + h / 4 : cym + h / 4} r="1" fill="#e7c66a" />
    </g>
  );
}

export function Board({
  players,
  reachable,
  lastMove,
  weaponLocations,
  canMove,
  onMoveTo,
  keyboardZoom = true,
  myId,
  cameraLock = true,
  activeId,
}: {
  players: PlayerView[];
  reachable?: Coord[];
  lastMove?: LastMove;
  weaponLocations?: Record<string, string>;
  canMove?: boolean;
  onMoveTo?: (tile: Coord) => void;
  /** Whether this board responds to ↑/↓ keys (off for the secondary map so listeners don't double up). */
  keyboardZoom?: boolean;
  /** The viewer's own player id. When set, the camera locks onto and follows *other* players' moves. */
  myId?: string;
  /** When false the camera never follows another player's move or recentres on a turn change;
   *  the viewer keeps full control of pan and zoom. */
  cameraLock?: boolean;
  /** Whose turn it is. When this changes, the camera recentres on them at the follow zoom (unlocked). */
  activeId?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 0.8, tx: 0, ty: 0 });
  // Promote the stage to its own GPU layer only while the camera is moving. Left on permanently,
  // `will-change: transform` makes Chrome rasterise the board once at 1x (a tile is 26px) and
  // stretch that bitmap when zoomed, blurring the room art, name bubbles and tokens alike. Dropping
  // the hint once a pan/zoom settles lets the browser re-rasterise the view at the real zoom.
  const [moving, setMoving] = useState(false);
  const movingT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setMoving(true);
    clearTimeout(movingT.current);
    movingT.current = setTimeout(() => setMoving(false), 250);
    return () => clearTimeout(movingT.current);
  }, [view]);
  const viewRef = useRef(view);
  viewRef.current = view; // always the latest committed view, for use inside gesture handlers
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  // Active touch/mouse pointers on the board, for two-finger pinch-to-zoom (iOS Safari et al.).
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number } | null>(null);

  // While true, pan/zoom input is ignored because the camera is following another player's move.
  const lockedRef = useRef(false);
  const [followName, setFollowName] = useState<string | null>(null);
  const playersRef = useRef(players);
  playersRef.current = players;

  // Walk-animation: when a new path arrives, step the moving pawn through it at 0.3s / tile. For
  // *other* players' moves we also lock the camera, zoom to 80%, and keep their pawn centred.
  const [anim, setAnim] = useState<{ playerId: string; tile: Coord } | null>(null);
  const animSig = useRef<string>('');
  // The effect is keyed on this string, not on `lastMove` itself: every server broadcast delivers a
  // fresh lastMove object, and re-running the effect on identity alone would clear the step timer
  // mid-walk without restarting it — leaving the pawn stranded on a corridor tile while the game
  // state (and the chat) already had it inside the room.
  const moveSig = lastMove && lastMove.path.length >= 2 ? `${lastMove.playerId}:${lastMove.path.map(coordKey).join('>')}` : '';
  const lastMoveRef = useRef(lastMove);
  lastMoveRef.current = lastMove;
  useEffect(() => {
    const lastMove = lastMoveRef.current;
    if (!moveSig || !lastMove || lastMove.path.length < 2) {
      setAnim(null);
      return;
    }
    const sig = moveSig;
    if (sig === animSig.current) return;
    animSig.current = sig;
    const follow = cameraLock && !!myId && lastMove.playerId !== myId;
    if (follow) {
      lockedRef.current = true;
      drag.current = null;
      pinch.current = null;
      setFollowName(playersRef.current.find((p) => p.id === lastMove.playerId)?.name ?? null);
    }
    const step = (tile: Coord) => {
      setAnim({ playerId: lastMove.playerId, tile });
      if (follow) {
        const el = viewportRef.current;
        if (el) {
          const { px, py } = pawnWorldPos(tile);
          setView({
            scale: FOLLOW_SCALE,
            tx: el.clientWidth / 2 - px * FOLLOW_SCALE,
            ty: el.clientHeight / 2 - py * FOLLOW_SCALE,
          });
        }
      }
    };
    let i = 0;
    step(lastMove.path[0]);
    const timer = setInterval(() => {
      i += 1;
      if (i >= lastMove.path.length) {
        clearInterval(timer);
        setAnim(null);
        if (follow) {
          lockedRef.current = false; // reached their destination — hand control back
          setFollowName(null);
        }
        return;
      }
      step(lastMove.path[i]);
    }, WALK_STEP_MS);
    return () => clearInterval(timer);
  }, [moveSig, myId, cameraLock]);

  // When the turn passes to a new player, recentre the camera on them at the follow zoom — but leave
  // it unlocked, so the viewer can immediately pan/zoom away.
  const turnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId) return;
    const prev = turnRef.current;
    turnRef.current = activeId;
    if (prev === null || prev === activeId) return; // skip first mount; only react to a real change
    if (!cameraLock) return; // the viewer has opted out of the camera moving on its own
    if (lockedRef.current) return; // a move is being followed — don't fight that camera
    const p = playersRef.current.find((pl) => pl.id === activeId);
    const el = viewportRef.current;
    if (!p || !el) return;
    const { px, py } = pawnWorldPos(p.position);
    setView({
      scale: FOLLOW_SCALE,
      tx: el.clientWidth / 2 - px * FOLLOW_SCALE,
      ty: el.clientHeight / 2 - py * FOLLOW_SCALE,
    });
  }, [activeId]);

  const reachSet = new Set((reachable ?? []).map(coordKey));

  // Who and what is standing in each room right now. A pawn mid-walk is not "in" its room yet, so
  // the room's packing doesn't shuffle until it arrives.
  const weaponsByRoom = new Map<string, string[]>();
  for (const [wid, rid] of Object.entries(weaponLocations ?? {})) {
    const arr = weaponsByRoom.get(rid) ?? [];
    arr.push(wid);
    weaponsByRoom.set(rid, arr);
  }
  const pawnsByRoom = new Map<string, PlayerView[]>();
  for (const p of players) {
    if (p.inRoomId && BOARD.rooms[p.inRoomId] && anim?.playerId !== p.id) {
      const arr = pawnsByRoom.get(p.inRoomId) ?? [];
      arr.push(p);
      pawnsByRoom.set(p.inRoomId, arr);
    }
  }
  const packing = (rid: string) => packFor(BOARD.rooms[rid], pawnsByRoom.get(rid)?.length ?? 0, weaponsByRoom.get(rid)?.length ?? 0);

  // Fit-to-width on first mount.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const scale = Math.min(1.1, (el.clientWidth - 16) / BW);
    setView({ scale, tx: (el.clientWidth - BW * scale) / 2, ty: 8 });
  }, []);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setView((v) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
    });
  }, []);

  // Wheel zoom (non-passive so we can preventDefault).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (lockedRef.current) return; // camera is following another player
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // iOS Safari fires non-standard gesture* events for pinch and will zoom the whole page unless we
  // suppress them; we handle pinch ourselves via pointer events.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    const evs = ['gesturestart', 'gesturechange', 'gestureend'];
    evs.forEach((n) => el.addEventListener(n, prevent as EventListener, { passive: false }));
    return () => evs.forEach((n) => el.removeEventListener(n, prevent as EventListener));
  }, []);

  // Up/Down arrow keys zoom toward centre.
  useEffect(() => {
    if (!keyboardZoom) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      if (lockedRef.current) return; // camera is following another player
      const el = viewportRef.current;
      if (!el) return;
      zoomAt(e.key === 'ArrowUp' ? 1.12 : 1 / 1.12, el.clientWidth / 2, el.clientHeight / 2);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomAt, keyboardZoom]);

  const startDragFrom = (x: number, y: number) => {
    drag.current = { x, y, tx: viewRef.current.tx, ty: viewRef.current.ty, moved: false };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (lockedRef.current) return; // camera is following another player — no pan/pinch
    if ((e.target as HTMLElement).dataset?.move) return; // clicking a move target, not panning
    // Capture to the clicked child (not the viewport): capturing to the viewport itself makes the
    // browser fire pointerleave on it, which would cancel the very drag we're starting.
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already gone — safe to ignore */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      // second finger down -> start a pinch and stop panning
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      drag.current = null;
    } else {
      startDragFrom(e.clientX, e.clientY);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (lockedRef.current) return; // camera is following another player
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two-finger pinch: zoom by the change in finger distance, centred on their midpoint.
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0 && dist > 0) {
        const rect = viewportRef.current?.getBoundingClientRect();
        zoomAt(dist / pinch.current.dist, (a.x + b.x) / 2 - (rect?.left ?? 0), (a.y + b.y) / 2 - (rect?.top ?? 0));
      }
      pinch.current.dist = dist;
      return;
    }

    const d = drag.current; // capture locally — the setView updater runs at commit time, by which
    if (!d) return; //          point a pointerup may have nulled drag.current.
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
    } else if (pointers.current.size === 1) {
      // a finger lifted after a pinch — resume panning from the one that remains, no jump
      const [p] = [...pointers.current.values()];
      startDragFrom(p.x, p.y);
    }
  };

  return (
    <div
      className="bv"
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div className={`bv__stage${moving ? ' bv__stage--moving' : ''}`} style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
        <svg width={BW} height={BH} className="bv__svg" role="img" aria-label="Mansion board">
          {/* section panels */}
          {BOARD.sections.map((s) => {
            const t = THEME[s.theme];
            return (
              <g key={s.id}>
                <rect x={s.origin.x * TS} y={s.origin.y * TS} width={s.width * TS} height={s.height * TS} rx="6" fill={t.bg} />
                <rect x={s.origin.x * TS} y={s.origin.y * TS} width={s.width * TS} height={s.height * TS} rx="6" fill="none" stroke={t.bg2} strokeWidth="3" />
                <g>
                  <rect x={s.origin.x * TS + 6} y={s.origin.y * TS + 5} width={132} height={20} rx="4" fill={t.title} stroke="#e7c66a" strokeWidth="1" />
                  <text x={s.origin.x * TS + 12} y={s.origin.y * TS + 19} fontFamily="Georgia, serif" fontSize="12" fill="#e7c66a" letterSpacing="1.5">
                    {s.title.toUpperCase()}
                  </text>
                </g>
              </g>
            );
          })}

          {/* shortcut link lines */}
          <g stroke="#e7c66a" strokeWidth="1.5" strokeDasharray="3 5" opacity="0.22">
            {BOARD.shortcuts.map((sc) => (
              <line key={sc.id} x1={cx(sc.a)} y1={cy(sc.a)} x2={cx(sc.b)} y2={cy(sc.b)} />
            ))}
          </g>

          {/* path cells */}
          {BOARD.cells.filter((c) => c.type === 'path').map((c) => {
            const t = THEME[(BOARD.sections.find((s) => s.id === c.sectionId)?.theme) ?? 'ground-floor'];
            const rot = rotatedTexture(c);
            const rotUrl = rot ? textureUrl(rot.name) : undefined;
            if (rot && rotUrl) {
              // bends and branches are drawn as a rotated image rather than a pattern fill, one per tile
              return (
                <g key={`p${c.x}-${c.y}`}>
                  <image href={rotUrl} x={c.x * TS} y={c.y * TS} width={TS} height={TS} preserveAspectRatio="none" transform={`rotate(${rot.angle} ${c.x * TS + TS / 2} ${c.y * TS + TS / 2})`} />
                  <rect x={c.x * TS} y={c.y * TS} width={TS} height={TS} fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth="0.5" />
                </g>
              );
            }
            return <rect key={`p${c.x}-${c.y}`} x={c.x * TS} y={c.y * TS} width={TS} height={TS} fill={tileFill(c, t.path)} stroke="rgba(0,0,0,0.18)" strokeWidth="0.5" />;
          })}

          {/* obstacles — things pieces walk around: lawns and the pond outdoors, hedge walls in the
              maze, graves in the Cemetery, pillars and blocked stubs indoors */}
          {(() => {
            const obstacles = BOARD.cells.filter((c) => c.type === 'obstacle');
            if (!obstacles.length) return null;
            const kind = (k: string) => obstacles.filter((c) => c.obstacleKind === k);
            const FILL: Record<string, string> = { water: '#2a6f8c', lawn: '#3d6b3b', hedge: '#1e3d21', wall: '#4a4356' };
            return (
              <g style={{ pointerEvents: 'none' }}>
                {obstacles.map((c) => {
                  const hedge = hedgeTexture(c);
                  const hedgeUrl = hedge ? textureUrl(hedge.name) : undefined;
                  if (hedge && hedgeUrl) {
                    return (
                      <image
                        key={`o${c.x}-${c.y}`}
                        href={hedgeUrl}
                        x={c.x * TS}
                        y={c.y * TS}
                        width={TS}
                        height={TS}
                        preserveAspectRatio="none"
                        transform={`rotate(${hedge.angle} ${c.x * TS + TS / 2} ${c.y * TS + TS / 2})`}
                      />
                    );
                  }
                  return <rect key={`o${c.x}-${c.y}`} x={c.x * TS} y={c.y * TS} width={TS} height={TS} fill={tileFill(c, FILL[c.obstacleKind ?? 'wall'])} />;
                })}
                {kind('water').length > 0 && <path d={roomOutline(kind('water'))} fill="none" stroke="#9fd6e6" strokeWidth="1.5" strokeLinejoin="round" />}
                {/* The green outline only stands in for the hedge when no texture has been dropped in;
                    drawn over the real foliage it reads as a stray line. */}
                {kind('hedge').length > 0 && !textureUrl('hedge_horizontal') && !textureUrl('hedge_corner') && (
                  <path d={roomOutline(kind('hedge'))} fill="none" stroke="#6f9a5a" strokeWidth="2" strokeLinejoin="round" />
                )}
                {kind('wall')
                  .filter((c) => !(tileTexture(c) && textureUrl(tileTexture(c)!))) // textured pillars draw their own
                  .map((c) => (
                    <rect key={`w${c.x}-${c.y}`} x={c.x * TS + 4} y={c.y * TS + 4} width={TS - 8} height={TS - 8} rx="3" fill="none" stroke="#8a8398" strokeWidth="1.5" />
                  ))}
                {kind('water').map((c) => (
                  <path key={`r${c.x}-${c.y}`} d={`M${c.x * TS + 5} ${c.y * TS + TS / 2} q${TS / 4} -3 ${TS / 2} 0 t${TS / 2 - 10} 0`} fill="none" stroke="rgba(190,230,245,0.45)" strokeWidth="1" />
                ))}
              </g>
            );
          })()}

          {/* the Courtyard fountain — an impassable obstacle in the middle of the Ground Floor */}
          {BOARD.fountain.length > 0 &&
            (() => {
              const xs = BOARD.fountain.map((t) => t.x);
              const ys = BOARD.fountain.map((t) => t.y);
              const x = Math.min(...xs) * TS;
              const y = Math.min(...ys) * TS;
              const w = (Math.max(...xs) - Math.min(...xs) + 1) * TS;
              const h = (Math.max(...ys) - Math.min(...ys) + 1) * TS;
              return (
                <g style={{ pointerEvents: 'none' }}>
                  <rect x={x} y={y} width={w} height={h} rx={6} fill="#35525f" stroke="#9fd6e6" strokeWidth="2" />
                  <rect x={x + TS * 0.7} y={y + TS * 0.7} width={w - TS * 1.4} height={h - TS * 1.4} rx={5} fill="#2a6f8c" stroke="#bfeaf5" strokeWidth="1.5" />
                  <circle cx={x + w / 2} cy={y + h / 2} r={TS * 1.05} fill="#7fbcd6" stroke="#eaf8ff" strokeWidth="1.5" />
                  <text x={x + w / 2} y={y + h / 2 + TS * 0.5} textAnchor="middle" fontSize={TS * 1.3}>
                    ⛲
                  </text>
                </g>
              );
            })()}

          {/* elevators — one per indoor floor */}
          {BOARD.elevators.map((e) => {
            const xs = e.cells.map((c) => c.x);
            const ys = e.cells.map((c) => c.y);
            const x = Math.min(...xs) * TS;
            const y = Math.min(...ys) * TS;
            const w = (Math.max(...xs) - Math.min(...xs) + 1) * TS;
            const h = (Math.max(...ys) - Math.min(...ys) + 1) * TS;
            return (
              <g key={e.floor}>
                <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} rx="3" fill="#3a3f48" stroke="#aab0b6" strokeWidth="2" />
                <line x1={x + w / 2} y1={y + 4} x2={x + w / 2} y2={y + h - 4} stroke="#6a7078" strokeWidth="1.5" />
                <text x={x + w / 2} y={y + h / 2 + 6} textAnchor="middle" fontSize="16">
                  🛗
                </text>
              </g>
            );
          })}

          {/* staircases between sections: each landing tile is a free hop to its twin. Flights whose
              landings face each other across a gap are drawn as one continuous staircase bridging the
              floors (the Clock Tower's as a spiral); the rest get a marker at each end. */}
          {BOARD.stairs.map((st) => {
            const name = (id: string) => BOARD.sections.find((s) => s.id === id)?.title ?? id;
            const label = `${st.title} — ${name(st.from)} ↔ ${name(st.to)}`;
            if (spansGap(st)) {
              return st.id === 'stairs-spiral' ? (
                <SpiralStair key={st.id} a={st.a[0]} b={st.b[0]} label={label} onTip={setTip} />
              ) : (
                <StairRun key={st.id} a={st.a} b={st.b} label={label} carpet={st.id === 'stairs-grand'} onTip={setTip} />
              );
            }
            return (
              <g key={st.id}>
                <line x1={cx(st.a[0])} y1={cy(st.a[0])} x2={cx(st.b[0])} y2={cy(st.b[0])} stroke="#9aa0a6" strokeWidth="1.5" strokeDasharray="2 4" opacity="0.3" />
                {st.a.map((t, i) => (
                  <Staircase key={`a${i}`} at={t} label={`${st.title} — to the ${name(st.to)}`} onTip={setTip} />
                ))}
                {st.b.map((t, i) => (
                  <Staircase key={`b${i}`} at={t} label={`${st.title} — to the ${name(st.from)}`} onTip={setTip} />
                ))}
              </g>
            );
          })}

          {/* rooms */}
          {Object.values(BOARD.rooms).map((room) => {
            const b = roomBounds(room);
            const theme = BOARD.sections.find((s) => s.id === room.sectionId)?.theme ?? 'ground-floor';
            const t = THEME[theme];
            const title = getCard(room.id)?.title ?? room.id;
            // Floor art: proper top-down board art if it has been painted (assets/board/rooms),
            // otherwise the room's card portrait as a stand-in. Board art is authored to the room's
            // exact tile rectangle, so it is stretched onto the bounds and shown undimmed; the card
            // portrait is cropped to cover and sat under a scrim so the name bubble stays legible.
            // A room with no board art yet borrows its card portrait as a stand-in. That is a
            // placeholder, so it takes the small thumbnail: it is drawn 74-256px wide here, and the
            // full-size master would add several MB to every game load for art due to be replaced.
            const boardArt = resolveBoardArt(room.id, title);
            const art = boardArt ?? resolveOverrideThumb(room.id, 'room', title);
            // A room whose tiles fill its whole bounding box is a plain rectangle; otherwise it has
            // a notch and must be drawn from its actual tiles so the L-shape shows.
            // name bubble: centred for rectangles, on the label tile for L-shapes
            const { isRect, cx: cxr, cy: cyr, fs, w: bubbleW, h: bubbleH } = labelGeom(room, title);
            return (
              <g key={room.id}>
                {isRect ? (
                  <>
                    {/* one cohesive room space (no internal grid) with a soft inset */}
                    <rect x={b.x + 1} y={b.y + 1} width={b.w - 2} height={b.h - 2} rx="5" fill={t.floor} stroke="#e7c66a" strokeWidth="2" />
                    {/* override art (if supplied) fills the room, clipped to its rounded bounds; a soft
                        scrim keeps the white name bubble and glyph legible over busy images */}
                    {art && (
                      <>
                        <clipPath id={`roomclip-${room.id}`}>
                          <rect x={b.x + 2} y={b.y + 2} width={b.w - 4} height={b.h - 4} rx="4" />
                        </clipPath>
                        <image
                          href={art}
                          x={b.x + 2}
                          y={b.y + 2}
                          width={b.w - 4}
                          height={b.h - 4}
                          preserveAspectRatio={boardArt ? 'none' : 'xMidYMid slice'}
                          clipPath={`url(#roomclip-${room.id})`}
                          style={{ pointerEvents: 'none' }}
                        />
                        {!boardArt && (
                          <rect x={b.x + 2} y={b.y + 2} width={b.w - 4} height={b.h - 4} rx="4" fill="rgba(10,7,16,0.32)" clipPath={`url(#roomclip-${room.id})`} style={{ pointerEvents: 'none' }} />
                        )}
                      </>
                    )}
                    <rect x={b.x + 4} y={b.y + 4} width={b.w - 8} height={b.h - 8} rx="4" fill="none" stroke="rgba(231,198,106,0.2)" strokeWidth="1" />
                  </>
                ) : (
                  <>
                    {/* notched room: fill each tile, then trace just the outer edge */}
                    {room.tiles.map((tl) => (
                      <rect key={`${tl.x}-${tl.y}`} x={tl.x * TS - 0.3} y={tl.y * TS - 0.3} width={TS + 0.6} height={TS + 0.6} fill={t.floor} />
                    ))}
                    {/* board art is painted over the whole bounding box, and the notches are cut out
                        by clipping to the room's actual tiles */}
                    {boardArt && (
                      <>
                        <clipPath id={`roomclip-${room.id}`}>
                          {room.tiles.map((tl) => (
                            <rect key={`${tl.x}-${tl.y}`} x={tl.x * TS - 0.3} y={tl.y * TS - 0.3} width={TS + 0.6} height={TS + 0.6} />
                          ))}
                        </clipPath>
                        <image
                          href={boardArt}
                          x={b.x + 2}
                          y={b.y + 2}
                          width={b.w - 4}
                          height={b.h - 4}
                          preserveAspectRatio="none"
                          clipPath={`url(#roomclip-${room.id})`}
                          style={{ pointerEvents: 'none' }}
                        />
                      </>
                    )}
                    <path d={roomOutline(room.tiles)} fill="none" stroke="#e7c66a" strokeWidth="2" strokeLinejoin="round" />
                  </>
                )}
                {/* thematic glyph, centred just above the room name */}
                {!boardArt && (
                  <text x={cxr} y={cyr - bubbleH / 2 - 3} textAnchor="middle" fontSize="13" style={{ pointerEvents: 'none' }}>
                    {EMOJI[room.id] ?? ''}
                  </text>
                )}
                {/* room name, in a white bubble */}
                <g style={{ pointerEvents: 'none' }}>
                  <rect x={cxr - bubbleW / 2} y={cyr - bubbleH / 2} width={bubbleW} height={bubbleH} rx={bubbleH / 2} fill="#f4efe1" stroke="#2a2018" strokeWidth="1" />
                  <text x={cxr} y={cyr + fs * 0.36} textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize={fs} fill="#1a120a">
                    {title}
                  </text>
                </g>
              </g>
            );
          })}

          {/* doors, drawn above every room outline so a connecting door between two rooms is never
              hidden under the neighbour's border */}
          {Object.values(BOARD.rooms).flatMap((room) => {
            const theme = BOARD.sections.find((s) => s.id === room.sectionId)?.theme ?? 'ground-floor';
            const gate = theme === 'grounds';
            return room.entrances.map((e, i) => <Door key={`${room.id}-${i}`} rt={e.roomTile} dt={e.doorTile} gate={gate} />);
          })}


          {/* secret-passage staircases */}
          {BOARD.shortcuts.flatMap((sc) => {
            const aLabel = `${sc.story} — secret passage to the ${getCard(sc.bRoomId)?.title ?? 'unknown'}`;
            const bLabel = `${sc.story} — secret passage to the ${getCard(sc.aRoomId)?.title ?? 'unknown'}`;
            return [
              <Staircase key={`${sc.id}a`} at={sc.a} label={aLabel} onTip={setTip} />,
              <Staircase key={`${sc.id}b`} at={sc.b} label={bLabel} onTip={setTip} />,
            ];
          })}

          {/* envelope */}
          <rect x={BOARD.envelope.x * TS + 1} y={BOARD.envelope.y * TS + 1} width={TS - 2} height={TS - 2} rx="2" fill="#7a1f2b" stroke="#e7c66a" />
          <text x={cx(BOARD.envelope)} y={cy(BOARD.envelope) + 4} textAnchor="middle" fontSize="12">✉</text>

          {/* start homes (faint) */}
          {BOARD.starts.map((s) => (
            <circle key={s.suspectId} cx={cx(s.tile)} cy={cy(s.tile)} r={TS / 2 - 3} fill="none" stroke={suspectColor(s.suspectId)} strokeWidth="1.5" opacity="0.25" />
          ))}

          {/* darken out-of-range squares; highlight reachable path cells individually and each
              reachable room as ONE large clickable space */}
          {canMove &&
            reachSet.size > 0 &&
            (() => {
              const reachRooms = new Map<string, Coord>(); // roomId -> a valid destination tile
              const reachPaths: Coord[] = [];
              for (const t of reachable ?? []) {
                const rid = ROOM_AT.get(coordKey(t));
                if (rid) {
                  if (!reachRooms.has(rid)) reachRooms.set(rid, t);
                } else {
                  reachPaths.push(t);
                }
              }
              return (
                <>
                  <rect x={0} y={0} width={BW} height={BH} fill="rgba(8,6,14,0.55)" />
                  {reachPaths.map((t) => (
                    <rect
                      key={`mv${t.x}-${t.y}`}
                      data-move="1"
                      x={t.x * TS + 1}
                      y={t.y * TS + 1}
                      width={TS - 2}
                      height={TS - 2}
                      rx={3}
                      fill="rgba(231,198,106,0.28)"
                      stroke="#e7c66a"
                      strokeWidth="1.5"
                      style={{ cursor: 'pointer' }}
                      onClick={() => onMoveTo?.(t)}
                    />
                  ))}
                  {[...reachRooms.entries()].map(([rid, dest]) => {
                    const b = roomBounds(BOARD.rooms[rid]);
                    return (
                      <rect
                        key={`mvr${rid}`}
                        data-move="1"
                        x={b.x + 1}
                        y={b.y + 1}
                        width={b.w - 2}
                        height={b.h - 2}
                        rx={5}
                        fill="rgba(231,198,106,0.30)"
                        stroke="#e7c66a"
                        strokeWidth="2.5"
                        style={{ cursor: 'pointer' }}
                        onClick={() => onMoveTo?.(dest)}
                      />
                    );
                  })}
                </>
              );
            })()}

          {/* weapon tokens, grouped by their current room (a suggestion summons them). Drawn above the
              move overlay, like the pawns, so their hover tooltips keep working during a move */}
          {[...weaponsByRoom.entries()].flatMap(([rid, wids]) => {
            if (!BOARD.rooms[rid]) return [];
            const pk = packing(rid);
            return wids.map((wid, i) => {
              const slot = pk.weaponSlots[i];
              return (
                <WeaponToken
                  key={wid}
                  id={wid}
                  px={slot.x}
                  py={slot.y}
                  scale={Math.min(1, pk.r / WEAPON_R)}
                  label={getCard(wid)?.title}
                  onTip={setTip}
                />
              );
            });
          })}

          {/* player pawns: those inside a room cluster together in that one space; others sit on
              their tile (and walk along the path while animating) */}
          {(() => {
            const free = players.filter((p) => !(p.inRoomId && BOARD.rooms[p.inRoomId] && anim?.playerId !== p.id));
            return (
              <>
                {free.map((p) => {
                  const { px, py } = anim?.playerId === p.id ? pawnWorldPos(anim.tile) : { px: cx(p.position), py: cy(p.position) };
                  return (
                    <Pawn
                      key={p.id}
                      px={px}
                      py={py}
                      color={suspectColor(p.suspectId)}
                      eliminated={p.eliminated}
                      label={getCard(p.suspectId)?.title}
                      onTip={setTip}
                    />
                  );
                })}
                {[...pawnsByRoom.entries()].flatMap(([rid, occ]) => {
                  const pk = packing(rid);
                  return occ.map((p, i) => {
                    const slot = pk.pawnSlots[i];
                    return (
                      <Pawn
                        key={p.id}
                        px={slot.x}
                        py={slot.y}
                        r={pk.r}
                        color={suspectColor(p.suspectId)}
                        eliminated={p.eliminated}
                        label={getCard(p.suspectId)?.title}
                        onTip={setTip}
                      />
                    );
                  });
                })}
              </>
            );
          })()}

          <defs>
            {BOARD_TEXTURES.map((name) => {
              const href = textureUrl(name);
              return href ? (
                <pattern key={name} id={texturePatternId(name)} patternUnits="userSpaceOnUse" width={TS} height={TS}>
                  <image href={href} x={0} y={0} width={TS} height={TS} preserveAspectRatio="none" />
                </pattern>
              ) : null;
            })}
            <radialGradient id="pewter" cx="38%" cy="32%" r="75%">
              <stop offset="0" stopColor="#eef0f2" />
              <stop offset="0.6" stopColor="#a9adb3" />
              <stop offset="1" stopColor="#5e6166" />
            </radialGradient>
          </defs>
        </svg>
      </div>
      <div className="bv__hint">scroll or ↑/↓ to zoom · drag to pan</div>
      {followName && <div className="bv__follow">🎥 Following {followName}…</div>}
      {tip && (
        <div className="bv__tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
