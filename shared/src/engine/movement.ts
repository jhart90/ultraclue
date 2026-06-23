import { BOARD, coordKey, type Board, type BoardCell, type Coord, type FloorId } from '../data/board';

// Movement runs over a "collapsed" graph where every room is a single node (a room counts as one
// space and ends your move when you enter it) and every corridor cell is its own node. Each floor's
// elevator is a single terminal node too: entering it ends the move (and triggers the floor choice
// in the turn engine). Cellar stairs are a free Grounds<->Basement link. The 8 secret shortcuts are
// NOT part of dice movement (separate mechanic).

const roomNode = (roomId: string) => `room:${roomId}`;
const elevNode = (floor: FloorId) => `elev:${floor}`;
const isRoomNode = (n: string) => n.startsWith('room:');
const isElevNode = (n: string) => n.startsWith('elev:');
const isStopNode = (n: string) => isRoomNode(n) || isElevNode(n);

function buildCellMap(board: Board): Map<string, BoardCell> {
  const m = new Map<string, BoardCell>();
  for (const c of board.cells) m.set(coordKey(c), c);
  return m;
}

function nodeOf(cellMap: Map<string, BoardCell>, tile: Coord): string {
  const c = cellMap.get(coordKey(tile));
  if (c?.type === 'room' && c.roomId) return roomNode(c.roomId);
  if (c?.type === 'elevator' && c.elevatorFloor) return elevNode(c.elevatorFloor);
  return coordKey(tile);
}

function buildMoveGraph(board: Board): { graph: Map<string, string[]>; cellMap: Map<string, BoardCell> } {
  const cellMap = buildCellMap(board);
  const graph = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!graph.has(a)) graph.set(a, []);
    if (!graph.has(b)) graph.set(b, []);
    if (!graph.get(a)!.includes(b)) graph.get(a)!.push(b);
    if (!graph.get(b)!.includes(a)) graph.get(b)!.push(a);
  };

  const ORTHO = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  for (const c of board.cells) {
    if (c.type === 'room') continue; // rooms join only via doorways
    for (const d of ORTHO) {
      const n = cellMap.get(coordKey({ x: c.x + d.x, y: c.y + d.y }));
      if (!n || n.type === 'room') continue;
      link(nodeOf(cellMap, c), nodeOf(cellMap, n)); // hall<->hall and hall<->elevator entries
    }
  }
  for (const room of Object.values(board.rooms)) {
    for (const e of room.entrances) link(roomNode(room.id), nodeOf(cellMap, e.doorTile));
  }
  // Cellar stairs: a free Grounds <-> Basement link.
  if (board.cellarLink.a && board.cellarLink.b) link(nodeOf(cellMap, board.cellarLink.a), nodeOf(cellMap, board.cellarLink.b));

  return { graph, cellMap };
}

// Cache for the static BOARD.
const CACHE = buildMoveGraph(BOARD);

interface Bfs {
  dist: Map<string, number>;
  parent: Map<string, string>;
}

function bfs(board: Board, start: Coord, steps: number, blocked: Set<string>): { graph: Map<string, string[]>; cellMap: Map<string, BoardCell>; startNode: string } & Bfs {
  const { graph, cellMap } = board === BOARD ? CACHE : buildMoveGraph(board);
  const startNode = nodeOf(cellMap, start);
  const dist = new Map<string, number>([[startNode, 0]]);
  const parent = new Map<string, string>();
  const queue: string[] = [startNode];

  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    // A room or elevator (other than where you started) ends your move — don't expand through it.
    if (isStopNode(cur) && cur !== startNode) continue;
    if (d >= steps) continue;
    for (const n of graph.get(cur) ?? []) {
      if (!isStopNode(n) && blocked.has(n)) continue; // corridor occupied by another piece
      if (!dist.has(n)) {
        dist.set(n, d + 1);
        parent.set(n, cur);
        queue.push(n);
      }
    }
  }
  return { graph, cellMap, startNode, dist, parent };
}

/** The room id at a tile, or undefined if it is a corridor / off-board. */
export function roomIdAt(board: Board, tile: Coord): string | undefined {
  const cellMap = board === BOARD ? CACHE.cellMap : buildCellMap(board);
  const c = cellMap.get(coordKey(tile));
  return c && c.type === 'room' ? c.roomId : undefined;
}

/** The elevator's floor if this tile is an elevator cell, else undefined. */
export function elevatorFloorAt(board: Board, tile: Coord): FloorId | undefined {
  const cellMap = board === BOARD ? CACHE.cellMap : buildCellMap(board);
  const c = cellMap.get(coordKey(tile));
  return c && c.type === 'elevator' ? c.elevatorFloor : undefined;
}

/** Path cells occupied by other pieces (rooms hold many pieces, so room cells never block). */
export function blockedCells(board: Board, positions: Coord[]): Set<string> {
  const cellMap = board === BOARD ? CACHE.cellMap : buildCellMap(board);
  const set = new Set<string>();
  for (const p of positions) {
    const c = cellMap.get(coordKey(p));
    if (c && c.type === 'path') set.add(coordKey(p));
  }
  return set;
}

/** Tiles the piece may legally finish on with this many steps (room cells expand to all their tiles). */
export function reachableTiles(board: Board, start: Coord, steps: number, blocked: Set<string>): Coord[] {
  const { cellMap, dist, startNode } = bfs(board, start, steps, blocked);
  const out: Coord[] = [];
  for (const [node, d] of dist) {
    if (node === startNode || d === 0) continue;
    if (isRoomNode(node)) {
      const roomId = node.slice('room:'.length);
      for (const t of board.rooms[roomId].tiles) out.push({ x: t.x, y: t.y });
    } else if (isElevNode(node)) {
      const floor = node.slice('elev:'.length) as FloorId;
      const elev = board.elevators.find((e) => e.floor === floor);
      if (elev) for (const t of elev.cells) out.push({ x: t.x, y: t.y });
    } else {
      const [x, y] = node.split(',').map(Number);
      out.push({ x, y });
    }
    void cellMap;
  }
  return out;
}

/** The walked tile path from `start` to `dest` (for animation). Empty if unreachable. */
export function pathTo(board: Board, start: Coord, dest: Coord, steps: number, blocked: Set<string>): Coord[] {
  const { cellMap, parent, dist } = bfs(board, start, steps, blocked);
  const destNode = nodeOf(cellMap, dest);
  if (!dist.has(destNode)) return [];

  const nodes: string[] = [];
  let cur: string | undefined = destNode;
  while (cur) {
    nodes.unshift(cur);
    cur = parent.get(cur);
  }
  // Expand nodes to tiles: corridors are their coord; the start room uses `start`, the
  // destination room uses the clicked `dest`.
  return nodes.map((node, i) => {
    if (isStopNode(node)) {
      return i === 0 ? { x: start.x, y: start.y } : { x: dest.x, y: dest.y };
    }
    const [x, y] = node.split(',').map(Number);
    return { x, y };
  });
}
