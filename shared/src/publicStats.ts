import type { Envelope, GameView } from './game';

// ---------------------------------------------------------------------------------------------
// Public-table history: a rolling archive of the last PUBLIC_STATS_RECENT games (each one enough to
// re-open its end-of-game details screen) plus all-time aggregates folded in as games finish.
// The server persists this; the client renders it on the "Statistics" screen.
// ---------------------------------------------------------------------------------------------

export const PUBLIC_STATS_RECENT = 50;

export interface PublicGameSummary {
  id: string;
  startedAt?: number;
  endedAt: number;
  winnerId?: string;
  winnerName: string;
  winnerSuspectId?: string;
  winnerIsBot: boolean;
  /** Won by a correct accusation (as opposed to being the last detective standing). */
  solved: boolean;
  /** Distinct humans who played, computer seats that played, and people who watched. */
  humans: number;
  computers: number;
  observers: number;
  turns: number;
  rounds: number;
  tiles: number;
  suggestions: number;
  envelope?: Envelope;
}

/** One finished public game, with the frozen view its details screen is drawn from. */
export interface ArchivedPublicGame extends PublicGameSummary {
  view: GameView;
}

export interface PublicStats {
  totalGames: number;
  solvedGames: number;
  totalTiles: number;
  totalTurns: number;
  /** Turns played in games that ended with a correct accusation (for "turns per solve"). */
  turnsInSolvedGames: number;
  totalSuggestions: number;
  /** Wins by human players, keyed by name. */
  humanWins: Record<string, number>;
  /** Wins by character (suspect card id), human or computer. */
  characterWins: Record<string, number>;
  /** How often each suspect / weapon / room was in the envelope. */
  murderers: Record<string, number>;
  weapons: Record<string, number>;
  rooms: Record<string, number>;
  /** Per character (suspect card id), summed over every public game they were dealt into. */
  characterGames: Record<string, number>;
  characterTiles: Record<string, number>;
  /** Times the character was named as the suspect in a suggestion (they need not have been in play). */
  characterSuspected: Record<string, number>;
  /** Times each weapon / room card was named in a suggestion, across every public game. */
  weaponsSuggested: Record<string, number>;
  roomsSuggested: Record<string, number>;
  characterAccusations: Record<string, number>;
  characterCorrect: Record<string, number>;
  /** Newest first, capped at PUBLIC_STATS_RECENT. */
  recent: ArchivedPublicGame[];
}

export function emptyPublicStats(): PublicStats {
  return {
    totalGames: 0,
    solvedGames: 0,
    totalTiles: 0,
    totalTurns: 0,
    turnsInSolvedGames: 0,
    totalSuggestions: 0,
    humanWins: {},
    characterWins: {},
    murderers: {},
    weapons: {},
    rooms: {},
    characterGames: {},
    characterTiles: {},
    characterSuspected: {},
    weaponsSuggested: {},
    roomsSuggested: {},
    characterAccusations: {},
    characterCorrect: {},
    recent: [],
  };
}

/** Strip a finished game's view down to what the details screen needs (no hands, no log, no
 *  per-viewer fields), so the archive stays small and leaks nothing. */
export function archiveView(view: GameView): GameView {
  return {
    ...view,
    yourId: '',
    yourHand: [],
    log: [],
    reachable: undefined,
    elevatorFloors: undefined,
    currentSuggestion: undefined,
    turnDeadline: undefined,
    resetsAt: undefined,
    serverNow: undefined,
    accusingId: undefined,
    observer: true,
  };
}

