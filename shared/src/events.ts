import type { SlotStatus, GameView } from './game';
import type { LobbyView, ChatMsg } from './lobby';
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
  REJOIN: 'rejoin', // reconnect to an existing seat after a refresh/drop
  SET_SLOT: 'setSlot',
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
  MAKE_ACCUSATION: 'makeAccusation',
  END_TURN: 'endTurn',

  // --- server -> client ---
  YOU_ARE: 'youAre',
  LOBBY: 'lobby',
  CHAT: 'chat', // broadcast of the full chat list; works in both lobby and in-game
  GAME_STARTED: 'gameStarted',
  REJOIN_FAILED: 'rejoinFailed', // the saved seat is gone; client should reset to the title
  ERROR: 'errorMsg',
} as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

// ---- payloads ----------------------------------------------------------------------------

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
}
export interface JoinGamePayload {
  code: string;
  name: string;
  clientId: string;
}
export interface RejoinPayload {
  clientId: string;
}
export interface SetSlotPayload {
  index: number;
  status: SlotStatus;
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
export interface ErrorPayload {
  message: string;
}
