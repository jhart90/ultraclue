import {
  SUSPECTS,
  defaultDice,
  startGame,
  makeRng,
  shuffle,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PUBLIC_MIN_PLAYERS,
  PUBLIC_MAX_PLAYERS,
  PUBLIC_DEFAULT_PLAYERS,
  PUBLIC_ROOM_CODE,
  BOT_DIFFICULTIES,
  DEFAULT_BOT_DIFFICULTY,
  BOT_SPEEDS,
  DEFAULT_BOT_SPEED,
  type BotDifficulty,
  type BotSpeed,
  type RoomSettings,
  type SlotOccupant,
  type ChatMsg,
  type GameState,
  type LobbyView,
  type Player,
  type RoomPhase,
  type Slot,
  type SlotStatus,
  type SuggestionEvent,
} from 'shared';

export interface Room {
  code: string;
  hostId: string;
  slots: Slot[];
  chat: ChatMsg[];
  phase: RoomPhase;
  game?: GameState;
  nextChatId: number;
  mirroredLogId: number; // highest game-log id already copied into the chat stream
  thinkingId?: number; // id of the transient "<bot> is thinking…" chat line, if one is showing
  lastRevealWhisper?: string; // dedup key for the private "reveals <card>" whisper
  lastLoggedSuggestion?: string; // dedup key for appending a resolved suggestion to the log below
  /** Every resolved suggestion (server truth, incl. the revealed card) — feeds bot deductions. */
  suggestionLog: SuggestionEvent[];
  /** Every player's private Detective Notes, keyed by player id, so they're in every save. */
  notes: Record<string, string>;
  /** A freshly loaded game is paused (all seats are bots) until a human takes a seat. */
  paused?: boolean;
  /** Id of a player currently composing an accusation (picking cards), to warn the rest of the table. */
  accusingId?: string;
  /** announcement.seq of a winning accusation already handled, so its delayed reveal fires once. */
  winAnnounced?: number;
  /** Public room: epoch ms when the finished game hands over to the next lobby (details screen countdown). */
  resetsAt?: number;
  /** The single always-on public room (code PUBLIC_ROOM_CODE): never deleted, every seat a computer
   *  until a human takes it, host = longest-tenured human, game auto-starts at `startsAt`. */
  isPublic?: boolean;
  settings?: RoomSettings;
  /** Public room: epoch ms at which the lobby starts its game (server-driven timer). */
  startsAt?: number;
  /** Public game: when the human currently on the clock must have acted by, and which wait it's for. */
  turnDeadline?: number;
  turnKey?: string;
  /** When the last dice roll was broadcast, so bots let the roll animation finish before acting. */
  lastRollAt?: number;
  lastRollSeq?: number;
}

const rooms = new Map<string, Room>();

// Unambiguous alphabet (no I/O/0/1) for human-friendly 4-letter room codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function emptySlots(): Slot[] {
  return Array.from({ length: MAX_PLAYERS }, (_, i) => ({ index: i, status: 'open' as SlotStatus }));
}

/** Pick a random suspect not already claimed by an occupant, so each new arrival gets a default
 *  character on the spot (there's no "choose" step — only "change"). Returns undefined if every
 *  suspect is taken (impossible with ≤MAX_PLAYERS seats and 40 suspects). */
function randomFreeSuspect(slots: Slot[]): string | undefined {
  const taken = new Set(slots.map((s) => s.occupant?.suspectId).filter((x): x is string => !!x));
  const free = SUSPECTS.filter((s) => !taken.has(s.id));
  return free.length ? free[Math.floor(Math.random() * free.length)].id : undefined;
}

/** A fresh computer occupant for a seat. Bot ids embed the seat index; a seat's previous bot is
 *  always remapped away (to the human who took it) before a new one is minted, so ids stay unique. */
function botOccupant(room: Pick<Room, 'code' | 'slots' | 'settings'>, index: number): SlotOccupant {
  return {
    id: `bot-${room.code}-${index}`,
    name: `Computer ${index + 1}`,
    isBot: true,
    connected: true,
    suspectId: randomFreeSuspect(room.slots),
    difficulty: room.settings?.botDifficulty ?? DEFAULT_BOT_DIFFICULTY,
  };
}

/** The difficulty new computers get in this room. */
export function roomBotDifficulty(room: Pick<Room, 'settings'>): BotDifficulty {
  return room.settings?.botDifficulty ?? DEFAULT_BOT_DIFFICULTY;
}

