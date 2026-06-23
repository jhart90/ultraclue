import { create } from 'zustand';
import {
  SOCKET_EVENTS,
  type ChatMsg,
  type Coord,
  type GameView,
  type LobbyView,
  type SlotStatus,
  type YouArePayload,
  type LobbyPayload,
  type ChatBroadcastPayload,
  type GameStartedPayload,
  type ErrorPayload,
} from 'shared';
import { socket } from './socket';

export type Screen = 'title' | 'lobby' | 'game' | 'gallery';

// Stable per-device id so a refresh re-attaches to the same seat; the active room code is saved
// so we can rejoin it automatically on reconnect.
const CLIENT_ID = (() => {
  try {
    let id = localStorage.getItem('ultraclue-cid');
    if (!id) {
      id = `c-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem('ultraclue-cid', id);
    }
    return id;
  } catch {
    return `c-${Math.random().toString(36).slice(2, 10)}`;
  }
})();
const ROOM_KEY = 'ultraclue-room';
const saveRoom = (code: string) => {
  try {
    localStorage.setItem(ROOM_KEY, code);
  } catch {
    /* ignore */
  }
};
const clearRoom = () => {
  try {
    localStorage.removeItem(ROOM_KEY);
  } catch {
    /* ignore */
  }
};

interface StoreState {
  connected: boolean;
  myId: string;
  screen: Screen;
  lobby?: LobbyView;
  game?: GameView;
  chat: ChatMsg[];
  error?: string;

  // actions
  goto: (screen: Screen) => void;
  createGame: (name: string) => void;
  joinGame: (code: string, name: string) => void;
  setSlot: (index: number, status: SlotStatus) => void;
  pickSuspect: (suspectId: string) => void;
  sendChat: (text: string) => void;
  startGame: () => void;
  rollMove: () => void;
  moveTo: (tile: Coord) => void;
  skipMove: () => void;
  suggest: (suspectId: string, weaponId: string) => void;
  revealCard: (cardId: string) => void;
  accuse: (suspectId: string, weaponId: string, roomId: string) => void;
  endTurn: () => void;
  leave: () => void;
  clearError: () => void;
}

export const useStore = create<StoreState>((set) => ({
  connected: false,
  myId: CLIENT_ID,
  screen: 'title',
  chat: [],

  goto: (screen) => set({ screen }),
  createGame: (name) => socket.emit(SOCKET_EVENTS.CREATE_GAME, { name, clientId: CLIENT_ID }),
  joinGame: (code, name) =>
    socket.emit(SOCKET_EVENTS.JOIN_GAME, { code: code.toUpperCase(), name, clientId: CLIENT_ID }),
  setSlot: (index, status) => socket.emit(SOCKET_EVENTS.SET_SLOT, { index, status }),
  pickSuspect: (suspectId) => socket.emit(SOCKET_EVENTS.PICK_SUSPECT, { suspectId }),
  sendChat: (text) => socket.emit(SOCKET_EVENTS.LOBBY_CHAT, { text }),
  startGame: () => socket.emit(SOCKET_EVENTS.START_GAME),
  rollMove: () => socket.emit(SOCKET_EVENTS.ROLL_MOVE),
  moveTo: (tile) => socket.emit(SOCKET_EVENTS.MOVE_TO, { tile }),
  skipMove: () => socket.emit(SOCKET_EVENTS.SKIP_MOVE),
  suggest: (suspectId, weaponId) => socket.emit(SOCKET_EVENTS.MAKE_SUGGESTION, { suspectId, weaponId }),
  revealCard: (cardId) => socket.emit(SOCKET_EVENTS.REVEAL_CARD, { cardId }),
  accuse: (suspectId, weaponId, roomId) => socket.emit(SOCKET_EVENTS.MAKE_ACCUSATION, { suspectId, weaponId, roomId }),
  endTurn: () => socket.emit(SOCKET_EVENTS.END_TURN),
  leave: () => {
    socket.emit(SOCKET_EVENTS.LEAVE);
    clearRoom();
    set({ screen: 'title', lobby: undefined, game: undefined, chat: [] });
  },
  clearError: () => set({ error: undefined }),
}));

// ---- wire server -> store (attached once at module load) ---------------------------------

// On (re)connect, if we have a saved room, try to slip back into our seat.
socket.on('connect', () => {
  useStore.setState({ connected: true });
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(ROOM_KEY);
  } catch {
    /* ignore */
  }
  if (saved) socket.emit(SOCKET_EVENTS.REJOIN, { clientId: CLIENT_ID });
});
socket.on('disconnect', () => useStore.setState({ connected: false }));

socket.on(SOCKET_EVENTS.YOU_ARE, (p: YouArePayload) => useStore.setState({ myId: p.id }));

socket.on(SOCKET_EVENTS.LOBBY, (p: LobbyPayload) => {
  const { lobby } = p;
  useStore.setState((state) => {
    const inRoom = lobby.slots.some((s) => s.occupant?.id === state.myId);
    if (inRoom) saveRoom(lobby.code);
    const screen: Screen = lobby.phase === 'play' ? 'game' : inRoom ? 'lobby' : state.screen;
    return { lobby, screen, error: undefined };
  });
});

socket.on(SOCKET_EVENTS.CHAT, (p: ChatBroadcastPayload) => useStore.setState({ chat: p.chat }));

socket.on(SOCKET_EVENTS.GAME_STARTED, (p: GameStartedPayload) => {
  saveRoom(p.view.code);
  useStore.setState({ game: p.view, screen: 'game' });
});

socket.on(SOCKET_EVENTS.REJOIN_FAILED, () => {
  clearRoom();
  useStore.setState({ screen: 'title', lobby: undefined, game: undefined, chat: [] });
});

socket.on(SOCKET_EVENTS.ERROR, (p: ErrorPayload) => useStore.setState({ error: p.message }));
