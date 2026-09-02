import { create } from 'zustand';
import {
  SOCKET_EVENTS,
  type ChatMsg,
  type Coord,
  type BotDifficulty,
  type BotSpeed,
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
  type PublicStats,
  type PublicStatsPayload,
} from 'shared';
import { socket } from './socket';

export type Screen = 'title' | 'lobby' | 'game' | 'gallery' | 'stats';

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

// A shared invite link (?join=ABCD) drops the recipient straight onto the Join form with the code
// filled in. Honour the invite over any saved game (don't silently auto-rejoin an old room), and
// scrub the param from the URL so a refresh doesn't re-trigger it.
export const initialJoinCode = (() => {
  try {
    const c = new URLSearchParams(window.location.search).get('join');
    if (c && /^[A-Za-z0-9]{4}$/.test(c)) {
      localStorage.removeItem(ROOM_KEY);
      window.history.replaceState(null, '', window.location.pathname);
      return c.toUpperCase();
    }
  } catch {
    /* ignore */
  }
  return null;
})();

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
  /** Bumps when the server hands us restored Detective Notes, so the notes sheet re-reads them. */
  notesEpoch: number;
  /** serverClock - ourClock (ms), from the last lobby view — corrects the public countdown. */
  serverOffset: number;

  // actions
  goto: (screen: Screen) => void;
  /** Fetch the public table's history and all-time numbers (for the Statistics screen). */
  fetchPublicStats: () => Promise<PublicStats>;
  syncNotes: (json: string) => void;
  createGame: (name: string) => void;
  joinGame: (code: string, name: string) => void;
  joinPublic: (name: string, observer?: boolean) => void;
  setRoomSettings: (patch: { totalPlayers?: number; botDifficulty?: BotDifficulty; botSpeed?: BotSpeed }) => void;
  setBotDifficulty: (index: number, difficulty: BotDifficulty) => void;
  setDice: (color: string, pips: string) => void;
  takeSeat: (index: number) => void;
  joinAsObserver: () => void;
  setSlot: (index: number, status: SlotStatus) => void;
  setObserver: (observer: boolean) => void;
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
  setAccusing: (accusing: boolean) => void;
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
  notesEpoch: 0,
  serverOffset: 0,

  goto: (screen) => set({ screen }),
  fetchPublicStats: () =>
    new Promise<PublicStats>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The server did not answer.')), 8000);
      socket.emit(SOCKET_EVENTS.PUBLIC_STATS, {}, (p: PublicStatsPayload) => {
        clearTimeout(t);
        resolve(p.stats);
      });
    }),
  syncNotes: (json) => socket.emit(SOCKET_EVENTS.SET_NOTES, { notes: json }),
  createGame: (name) => socket.emit(SOCKET_EVENTS.CREATE_GAME, { name, clientId: CLIENT_ID }),
  joinGame: (code, name) => {
    pendingName = name; // remembered in case we land on a seat-picker for an in-progress game
    socket.emit(SOCKET_EVENTS.JOIN_GAME, { code: code.toUpperCase(), name, clientId: CLIENT_ID });
  },
  joinPublic: (name, observer = false) => {
    pendingName = name; // reused on the seat picker if the public game is already running
    socket.emit(SOCKET_EVENTS.JOIN_PUBLIC, { name, clientId: CLIENT_ID, observer });
  },
  setRoomSettings: (patch) => socket.emit(SOCKET_EVENTS.SET_ROOM_SETTINGS, patch),
  setBotDifficulty: (index, difficulty) => socket.emit(SOCKET_EVENTS.SET_BOT_DIFFICULTY, { index, difficulty }),
  setDice: (color, pips) => {
    try {
      localStorage.setItem('ultraclue-dice', JSON.stringify({ color, pips }));
    } catch {
      /* ignore */
    }
    socket.emit(SOCKET_EVENTS.SET_DICE, { color, pips });
  },
  takeSeat: (index) => {
    const { seatPick } = useStore.getState();
    if (seatPick) socket.emit(SOCKET_EVENTS.TAKE_SEAT, { code: seatPick.code, index, name: pendingName });
  },
  joinAsObserver: () => {
    const { seatPick } = useStore.getState();
    if (seatPick) socket.emit(SOCKET_EVENTS.JOIN_OBSERVER, { code: seatPick.code, name: pendingName });
  },
  setSlot: (index, status) => socket.emit(SOCKET_EVENTS.SET_SLOT, { index, status }),
  setObserver: (observer) => socket.emit(SOCKET_EVENTS.SET_OBSERVER, { observer }),
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
  setAccusing: (accusing) => socket.emit(SOCKET_EVENTS.SET_ACCUSING, { accusing }),
  endTurn: () => socket.emit(SOCKET_EVENTS.END_TURN),
  bootPlayer: (targetId) => socket.emit(SOCKET_EVENTS.BOOT_PLAYER, { targetId }),
  saveGame: () => socket.emit(SOCKET_EVENTS.SAVE_GAME),
  loadGame: () => {
    const s = readSave();
    if (s) {
      pendingNotes = s.notes ?? null; // restored under the new room code once the game view arrives
      pendingName = ''; // keep each seat's saved name when the loader picks from the seat picker
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
  const mine = lobby.slots.find((s) => s.occupant?.id === useStore.getState().myId)?.occupant;
  const chosen = savedDice();
  if (mine && chosen && (mine.dice?.color !== chosen.color || mine.dice?.pips !== chosen.pips)) {
    socket.emit(SOCKET_EVENTS.SET_DICE, chosen);
  }
  useStore.setState((state) => {
    const inRoom = lobby.slots.some((s) => s.occupant?.id === state.myId);
    if (inRoom) saveRoom(lobby.code);
    const serverOffset = lobby.serverNow ? lobby.serverNow - Date.now() : state.serverOffset;
    // We joined an in-progress (loaded) game but aren't seated yet → pick a seat to take over.
    if (!inRoom && lobby.phase === 'play') {
      return { lobby, serverOffset, seatPick: { code: lobby.code, slots: lobby.slots }, error: undefined };
    }
    // Only follow a lobby into its screen if we're actually seated in it — otherwise a stray update
    // (e.g. right after we left) must not drag us back into the game.
    const screen: Screen = inRoom ? (lobby.phase === 'play' ? 'game' : 'lobby') : state.screen;
    return { lobby, serverOffset, screen, seatPick: undefined, error: undefined };
  });
});

