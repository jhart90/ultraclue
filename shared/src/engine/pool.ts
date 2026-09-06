import { SUSPECTS, WEAPONS, ROOMS, boardFor, type Board } from '../data';
import type { GameState } from '../game';
import type { RoomCard, SuspectCard, WeaponCard } from '../types';
import { type RNG, shuffle } from '../rng';

// The cards actually in a game. The host can switch wings of the house off (their rooms leave the
// board and the deck) and play with fewer than all 40 weapons, so the engine and the bots must ask
// the game which suspects, weapons and rooms exist rather than reading the full card lists.

export interface CardPool {
  suspects: SuspectCard[];
  weapons: WeaponCard[];
  rooms: RoomCard[];
}

/** Every card: the pool of a game played with the whole house and all 40 weapons. */
export const FULL_POOL: CardPool = { suspects: SUSPECTS, weapons: WEAPONS, rooms: ROOMS };

/** How few weapons a host may play with. Fewer than this and the weapon is barely a mystery. */
export const MIN_WEAPONS = 6;
export const MAX_WEAPONS = WEAPONS.length;
export const DEFAULT_WEAPONS = WEAPONS.length;

export function clampWeaponCount(n: number | undefined): number {
  if (n == null || !Number.isFinite(n)) return DEFAULT_WEAPONS;
  return Math.max(MIN_WEAPONS, Math.min(MAX_WEAPONS, Math.round(n)));
}

type PoolState = Pick<GameState, 'wingsOff' | 'weaponIds'>;

/** The board this game is played on: the whole house, or the house minus the wings switched off. */
export function boardOf(state: PoolState | undefined): Board {
  return boardFor(state?.wingsOff ?? []);
}

/** The room cards in play on this board, in the canonical card order. */
export function roomsInPlay(board: Board): RoomCard[] {
  return ROOMS.filter((r) => !!board.rooms[r.id]);
}

/** The weapon cards in this game's deck, in the canonical card order. */
export function weaponsInPlay(state: PoolState | undefined): WeaponCard[] {
  const ids = state?.weaponIds;
  if (!ids) return WEAPONS;
  const set = new Set(ids);
  return WEAPONS.filter((w) => set.has(w.id));
}

/** The suspects, weapons and rooms in this game. */
export function poolOf(state: PoolState | undefined): CardPool {
  if (!state || (!state.wingsOff?.length && !state.weaponIds)) return FULL_POOL;
  return { suspects: SUSPECTS, weapons: weaponsInPlay(state), rooms: roomsInPlay(boardOf(state)) };
}

/** Every card id in the pool, suspects then weapons then rooms. */
export function poolIds(pool: CardPool): string[] {
  return [...pool.suspects, ...pool.weapons, ...pool.rooms].map((c) => c.id);
}

/** Whether a card is in this game at all (a suggestion or accusation may only name cards in play). */
export function inPool(pool: CardPool, cardId: string): boolean {
  return pool.suspects.some((c) => c.id === cardId) || pool.weapons.some((c) => c.id === cardId) || pool.rooms.some((c) => c.id === cardId);
}

/**
 * Pick which weapons are in a game. Every room on the board starts with one weapon token in it, so
 * the weapons tied to rooms still in play come first (a random `count` of them if there are more
 * than that); any places left are filled at random from the rest. Returned in canonical card order.
 */
export function chooseWeapons(board: Board, count: number | undefined, rng: RNG): string[] {
  const n = clampWeaponCount(count);
  if (n >= MAX_WEAPONS) return WEAPONS.map((w) => w.id); // the full set: nothing to draw (and no dice spent)
  const roomWeapons = new Set(Object.values(board.rooms).map((r) => r.weaponId));
  const preferred = shuffle(WEAPONS.filter((w) => roomWeapons.has(w.id)).map((w) => w.id), rng);
  const rest = shuffle(WEAPONS.filter((w) => !roomWeapons.has(w.id)).map((w) => w.id), rng);
  const chosen = new Set([...preferred, ...rest].slice(0, n));
  return WEAPONS.filter((w) => chosen.has(w.id)).map((w) => w.id);
}
