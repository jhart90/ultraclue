import { SUSPECTS, WEAPONS, ROOMS, BOARD, getCard } from '../data';
import type { Coord } from '../data/board';
import { type RNG, pick } from '../rng';
import { roomIdAt } from './movement';

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

export function botCandidates(ruledOut: Set<string>) {
  return {
    suspects: SUSPECTS.filter((c) => !ruledOut.has(c.id)),
    weapons: WEAPONS.filter((c) => !ruledOut.has(c.id)),
    rooms: ROOMS.filter((c) => !ruledOut.has(c.id)),
  };
}

/** The solution, if the bot has narrowed every category to a single candidate. */
export function botAccusation(ruledOut: Set<string>): BotAccusation | null {
  const c = botCandidates(ruledOut);
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
): BotSuggestion {
  const c = botCandidates(ruledOut);
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

  const suspect = pick(c.suspects.length ? c.suspects : SUSPECTS, rng);
  const weapon = pick(c.weapons.length ? c.weapons : WEAPONS, rng);
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

/** Choose a destination: prefer entering a room (to suggest), favouring still-unknown rooms. */
export function botMoveTarget(reachable: Coord[], ruledOut: Set<string>, rng: RNG): Coord | null {
  if (!reachable.length) return null;
  const roomTiles = reachable.filter((t) => roomIdAt(BOARD, t));
  if (roomTiles.length) {
    const candidate = roomTiles.filter((t) => !ruledOut.has(roomIdAt(BOARD, t)!));
    return pick(candidate.length ? candidate : roomTiles, rng);
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