function cleanDifficulty(d: unknown): BotDifficulty | undefined {
  return BOT_DIFFICULTIES.includes(d as BotDifficulty) ? (d as BotDifficulty) : undefined;
}
function cleanSpeed(d: unknown): BotSpeed | undefined {
  return BOT_SPEEDS.includes(d as BotSpeed) ? (d as BotSpeed) : undefined;
}
/** How quickly this room's computers act. */
export function roomBotSpeed(room: Pick<Room, 'settings'>): BotSpeed {
  return room.settings?.botSpeed ?? DEFAULT_BOT_SPEED;
}

// ---- the public room --------------------------------------------------------------------------

function clampTotal(n: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return PUBLIC_DEFAULT_PLAYERS;
  return Math.min(PUBLIC_MAX_PLAYERS, Math.max(PUBLIC_MIN_PLAYERS, v));
}

/** When a public lobby formed at `now` should start: 10 minutes out — unless the next :00 or :30
 *  is within 15 minutes, in which case the game starts on that mark so it lands on a round time. */
export function publicStartTime(now = Date.now()): number {
  const HALF_HOUR = 30 * 60_000;
  const nextMark = (Math.floor(now / HALF_HOUR) + 1) * HALF_HOUR;
  if (nextMark - now <= 15 * 60_000) return nextMark;
  return now + 10 * 60_000;
}

export function getPublicRoom(): Room | undefined {
  return rooms.get(PUBLIC_ROOM_CODE);
}

/** Build the public lobby: `totalPlayers` seats, every one a computer, clock already running. */
export function createPublicRoom(
  totalPlayers = PUBLIC_DEFAULT_PLAYERS,
  botDifficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY,
  botSpeed: BotSpeed = DEFAULT_BOT_SPEED,
): Room {
  const room: Room = {
    code: PUBLIC_ROOM_CODE,
    hostId: '',
    slots: [],
    chat: [],
    phase: 'lobby',
    nextChatId: 1,
    mirroredLogId: 0,
    suggestionLog: [],
    notes: {},
    isPublic: true,
    settings: { totalPlayers: clampTotal(totalPlayers), botDifficulty, botSpeed },
    startsAt: publicStartTime(),
  };
  for (let i = 0; i < room.settings!.totalPlayers!; i++) {
    room.slots.push({ index: i, status: 'bot', occupant: botOccupant(room, i) });
  }
  rooms.set(room.code, room);
  return room;
}

/** Public room host = the longest-tenured human still in the room (players before observers).
 *  A sitting host keeps the title while they remain; only when they're gone does it pass on. */
