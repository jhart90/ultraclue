import type { GameState, GameStats, GameView, Participant, PlayerStats } from '../game';

const emptyPlayer = (): PlayerStats => ({ turns: 0, tiles: 0, roomsVisited: [], suggestions: 0, reveals: 0, accusations: 0 });

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
  playerStats(state, byId).suggestions++;
}

export function noteReveal(state: GameState, responderId: string): void {
  playerStats(state, responderId).reveals++;
}

export function noteAccusation(state: GameState, byId: string): void {
  playerStats(state, byId).accusations++;
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
  mostSuggestions: Ranked[];
  mostReveals: Ranked[];
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

/** Leaders of a per-player number; everyone tied at the top is included. */
function leaders(view: GameView, pick: (ps: PlayerStats) => number): Ranked[] {
  const st = view.stats;
  if (!st) return [];
  let best = 0;
  let out: Ranked[] = [];
  for (const id of view.turnOrder) {
    const ps = st.players[id];
    if (!ps) continue;
    const n = pick(ps);
    if (n <= 0) continue;
    if (n > best) {
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
  return {
    turnsPlayed: st.turnsPlayed,
    rounds: view.round ?? 0,
    suggestionCount: st.suggestionCount,
    topSuspects: ranked(st.suspects),
    topWeapons: ranked(st.weapons),
    topRooms: ranked(st.rooms),
    mostTravelled: leaders(view, (ps) => ps.tiles),
    mostRoomsVisited: leaders(view, (ps) => ps.roomsVisited.length),
    mostSuggestions: leaders(view, (ps) => ps.suggestions),
    mostReveals: leaders(view, (ps) => ps.reveals),
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
