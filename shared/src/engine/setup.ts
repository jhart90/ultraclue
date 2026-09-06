import { SUSPECTS, getCard, wingsKey } from '../data';
import type { Envelope, GameState, Player } from '../game';
import { type RNG, shuffle, pick } from '../rng';
import { log } from './util';
import { beginTurn, startTileOf } from './turn';
import { newStats, syncParticipants } from './stats';
import { FULL_POOL, boardOf, chooseWeapons, poolIds, poolOf, type CardPool } from './pool';

/** The host's choices for how much of the house, and how many weapons, a game is played with. */
export interface GameOptions {
  /** Wings switched off (board section ids). */
  wingsOff?: string[];
  /** Weapons in the deck (MIN_WEAPONS..40). */
  weaponCount?: number;
}

/** Pick the hidden solution: one random suspect, weapon, and room from the cards in play. */
export function buildEnvelope(rng: RNG, pool: CardPool = FULL_POOL): Envelope {
  return {
    suspectId: pick(pool.suspects, rng).id,
    weaponId: pick(pool.weapons, rng).id,
    roomId: pick(pool.rooms, rng).id,
  };
}

/** Shuffle the non-solution cards in play and deal them as evenly as possible, round-robin. */
export function dealHands(players: Player[], envelope: Envelope, rng: RNG, pool: CardPool = FULL_POOL): void {
  const inEnvelope = new Set([envelope.suspectId, envelope.weaponId, envelope.roomId]);
  const deck = shuffle(
    poolIds(pool).filter((id) => !inEnvelope.has(id)),
    rng,
  );
  players.forEach((p) => (p.hand = []));
  deck.forEach((cardId, i) => players[i % players.length].hand.push(cardId));
}

/** Sort players into seats by their suspect's fixed turn order (Miss Scarlet first). */
function turnOrderOf(players: Player[]): string[] {
  const rank = new Map(SUSPECTS.map((s) => [s.id, s.turnOrder]));
  return [...players]
    .sort((a, b) => (rank.get(a.suspectId) ?? 999) - (rank.get(b.suspectId) ?? 999))
    .map((p) => p.id);
}

/**
 * Create the initial in-play GameState from the lobby roster: settle which wings and weapons are
 * in play, pick the envelope, deal hands, seat players in turn order and place their pieces.
 */
export function startGame(code: string, lobbyPlayers: Player[], rng: RNG, options: GameOptions = {}): GameState {
  if (lobbyPlayers.length < 2) throw new Error('Need at least 2 players to start.');

  const wingsOff = wingsKey(options.wingsOff ?? []) ? wingsKey(options.wingsOff ?? []).split('+') : undefined;
  const board = boardOf({ wingsOff });
  // Weapons: every one of the 40 unless the host asked for fewer, in which case the ones tied to
  // rooms still on the board come first (the deck is stored only when it is not the full set).
  const weaponIds = chooseWeapons(board, options.weaponCount, rng);
  const trimmedDeck = weaponIds.length < FULL_POOL.weapons.length ? weaponIds : undefined;
  const pool = poolOf({ wingsOff, weaponIds: trimmedDeck });

  const players: Player[] = lobbyPlayers.map((p) => ({
    ...p,
    hand: [],
    eliminated: false,
    position: startTileOf(p.suspectId, board),
    inRoomId: undefined,
  }));
  const envelope = buildEnvelope(rng, pool);
  dealHands(players, envelope, rng, pool);

  // Each room starts with the weapon token the board ties to it, if that weapon is in the game;
  // any weapon in the game whose room is not on the board is set down in a random room instead.
  const weaponLocations: Record<string, string> = {};
  const inGame = new Set(weaponIds);
  const roomIds = Object.keys(board.rooms);
  for (const room of Object.values(board.rooms)) if (inGame.has(room.weaponId)) weaponLocations[room.weaponId] = room.id;
  for (const wid of weaponIds) if (!weaponLocations[wid]) weaponLocations[wid] = pick(roomIds, rng);

  const state: GameState = {
    code,
    phase: 'play',
    players,
    turnOrder: turnOrderOf(players),
    activeIdx: 0,
    round: 0,
    ...(wingsOff ? { wingsOff } : {}),
    ...(trimmedDeck ? { weaponIds: trimmedDeck } : {}),
    envelope,
    log: [],
    nextLogId: 1,
    weaponLocations,
    turnPhase: 'awaitRoll',
    stats: newStats(players.map((p) => p.id)),
  };
  syncParticipants(
    state,
    players.map((p) => ({ name: p.name, kind: p.isBot ? ('computer' as const) : ('human' as const), suspectId: p.suspectId })),
    state.stats!.startedAt,
  );

  log(state, 'The CLASSIFIED envelope is sealed. The cards are dealt. The investigation begins.');
  const first = players.find((p) => p.id === state.turnOrder[0])!;
  log(state, `${first.name} (${getCard(first.suspectId)?.title}) goes first.`);
  beginTurn(state, rng); // first player auto-rolls (they start in the open)
  return state;
}