export function electHost(room: Room): void {
  const humans = room.slots
    .map((s) => s.occupant)
    .filter((o): o is SlotOccupant => !!o && !o.isBot);
  if (humans.some((h) => h.id === room.hostId)) return;
  humans.sort((a, b) => (a.observer ? 1 : 0) - (b.observer ? 1 : 0) || (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
  room.hostId = humans[0]?.id ?? '';
  if (room.game) for (const p of room.game.players) p.isHost = p.id === room.hostId;
}

/** A human joins the public lobby: they take over the lowest computer seat (keeping its character).
 *  Someone already seated just gets their existing seat back. */
/** Public observers sit in extra slots appended past the table (index >= totalPlayers), so the
 *  humans-plus-computers count of the playing seats is untouched. */
function appendObserverSlot(room: Room, occupant: SlotOccupant): Slot {
  const slot: Slot = { index: room.slots.length, status: 'open', occupant: { ...occupant, observer: true, suspectId: undefined } };
  room.slots.push(slot);
  return slot;
}
function dropSlot(room: Room, slot: Slot): void {
  room.slots = room.slots.filter((s) => s !== slot);
  room.slots.forEach((s, i) => (s.index = i));
}
/** Is this a public observer slot (past the playing seats)? */
function isPublicObserverSlot(room: Room, slot: Slot): boolean {
  return !!room.isPublic && slot.index >= (room.settings?.totalPlayers ?? room.slots.length);
}

export function joinPublicLobby(room: Room, id: string, name: string, observer = false): number {
  if (!room.isPublic) throw new Error('Not the public room.');
  if (room.phase !== 'lobby') throw new Error('The public game has already started.');
  const mine = room.slots.find((s) => s.occupant?.id === id);
  if (mine) return mine.index;
  if (observer) {
    const s = appendObserverSlot(room, { id, name: name.trim() || 'Observer', isBot: false, connected: true, joinedAt: Date.now() });
    electHost(room);
    return s.index;
  }
  const slot = room.slots.find((s) => s.occupant?.isBot);
  if (!slot?.occupant) throw new Error('The public table is full.');
  slot.status = 'open';
  slot.occupant = {
    id,
    name: name.trim() || 'Player',
    isBot: false,
    connected: true,
    suspectId: slot.occupant.suspectId,
    joinedAt: Date.now(),
  };
  electHost(room);
  return slot.index;
}

/** Host changes the room's settings. Computer difficulty applies to every computer seat now and to
 *  any added later (the host can still override one seat with setBotDifficulty). Resizing is public
 *  only: growing appends computer seats; shrinking drops computer seats from the end, moving any
 *  human sitting past the new size into a freed computer seat. */
export function setRoomSettings(
  room: Room,
  requesterId: string,
  patch: { totalPlayers?: number; botDifficulty?: unknown; botSpeed?: unknown },
): void {
  if (room.hostId !== requesterId) throw new Error('Only the host can change the settings.');
  if (room.phase !== 'lobby') throw new Error('The game has already started.');
  const d = cleanDifficulty(patch.botDifficulty);
  if (d) {
    room.settings = { ...(room.settings ?? {}), botDifficulty: d };
    for (const s of room.slots) if (s.occupant?.isBot) s.occupant.difficulty = d;
  }
  const sp = cleanSpeed(patch.botSpeed);
  if (sp) room.settings = { ...(room.settings ?? { botDifficulty: DEFAULT_BOT_DIFFICULTY }), botSpeed: sp };
  if (patch.totalPlayers == null) return;
  if (!room.isPublic) throw new Error('Only the public table can be resized.');
  const n = clampTotal(patch.totalPlayers);
  const humans = room.slots.filter((s) => s.occupant && !s.occupant.isBot && !s.occupant.observer).length;
  if (n < humans) throw new Error(`${humans} people are already seated — the table can't be smaller than that.`);
  const oldTotal = room.settings?.totalPlayers ?? room.slots.length;
  const observers = room.slots.slice(oldTotal); // watchers sit past the playing seats; keep them
  let playing = room.slots.slice(0, oldTotal);
  if (n < playing.length) {
    const keep = playing.slice(0, n);
    const overflow = playing
      .slice(n)
      .map((s) => s.occupant)
      .filter((o): o is SlotOccupant => !!o && !o.isBot);
    for (const h of overflow) {
      const target = keep.find((s) => s.occupant?.isBot);
      if (!target) throw new Error('Not enough seats for everyone already here.');
      target.status = 'open';
      target.occupant = h;
    }
    playing = keep;
  } else {
    for (let i = playing.length; i < n; i++) {
      playing.push({ index: i, status: 'bot', occupant: botOccupant({ ...room, slots: playing }, i) });
    }
  }
  room.slots = [...playing, ...observers];
  room.slots.forEach((s, i) => (s.index = i));
  room.settings = { ...(room.settings ?? { botDifficulty: DEFAULT_BOT_DIFFICULTY }), totalPlayers: n };
}

/** Host sets one computer seat's difficulty (lobby or mid-game). */
export function setBotDifficulty(room: Room, requesterId: string, index: number, difficulty: unknown): void {
  if (room.hostId !== requesterId) throw new Error('Only the host can change a computer\'s difficulty.');
  const d = cleanDifficulty(difficulty);
  if (!d) throw new Error('Unknown difficulty.');
  const occ = room.slots[index]?.occupant;
  if (!occ || !occ.isBot) throw new Error('That seat is not a computer.');
  occ.difficulty = d;
  const gp = room.game?.players.find((p) => p.id === occ.id);
  if (gp) gp.difficulty = d;
}

/** After a public game ends: tear it down and form the next lobby (same table size, clock reset),
 *  re-seating every human who is still connected — with their character where it's free. */
export function resetPublicRoom(): Room {
  const old = getPublicRoom();
  const total = old?.settings?.totalPlayers ?? PUBLIC_DEFAULT_PLAYERS;
  const difficulty = old ? roomBotDifficulty(old) : DEFAULT_BOT_DIFFICULTY;
  const speed = old ? roomBotSpeed(old) : DEFAULT_BOT_SPEED;
  const humans = old
    ? old.slots.map((s) => s.occupant).filter((o): o is SlotOccupant => !!o && !o.isBot && o.connected)
    : [];
  rooms.delete(PUBLIC_ROOM_CODE);
  const room = createPublicRoom(total, difficulty, speed);
  for (const h of humans) {
    if (h.observer) {
      appendObserverSlot(room, { ...h, connected: true });
      continue;
    }
    const slot = room.slots.find((s) => s.occupant?.isBot);
    if (!slot?.occupant) break;
    // Keep their character: if a computer seat happened to draw it, hand that seat this one's.
    const wanted = h.suspectId ?? slot.occupant.suspectId;
    const holder = room.slots.find((s) => s !== slot && s.occupant?.suspectId === wanted);
    if (holder?.occupant) holder.occupant.suspectId = slot.occupant.suspectId;
    slot.status = 'open';
    slot.occupant = {
      id: h.id,
      name: h.name,
      isBot: false,
      connected: true,
      suspectId: wanted,
      joinedAt: h.joinedAt ?? Date.now(),
    };
  }
  electHost(room);
  return room;
}

export function createRoom(hostId: string, hostName: string): Room {
  const slots = emptySlots();
  slots[0].occupant = {
    id: hostId,
    name: hostName.trim() || 'Host',
    isBot: false,
    connected: true,
    suspectId: randomFreeSuspect(slots),
  };
  const room: Room = {
    code: genCode(),
    hostId,
    slots,
    chat: [],
    phase: 'lobby',
    nextChatId: 1,
    mirroredLogId: 0,
    suggestionLog: [],
    notes: {},
    settings: { botDifficulty: DEFAULT_BOT_DIFFICULTY },
  };
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get((code ?? '').toUpperCase());
}

export function findRoomByOccupant(id: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.slots.some((s) => s.occupant?.id === id)) return room;
  }
  return undefined;
}

