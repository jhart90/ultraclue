import { create } from 'zustand';
import {
  SOCKET_EVENTS,
  type ChatMsg,
  type Coord,
  type GameView,
  type LobbyView,
  type Slot,
  type SlotStatus,
  type YouArePayload,
  type LobbyPayload,
  type ChatBroadcastPayload,
  type GameStartedPayload,
  type ErrorPayload,
  type SavedGameMeta,
  type SaveGameDataPayload,
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

// A single saved-game slot lives in browser storage (manual save + per-turn auto-save). It also
// carries this player's private Detective Notes so they survive a save/load.
const SAVE_KEY = 'ultraclue-savegame';
type SaveSlot = { meta: SavedGameMeta; blob: unknown; notes?: string };
function readSave(): SaveSlot | null {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? (JSON.parse(s) as SaveSlot) : null;
  } catch {
    return null;
  }
}
function writeSave(payload: SaveSlot): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  } catch {
    /* storage full / unavailable — ignore */
  }
}

// Detective Notes persist in localStorage keyed by room code; carry them across a save/load.
const notesKey = (code: string) => `ultraclue-notes-${code}`;
let pendingNotes: string | null = null; // notes to restore once the loaded game's (new) code arrives
let pendingName = ''; // the name typed on the Join form, reused if we have to pick a seat
function readNotes(code: string): string | null {
  try {
    return localStorage.getItem(notesKey(code));
  } catch {
    return null;
  }
}
function restoreNotes(code: string, json: string): void {
  try {
    localStorage.setItem(notesKey(code), json);
    localStorage.setItem(`${notesKey(code)}-seeded`, '1'); // already filled — don't re-seed the hand
  } catch {
    /* ignore */
  }
}

interface StoreState {
  connected: boolean;
  myId: string;
  screen: Screen;
  lobby?: LobbyView;
  game?: GameView;
  chat: ChatMsg[];
  error?: string;
  /** Metadata for the saved game in browser storage, if any (drives the title's Load button). */
  savedMeta?: SavedGameMeta;
  /** Bumps when a save lands, so the in-game menu can flash a brief "Saved" confirmation. */
  savedAt?: number;
  /** Set when we joined an in-progress (loaded) game and must pick a seat to take over. */
  seatPick?: { code: string; slots: Slot[] };

  // actions
  goto: (screen: Screen) => void;
  createGame: (name: string) => void;
  joinGame: (code: string, name: string) => void;
  takeSeat: (index: number) => void;
  setSlot: (index: number, status: SlotStatus) => void;
  pickSuspect: (suspectId: string) => void;
  sendChat: (text: string) => void;
  startGame: () => void;
  rollMove: () => void;
  moveTo: (tile: Coord) => void;
  chooseFloor: (floor: 'ground-floor' | 'upper-floor' | 'basement') => void;
  takeShortcut: () => void;
  skipMove: () => void;
  suggest: (suspectId: string, weaponId: string) => void;
  revealCard: (cardId: string) => void;
  passSuggestion: () => void;
  accuse: (suspectId: string, weaponId: string, roomId: string) => void;
  endTurn: () => void;
  bootPlayer: (targetId: string) => void;
  saveGame: () => void;
  loadGame: () => void;
  leave: () => void;
  clearError: () => void;
}

