import type { SlotStatus, GameView, BotDifficulty, BotSpeed } from './game';
import type { LobbyView, ChatMsg } from './lobby';
import type { PublicStats } from './publicStats';
import type { PlayerProfile } from './profile';
import type { Coord } from './data/board';

// The socket protocol shared by client and server. Every client->server intent and
// server->client message has a constant here plus a typed payload, so the two sides can't drift.

export const SOCKET_EVENTS = {
  // M0 handshake / smoke test (kept for a lightweight health check).
  HELLO: 'hello',
  HELLO_ACK: 'helloAck',

  // --- client -> server (lobby intents) ---
  CREATE_GAME: 'createGame',
  JOIN_GAME: 'joinGame',
  JOIN_PUBLIC: 'joinPublic', // join the always-on public room (no code): take a seat, or pick one mid-game
  SET_ROOM_SETTINGS: 'setRoomSettings', // host adjusts the room's settings (table size, computer difficulty)
  SET_BOT_DIFFICULTY: 'setBotDifficulty', // host changes one computer seat's difficulty
  REJOIN: 'rejoin', // reconnect to an existing seat after a refresh/drop
  SET_SLOT: 'setSlot',
  SET_OBSERVER: 'setObserver', // a human toggles watch-only mode for their own seat
  PICK_SUSPECT: 'pickSuspect',
  LOBBY_CHAT: 'lobbyChat',
  START_GAME: 'startGame',
  LEAVE: 'leave',

  // --- client -> server (in-game turn intents) ---
  ROLL_MOVE: 'rollMove', // in-room player elects to roll & move
  MOVE_TO: 'moveTo',
  CHOOSE_FLOOR: 'chooseFloor', // pick an elevator destination floor
  TAKE_SHORTCUT: 'takeShortcut', // ride a room's secret passage instead of moving
  SKIP_MOVE: 'skipMove',
  MAKE_SUGGESTION: 'makeSuggestion',
  REVEAL_CARD: 'revealCard',
  PASS_SUGGESTION: 'passSuggestion', // a card-less responder acknowledges "Reveal nothing"
  MAKE_ACCUSATION: 'makeAccusation',
  END_TURN: 'endTurn',
  BOOT_PLAYER: 'bootPlayer', // host replaces a human player with a bot
  SAVE_GAME: 'saveGame', // request a fresh save snapshot of the current game
  LOAD_GAME: 'loadGame', // restore a previously saved game (from the title screen)
  TAKE_SEAT: 'takeSeat', // join an in-progress (loaded) game by taking over a bot/empty seat
  JOIN_OBSERVER: 'joinObserver', // join an in-progress game to watch only (not as a player)
  SET_ACCUSING: 'setAccusing', // a player opened/closed the accusation picker (warn the table)
  SET_NOTES: 'setNotes', // client pushes its Detective Notes so they ride along in every save
  SET_DICE: 'setDice', // a human picks the colours of their dice
  PUBLIC_STATS: 'publicStats', // ask for the public table's history + all-time numbers (answered via ack)
  PLAYER_PROFILE: 'playerProfile', // look up the long-term profile for a name + optional PIN (answered via ack)

  // --- server -> client ---
  YOU_ARE: 'youAre',
  LOBBY: 'lobby',
  CHAT: 'chat', // broadcast of the full chat list; works in both lobby and in-game
  GAME_STARTED: 'gameStarted',
  NOTES: 'notes', // server hands a player the Detective Notes for the seat they hold
  REJOIN_FAILED: 'rejoinFailed', // the saved seat is gone; client should reset to the title
  SAVE_GAME_DATA: 'saveGameData', // a snapshot to stash in browser storage (manual save / auto-save)
  ERROR: 'errorMsg',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// ---- payloads ----------------------------------------------------------------------------

export interface PublicStatsPayload {
  stats: PublicStats;
}
export interface PlayerProfileRequest {
  name: string;
  /** Optional 4-character PIN. Only ever travels client → server; never echoed to anyone. */
  pin?: string;
}
export interface PlayerProfilePayload {
  /** null when nobody has finished a game under that name + PIN yet. */
  profile: PlayerProfile | null;
}

export interface HelloPayload {
  name: string;
}
export interface HelloAckPayload {
  message: string;
  clients: number;
}

export interface CreateGamePayload {
  name: string;
  clientId: string;
  /** Optional profile PIN (4 letters/digits). Kept server-side only. */
  pin?: string;
}
export interface JoinGamePayload {
  code: string;
  name: string;
  clientId: string;
  pin?: string;
}
export interface RejoinPayload {
  clientId: string;
}
export interface JoinPublicPayload {
  name: string;
  clientId: string;
  pin?: string;
  /** Watch only: take an observer seat rather than a playing seat. */
  observer?: boolean;
}
export interface SetRoomSettingsPayload {
  totalPlayers?: number;
  botDifficulty?: BotDifficulty;
  botSpeed?: BotSpeed;
}
export interface SetBotDifficultyPayload {
  index: number; // seat index of the computer
  difficulty: BotDifficulty;
}
export interface SetSlotPayload {
  index: number;
  status: SlotStatus;
}
export interface SetObserverPayload {
  observer: boolean;
}
export interface PickSuspectPayload {
  suspectId: string;
}
export interface LobbyChatPayload {
  text: string;
}

export interface YouArePayload {
  id: string;
}
export interface LobbyPayload {
  lobby: LobbyView;
}
export interface ChatBroadcastPayload {
  chat: ChatMsg[];
}
export interface GameStartedPayload {
  view: GameView;
}
export interface MoveToPayload {
  tile: Coord;
}
export interface ChooseFloorPayload {
  floor: 'ground-floor' | 'upper-floor' | 'basement';
}
export interface MakeSuggestionPayload {
  suspectId: string;
  weaponId: string;
}
export interface RevealCardPayload {
  cardId: string;
}
export interface MakeAccusationPayload {
  suspectId: string;
  weaponId: string;
  roomId: string;
}
export interface BootPlayerPayload {
  /** Game player id of the human seat to replace with a bot. */
  targetId: string;
}
export interface TakeSeatPayload {
  code: string;
  index: number; // slot index of the bot/empty seat to take over
  name: string;
  /** The name the joiner's profile goes by when `name` is left blank (loading a save keeps each
   *  seat's saved name, but the stats still belong to whoever is playing). */
  profileName?: string;
  pin?: string;
}
export interface JoinObserverPayload {
  code: string;
  name: string;
}
export interface SetAccusingPayload {
  accusing: boolean;
}
export interface SetDicePayload {
  color: string;
  pips: string;
}
export interface SetNotesPayload {
  /** Serialized Detective Notes (the localStorage JSON) for this player's seat. */
  notes: string;
}
export interface NotesPayload {
  notes: string;
}

/** A saved-game snapshot. `blob` is an opaque serialized room (handled only by the server); the
 *  metadata is shown on the title screen's Load button. */
export interface SavedGameMeta {
  savedAt: number;
  round: number;
  players: number;
  auto: boolean;
}
export interface SaveGameDataPayload {
  meta: SavedGameMeta;
  blob: unknown;
}
export interface LoadGamePayload {
  blob: unknown;
  clientId: string;
  name?: string;
}
export interface ErrorPayload {
  message: string;
}