export function joinRoom(code: string, id: string, name: string): { room: Room; index: number } {
  const room = getRoom(code);
  if (!room) throw new Error('No game found with that code.');
  if (room.phase !== 'lobby') throw new Error('That game has already started.');
  const slot = room.slots.find((s) => s.status === 'open' && !s.occupant);
  if (!slot) throw new Error('That game is full.');
  slot.occupant = {
    id,
    name: name.trim() || 'Player',
    isBot: false,
    connected: true,
    suspectId: randomFreeSuspect(room.slots),
  };
  return { room, index: slot.index };
}

export function setSlot(room: Room, requesterId: string, index: number, status: SlotStatus): void {
  if (room.hostId !== requesterId) throw new Error('Only the host can change slots.');
  if (room.phase !== 'lobby') throw new Error('The game has already started.');
  if (room.isPublic) throw new Error('Public seats are always filled — resize the table instead.');
  const slot = room.slots[index];
  if (!slot) throw new Error('Invalid slot.');
  if (slot.occupant?.id === room.hostId) throw new Error('The host slot cannot be changed.');
  // A connected human may not be evicted; a disconnected one (or a bot) can be.
  if (slot.occupant && !slot.occupant.isBot && slot.occupant.connected) {
    throw new Error('A player is sitting in that slot.');
  }

  if (status === 'bot') {
    slot.status = 'bot';
    slot.occupant = botOccupant(room, index);
  } else {
    // 'open' or 'closed' — both clear any bot occupant.
    slot.status = status;
    slot.occupant = undefined;
  }
}

/** A human flips their own seat into (or out of) watch-only observer mode. Lobby-only. */
export function setObserver(room: Room, id: string, observer: boolean): void {
  if (room.phase !== 'lobby') throw new Error('The game has already started.');
  const slot = room.slots.find((s) => s.occupant?.id === id);
  if (!slot?.occupant) throw new Error('You are not in this game.');
  if (slot.occupant.isBot) throw new Error('Bots cannot observe.');
  if (!room.isPublic) {
    slot.occupant.observer = observer;
    return;
  }
  // Public: a watcher moves out to an observer slot and a computer takes the playing seat back;
  // a watcher who wants to play takes the lowest computer seat.
  if (observer === !!slot.occupant.observer) return;
  const occ = slot.occupant;
  if (observer) {
    slot.status = 'bot';
    slot.occupant = { ...botOccupant(room, slot.index), suspectId: occ.suspectId };
    appendObserverSlot(room, occ);
  } else {
    const seat = room.slots.find((s) => s.occupant?.isBot);
    if (!seat?.occupant) throw new Error('The public table is full.');
    dropSlot(room, slot);
    seat.status = 'open';
    seat.occupant = { ...occ, observer: false, suspectId: seat.occupant.suspectId };
  }
  electHost(room);
}

export function pickSuspect(room: Room, id: string, suspectId: string): void {
  if (room.phase !== 'lobby') throw new Error('The game has already started.');
  if (!SUSPECTS.some((s) => s.id === suspectId)) throw new Error('Unknown character.');
  const slot = room.slots.find((s) => s.occupant?.id === id);
  if (!slot?.occupant) throw new Error('You are not in this game.');
  const holder = room.slots.find((s) => s.occupant && s.occupant.id !== id && s.occupant.suspectId === suspectId)?.occupant;
  if (holder && !holder.isBot) throw new Error('That character is already taken.');
  // A computer's character is up for grabs: it takes over the character you're giving up.
  if (holder) {
    holder.suspectId = slot.occupant.suspectId;
    holder.dice = undefined; // computers always roll their character's colours
  }
  slot.occupant.suspectId = suspectId;
}

