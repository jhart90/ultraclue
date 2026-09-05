import { describe, it, expect } from 'vitest';
import { BOARD, buildAdjacency, coordKey, roomToRoomDistance, ROOMS, SUSPECTS, type Coord } from '../src';

const ORTHO = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
const CELL = new Map(BOARD.cells.map((c) => [coordKey(c), c]));
const cellAt = (c: Coord) => CELL.get(coordKey(c));
const ROOM_IDS = Object.keys(BOARD.rooms);
const title = (id: string) => ROOMS.find((r) => r.id === id)?.title ?? id;

// Rooms that are deliberately out of the way: the maze you must thread, the one-door Bunker.
const REMOTE = new Set(['room-hedge-maze', 'room-bunker']);

function isContiguous(tiles: Coord[]): boolean {
  if (tiles.length === 0) return false;
  const keys = new Set(tiles.map(coordKey));
  const seen = new Set<string>([coordKey(tiles[0])]);
  const queue = [tiles[0]];
  while (queue.length) {
    const t = queue.shift()!;
    for (const d of ORTHO) {
      const nk = coordKey({ x: t.x + d.x, y: t.y + d.y });
      if (keys.has(nk) && !seen.has(nk)) {
        seen.add(nk);
        queue.push({ x: t.x + d.x, y: t.y + d.y });
      }
    }
  }
  return seen.size === tiles.length;
}

/** Pairs of rooms joined by a connecting door (one room's door opens straight into the other). */
function internalPairs(): Set<string> {
  const out = new Set<string>();
  for (const r of Object.values(BOARD.rooms)) {
    for (const e of r.entrances) {
      const c = cellAt(e.doorTile);
      if (c?.type === 'room' && c.roomId) out.add([r.id, c.roomId].sort().join('|'));
    }
  }
  return out;
}

/** Steps from a hall tile to the nearest room (rooms passable, stairs free, no elevator). */
function stepsToNearestRoom(start: Coord): number {
  const adj = buildAdjacency(BOARD, false);
  const dist = new Map<string, number>([[coordKey(start), 0]]);
  const queue = [coordKey(start)];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    const c = CELL.get(cur)!;
    if (c.type === 'room') return d;
    for (const n of adj.get(cur) ?? []) {
      if (dist.has(n)) continue;
      const nc = CELL.get(n)!;
      // a stair hop is free; entering an elevator is not a room
      const free = BOARD.stairs.some((st) => st.a.some((t, i) => (coordKey(t) === cur && coordKey(st.b[i]) === n) || (coordKey(st.b[i]) === cur && coordKey(t) === n)));
      if (nc.type === 'elevator') continue;
      dist.set(n, d + (free ? 0 : 1));
      if (free) queue.unshift(n);
      else queue.push(n);
    }
  }
  return Infinity;
}

