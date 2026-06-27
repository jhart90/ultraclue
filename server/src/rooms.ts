import {
  SUSPECTS,
  startGame,
  makeRng,
  shuffle,
  MAX_PLAYERS,
  MIN_PLAYERS,
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
  const slot = room.slots[index];
  if (!slot) throw new Error('Invalid slot.');
  if (slot.occupant?.id === room.hostId) throw new Error('The host slot cannot be changed.');
  // A connected human may not be evicted; a disconnected one (or a bot) can be.
  if (slot.occupant && !slot.occupant.isBot && slot.occupant.connected) {
    throw new Error('A player is sitting in that slot.');
  }

  if (status === 'bot') {
    slot.status = 'bot';
    slot.occupant = {
      id: `bot-${room.code}-${index}`,
      name: `Computer ${index + 1}`,
      isBot: true,
      connected: true,
      suspectId: randomFreeSuspect(room.slots),
    };
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
  slot.occupant.observer = observer;
}

export function pickSuspect(room: Room, id: string, suspectId: string): void {
  if (room.phase !== 'lobby') throw new Error('The game has already started.');
  if (!SUSPECTS.some((s) => s.id === suspectId)) throw new Error('Unknown character.');
  const takenByOther = room.slots.some(
    (s) => s.occupant && s.occupant.id !== id && s.occupant.suspectId === suspectId,
  );
  if (takenByOther) throw new Error('That character is already taken.');
  const slot = room.slots.find((s) => s.occupant?.id === id);
  if (!slot?.occupant) throw new Error('You are not in this game.');
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
      room.chat.push({ id: room.nextChatId++, from: '', text: entry.text, system: true });
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
    if (botTakeover) occ.isBot = true;
  }
  const gp = room.game?.players.find((p) => p.id === id);
  if (gp && !gp.eliminated) {
    gp.connected = false;
    if (botTakeover) gp.isBot = true;
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
  const gp = room.game?.players.find((p) => p.id === targetId);
  if (gp && !gp.eliminated) {
    gp.isBot = true;
    gp.connected = true;
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
  if (slot) slot.occupant = undefined; // their slot stays 'open'

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
  return {
    code: room.code,
    hostId: room.hostId,
    slots: room.slots,
    phase: room.phase,
  };
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

  // Only seats that map to a dealt player become takeable bots; observer/stray seats from the save
  // are dropped (a loaded game has no observers — anyone can take a player seat or just watch).
  const playerIds = new Set(room.game!.players.map((p) => p.id));
  for (const slot of room.slots) {
    if (!slot.occupant) continue;
    if (!playerIds.has(slot.occupant.id)) {
      slot.occupant = undefined;
      slot.status = 'open';
      continue;
    }
    slot.occupant.isBot = true;
    slot.occupant.connected = true;
    slot.occupant.observer = false;
  }
  for (const p of room.game!.players) {
    p.isBot = true;
    p.connected = true;
    p.isHost = false;
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
  }
  const gp = room.game?.players.find((p) => p.id === botId);
  if (gp) {
    gp.isBot = true;
    gp.connected = true;
    gp.isHost = false;
  }
  // If the host left, hand the title to a remaining human (if any).
  if (wasHost) {
    const human = room.slots.find((s) => s.occupant && !s.occupant.isBot);
    if (human?.occupant) {
      room.hostId = human.occupant.id;
      if (room.game) for (const p of room.game.players) p.isHost = p.id === room.hostId;
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
  }
  const gp = room.game?.players.find((p) => p.id === joinerId);
  if (gp) {
    gp.isBot = false;
    gp.connected = true;
    gp.isHost = joinerId === room.hostId;
    if (name.trim()) gp.name = name.trim();
  }
}

/** Join an in-progress game to watch only. The observer occupies a free seat but isn't a dealt
 *  player (it's flagged observer, so they get no piece, hand, notes, or private reveals); they
 *  receive game broadcasts like any other seat-holder. */
export function joinAsObserver(room: Room, joinerId: string, name: string): void {
  if (room.phase !== 'play') throw new Error('That game is not in progress.');
  if (room.slots.some((s) => s.occupant?.id === joinerId)) throw new Error('You are already in this game.');
  const slot = room.slots.find((s) => !s.occupant);
  if (!slot) throw new Error('This game is full — there is no free seat to observe from.');
  slot.status = 'open';
  slot.occupant = {
    id: joinerId,
    name: name.trim() || 'Observer',
    isBot: false,
    connected: true,
    observer: true,
  };
}

/** Build the engine GameState from the lobby roster, assigning suspects to anyone without one. */
export function startGameInRoom(room: Room, requesterId: string): GameState {
  if (room.hostId !== requesterId) throw new Error('Only the host can start the game.');
  if (room.phase !== 'lobby') throw new Error('The game has already started.');

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
    return {
      id: o.id,
      name,
      suspectId,
      isBot: o.isBot,
      isHost: o.id === room.hostId,
      connected: o.connected,
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
