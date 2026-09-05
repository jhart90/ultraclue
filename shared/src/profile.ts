import type { GameView } from './game';

// ---------------------------------------------------------------------------------------------
// Player profiles: long-term statistics for one human, identified by their name plus an optional
// 4-character PIN (letters or digits), NBA Jam style. The PIN is never shown to anyone: the
// server turns name + PIN into an opaque profile id and only that id (never the PIN) is stored.
// Two people who both play as "Jack" are told apart by their PINs; the profile's public `tag`
// (three characters derived from the id) is what the leaderboards show when names collide.
// ---------------------------------------------------------------------------------------------

/** A PIN is exactly four letters or digits. Case doesn't matter. */
export const PIN_RE = /^[A-Za-z0-9]{4}$/;
export const PIN_LENGTH = 4;
/** How many recent games a profile remembers. */
export const PROFILE_RECENT = 5;

/** Normalise a PIN as typed: letters upper-cased; anything that isn't a valid PIN becomes ''. */
export function cleanPin(pin: unknown): string {
  const s = typeof pin === 'string' ? pin.trim().toUpperCase() : '';
  return PIN_RE.test(s) ? s : '';
}

/** The name as it is matched for a profile: trimmed, single-spaced, case-folded. */
export function normalizeName(name: unknown): string {
  return (typeof name === 'string' ? name : '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The profile id for a name used WITHOUT a PIN: plain and deterministic, so the same name always
 *  lands on the same shared profile (and so legacy by-name tallies map onto it). PIN-protected
 *  profiles get salted ids minted by the server instead. */
export function pinlessProfileId(name: string): string {
  return `n:${normalizeName(name)}`;
}

/** One game a profile took part in. */
export interface ProfileGame {
  id: string;
  startedAt?: number;
  endedAt: number;
  /** Played at the public table (as opposed to a private room). */
  isPublic: boolean;
  suspectId: string;
  result: 'won' | 'eliminated' | 'lost';
  /** The game ended with a correct accusation (by whoever won). */
  solved: boolean;
  winnerName: string;
  players: number;
  humans: number;
  turns: number;
  tiles: number;
  suggestions: number;
  accusations: number;
  accusationsCorrect: number;
}

/** Everything the game remembers about one player, across every game they finished. */
export interface PlayerProfile {
  id: string;
  /** The name as most recently typed (matching is case-insensitive). */
  name: string;
  /** Short public mark shown beside the name when two profiles share it. '' for PIN-less profiles. */
  tag: string;
  hasPin: boolean;
  createdAt: number;
  lastPlayedAt?: number;
  games: number;
  wins: number;
  /** Wins by a correct accusation (the rest were "last detective standing"). */
  solves: number;
  eliminations: number;
  tiles: number;
  suggestions: number;
  accusations: number;
  accusationsCorrect: number;
  /** Games per character (suspect card id). */
  characters: Record<string, number>;
  /** Cards named in this player's own suggestions. */
  suspectedSuspects: Record<string, number>;
  suspectedWeapons: Record<string, number>;
  suspectedRooms: Record<string, number>;
  /** Newest first, capped at PROFILE_RECENT. */
  recent: ProfileGame[];
}

export function emptyProfile(id: string, name: string, tag: string, hasPin: boolean, now = Date.now()): PlayerProfile {
  return {
    id,
    name,
    tag,
    hasPin,
    createdAt: now,
    games: 0,
    wins: 0,
    solves: 0,
    eliminations: 0,
    tiles: 0,
    suggestions: 0,
    accusations: 0,
    accusationsCorrect: 0,
    characters: {},
    suspectedSuspects: {},
    suspectedWeapons: {},
    suspectedRooms: {},
    recent: [],
  };
}

const bump = (tally: Record<string, number>, key: string | undefined, by = 1) => {
  if (!key || !by) return;
  tally[key] = (tally[key] ?? 0) + by;
};

/** Fold one finished game (as seen by `playerId`'s seat) into a profile. Mutates `profile` and
 *  returns the game's entry, or undefined if the player wasn't dealt into the game. */
export function foldProfileGame(
  profile: PlayerProfile,
  view: GameView,
  playerId: string,
  meta: { id: string; isPublic: boolean },
  now = Date.now(),
): ProfileGame | undefined {
  const me = view.players.find((p) => p.id === playerId);
  if (!me) return undefined;
  if (profile.recent.some((g) => g.id === meta.id)) return undefined; // already counted
  const st = view.stats;
  const ps = st?.players[playerId];
  const winner = view.players.find((p) => p.id === view.winnerId);
  const a = view.announcement;
  const solved = !!(a && a.kind === 'accusation' && a.correct && a.byId === view.winnerId);
  const won = view.winnerId === playerId;
  const game: ProfileGame = {
    id: meta.id,
    startedAt: st?.startedAt,
    endedAt: st?.endedAt ?? now,
    isPublic: meta.isPublic,
    suspectId: me.suspectId,
    result: won ? 'won' : me.eliminated ? 'eliminated' : 'lost',
    solved,
    winnerName: winner?.name ?? 'Nobody',
    players: view.players.length,
    humans: view.players.filter((p) => !p.isBot).length,
    turns: ps?.turns ?? 0,
    tiles: ps?.tiles ?? 0,
    suggestions: ps?.suggestions ?? 0,
    accusations: ps?.accusations ?? 0,
    accusationsCorrect: ps?.accusationsCorrect ?? (won && solved ? 1 : 0),
  };
  profile.games++;
  if (won) profile.wins++;
  if (won && solved) profile.solves++;
  if (game.result === 'eliminated') profile.eliminations++;
  profile.tiles += game.tiles;
  profile.suggestions += game.suggestions;
  profile.accusations += game.accusations;
  profile.accusationsCorrect += game.accusationsCorrect;
  bump(profile.characters, me.suspectId);
  for (const [id, n] of Object.entries(ps?.suggested?.suspects ?? {})) bump(profile.suspectedSuspects, id, n);
  for (const [id, n] of Object.entries(ps?.suggested?.weapons ?? {})) bump(profile.suspectedWeapons, id, n);
  for (const [id, n] of Object.entries(ps?.suggested?.rooms ?? {})) bump(profile.suspectedRooms, id, n);
  profile.lastPlayedAt = game.endedAt;
  profile.recent.unshift(game);
  if (profile.recent.length > PROFILE_RECENT) profile.recent.length = PROFILE_RECENT;
  return game;
}

/** Name plus tag, for lists where the same name may appear more than once. */
export function profileLabel(name: string, tag: string, showTag: boolean): string {
  return showTag && tag ? `${name} #${tag}` : name;
}
