import { describe, it, expect } from 'vitest';
import { BOARD, buildAdjacency, coordKey, ROOMS, SUSPECTS, type Coord } from '../src';

function cellAt(c: Coord) {
  return BOARD.cells.find((t) => t.x === c.x && t.y === c.y);
}

function isContiguous(tiles: Coord[]): boolean {
  if (tiles.length === 0) return false;
  const keys = new Set(tiles.map(coordKey));
  const seen = new Set<string>([coordKey(tiles[0])]);
  const queue = [tiles[0]];
  while (queue.length) {
    const t = queue.shift()!;
    for (const d of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      const nk = coordKey({ x: t.x + d.x, y: t.y + d.y });
      if (keys.has(nk) && !seen.has(nk)) {
        seen.add(nk);
        queue.push({ x: t.x + d.x, y: t.y + d.y });
      }
    }
  }
  return seen.size === tiles.length;
}

describe('board (2D themed sections)', () => {
  it('has four themed sections laid out in 2D', () => {
    expect(BOARD.sections).toHaveLength(4);
    const by = Object.fromEntries(BOARD.sections.map((s) => [s.id, s.origin]));
    // grounds directly above ground floor (same x); upper left, basement right of ground floor
    expect(by['grounds'].x).toBe(by['ground-floor'].x);
    expect(by['grounds'].y).toBeLessThan(by['ground-floor'].y);
    expect(by['upper-floor'].x).toBeLessThan(by['ground-floor'].x);
    expect(by['basement'].x).toBeGreaterThan(by['ground-floor'].x);
  });

  it('contains all 40 rooms, each contiguous with 2–5 entrances (closet has 1)', () => {
    expect(Object.keys(BOARD.rooms)).toHaveLength(40);
    for (const room of ROOMS) {
      const layout = BOARD.rooms[room.id];
      expect(layout, room.id).toBeTruthy();
      expect(layout.tiles.length, room.id).toBeGreaterThan(0);
      expect(isContiguous(layout.tiles), `${room.id} not contiguous`).toBe(true);
      if (room.id === 'room-walk-in-closet' || room.id === 'room-bunker') expect(layout.entrances).toHaveLength(1);
      else {
        expect(layout.entrances.length, `${room.id} entrances`).toBeGreaterThanOrEqual(2);
        expect(layout.entrances.length, `${room.id} entrances`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('has a 3x3 elevator on each indoor floor (not the grounds)', () => {
    expect(BOARD.elevators).toHaveLength(3);
    expect(new Set(BOARD.elevators.map((e) => e.floor))).toEqual(
      new Set(['ground-floor', 'upper-floor', 'basement']),
    );
    for (const e of BOARD.elevators) {
      expect(e.cells.length, e.floor).toBe(9);
      expect(cellAt(e.exit)?.type).toBe('path');
    }
    // the elevator is not a room
    expect(BOARD.rooms['room-elevator']).toBeUndefined();
  });

  it('has a 5x5 fountain obstacle in the Grounds that pieces cannot enter', () => {
    expect(BOARD.fountain).toHaveLength(25);
    const xs = BOARD.fountain.map((t) => t.x);
    const ys = BOARD.fountain.map((t) => t.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(4); // a contiguous 5-wide
    expect(Math.max(...ys) - Math.min(...ys)).toBe(4); // x 5-tall block
    const adj = buildAdjacency(BOARD, false);
    const starts = new Set(BOARD.starts.map((s) => coordKey(s.tile)));
    for (const t of BOARD.fountain) {
      const c = cellAt(t);
      expect(c?.type, coordKey(t)).toBe('fountain');
      expect(c?.sectionId).toBe('grounds');
      expect(adj.get(coordKey(t)) ?? [], `fountain ${coordKey(t)} is walkable`).toHaveLength(0);
      expect(starts.has(coordKey(t)), `start on fountain ${coordKey(t)}`).toBe(false);
    }
  });

  it('links the Grounds and Basement via cellar stairs', () => {
    const a = cellAt(BOARD.cellarLink.a);
    const b = cellAt(BOARD.cellarLink.b);
    expect(a?.sectionId).toBe('grounds');
    expect(b?.sectionId).toBe('basement');
  });

  it('gives every suspect a unique start tile on a walkable hall cell', () => {
    expect(BOARD.starts).toHaveLength(40);
    expect(new Set(BOARD.starts.map((s) => s.suspectId))).toEqual(new Set(SUSPECTS.map((s) => s.id)));
    for (const { tile } of BOARD.starts) expect(cellAt(tile)?.type, coordKey(tile)).toBe('path');
  });

  it('has 8 shortcuts (6 room, 2 world) and the envelope on a path', () => {
    expect(BOARD.shortcuts.filter((s) => s.kind === 'room')).toHaveLength(6);
    expect(BOARD.shortcuts.filter((s) => s.kind === 'world')).toHaveLength(2);
    expect(cellAt(BOARD.envelope)?.type).toBe('path');
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

  it('is fully connected via halls + cellar stairs (without secret shortcuts)', () => {
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
    expect(seen.has(coordKey(BOARD.envelope))).toBe(true);
  });
});
