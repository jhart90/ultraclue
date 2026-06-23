import { describe, it, expect } from 'vitest';
import { BOARD, buildAdjacency, coordKey, ROOMS, SUSPECTS, type Coord } from '../src';

function cellAt(c: Coord) {
  return BOARD.cells.find((t) => t.x === c.x && t.y === c.y);
}

/** Is a room's footprint a single connected blob? */
function isContiguous(tiles: Coord[]): boolean {
  if (tiles.length === 0) return false;
  const keys = new Set(tiles.map(coordKey));
  const seen = new Set<string>([coordKey(tiles[0])]);
  const queue = [tiles[0]];
  while (queue.length) {
    const t = queue.shift()!;
    for (const d of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const nk = coordKey({ x: t.x + d.x, y: t.y + d.y });
      if (keys.has(nk) && !seen.has(nk)) {
        seen.add(nk);
        queue.push({ x: t.x + d.x, y: t.y + d.y });
      }
    }
  }
  return seen.size === tiles.length;
}

describe('board (themed sections)', () => {
  it('has four themed sections', () => {
    expect(BOARD.sections).toHaveLength(4);
    expect(BOARD.sections.map((s) => s.theme)).toEqual(['grounds', 'ground-floor', 'upper-floor', 'basement']);
  });

  it('contains all 40 rooms, each a contiguous blob with 2–5 entrances (closet has 1)', () => {
    expect(Object.keys(BOARD.rooms)).toHaveLength(40);
    for (const room of ROOMS) {
      const layout = BOARD.rooms[room.id];
      expect(layout, room.id).toBeTruthy();
      expect(layout.tiles.length, room.id).toBeGreaterThan(0);
      expect(isContiguous(layout.tiles), `${room.id} not contiguous`).toBe(true);
      if (room.id === 'room-walk-in-closet') {
        expect(layout.entrances).toHaveLength(1);
      } else {
        expect(layout.entrances.length, `${room.id} entrance count`).toBeGreaterThanOrEqual(2);
        expect(layout.entrances.length, `${room.id} entrance count`).toBeLessThanOrEqual(5);
      }
    }
  });

  it('gives every suspect a unique start tile on a walkable path cell', () => {
    expect(BOARD.starts).toHaveLength(40);
    expect(new Set(BOARD.starts.map((s) => s.suspectId)).size).toBe(40);
    expect(new Set(SUSPECTS.map((s) => s.id))).toEqual(new Set(BOARD.starts.map((s) => s.suspectId)));
    for (const { tile } of BOARD.starts) expect(cellAt(tile)?.type, coordKey(tile)).toBe('path');
  });

  it('places the envelope on a path cell', () => {
    expect(cellAt(BOARD.envelope)?.type).toBe('path');
  });

  it('has 8 shortcuts: 6 distant room pairs and 2 world pairs', () => {
    expect(BOARD.shortcuts).toHaveLength(8);
    expect(BOARD.shortcuts.filter((s) => s.kind === 'room')).toHaveLength(6);
    expect(BOARD.shortcuts.filter((s) => s.kind === 'world')).toHaveLength(2);
    for (const sc of BOARD.shortcuts.filter((s) => s.kind === 'room')) {
      expect(sc.aRoomId).not.toBe(sc.bRoomId);
      expect(Math.abs(sc.a.x - sc.b.x) + Math.abs(sc.a.y - sc.b.y), sc.id).toBeGreaterThan(15);
    }
  });

  it('makes the Walk-in Closet a dead-end with a single door into the Master Suite', () => {
    const closet = BOARD.rooms['room-walk-in-closet'];
    expect(closet.entrances).toHaveLength(1);
    const masterTiles = new Set(BOARD.rooms['room-master-suite'].tiles.map(coordKey));
    expect(masterTiles.has(coordKey(closet.entrances[0].doorTile))).toBe(true);
    const closetTiles = new Set(closet.tiles.map(coordKey));
    const adj = buildAdjacency(BOARD, false);
    for (const t of closet.tiles) {
      for (const nk of adj.get(coordKey(t)) ?? []) {
        expect(closetTiles.has(nk) || masterTiles.has(nk), `closet leaked to ${nk}`).toBe(true);
      }
    }
  });

  it('is fully connected via doorways + stairs (without secret shortcuts)', () => {
    const adj = buildAdjacency(BOARD, false);
    const startKey = coordKey(BOARD.starts[0].tile);
    const seen = new Set<string>([startKey]);
    const queue = [startKey];
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
