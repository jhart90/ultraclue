import type { AnyCard, SuspectCard } from '../types';
import { SUSPECTS } from './suspects';
import { WEAPONS } from './weapons';
import { ROOMS } from './rooms';

export { SUSPECTS } from './suspects';
export { WEAPONS } from './weapons';
export { ROOMS } from './rooms';
export * from './board';

/** All 120 cards in a single array. */
export const ALL_CARDS: AnyCard[] = [...SUSPECTS, ...WEAPONS, ...ROOMS];

const CARD_BY_ID: Map<string, AnyCard> = new Map(ALL_CARDS.map((c) => [c.id, c]));

export function getCard(id: string): AnyCard | undefined {
  return CARD_BY_ID.get(id);
}

/** Suspects sorted by their fixed turn order — used to seat players. */
export function suspectsByTurnOrder(): SuspectCard[] {
  return [...SUSPECTS].sort((a, b) => a.turnOrder - b.turnOrder);
}

// Sanity checks so a typo (duplicate id, miscount) fails loudly at import time rather than
// surfacing as a subtle gameplay bug later.
if (SUSPECTS.length !== 40 || WEAPONS.length !== 40 || ROOMS.length !== 40) {
  throw new Error(
    `Card count mismatch: ${SUSPECTS.length} suspects, ${WEAPONS.length} weapons, ${ROOMS.length} rooms (expected 40 each).`,
  );
}
if (CARD_BY_ID.size !== ALL_CARDS.length) {
  throw new Error('Duplicate card id detected in the card data.');
}
