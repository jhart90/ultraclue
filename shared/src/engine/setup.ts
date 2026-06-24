import { ALL_CARDS, SUSPECTS, WEAPONS, ROOMS, getCard, BOARD } from '../data';
import type { Envelope, GameState, Player } from '../game';
import { type RNG, shuffle, pick } from '../rng';
import { log } from './util';
import { beginTurn, startTileOf } from './turn';

/** Pick the hidden solution: one random suspect, weapon, and room. */
export function buildEnvelope(rng: RNG): Envelope {
  return {
    suspectId: pick(SUSPECTS, rng).id,
    weaponId: pick(WEAPONS, rng).id,
    roomId: pick(ROOMS, rng).id,
  };
}

/** Shuffle the 117 non-solution cards and deal them as evenly as possible, round-robin. */
export function dealHands(players: Player[], envelope: Envelope, rng: RNG): void {
  const inEnvelope = new Set([envelope.suspectId, envelope.weaponId, envelope.roomId]);
  const deck = shuffle(
    ALL_CARDS.filter((c) => !inEnvelope.has(c.id)).map((c) => c.id),
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
 * Create the initial in-play GameState from the lobby roster: pick the envelope, deal hands,
 * seat players in turn order. (Board placement is added in M5.)
 */
export function startGame(code: string, lobbyPlayers: Player[], rng: RNG): GameState {
  if (lobbyPlayers.length < 2) throw new Error('Need at least 2 players to start.');

  const players: Player[] = lobbyPlayers.map((p) => ({
    ...p,
    hand: [],
    eliminated: false,
    position: startTileOf(p.suspectId),
    inRoomId: undefined,
  }));
  const envelope = buildEnvelope(rng);
  dealHands(players, envelope, rng);

  // Each room starts with one weapon token (board data assigns weaponId -> room).
  const weaponLocations: Record<string, string> = {};
  for (const room of Object.values(BOARD.rooms)) weaponLocations[room.weaponId] = room.id;

  const state: GameState = {
    code,
    phase: 'play',
    players,
    turnOrder: turnOrderOf(players),
    activeIdx: 0,
    round: 0,
    envelope,
    log: [],
    nextLogId: 1,
    weaponLocations,
    turnPhase: 'awaitRoll',
  };

  log(state, 'The CLASSIFIED envelope is sealed. The cards are dealt. The investigation begins.');
  const first = players.find((p) => p.id === state.turnOrder[0])!;
  log(state, `${first.name} (${getCard(first.suspectId)?.title}) goes first.`);
  beginTurn(state, rng); // first player auto-rolls (they start in the open)
  return state;
}
