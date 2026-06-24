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

export function addChat(room: Room, fromName: string, text: string, system = false): void {
  const clean = text.trim().slice(0, 300);
  if (!clean) return;
  room.chat.push({ id: room.nextChatId++, from: fromName, text: clean, system });
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

/** Build the engine GameState from the lobby roster, assigning suspects to anyone without one. */
export function startGameInRoom(room: Room, requesterId: string): GameState {
  if (room.hostId !== requesterId) throw new Error('Only the host can start the game.');
  if (room.phase !== 'lobby') throw new Error('The game has already started.');

  const occupants = room.slots.map((s) => s.occupant).filter((o) => o != null);
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