export const useStore = create<StoreState>((set) => ({
  connected: false,
  myId: CLIENT_ID,
  screen: 'title',
  chat: [],
  savedMeta: readSave()?.meta,

  goto: (screen) => set({ screen }),
  createGame: (name) => socket.emit(SOCKET_EVENTS.CREATE_GAME, { name, clientId: CLIENT_ID }),
  joinGame: (code, name) => {
    pendingName = name; // remembered in case we land on a seat-picker for an in-progress game
    socket.emit(SOCKET_EVENTS.JOIN_GAME, { code: code.toUpperCase(), name, clientId: CLIENT_ID });
  },
  takeSeat: (index) => {
    const { seatPick } = useStore.getState();
    if (seatPick) socket.emit(SOCKET_EVENTS.TAKE_SEAT, { code: seatPick.code, index, name: pendingName });
  },
  setSlot: (index, status) => socket.emit(SOCKET_EVENTS.SET_SLOT, { index, status }),
  pickSuspect: (suspectId) => socket.emit(SOCKET_EVENTS.PICK_SUSPECT, { suspectId }),
  sendChat: (text) => socket.emit(SOCKET_EVENTS.LOBBY_CHAT, { text }),
  startGame: () => socket.emit(SOCKET_EVENTS.START_GAME),
  rollMove: () => socket.emit(SOCKET_EVENTS.ROLL_MOVE),
  moveTo: (tile) => socket.emit(SOCKET_EVENTS.MOVE_TO, { tile }),
  chooseFloor: (floor) => socket.emit(SOCKET_EVENTS.CHOOSE_FLOOR, { floor }),
  takeShortcut: () => socket.emit(SOCKET_EVENTS.TAKE_SHORTCUT),
  skipMove: () => socket.emit(SOCKET_EVENTS.SKIP_MOVE),
  suggest: (suspectId, weaponId) => socket.emit(SOCKET_EVENTS.MAKE_SUGGESTION, { suspectId, weaponId }),
  revealCard: (cardId) => socket.emit(SOCKET_EVENTS.REVEAL_CARD, { cardId }),
  passSuggestion: () => socket.emit(SOCKET_EVENTS.PASS_SUGGESTION),
  accuse: (suspectId, weaponId, roomId) => socket.emit(SOCKET_EVENTS.MAKE_ACCUSATION, { suspectId, weaponId, roomId }),
  endTurn: () => socket.emit(SOCKET_EVENTS.END_TURN),
  bootPlayer: (targetId) => socket.emit(SOCKET_EVENTS.BOOT_PLAYER, { targetId }),
  saveGame: () => socket.emit(SOCKET_EVENTS.SAVE_GAME),
  loadGame: () => {
    const s = readSave();
    if (s) {
      pendingNotes = s.notes ?? null; // restored under the new room code once the game view arrives
      socket.emit(SOCKET_EVENTS.LOAD_GAME, { blob: s.blob, clientId: CLIENT_ID });
    }
  },
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
    // We joined an in-progress (loaded) game but aren't seated yet → pick a seat to take over.
    if (!inRoom && lobby.phase === 'play') {
      return { lobby, seatPick: { code: lobby.code, slots: lobby.slots }, error: undefined };
    }
    // Only follow a lobby into its screen if we're actually seated in it — otherwise a stray update
    // (e.g. right after we left) must not drag us back into the game.
    const screen: Screen = inRoom ? (lobby.phase === 'play' ? 'game' : 'lobby') : state.screen;
    return { lobby, screen, seatPick: undefined, error: undefined };
  });
});

socket.on(SOCKET_EVENTS.CHAT, (p: ChatBroadcastPayload) => useStore.setState({ chat: p.chat }));

socket.on(SOCKET_EVENTS.GAME_STARTED, (p: GameStartedPayload) => {
  if (pendingNotes) {
    restoreNotes(p.view.code, pendingNotes); // bring the saved Detective Notes into the new room
    pendingNotes = null;
  }
  saveRoom(p.view.code);
  useStore.setState({ game: p.view, screen: 'game', seatPick: undefined });
});

socket.on(SOCKET_EVENTS.REJOIN_FAILED, () => {
  clearRoom();
  useStore.setState({ screen: 'title', lobby: undefined, game: undefined, chat: [] });
});

// A save snapshot arrived (manual save or per-turn auto-save) — stash it, with our own notes, in
// browser storage.
socket.on(SOCKET_EVENTS.SAVE_GAME_DATA, (p: SaveGameDataPayload) => {
  const code = useStore.getState().game?.code;
  const notes = code ? readNotes(code) : null;
  writeSave({ meta: p.meta, blob: p.blob, notes: notes ?? undefined });
  useStore.setState({ savedMeta: p.meta, savedAt: p.meta.savedAt });
});

socket.on(SOCKET_EVENTS.ERROR, (p: ErrorPayload) => useStore.setState({ error: p.message }));
