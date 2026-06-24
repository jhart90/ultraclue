import type { SlotStatus } from './game';

// Lobby / room model. Unlike GameState there is no hidden information here, so a single LobbyView
// is broadcast to everyone in the room; each client identifies itself by its own socket id.

export interface ChatMsg {
  id: number;
  from: string; // display name (ignored for system narration)
  text: string;
  system?: boolean; // game-log narration / room notices, rendered without a "name:" prefix
}

export interface SlotOccupant {
  /** Socket id for a human, or a synthetic id like "bot-ABCD-2" for a bot. */
  id: string;
  name: string;
  suspectId?: string;
  isBot: boolean;
  connected: boolean;
}

export interface Slot {
  index: number;
  status: SlotStatus; // 'open' | 'closed' | 'bot'
  occupant?: SlotOccupant;
}

export type RoomPhase = 'lobby' | 'play' | 'ended';

export interface LobbyView {
  code: string;
  hostId: string;
  slots: Slot[]; // always length 8
  phase: RoomPhase;
}

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