export function addChat(
  room: Room,
  fromName: string,
  text: string,
  system = false,
  to?: string[],
  whisper = false,
): void {
  const clean = text.trim().slice(0, 300);
  if (!clean) return;
  room.chat.push({ id: room.nextChatId++, from: fromName, text: clean, system, to, whisper });
  if (room.chat.length > 500) room.chat.shift();
}

/** Show a transient italic "<name> is thinking…" line while a bot deliberates. Replaces any
 *  previous thinking line (only one shows at a time). */
export function setThinking(room: Room, name: string): void {
  clearThinking(room);
  const id = room.nextChatId++;
  room.thinkingId = id;
  room.chat.push({ id, from: '', text: `${name} is thinking…`, system: true });
}

/** Remove the transient thinking line (called right before a bot's real move is narrated). */
export function clearThinking(room: Room): void {
  if (room.thinkingId == null) return;
  const i = room.chat.findIndex((m) => m.id === room.thinkingId);
  if (i !== -1) room.chat.splice(i, 1);
  room.thinkingId = undefined;
}

/** Copy any new game-log entries into the chat as system narration, so the chat is the single
 *  chronological feed of game events interspersed with player messages. */
export function mirrorLog(room: Room): void {
  if (!room.game) return;
  for (const entry of room.game.log) {
    if (entry.id > room.mirroredLogId) {
      const card = entry.card;
      if (card?.kind === 'reveal' && card.cardId) {
        // Everyone sees a face-down reveal card; the two players in on it get the face-up version.
        const humans = room.slots.map((s) => s.occupant).filter((o) => o && !o.isBot).map((o) => o!.id);
        const insiders = [card.responderId, card.suggesterId];
        const outsiders = humans.filter((id) => !insiders.includes(id));
        room.chat.push({
          id: room.nextChatId++, from: '', text: entry.text, system: true, to: outsiders,
          card: { kind: 'reveal', responderId: card.responderId, suggesterId: card.suggesterId },
        });
        room.chat.push({ id: room.nextChatId++, from: '', text: entry.text, system: true, to: insiders, card });
      } else {
        room.chat.push({ id: room.nextChatId++, from: '', text: entry.text, system: true, card });
      }
      room.mirroredLogId = entry.id;
    }
  }
  while (room.chat.length > 500) room.chat.shift();
}

/** Mark a participant disconnected. The seat stays human and the game waits for them — only an
 *  explicit leave (botTakeover) or the host hands the seat to a bot. */
export function disconnectOccupant(id: string, botTakeover = false): Room | undefined {
  const room = findRoomByOccupant(id);
  if (!room) return undefined;
  const occ = room.slots.find((s) => s.occupant?.id === id)?.occupant;
  if (occ) {
    occ.connected = false;
    if (botTakeover) {
      occ.isBot = true;
      occ.difficulty = roomBotDifficulty(room);
    }
  }
  const gp = room.game?.players.find((p) => p.id === id);
  if (gp && !gp.eliminated) {
    gp.connected = false;
    if (botTakeover) {
      gp.isBot = true;
      gp.difficulty = roomBotDifficulty(room);
    }
  }
  return room;
}

/** Re-attach a returning participant to their seat. A seat the host already replaced with a bot
 *  stays a bot (isBot is left untouched). */
export function reconnectOccupant(id: string): Room | undefined {
  const room = findRoomByOccupant(id);
  if (!room) return undefined;
  const occ = room.slots.find((s) => s.occupant?.id === id)?.occupant;
  if (occ) occ.connected = true;
  const gp = room.game?.players.find((p) => p.id === id);
  if (gp) gp.connected = true;
  return room;
}

/** Host action: replace a human player with a bot so a stalled table can continue. */
export function bootPlayer(room: Room, requesterId: string, targetId: string): void {
  if (room.hostId !== requesterId) throw new Error('Only the host can replace a player.');
  if (targetId === room.hostId) throw new Error('The host cannot be replaced.');
  const occ = room.slots.find((s) => s.occupant?.id === targetId)?.occupant;
  if (!occ) throw new Error('That player is not in the game.');
  if (occ.isBot) throw new Error('That seat is already a bot.');
  occ.isBot = true;
  occ.connected = true;
  occ.difficulty = roomBotDifficulty(room);
  const gp = room.game?.players.find((p) => p.id === targetId);
  if (gp && !gp.eliminated) {
    gp.isBot = true;
    gp.connected = true;
    gp.difficulty = roomBotDifficulty(room);
  }
}

