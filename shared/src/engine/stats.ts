import type { GameState, GameStats, GameView, Participant, PlayerStats } from '../game';

const emptyPlayer = (): PlayerStats => ({
  turns: 0,
  tiles: 0,
  roomsVisited: [],
  suggestions: 0,
  reveals: 0,
  accusations: 0,
  accusationsCorrect: 0,
  suggested: { suspects: {}, weapons: {}, rooms: {} },
});

/** Fresh per-game statistics: one empty tally per dealt player. */
export function newStats(playerIds: string[], now = Date.now()): GameStats {
  const players: Record<string, PlayerStats> = {};
  for (const id of playerIds) players[id] = emptyPlayer();
  return { startedAt: now, participants: [], turnsPlayed: 0, suggestionCount: 0, suspects: {}, weapons: {}, rooms: {}, players };
}

/** A seat or watcher as the server sees it right now. */
export interface RosterEntry {
  name: string;
  kind: Participant['kind'];
  suspectId?: string;
}

const sameSeat = (p: Participant, r: RosterEntry) =>
  p.name === r.name && p.kind === r.kind && (p.kind === 'observer' || p.suspectId === r.suspectId);

/**
 * Reconcile the participants list with who is at the table now: newcomers are added, and anyone no
 * longer present (left, dropped, replaced by a computer, or stopped watching) is stamped with the
 * time they went. Someone who comes back gets a fresh entry.
 */
export function syncParticipants(state: GameState, roster: RosterEntry[], now = Date.now()): void {
  const st = statsOf(state);
  if (!st.participants) st.participants = [];
  const list = st.participants;
  const present = new Set<Participant>();
  for (const r of roster) {
    let p = list.find((x) => !x.leftAt && sameSeat(x, r));
    if (!p) {
      p = { name: r.name, kind: r.kind, suspectId: r.kind === 'observer' ? undefined : r.suspectId, joinedAt: now };
      list.push(p);
    }
    present.add(p);
  }
  for (const p of list) if (!p.leftAt && !present.has(p)) p.leftAt = now;
}

/** Stamp the end of the game (once). */
export function noteGameEnd(state: GameState, now = Date.now()): void {
  const st = statsOf(state);
  if (!st.endedAt) st.endedAt = now;
}

/** The game's tally, created on demand (games saved before stats existed have none). */
export function statsOf(state: GameState): GameStats {
  if (!state.stats) state.stats = newStats(state.players.map((p) => p.id));
  return state.stats;
}

/** A player's tally, created on demand. */
export function playerStats(state: GameState, playerId: string): PlayerStats {
  const st = statsOf(state);
  if (!st.players[playerId]) st.players[playerId] = emptyPlayer();
  return st.players[playerId];
}

const bump = (tally: Record<string, number>, key: string) => {
  tally[key] = (tally[key] ?? 0) + 1;
};

export function noteTurn(state: GameState, playerId: string): void {
  statsOf(state).turnsPlayed++;
  playerStats(state, playerId).turns++;
}

export function noteWalk(state: GameState, playerId: string, tiles: number): void {
  if (tiles > 0) playerStats(state, playerId).tiles += tiles;
}

export function noteRoomVisit(state: GameState, playerId: string, roomId: string | undefined): void {
  if (!roomId) return;
  const ps = playerStats(state, playerId);
  if (!ps.roomsVisited.includes(roomId)) ps.roomsVisited.push(roomId);
}

export function noteSuggestion(state: GameState, byId: string, suspectId: string, weaponId: string, roomId: string): void {
  const st = statsOf(state);
  st.suggestionCount++;
  bump(st.suspects, suspectId);
  bump(st.weapons, weaponId);
  bump(st.rooms, roomId);
  const ps = playerStats(state, byId);
  ps.suggestions++;
  // per-player card tallies (a game saved before these existed gets them from here on)
  if (!ps.suggested) ps.suggested = { suspects: {}, weapons: {}, rooms: {} };
  bump(ps.suggested.suspects, suspectId);
  bump(ps.suggested.weapons, weaponId);
  bump(ps.suggested.rooms, roomId);
}

export function noteReveal(state: GameState, responderId: string): void {
  playerStats(state, responderId).reveals++;
}

