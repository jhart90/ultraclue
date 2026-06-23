import { SUSPECTS, WEAPONS, ROOMS, BOARD } from '../data';
import type { Coord } from '../data/board';
import { type RNG, pick } from '../rng';
import { roomIdAt } from './movement';

// Bot deduction is intentionally simple but sound: a card is "ruled out" of the solution if the
// bot holds it or has seen it revealed. When exactly one card remains in each of the three
// categories, that triple must be the envelope — so the bot accuses. Otherwise it tours rooms
// and keeps suggesting to gather more reveals.

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

/** Pick a suspect + weapon to suggest, preferring cards the bot hasn't ruled out (max info). */
export function botSuggestion(ruledOut: Set<string>, rng: RNG): BotSuggestion {
  const c = botCandidates(ruledOut);
  const suspect = pick(c.suspects.length ? c.suspects : SUSPECTS, rng);
  const weapon = pick(c.weapons.length ? c.weapons : WEAPONS, rng);
  return { suspectId: suspect.id, weaponId: weapon.id };
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