/** True if at least one human occupant is still connected. */
export function hasConnectedHuman(room: Room): boolean {
  return room.slots.some((s) => s.occupant && !s.occupant.isBot && s.occupant.connected);
}

export function deleteRoom(code: string): void {
  rooms.delete(code);
}

/** Remove a participant (on explicit leave). Migrates host or deletes the room if empty. */
export function removeOccupant(id: string): { room?: Room; deleted: boolean } {
  const room = findRoomByOccupant(id);
  if (!room) return { deleted: false };

  const slot = room.slots.find((s) => s.occupant?.id === id);
  if (slot) {
    if (room.isPublic && isPublicObserverSlot(room, slot)) {
      dropSlot(room, slot); // a watcher's extra seat goes away with them
    } else if (room.isPublic) {
      // Public seats never sit empty: hand it straight back to a computer.
      slot.status = 'bot';
      slot.occupant = botOccupant(room, slot.index);
    } else {
      slot.occupant = undefined; // their slot stays 'open'
    }
  }

  if (room.isPublic) {
    electHost(room); // the room lives on regardless — it is never deleted
    return { room, deleted: false };
  }

  if (room.hostId === id) {
    const nextHuman = room.slots.find((s) => s.occupant && !s.occupant.isBot);
    if (nextHuman?.occupant) {
      room.hostId = nextHuman.occupant.id;
    }
  }

  const anyHuman = room.slots.some((s) => s.occupant && !s.occupant.isBot);
  if (!anyHuman) {
    rooms.delete(room.code);
    return { room, deleted: true };
  }
  return { room, deleted: false };
}

export function toLobbyView(room: Room): LobbyView {
  const view: LobbyView = {
    code: room.code,
    hostId: room.hostId,
    slots: room.slots,
    phase: room.phase,
  };
  view.settings = room.settings ?? { botDifficulty: DEFAULT_BOT_DIFFICULTY };
  if (room.isPublic) {
    view.isPublic = true;
    view.startsAt = room.startsAt;
    view.serverNow = Date.now();
  }
  return view;
}

// ---- save / load ----------------------------------------------------------------------------

/** A plain, JSON-serializable snapshot of everything needed to resume a room. */
export function serializeRoom(room: Room): unknown {
  return structuredClone({
    v: 1,
    code: room.code,
    hostId: room.hostId,
    slots: room.slots,
    chat: room.chat,
    phase: room.phase,
    game: room.game,
    nextChatId: room.nextChatId,
    mirroredLogId: room.mirroredLogId,
    suggestionLog: room.suggestionLog ?? [], // bot deductions survive a save/load
    notes: room.notes ?? {}, // every player's notes, so any save carries them all
    settings: room.settings,
  });
}

/** Rewrite every reference to a player id within a snapshot (slots + game state + notes). */
function remapId(saved: Room, oldId: string, newId: string): void {
  if (oldId === newId) return;
  for (const slot of saved.slots) if (slot.occupant?.id === oldId) slot.occupant.id = newId;
  if (saved.hostId === oldId) saved.hostId = newId;
  if (saved.notes && saved.notes[oldId] !== undefined) {
    saved.notes[newId] = saved.notes[oldId]; // notes follow the seat to its new owner
    delete saved.notes[oldId];
  }
  const g = saved.game;
  if (!g) return;
  g.turnOrder = g.turnOrder.map((id) => (id === oldId ? newId : id));
  for (const p of g.players) if (p.id === oldId) p.id = newId;
  if (g.winnerId === oldId) g.winnerId = newId;
  const sg = g.currentSuggestion;
  if (sg) {
    if (sg.suggesterId === oldId) sg.suggesterId = newId;
    if (sg.pendingResponderId === oldId) sg.pendingResponderId = newId;
    if (sg.responderId === oldId) sg.responderId = newId;
    sg.queue = sg.queue.map((id) => (id === oldId ? newId : id));
    sg.passes = sg.passes.map((id) => (id === oldId ? newId : id));
  }
  for (const e of saved.suggestionLog ?? []) {
    if (e.suggesterId === oldId) e.suggesterId = newId;
    if (e.responderId === oldId) e.responderId = newId;
    e.passers = e.passers.map((id) => (id === oldId ? newId : id));
  }
}

/** Restore a saved snapshot as a fresh room. The loader takes over the original host's seat; every
 *  other human becomes a connected bot so the table can run until they (optionally) rejoin. */