export function noteAccusation(state: GameState, byId: string, correct = false): void {
  const ps = playerStats(state, byId);
  ps.accusations++;
  if (correct) ps.accusationsCorrect = (ps.accusationsCorrect ?? 0) + 1;
}

// ---- summary for the end-of-game screen -----------------------------------------------------

export interface Ranked {
  id: string;
  count: number;
}

export interface StatsRow {
  playerId: string;
  turns: number;
  tiles: number;
  rooms: number;
  suggestions: number;
  reveals: number;
  accusations: number;
  /** How often this player's character was named in a suggestion. */
  timesSuspected: number;
}

export interface StatsSummary {
  turnsPlayed: number;
  rounds: number;
  suggestionCount: number;
  /** Most-named cards in suggestions, top first. */
  topSuspects: Ranked[];
  topWeapons: Ranked[];
  topRooms: Ranked[];
  /** Player ids leading each category (ties share the honour). */
  mostTravelled: Ranked[];
  mostRoomsVisited: Ranked[];
  /** Times this player's character was named in someone's suggestion (their own included). */
  mostSuspected: Ranked[];
  mostReveals: Ranked[];
  /** …and the players at the other end of the same four numbers. */
  leastTravelled: Ranked[];
  leastRoomsVisited: Ranked[];
  leastSuspected: Ranked[];
  leastReveals: Ranked[];
  /** Every player's line for the table, in turn order. */
  rows: StatsRow[];
}

function ranked(tally: Record<string, number>, top = 3): Ranked[] {
  return Object.entries(tally)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([id, count]) => ({ id, count }));
}

/**
 * The players at one end of a per-player number; everyone tied there shares the honour.
 * 'max' skips zeros — an honour nobody actually scored isn't one — while 'min' keeps them, since
 * doing none of a thing is exactly what "least" means.
 */
function extreme(view: GameView, valueOf: (id: string) => number, dir: 'max' | 'min'): Ranked[] {
  const st = view.stats;
  if (!st) return [];
  let best: number | null = null;
  let out: Ranked[] = [];
  for (const id of view.turnOrder) {
    if (!st.players[id]) continue; // never dealt in
    const n = valueOf(id);
    if (dir === 'max' && n <= 0) continue;
    if (best === null || (dir === 'max' ? n > best : n < best)) {
      best = n;
      out = [];
    }
    if (n === best) out.push({ id, count: n });
  }
  return out;
}

export function summarizeStats(view: GameView): StatsSummary | undefined {
  const st = view.stats;
  if (!st) return undefined;
  const suspectOf = new Map(view.players.map((p) => [p.suspectId, p.id]));
  const timesSuspected: Record<string, number> = {};
  for (const [sid, n] of Object.entries(st.suspects)) {
    const pid = suspectOf.get(sid);
    if (pid) timesSuspected[pid] = n;
  }
  const of = (id: string): PlayerStats => st.players[id] ?? emptyPlayer();
  const tiles = (id: string) => of(id).tiles;
  const roomsSeen = (id: string) => of(id).roomsVisited.length;
  const reveals = (id: string) => of(id).reveals;
  const suspected = (id: string) => timesSuspected[id] ?? 0;
  return {
    turnsPlayed: st.turnsPlayed,
    rounds: view.round ?? 0,
    suggestionCount: st.suggestionCount,
    topSuspects: ranked(st.suspects),
    topWeapons: ranked(st.weapons),
    topRooms: ranked(st.rooms),
    mostTravelled: extreme(view, tiles, 'max'),
    mostRoomsVisited: extreme(view, roomsSeen, 'max'),
    mostSuspected: extreme(view, suspected, 'max'),
    mostReveals: extreme(view, reveals, 'max'),
    leastTravelled: extreme(view, tiles, 'min'),
    leastRoomsVisited: extreme(view, roomsSeen, 'min'),
    leastSuspected: extreme(view, suspected, 'min'),
    leastReveals: extreme(view, reveals, 'min'),
    rows: view.turnOrder.map((playerId) => {
      const ps = st.players[playerId] ?? emptyPlayer();
      return {
        playerId,
        turns: ps.turns,
        tiles: ps.tiles,
        rooms: ps.roomsVisited.length,
        suggestions: ps.suggestions,
        reveals: ps.reveals,
        accusations: ps.accusations,
        timesSuspected: timesSuspected[playerId] ?? 0,
      };
    }),
  };
}