socket.on(SOCKET_EVENTS.CHAT, (p: ChatBroadcastPayload) => useStore.setState({ chat: p.chat }));

// The server handed us the Detective Notes for our seat (on resume / rejoin / takeover).
socket.on(SOCKET_EVENTS.NOTES, (p: { notes: string }) => {
  const code = useStore.getState().game?.code;
  if (code && p?.notes) {
    restoreNotes(code, p.notes);
    useStore.setState((s) => ({ notesEpoch: s.notesEpoch + 1 }));
  }
});

socket.on(SOCKET_EVENTS.GAME_STARTED, (p: GameStartedPayload) => {
  if (pendingNotes) {
    restoreNotes(p.view.code, pendingNotes); // bring the saved Detective Notes into the new room
    pendingNotes = null;
  }
  saveRoom(p.view.code);
  useStore.setState((s) => ({
    game: p.view,
    screen: 'game',
    seatPick: undefined,
    serverOffset: p.view.serverNow ? p.view.serverNow - Date.now() : s.serverOffset,
  }));
});

/** The dice colours this browser chose earlier, if any. */
export function savedDice(): { color: string; pips: string } | null {
  try {
    const s = localStorage.getItem('ultraclue-dice');
    return s ? (JSON.parse(s) as { color: string; pips: string }) : null;
  } catch {
    return null;
  }
}

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