export function loadRoom(blob: unknown, loaderId: string, loaderName: string): Room {
  const saved = structuredClone(blob) as Partial<Room> & { game?: GameState };
  if (!saved || typeof saved !== 'object' || !saved.game || !Array.isArray(saved.slots)) {
    throw new Error('That save file is not a valid game.');
  }
  const room: Room = {
    code: genCode(),
    hostId: saved.hostId ?? '',
    slots: saved.slots,
    chat: saved.chat ?? [],
    phase: 'play',
    game: saved.game,
    nextChatId: saved.nextChatId ?? 1,
    mirroredLogId: saved.mirroredLogId ?? 0,
    suggestionLog: saved.suggestionLog ?? [],
    notes: saved.notes ?? {}, // restore everyone's Detective Notes from the snapshot
    settings: saved.settings ?? { botDifficulty: DEFAULT_BOT_DIFFICULTY },
  };
  room.game!.code = room.code;

  // Every seat starts as a connected bot and the game is paused: the loader (and anyone who rejoins
  // by the room code) then picks which player to take over from the seat picker. Free the loader's
  // own id so they can claim any seat — including their own — without a collision.
  const usesLoaderId =
    room.game!.players.some((p) => p.id === loaderId) || room.slots.some((s) => s.occupant?.id === loaderId);
  if (usesLoaderId) remapId(room, loaderId, `loadbot-${room.code}-self`);
  room.hostId = loaderId; // the loader owns the loaded room; they become a player once they pick a seat
  room.paused = true;
  void loaderName;

  // Every seat that maps to a dealt player becomes a takeable bot named after its character — so the
  // seat picker shows "Madame Violet", never the name of a human who saved/observed that seat and
  // isn't really there. Observer/stray seats (not among the dealt players) are dropped entirely.
  const playerById = new Map(room.game!.players.map((p) => [p.id, p]));
  const suspectTitle = (id?: string) => SUSPECTS.find((s) => s.id === id)?.title;
  for (const slot of room.slots) {
    const occ = slot.occupant;
    if (!occ) continue;
    const gp = playerById.get(occ.id);
    if (!gp) {
      slot.occupant = undefined;
      slot.status = 'open';
      continue;
    }
    occ.isBot = true;
    occ.connected = true;
    occ.observer = false;
    occ.suspectId = gp.suspectId;
    occ.name = suspectTitle(gp.suspectId) ?? `Computer ${slot.index + 1}`;
    occ.difficulty = occ.difficulty ?? roomBotDifficulty(room);
  }
  for (const p of room.game!.players) {
    p.isBot = true;
    p.connected = true;
    p.isHost = false;
    p.name = suspectTitle(p.suspectId) ?? p.name;
    p.difficulty = p.difficulty ?? roomBotDifficulty(room);
  }

  rooms.set(room.code, room);
  return room;
}

/** A player explicitly leaves an in-progress game. Their seat is handed to a bot under a *fresh*
 *  id so the player's own id is fully detached from the room — otherwise they'd be silently pulled
 *  back in (findRoomByOccupant would still match) and a refresh would auto-rejoin. */
export function leaveGameAsBot(room: Room, clientId: string): void {
  const slot = room.slots.find((s) => s.occupant?.id === clientId);
  if (!slot?.occupant) return;
  const wasHost = room.hostId === clientId;
  const botId = `left-${room.code}-${slot.index}`;
  remapId(room, clientId, botId);
  const occ = room.slots.find((s) => s.occupant?.id === botId)?.occupant;
  if (occ) {
    occ.isBot = true;
    occ.connected = true;
    occ.difficulty = roomBotDifficulty(room);
  }
  const gp = room.game?.players.find((p) => p.id === botId);
  if (gp) {
    gp.isBot = true;
    gp.connected = true;
    gp.isHost = false;
    gp.difficulty = roomBotDifficulty(room);
  }
  // A public observer seat was appended past the table size just for them — drop it again so the
  // seat list doesn't fill with ghost observers. (Player seats stay: the bot finishes their game.)
  if (room.isPublic && occ?.observer) {
    room.slots = room.slots.filter((s) => s !== slot);
    room.slots.forEach((s, i) => (s.index = i));
  }
  // If the host left, hand the title to a remaining human (if any).
  if (wasHost) {
    if (room.isPublic) {
      electHost(room);
    } else {
      const human = room.slots.find((s) => s.occupant && !s.occupant.isBot);
      if (human?.occupant) {
        room.hostId = human.occupant.id;
        if (room.game) for (const p of room.game.players) p.isHost = p.id === room.hostId;
      }
    }
  }
}

/** A player joining an in-progress (loaded) game takes over a bot/empty seat, inheriting that
 *  character and its hand. The seat must currently be a bot (or empty). */
