// The authoritative game-state model and the per-player "view" model sent over the wire.
// The server holds one GameState (with hidden info); each client receives a GameView tailored
// to what that player is allowed to see.

import type { Coord, FloorId } from './data/board';

export type SlotStatus = 'open' | 'closed' | 'bot';

/** How long the 3D dice roll animation runs on clients (ms). Bots wait it out before acting. */
export const DICE_ANIM_MS = 2600;
/** Public games: a human on the clock has this long to act before the turn is passed for them. */
export const PUBLIC_TURN_MS = 90_000;

/** How well a computer player plays. Set per seat by the host; a room-wide default applies to new bots. */
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'medium', 'hard'];
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'medium';
export const BOT_DIFFICULTY_LABEL: Record<BotDifficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
export const BOT_DIFFICULTY_BLURB: Record<BotDifficulty, string> = {
  easy: 'Short memory, random guesses, and it will gamble on an accusation.',
  medium: 'Keeps proper notes and only accuses when sure, but probes carelessly.',
  hard: 'Full deduction, targeted probes, and it heads straight for useful rooms.',
};

/** A player's dice look: body colour and pip colour (hex). Bots default to their character's colour. */
export interface DiceStyle {
  color: string;
  pips: string;
}
export type Phase = 'lobby' | 'setup' | 'play' | 'ended';

// Movement sub-state of the current player's turn.
//  awaitRoll     — player started the turn inside a room: choose ROLL & MOVE or skip movement.
//  awaitMove     — dice are rolled; pick a highlighted destination square.
//  awaitElevator — stepped into the elevator: choose which floor to ride to.
//  postMove      — finished moving (or skipped): suggest / accuse / end the turn.
export type TurnPhase = 'awaitRoll' | 'awaitMove' | 'awaitElevator' | 'postMove';

export interface Player {
  /** Socket id for humans, or a synthetic id like "bot-2" for bots. */
  id: string;
  name: string;
  /** Chosen suspect card id; drives piece colour and turn order. */
  suspectId: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  /** Card ids in hand. SERVER-ONLY — never sent to other players. */
  hand: string[];
  eliminated: boolean;
  /** Dice colours this player rolls with (shown to everyone during their roll animation). */
  dice?: DiceStyle;
  /** Computer players only: how well this seat plays. */
  difficulty?: BotDifficulty;
  /** Current board tile. */
  position: Coord;
  /** Room id if the piece is currently inside a room. */
  inRoomId?: string;
}

export interface Envelope {
  suspectId: string;
  weaponId: string;
  roomId: string;
}

export interface Suggestion {
  suggesterId: string;
  suspectId: string;
  weaponId: string;
  roomId: string;
  /** Players still to be asked, clockwise from the suggester. */
  queue: string[];
  /** Players who have already been asked and had no matching card. */
  passes: string[];
  /** Set when the head of the queue holds a matching card and we await their reveal choice. */
  pendingResponderId?: string;
  /** Who ultimately revealed a card (if anyone). */
  responderId?: string;
  /** The revealed card id. SERVER-ONLY — only surfaced to the suggester in their view. */
  revealedCardId?: string;
  anyRevealed: boolean;
  resolved: boolean;
}

export interface LogEntry {
  id: number;
  text: string;
}

/** A suggestion or accusation just made — broadcast so every client can pop up the three cards. */
export interface Announcement {
  seq: number;
  kind: 'suggestion' | 'accusation';
  byId: string;
  byName: string;
  suspectId: string;
  weaponId: string;
  roomId: string;
  correct?: boolean; // accusations only
}

export interface GameState {
  code: string;
  phase: Phase;
  players: Player[];
  /** Player ids ordered by their suspect's fixed turn order. Eliminated players stay in the list but are skipped. */
  turnOrder: string[];
  /** Index into turnOrder of the current player. */
  activeIdx: number;
  /** Completed full rounds (bumps each time the turn wraps back to the first player). */
  round?: number;
  /** The solution. SERVER-ONLY — only revealed in views once the game has ended. */
  envelope: Envelope;
  currentSuggestion?: Suggestion;
  announcement?: Announcement;
  winnerId?: string;
  log: LogEntry[];
  nextLogId: number;
  /** Where each weapon token currently sits: weaponId -> roomId. Updated when a suggestion summons one. */
  weaponLocations: Record<string, string>;
  // ---- movement ----
  turnPhase: TurnPhase;
  /** The two dice of the current movement, once rolled. */
  lastRoll?: [number, number];
  /** Increments on every dice roll, so clients can detect a fresh roll even if the values repeat. */
  rollSeq?: number;
  /** The path most recently walked, for clients to animate. */
  lastMove?: { playerId: string; path: Coord[] };
  /** Set while a player is choosing an elevator floor (steps left to continue moving after). */
  elevatorRide?: { fromFloor: FloorId; stepsLeft: number };
}

// ---- Per-player view (safe to broadcast) -------------------------------------------------

export interface PlayerView {
  id: string;
  name: string;
  suspectId: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  eliminated: boolean;
  dice?: DiceStyle;
  difficulty?: BotDifficulty;
  /** How many cards this player holds — never the cards themselves. */
  handCount: number;
  position: Coord;
  inRoomId?: string;
}

export interface SuggestionView {
  suggesterId: string;
  suspectId: string;
  weaponId: string;
  roomId: string;
  queue: string[];
  passes: string[];
  pendingResponderId?: string;
  responderId?: string;
  /** Only populated when the viewer is the suggester. */
  revealedCardId?: string;
  anyRevealed: boolean;
  resolved: boolean;
}

export interface GameView {
  code: string;
  phase: Phase;
  players: PlayerView[];
  turnOrder: string[];
  activeIdx: number;
  yourId: string;
  /** Room host's id, so an observing host still gets host-only controls (set by the server). */
  hostId?: string;
  /** Set to the id of a player currently composing an accusation, so the table can be warned. */
  accusingId?: string;
  /** True when the viewer is watching only (not one of the dealt players). */
  observer?: boolean;
  /** Public games: epoch ms by which the human on the clock must act (turn passed otherwise). */
  turnDeadline?: number;
  /** Server clock when this view was built, to correct the countdown for clock skew. */
  serverNow?: number;
  /** The viewer's own hand. Empty for spectators / non-players. */
  yourHand: string[];
  currentSuggestion?: SuggestionView;
  announcement?: Announcement;
  /** Only present once the game has ended. */
  envelope?: Envelope;
  winnerId?: string;
  log: LogEntry[];
  weaponLocations: Record<string, string>;
  // ---- movement ----
  turnPhase: TurnPhase;
  lastRoll?: [number, number];
  rollSeq?: number;
  lastMove?: { playerId: string; path: Coord[] };
  /** Tiles the active player may move to this turn (for highlighting). */
  reachable?: Coord[];
  /** Floors the active player may ride the elevator to (when choosing). */
  elevatorFloors?: FloorId[];
}
