import { BOARD, getCard } from '../data';
import type { Board, Coord } from '../data/board';
import { type RNG, pick } from '../rng';
import { roomIdAt } from './movement';
import { FULL_POOL, type CardPool } from './pool';

// These helpers turn a bot's deduction into a decision. A card is "ruled out" of the solution once
// the deduction (see botNotes.ts — own hand, passes, reveals, and cross-inferences) places it in
// some player's hand. When exactly one card remains in each of the three categories, that triple
// must be the envelope — so the bot accuses. Otherwise it tours still-unknown rooms and keeps
// suggesting to gather more reveals.

export interface BotSuggestion {
  suspectId: string;
  weaponId: string;
}
export interface BotAccusation {
  suspectId: string;
  weaponId: string;
  roomId: string;
}

/** The cards in play (`pool`) that might still be in the envelope. */
export function botCandidates(ruledOut: Set<string>, pool: CardPool = FULL_POOL) {
  return {
    suspects: pool.suspects.filter((c) => !ruledOut.has(c.id)),
    weapons: pool.weapons.filter((c) => !ruledOut.has(c.id)),
    rooms: pool.rooms.filter((c) => !ruledOut.has(c.id)),
  };
}

/** The solution, if the bot has narrowed every category to a single candidate. */
export function botAccusation(ruledOut: Set<string>, pool: CardPool = FULL_POOL): BotAccusation | null {
  const c = botCandidates(ruledOut, pool);
  if (c.suspects.length === 1 && c.weapons.length === 1 && c.rooms.length === 1) {
    return { suspectId: c.suspects[0].id, weaponId: c.weapons[0].id, roomId: c.rooms[0].id };
  }
  return null;
}

/**
 * Pick a suspect + weapon to suggest.
 *  - Strategic room isolation: when the bot is standing in a room it knows nothing about, and rooms
 *    are (one of) the categories it's least sure of, it suggests a suspect AND weapon from its OWN
 *    hand. Since no one else can hold those, the only card anyone could reveal is the room — so the
 *    bot is guaranteed to learn whether this room is part of the solution this turn.
 *  - Otherwise it probes for maximum information: a suspect and weapon it hasn't ruled out.
 */
export function botSuggestion(
  ruledOut: Set<string>,
  hand: string[],
  roomId: string | undefined,
  rng: RNG,
  pool: CardPool = FULL_POOL,
): BotSuggestion {
  const c = botCandidates(ruledOut, pool);
  const heldSuspects = hand.filter((id) => getCard(id)?.type === 'suspect');
  const heldWeapons = hand.filter((id) => getCard(id)?.type === 'weapon');
  const roomUnknown = !!roomId && !ruledOut.has(roomId);

  if (
    roomUnknown &&
    heldSuspects.length > 0 &&
    heldWeapons.length > 0 &&
    c.rooms.length >= c.suspects.length &&
    c.rooms.length >= c.weapons.length
  ) {
    return { suspectId: pick(heldSuspects, rng), weaponId: pick(heldWeapons, rng) };
  }

  const suspect = pick(c.suspects.length ? c.suspects : pool.suspects, rng);
  const weapon = pick(c.weapons.length ? c.weapons : pool.weapons, rng);
  return { suspectId: suspect.id, weaponId: weapon.id };
}

/**
 * Choose which matching card a bot reveals to a suggester when it holds more than one.
 *  - Re-show a card the suggester has already seen from us if we can (it learns nothing new).
 *  - Otherwise reveal whichever card the most *other* players have already seen, so we leak our hand
 *    to as few new people as possible.
 */
export function botRevealCard(
  matches: string[],
  shownToSuggester: Set<string>,
  exposure: Map<string, number>,
  rng: RNG,
): string {
  if (matches.length <= 1) return matches[0];
  const repeats = matches.filter((c) => shownToSuggester.has(c));
  if (repeats.length) return pick(repeats, rng);
  const best = Math.max(...matches.map((c) => exposure.get(c) ?? 0));
  const mostExposed = matches.filter((c) => (exposure.get(c) ?? 0) === best);
  return pick(mostExposed, rng);
}

/** Pick one of these room tiles, weighting every room equally: first a room among those the tiles
 *  belong to, then a tile inside it. Picking a tile uniformly would let a big room next to a small
 *  one (the Ballroom beside the Lounge) soak up nearly every visit, since it shows far more tiles
 *  within one roll of its doors. `tiles` must all lie in rooms. */
export function pickRoomTile(tiles: readonly Coord[], rng: RNG, board: Board = BOARD): Coord {
  const byRoom = new Map<string, Coord[]>();
  for (const t of tiles) {
    const r = roomIdAt(board, t);
    if (!r) continue;
    const list = byRoom.get(r);
    if (list) list.push(t);
    else byRoom.set(r, [t]);
  }
  if (!byRoom.size) return pick(tiles, rng);
  return pick(pick([...byRoom.values()], rng), rng);
}

/** Choose a destination: prefer entering a room (to suggest), favouring still-unknown rooms. */
export function botMoveTarget(reachable: Coord[], ruledOut: Set<string>, rng: RNG, board: Board = BOARD): Coord | null {
  if (!reachable.length) return null;
  const roomTiles = reachable.filter((t) => roomIdAt(board, t));
  if (roomTiles.length) {
    const candidate = roomTiles.filter((t) => !ruledOut.has(roomIdAt(board, t)!));
    return pickRoomTile(candidate.length ? candidate : roomTiles, rng, board);
  }
  return pick(reachable, rng);
}

/** Whether an in-room bot should stay and suggest (room still unknown and not yet tested). */
export function botShouldStay(
  currentRoomId: string | undefined,
  ruledOut: Set<string>,
  visited: Set<string>,
): boolean {
  return !!currentRoomId && !ruledOut.has(currentRoomId) && !visited.has(currentRoomId);
}