export function takeSeat(room: Room, joinerId: string, name: string, index: number): void {
  if (room.phase !== 'play') throw new Error('That game is not in progress.');
  const slot = room.slots[index];
  if (!slot?.occupant) throw new Error('That seat is empty.');
  if (!slot.occupant.isBot) throw new Error('That seat is taken by a connected player.');
  if (room.slots.some((s) => s.occupant?.id === joinerId)) throw new Error('You already hold a seat.');
  remapId(room, slot.occupant.id, joinerId);
  const occ = room.slots.find((s) => s.occupant?.id === joinerId)?.occupant;
  if (occ) {
    occ.isBot = false;
    occ.connected = true;
    occ.name = name.trim() || occ.name;
    occ.joinedAt = Date.now();
    occ.difficulty = undefined;
  }
  if (room.isPublic) electHost(room); // an empty public table makes its first human the host
  const gp = room.game?.players.find((p) => p.id === joinerId);
  if (gp) {
    gp.isBot = false;
    gp.connected = true;
    gp.isHost = joinerId === room.hostId;
    gp.difficulty = undefined;
    if (name.trim()) gp.name = name.trim();
    // A seat inherits its character's dice; a returning human's own choice comes via SET_DICE.
  }
}

/** Join an in-progress game to watch only. The observer occupies a free seat but isn't a dealt
 *  player (it's flagged observer, so they get no piece, hand, notes, or private reveals); they
 *  receive game broadcasts like any other seat-holder. */
export function joinAsObserver(room: Room, joinerId: string, name: string): void {
  if (room.phase !== 'play') throw new Error('That game is not in progress.');
  if (room.slots.some((s) => s.occupant?.id === joinerId)) throw new Error('You are already in this game.');
  let slot = room.slots.find((s) => !s.occupant);
  if (!slot) {
    // The public table is always full, so observers get an extra seat appended past it.
    if (!room.isPublic) throw new Error('This game is full — there is no free seat to observe from.');
    slot = { index: room.slots.length, status: 'open' };
    room.slots.push(slot);
  }
  slot.status = 'open';
  slot.occupant = {
    id: joinerId,
    name: name.trim() || 'Observer',
    isBot: false,
    connected: true,
    observer: true,
    joinedAt: Date.now(),
  };
  if (room.isPublic) electHost(room);
}

/** Build the engine GameState from the lobby roster, assigning suspects to anyone without one.
 *  `force` is for the public room's clock, which starts the game with no host at all. */
export function startGameInRoom(room: Room, requesterId: string, opts: { force?: boolean } = {}): GameState {
  if (!opts.force && room.hostId !== requesterId) throw new Error('Only the host can start the game.');
  if (room.isPublic && !opts.force) throw new Error('The public game starts when the clock runs out.');
  if (room.phase !== 'lobby') throw new Error('The game has already started.');

  if (room.isPublic) {
    // Nobody may stall a public table: a human who dropped before the clock ran out is replaced by
    // a computer (keeping the seat's character). If they come back they can take any seat over.
    for (const s of room.slots) {
      const o = s.occupant;
      if (o && !o.isBot && !o.connected) {
        s.status = 'bot';
        s.occupant = { ...botOccupant(room, s.index), suspectId: o.suspectId };
      }
    }
    electHost(room);
  }

  // Observers stay in the room to watch but aren't dealt in — only the rest become players.
  const occupants = room.slots
    .map((s) => s.occupant)
    .filter((o): o is NonNullable<typeof o> => o != null && !o.observer);
  if (occupants.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players to start.`);

  const rng = makeRng(Math.floor(Math.random() * 0x7fffffff) + 1);
  const taken = new Set(occupants.map((o) => o.suspectId).filter((x): x is string => !!x));
  const freeSuspects = shuffle(
    SUSPECTS.filter((s) => !taken.has(s.id)).map((s) => s.id),
    rng,
  );
  let next = 0;

  const players: Player[] = occupants.map((o) => {
    const suspectId = o.suspectId ?? freeSuspects[next++];
    // Bots play (and are named after) a random suspect not claimed by a human, e.g. "Miss Coral".
    const name = o.isBot ? SUSPECTS.find((s) => s.id === suspectId)?.title ?? o.name : o.name;
    if (o.isBot) o.name = name; // so the seat picker / chat call the seat by its character too
    return {
      id: o.id,
      name,
      suspectId,
      isBot: o.isBot,
      isHost: o.id === room.hostId,
      connected: o.connected,
      dice: o.dice ?? defaultDice(suspectId),
      difficulty: o.isBot ? (o.difficulty ?? roomBotDifficulty(room)) : undefined,
      hand: [],
      eliminated: false,
      position: { x: 0, y: 0 }, // real start tile assigned inside startGame()
    };
  });

  const game = startGame(room.code, players, rng);
  room.game = game;
  room.phase = 'play';
  return game;
}
