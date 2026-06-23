import { getCard, BOARD } from '../data';
import type { RNG } from '../rng';
import type { GameState, Suggestion } from '../game';
import { clone, currentPlayerId, log, requirePlayer } from './util';
import { concludeTurn } from './turn';

function trioSet(s: Pick<Suggestion, 'suspectId' | 'weaponId' | 'roomId'>): Set<string> {
  return new Set([s.suspectId, s.weaponId, s.roomId]);
}

/** Cards in this player's hand that match the suggestion's suspect/weapon/room. */
export function matchingCards(state: GameState, playerId: string, suggestion: Suggestion): string[] {
  const trio = trioSet(suggestion);
  return requirePlayer(state, playerId).hand.filter((c) => trio.has(c));
}

/**
 * Begin a suggestion. The suspect + weapon are "summoned" to the suggester's room (board move
 * handled by the caller in M6). Builds the clockwise query queue and auto-advances past players
 * who hold no matching card, stopping at the first who must reveal (pendingResponderId) or
 * resolving with no reveal.
 */
export function makeSuggestion(
  state: GameState,
  suggesterId: string,
  suspectId: string,
  weaponId: string,
  roomId: string,
  rng: RNG,
): GameState {
  const s = clone(state);
  if (s.phase !== 'play') throw new Error('Not in play.');
  if (currentPlayerId(s) !== suggesterId) throw new Error('Not your turn.');
  if (s.currentSuggestion && !s.currentSuggestion.resolved)
    throw new Error('A suggestion is already in progress.');

  // Summon the named suspect's piece (if a player holds it) and the weapon token into the room.
  if (s.weaponLocations) s.weaponLocations[weaponId] = roomId;
  const summoned = s.players.find((p) => p.suspectId === suspectId);
  if (summoned && BOARD.rooms[roomId]) {
    const tile = BOARD.rooms[roomId].tiles[0];
    summoned.position = { x: tile.x, y: tile.y };
    summoned.inRoomId = roomId;
  }

  const order = s.turnOrder;
  const start = order.indexOf(suggesterId);
  const queue: string[] = [];
  for (let k = 1; k < order.length; k++) {
    const pid = order[(start + k) % order.length];
    if (pid === suggesterId) break;
    if (!requirePlayer(s, pid).eliminated) queue.push(pid);
  }

  s.currentSuggestion = {
    suggesterId,
    suspectId,
    weaponId,
    roomId,
    queue,
    passes: [],
    anyRevealed: false,
    resolved: false,
  };

  const name = requirePlayer(s, suggesterId).name;
  s.announcement = {
    seq: (s.announcement?.seq ?? 0) + 1,
    kind: 'suggestion',
    byId: suggesterId,
    byName: name,
    suspectId,
    weaponId,
    roomId,
  };
  log(
    s,
    `${name} suggests ${getCard(suspectId)?.title} with the ${getCard(weaponId)?.title} in the ${getCard(roomId)?.title}.`,
  );
  return progressSuggestion(s, rng);
}

/**
 * Walk the query queue: players with no matching card pass automatically; stop at the first
 * player who holds a match (awaiting their reveal choice). If the queue empties with no match,
 * the suggestion resolves disproven-by-no-one and the turn ends.
 */
export function progressSuggestion(state: GameState, rng: RNG): GameState {
  const s = clone(state);
  const sg = s.currentSuggestion;
  if (!sg || sg.resolved) return s;

  while (sg.queue.length > 0) {
    const pid = sg.queue[0];
    const player = requirePlayer(s, pid);
    if (matchingCards(s, pid, sg).length === 0) {
      sg.passes.push(pid);
      sg.queue.shift();
      log(s, `${player.name} cannot disprove it.`);
    } else {
      sg.pendingResponderId = pid;
      return s;
    }
  }

  sg.resolved = true;
  sg.anyRevealed = false;
  log(s, 'No one could disprove the suggestion.');
  concludeTurn(s, rng);
  return s;
}

/** The pending player reveals one matching card to the suggester; the turn then ends immediately. */
export function respondToSuggestion(
  state: GameState,
  responderId: string,
  cardId: string,
  rng: RNG,
): GameState {
  const s = clone(state);
  const sg = s.currentSuggestion;
  if (!sg || sg.resolved) throw new Error('No suggestion awaiting a response.');
  if (sg.pendingResponderId !== responderId) throw new Error('Not your card to reveal.');
  if (!matchingCards(s, responderId, sg).includes(cardId))
    throw new Error('That card does not match the suggestion.');

  sg.responderId = responderId;
  sg.revealedCardId = cardId;
  sg.anyRevealed = true;
  sg.resolved = true;
  sg.pendingResponderId = undefined;

  const responder = requirePlayer(s, responderId).name;
  const suggester = requirePlayer(s, sg.suggesterId).name;
  log(s, `${responder} reveals a card to ${suggester}.`);
  concludeTurn(s, rng);
  return s;
}

/** Default card choice for bots / auto-reveal: just the first matching card. */
export function autoRevealCard(state: GameState, responderId: string): string {
  const sg = state.currentSuggestion;
  if (!sg) throw new Error('No suggestion in progress.');
  const matches = matchingCards(state, responderId, sg);
  if (matches.length === 0) throw new Error('Responder has no matching card.');
  return matches[0];
}