describe('board (2D themed sections)', () => {
  it('has four themed sections laid out in 2D', () => {
    expect(BOARD.sections).toHaveLength(4);
    const by = Object.fromEntries(BOARD.sections.map((s) => [s.id, s.origin]));
    expect(by['grounds'].x).toBe(by['ground-floor'].x);
    expect(by['grounds'].y).toBeLessThan(by['ground-floor'].y);
    expect(by['upper-floor'].x).toBeLessThan(by['ground-floor'].x);
    expect(by['basement'].x).toBeGreaterThan(by['ground-floor'].x);
  });

  it('contains all 40 rooms, each contiguous with 1–3 entrances, and rooms sized by tier', () => {
    expect(ROOM_IDS).toHaveLength(40);
    for (const room of ROOMS) {
      const layout = BOARD.rooms[room.id];
      expect(layout, room.id).toBeTruthy();
      expect(isContiguous(layout.tiles), `${room.id} not contiguous`).toBe(true);
      expect(layout.entrances.length, `${room.id} entrances`).toBeGreaterThanOrEqual(1);
      expect(layout.entrances.length, `${room.id} entrances`).toBeLessThanOrEqual(3);
    }
    const size = (id: string) => BOARD.rooms[id].tiles.length;
    // grand rooms
    for (const id of ['room-ballroom', 'room-master-suite', 'room-courtyard']) expect(size(id), id).toBeGreaterThanOrEqual(40);
    // the Ballroom is the biggest indoor room bar the open Courtyard
    for (const id of ROOM_IDS) if (id !== 'room-ballroom' && id !== 'room-courtyard' && id !== 'room-master-suite') expect(size(id), id).toBeLessThan(size('room-ballroom'));
    // small rooms
    for (const id of ['room-gazebo', 'room-walk-in-closet', 'room-pantry', 'room-clock-tower', 'room-bunker']) expect(size(id), id).toBeLessThanOrEqual(18);
    // the kitchen is a real kitchen: Dining on one side, Pantry on the other, back door to the passage
    expect(size('room-kitchen')).toBeGreaterThanOrEqual(24);
    expect(BOARD.rooms['room-kitchen'].entrances).toHaveLength(3);
  });

  it('has a 3x3 elevator on each indoor floor with several exit tiles', () => {
    expect(BOARD.elevators).toHaveLength(3);
    expect(new Set(BOARD.elevators.map((e) => e.floor))).toEqual(new Set(['ground-floor', 'upper-floor', 'basement']));
    for (const e of BOARD.elevators) {
      expect(e.cells.length, e.floor).toBe(9);
      expect(e.exits.length, e.floor).toBeGreaterThanOrEqual(4);
      for (const x of e.exits) expect(cellAt(x)?.type).toBe('path');
      expect(cellAt(e.exit)?.type).toBe('path');
    }
    expect(BOARD.rooms['room-elevator']).toBeUndefined();
  });

  it('puts the fountain (and the envelope) in the middle of the walled Courtyard out on the Grounds', () => {
    expect(BOARD.fountain).toHaveLength(12);
    const xs = BOARD.fountain.map((t) => t.x);
    const ys = BOARD.fountain.map((t) => t.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(3);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(2);
    const adj = buildAdjacency(BOARD, false);
    const yard = BOARD.rooms['room-courtyard'];
    const yx = yard.tiles.map((t) => t.x);
    const yy = yard.tiles.map((t) => t.y);
    for (const t of BOARD.fountain) {
      const c = cellAt(t);
      expect(c?.type, coordKey(t)).toBe('fountain');
      expect(c?.sectionId).toBe('grounds');
      expect(adj.get(coordKey(t)) ?? [], `fountain ${coordKey(t)} is walkable`).toHaveLength(0);
      expect(t.x).toBeGreaterThan(Math.min(...yx));
      expect(t.x).toBeLessThan(Math.max(...yx));
      expect(t.y).toBeGreaterThan(Math.min(...yy));
      expect(t.y).toBeLessThan(Math.max(...yy));
    }
    expect(cellAt(BOARD.envelope)?.type).toBe('fountain');
  });

  it('has no open hall block 3 tiles wide in both directions (corridors are 1 or 2 wide)', () => {
    const W = BOARD.width;
    const H = BOARD.height;
    const open: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(false));
    for (const c of BOARD.cells) if (c.type === 'path') open[c.y][c.x] = true;
    let worst: string | null = null;
    for (let y = 0; y <= H - 3 && !worst; y++) {
      for (let x = 0; x <= W - 3 && !worst; x++) {
        let all = true;
        for (let dy = 0; dy < 3 && all; dy++) for (let dx = 0; dx < 3; dx++) if (!open[y + dy][x + dx]) all = false;
        if (all) worst = `${x},${y}`;
      }
    }
    expect(worst, `3x3 open hall block at ${worst}`).toBeNull();
  });

  it('requires a roll of 4+ to walk between any two rooms, except through a connecting door', () => {
    const internal = internalPairs();
    expect(internal).toEqual(
      new Set(
        [
          ['room-dining', 'room-kitchen'],
          ['room-kitchen', 'room-pantry'],
          ['room-library', 'room-study'],
          ['room-boudoir', 'room-master-suite'],
          ['room-master-suite', 'room-walk-in-closet'],
          ['room-gymnasium', 'room-sauna'],
        ].map((p) => p.sort().join('|')),
      ),
    );
    let worst = Infinity;
    let worstPair = '';
    for (const a of ROOM_IDS) {
      for (const b of ROOM_IDS) {
        if (a >= b || internal.has([a, b].sort().join('|'))) continue;
        const d = roomToRoomDistance(BOARD, a, b, false);
        if (d < worst) (worst = d), (worstPair = `${title(a)} -> ${title(b)}`);
      }
    }
    expect(worst, `closest room pair (${worstPair}) is only ${worst} steps apart`).toBeGreaterThanOrEqual(4);
  });

  it('separates the wings from the Ground Floor by a 2-wide blank gap', () => {
    const xAt = (id: string) => BOARD.sections.find((s) => s.id === id)!.origin.x;
    const wAt = (id: string) => BOARD.sections.find((s) => s.id === id)!.width;
    const upperRight = xAt('upper-floor') + wAt('upper-floor');
    expect(xAt('ground-floor') - upperRight).toBe(2);
    const groundRight = xAt('ground-floor') + wAt('ground-floor');
    expect(xAt('basement') - groundRight).toBe(2);
    for (const gapX of [upperRight, upperRight + 1, groundRight, groundRight + 1]) {
      expect(BOARD.cells.some((c) => c.x === gapX), `gap column ${gapX} must be blank`).toBe(false);
    }
  });

  it('joins every section to the rest by at least two staircases, each with paired landing tiles', () => {
    expect(BOARD.stairs.length).toBeGreaterThanOrEqual(5);
    const touches: Record<string, number> = {};
    for (const st of BOARD.stairs) {
      expect(st.a.length, st.id).toBe(st.b.length);
      expect(st.a.length, st.id).toBeGreaterThanOrEqual(1);
      for (const t of st.a) {
        expect(cellAt(t)?.type, `${st.id} ${coordKey(t)}`).toBe('path');
        expect(cellAt(t)?.sectionId, st.id).toBe(st.from);
        expect(cellAt(t)?.landing).toBe(true);
      }
      for (const t of st.b) {
        expect(cellAt(t)?.type, `${st.id} ${coordKey(t)}`).toBe('path');
        expect(cellAt(t)?.sectionId, st.id).toBe(st.to);
      }
      touches[st.from] = (touches[st.from] ?? 0) + 1;
      touches[st.to] = (touches[st.to] ?? 0) + 1;
    }
    for (const sec of BOARD.sections) expect(touches[sec.id] ?? 0, sec.id).toBeGreaterThanOrEqual(2);
    // every landing keeps one clear hall tile between it and any room, pillar, hedge or water
    // (lawn beside a garden landing is fine); only the Clock Tower's spiral hugs its tower
    for (const st of BOARD.stairs) {
      if (st.id === 'stairs-spiral') continue;
      for (const t of [...st.a, ...st.b]) {
        for (const d of ORTHO) {
          const n = cellAt({ x: t.x + d.x, y: t.y + d.y });
          if (!n) continue; // the void beside a section edge
          const clear = n.type === 'path' || (n.type === 'obstacle' && n.obstacleKind === 'lawn');
          expect(clear, `${st.id} landing ${coordKey(t)} touches ${n.type}${n.roomId ? ' ' + n.roomId : ''} at ${coordKey(n)}`).toBe(true);
        }
      }
    }
    // the grand staircase is three tiles wide, so one pawn can never block it
    const grand = BOARD.stairs.find((s) => s.id === 'stairs-grand')!;
    expect(grand.a).toHaveLength(3);
    // and no lift sits against a landing (a rider stepping out must never crowd the stairs)
    for (const e of BOARD.elevators) {
      for (const cell of e.cells) {
        for (const l of [...grand.a, ...grand.b]) {
          expect(Math.abs(cell.x - l.x) + Math.abs(cell.y - l.y), `${e.floor} lift cell ${coordKey(cell)} touches landing ${coordKey(l)}`).toBeGreaterThan(2);
        }
      }
    }
  });

  it('gives every suspect a start tile 2–5 steps from a room, clear of doors and landings, spread across the house', () => {
    expect(BOARD.starts).toHaveLength(40);
    expect(new Set(BOARD.starts.map((s) => s.suspectId))).toEqual(new Set(SUSPECTS.map((s) => s.id)));
    expect(new Set(BOARD.starts.map((s) => coordKey(s.tile))).size).toBe(40);
    const doorTiles = new Set<string>();
    for (const r of Object.values(BOARD.rooms)) for (const e of r.entrances) if (cellAt(e.doorTile)?.type === 'path') doorTiles.add(coordKey(e.doorTile));
    const bySeat = [...BOARD.starts].sort((a, b) => SUSPECTS.find((s) => s.id === a.suspectId)!.turnOrder - SUSPECTS.find((s) => s.id === b.suspectId)!.turnOrder);
    const sections: string[] = [];
    for (const { suspectId, tile } of bySeat) {
      const c = cellAt(tile);
      expect(c?.type, suspectId).toBe('path');
      expect(c?.landing ?? false, `${suspectId} starts on a stair landing`).toBe(false);
      expect(doorTiles.has(coordKey(tile)), `${suspectId} starts on a door tile`).toBe(false);
      for (const d of ORTHO) expect(doorTiles.has(coordKey({ x: tile.x + d.x, y: tile.y + d.y })), `${suspectId} starts beside a door`).toBe(false);
      const steps = stepsToNearestRoom(tile);
      expect(steps, `${suspectId} nearest room`).toBeGreaterThanOrEqual(2);
      expect(steps, `${suspectId} nearest room`).toBeLessThanOrEqual(5);
      sections.push(c!.sectionId);
    }
    // any table of 8 (or fewer) consecutive seats is spread over all four sections
    for (let i = 0; i + 8 <= sections.length; i++) expect(new Set(sections.slice(i, i + 8)).size, `seats ${i + 1}-${i + 8}`).toBe(4);
    for (let i = 2; i < sections.length; i++) expect(sections[i] === sections[i - 1] && sections[i] === sections[i - 2], `seats ${i - 1}-${i + 1} all in ${sections[i]}`).toBe(false);
  });

  it('cuts the Planetarium and Gazebo corners on the diagonal', () => {
    const forRoom = (id: string) => BOARD.chamfers.filter((c) => c.roomId === id);
    expect(forRoom('room-planetarium').map((c) => c.corner).sort()).toEqual(['ne', 'nw', 'se', 'sw']);
    expect(forRoom('room-gazebo').map((c) => c.corner).sort()).toEqual(['ne', 'nw', 'se', 'sw']);
    for (const ch of BOARD.chamfers) {
      const room = BOARD.rooms[ch.roomId];
      const xs = room.tiles.map((t) => t.x), ys = room.tiles.map((t) => t.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      // a strip of one or two tiles, all obstacles nothing walks on
      expect(ch.tiles.length).toBeGreaterThanOrEqual(1);
      expect(ch.tiles.length).toBeLessThanOrEqual(2);
      for (const t of ch.tiles) {
        const c = cellAt(t);
        expect(c?.type, coordKey(t)).toBe('obstacle');
        expect(c?.obstacleKind, coordKey(t)).toBe('chamfer');
        // sitting in the named corner of the room's bounding box (a two-tile strip runs inward along the edge)
        const n = ch.tiles.length;
        const yOk = ch.corner.includes('n') ? t.y === minY : t.y === maxY;
        const xOk = ch.corner.includes('w') ? t.x >= minX && t.x < minX + n : t.x <= maxX && t.x > maxX - n;
        expect(yOk && xOk, `${ch.roomId} ${ch.corner} ${coordKey(t)}`).toBe(true);
      }
    }
  });

  it('has 8 secret passages, each with a story and each saving a long walk', () => {
    expect(BOARD.shortcuts).toHaveLength(8);
    const seen = new Set<string>();
    for (const sc of BOARD.shortcuts) {
      expect(sc.kind).toBe('room');
      expect(sc.story.length).toBeGreaterThan(3);
      for (const id of [sc.aRoomId, sc.bRoomId]) {
        expect(seen.has(id), `${title(id)} has two passages`).toBe(false);
        seen.add(id);
      }
      expect(cellAt(sc.a)?.roomId).toBe(sc.aRoomId);
      expect(cellAt(sc.b)?.roomId).toBe(sc.bRoomId);
      const walk = roomToRoomDistance(BOARD, sc.aRoomId, sc.bRoomId);
      expect(walk, `${title(sc.aRoomId)} <-> ${title(sc.bRoomId)} saves only ${walk}`).toBeGreaterThanOrEqual(20);
    }
  });

  it('makes the Walk-in Closet a dead-end with its only door into the Master Suite', () => {
    const closet = BOARD.rooms['room-walk-in-closet'];
    expect(closet.entrances).toHaveLength(1);
    const master = new Set(BOARD.rooms['room-master-suite'].tiles.map(coordKey));
    expect(master.has(coordKey(closet.entrances[0].doorTile))).toBe(true);
    const closetTiles = new Set(closet.tiles.map(coordKey));
    const adj = buildAdjacency(BOARD, false);
    for (const t of closet.tiles) {
      for (const nk of adj.get(coordKey(t)) ?? []) {
        expect(closetTiles.has(nk) || master.has(nk), `closet leaked to ${nk}`).toBe(true);
      }
    }
  });

  it('gives the Bunker one door at the end of a 1-wide blast corridor', () => {
    const bunker = BOARD.rooms['room-bunker'];
    expect(bunker.entrances).toHaveLength(1);
    let t = bunker.entrances[0].doorTile;
    // walk the corridor away from the door: each tile has exactly two open neighbours for 3 tiles
    let prev = bunker.entrances[0].roomTile;
    for (let i = 0; i < 3; i++) {
      const open = ORTHO.map((d) => ({ x: t.x + d.x, y: t.y + d.y })).filter((n) => cellAt(n)?.type === 'path');
      expect(open.length, `blast corridor tile ${coordKey(t)}`).toBe(i === 0 ? 1 : 2);
      const next = open.find((n) => coordKey(n) !== coordKey(prev))!;
      prev = t;
      t = next;
    }
  });

  it('is fully connected via halls + staircases (without secret passages)', () => {
    const adj = buildAdjacency(BOARD, false);
    const start = coordKey(BOARD.starts[0].tile);
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    }
    for (const s of BOARD.starts) expect(seen.has(coordKey(s.tile)), `start ${s.suspectId}`).toBe(true);
    for (const room of Object.values(BOARD.rooms)) {
      expect(room.tiles.some((t: Coord) => seen.has(coordKey(t))), `room ${room.id}`).toBe(true);
    }
  });

  it('keeps walking distances fair: neighbours within a roll, no room stranded, no marathon pairs', () => {
    const all: number[] = [];
    for (const a of ROOM_IDS) {
      let sum = 0;
      let within7 = 0;
      for (const b of ROOM_IDS) {
        if (a === b) continue;
        const d = roomToRoomDistance(BOARD, a, b);
        expect(Number.isFinite(d), `${title(a)} cannot reach ${title(b)}`).toBe(true);
        sum += d;
        if (d <= 7) within7++;
        if (a < b) all.push(d);
      }
      if (REMOTE.has(a)) continue;
      expect(within7, `${title(a)} has only ${within7} rooms within a 7-step roll`).toBeGreaterThanOrEqual(2);
      expect(sum / (ROOM_IDS.length - 1), `${title(a)} averages too far from everything`).toBeLessThanOrEqual(27);
    }
    all.sort((x, y) => x - y);
    expect(all[all.length - 1], 'longest room-to-room walk').toBeLessThanOrEqual(48);
    expect(all[all.length >> 1], 'median room-to-room walk').toBeLessThanOrEqual(21);
  });
});
