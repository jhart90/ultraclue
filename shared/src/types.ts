// Core domain types for Ultra Clue. These are shared verbatim by the client, the server, and
// the rules engine so there is a single source of truth for what a card / player / game is.

export type CardType = 'suspect' | 'weapon' | 'room';

export interface BaseCard {
  /** Stable unique id, e.g. "suspect-scarlet". Used for override-asset lookup and networking. */
  id: string;
  type: CardType;
  /** Display name, e.g. "Miss Scarlet", "Candlestick", "Grand Hall". */
  title: string;
  /** Short flavour line shown on the card. */
  phrase: string;
}

export interface SuspectCard extends BaseCard {
  type: 'suspect';
  /** Hex colour of this character's game piece. */
  color: string;
  /** Fixed seat in the turn order, 1..40 (lower goes first; Miss Scarlet is 1). */
  turnOrder: number;
}

export interface WeaponCard extends BaseCard {
  type: 'weapon';
}

export interface RoomCard extends BaseCard {
  type: 'room';
  // Board footprint (tiles, entrances) is attached in the board data (M5), not here.
}

export type AnyCard = SuspectCard | WeaponCard | RoomCard;
