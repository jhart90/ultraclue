import type { SlotStatus, DiceStyle, BotDifficulty, BotSpeed, LogCard } from './game';

// Lobby / room model. Unlike GameState there is no hidden information here, so a single LobbyView
// is broadcast to everyone in the room; each client identifies itself by its own socket id.

export interface ChatMsg {
  id: number;
  from: string; // display name (ignored for system narration)
  text: string;
  system?: boolean; // game-log narration / room notices, rendered without a "name:" prefix
  /** Audience (player ids). Undefined = public/everyone; otherwise only these ids may see it. */
  to?: string[];
  /** The inverse of `to`: everyone EXCEPT these ids. Used for the face-down half of a reveal, so
   *  that a player who joins after it happened still sees it (a fixed `to` list would omit them). */
  except?: string[];
  /** A private "whisper" — rendered in italic grey. */
  whisper?: boolean;
  /** Structured game event drawn as a card in the chat (roll, suggestion, reveal, accusation). */
  card?: LogCard;
}

export interface SlotOccupant {
  /** Socket id for a human, or a synthetic id like "bot-ABCD-2" for a bot. */
  id: string;
  name: string;
  suspectId?: string;
  isBot: boolean;
  connected: boolean;
  /** Watching only: gets no game piece, hand, or detective notes, and never sees private reveals.
   *  Set by the human themselves in the lobby; excluded from the dealt players when the game starts. */
  observer?: boolean;
  /** When this human joined the room (epoch ms). In the public room the longest-tenured human is
   *  the host, so this decides who controls the settings. Unset for bots. */
  joinedAt?: number;
  /** Dice colours chosen by this human (bots use their character's colour by default). */
  dice?: DiceStyle;
  /** Computer seats: how well this bot plays (defaults to the room's setting). */
  difficulty?: BotDifficulty;
}

export interface Slot {
  index: number;
  status: SlotStatus; // 'open' | 'closed' | 'bot'
  occupant?: SlotOccupant;
}

export type RoomPhase = 'lobby' | 'play' | 'ended';

/** Host-adjustable room settings. */
export interface RoomSettings {
  /** Public room only: seats at the table (humans + computers always sum to this), 8..40. */
  totalPlayers?: number;
  /** Difficulty given to computer seats (the host can still override any one seat). */
  botDifficulty: BotDifficulty;
  /** How quickly every computer at the table acts. */
  botSpeed?: BotSpeed;
}

export interface LobbyView {
  code: string;
  hostId: string;
  /** MAX_PLAYERS long for a private room; `settings.totalPlayers` long for the public room (plus
   *  any extra observer seats appended mid-game). */
  slots: Slot[];
  phase: RoomPhase;
  /** The single always-on public room: every seat is a computer until a human takes it over, and
   *  the game starts itself when the countdown (`startsAt`) runs out. */
  isPublic?: boolean;
  /** Epoch ms at which the public lobby auto-starts its game. */
  startsAt?: number;
  /** Server clock (epoch ms) when this view was built, so clients can correct the countdown for
   *  their own clock skew. */
  serverNow?: number;
  settings?: RoomSettings;
}

/** Private rooms: a fixed 8-seat table. */
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;

/** The public room: the host picks a table size in this range; every seat is filled (by a
 *  computer if no human has taken it). 40 is the full suspect roster. */
export const PUBLIC_MIN_PLAYERS = 8;
export const PUBLIC_MAX_PLAYERS = 40;
export const PUBLIC_DEFAULT_PLAYERS = 40;
/** The public room's fixed code. Six letters, so it can never collide with a generated 4-letter
 *  private code; it's joined from the title screen, never typed. */
export const PUBLIC_ROOM_CODE = 'PUBLIC';