/** Summarise a finished game for its history tile. */
export function summarizePublicGame(view: GameView, id: string): PublicGameSummary {
  const st = view.stats;
  const winner = view.players.find((p) => p.id === view.winnerId);
  const names = (kind: 'human' | 'computer' | 'observer') => new Set((st?.participants ?? []).filter((p) => p.kind === kind).map((p) => p.name)).size;
  const a = view.announcement;
  const solved = !!(a && a.kind === 'accusation' && a.correct && a.byId === view.winnerId);
  const tiles = Object.values(st?.players ?? {}).reduce((n, p) => n + p.tiles, 0);
  return {
    id,
    startedAt: st?.startedAt,
    endedAt: st?.endedAt ?? Date.now(),
    winnerId: view.winnerId,
    winnerName: winner?.name ?? 'Nobody',
    winnerSuspectId: winner?.suspectId,
    winnerIsBot: winner?.isBot ?? false,
    solved,
    humans: names('human') || view.players.filter((p) => !p.isBot).length,
    computers: names('computer') || view.players.filter((p) => p.isBot).length,
    observers: names('observer'),
    turns: st?.turnsPlayed ?? 0,
    rounds: view.round ?? 0,
    tiles,
    suggestions: st?.suggestionCount ?? 0,
    envelope: view.envelope,
  };
}

const bump = (tally: Record<string, number>, key: string | undefined, by = 1) => {
  if (!key || !by) return;
  tally[key] = (tally[key] ?? 0) + by;
};

/** Fold one finished game into the all-time totals and the rolling archive. Mutates `stats`. */
export function foldPublicGame(stats: PublicStats, view: GameView, id: string): ArchivedPublicGame {
  const summary = summarizePublicGame(view, id);
  stats.totalGames++;
  if (summary.solved) {
    stats.solvedGames++;
    stats.turnsInSolvedGames += summary.turns;
  }
  stats.totalTiles += summary.tiles;
  stats.totalTurns += summary.turns;
  stats.totalSuggestions += summary.suggestions;
  if (summary.winnerId && !summary.winnerIsBot) bump(stats.humanWins, summary.winnerName);
  bump(stats.characterWins, summary.winnerSuspectId);
  bump(stats.murderers, summary.envelope?.suspectId);
  bump(stats.weapons, summary.envelope?.weaponId);
  bump(stats.rooms, summary.envelope?.roomId);
  // per-character tallies
  for (const p of view.players) {
    const ps = view.stats?.players[p.id];
    bump(stats.characterGames, p.suspectId);
    bump(stats.characterTiles, p.suspectId, ps?.tiles ?? 0);
    bump(stats.characterAccusations, p.suspectId, ps?.accusations ?? 0);
  }
  for (const [sid, n] of Object.entries(view.stats?.suspects ?? {})) bump(stats.characterSuspected, sid, n);
  for (const [wid, n] of Object.entries(view.stats?.weapons ?? {})) bump(stats.weaponsSuggested, wid, n);
  for (const [rid, n] of Object.entries(view.stats?.rooms ?? {})) bump(stats.roomsSuggested, rid, n);
  if (summary.solved) bump(stats.characterCorrect, summary.winnerSuspectId);
  const archived: ArchivedPublicGame = { ...summary, view: archiveView(view) };
  stats.recent.unshift(archived);
  if (stats.recent.length > PUBLIC_STATS_RECENT) stats.recent.length = PUBLIC_STATS_RECENT;
  return archived;
}

/** Fill in tallies that a stats file saved by an older build never recorded, from whatever the
 *  rolling archive still holds. Only touches tallies that are entirely absent, so a file that has
 *  them (even at zero for some cards) is left alone. Returns true if anything was rebuilt. */
export function backfillPublicStats(stats: PublicStats, raw: Partial<PublicStats>): boolean {
  let changed = false;
  const rebuild = (key: 'weaponsSuggested' | 'roomsSuggested', pick: (g: ArchivedPublicGame) => Record<string, number> | undefined) => {
    if (raw[key]) return;
    const tally: Record<string, number> = {};
    for (const g of stats.recent) for (const [id, n] of Object.entries(pick(g) ?? {})) bump(tally, id, n);
    stats[key] = tally;
    changed = true;
  };
  rebuild('weaponsSuggested', (g) => g.view.stats?.weapons);
  rebuild('roomsSuggested', (g) => g.view.stats?.rooms);
  return changed;
}
