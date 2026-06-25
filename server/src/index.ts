import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  SOCKET_EVENTS,
  viewFor,
  makeRng,
  currentPlayerId,
  getPlayer,
  rollAndMove,
  moveTo,
  chooseFloor,
  elevatorOptions,
  takeShortcut,
  skipMovement,
  makeSuggestion,
  respondToSuggestion,
  passSuggestion,
  makeAccusation,
  endTurn,
  passTurn,
  activeReachable,
  botAccusation,
  botSuggestion,
  botRevealCard,
  botMoveTarget,
  botShouldStay,
  type GameState,
  type CreateGamePayload,
  type JoinGamePayload,
  type LobbyChatPayload,
  type MoveToPayload,
  type ChooseFloorPayload,
  type MakeSuggestionPayload,
  type RevealCardPayload,
  type MakeAccusationPayload,
  type PickSuspectPayload,
  type SetSlotPayload,
  type RejoinPayload,
  type BootPlayerPayload,
  type LoadGamePayload,
  type SaveGameDataPayload,
} from 'shared';
import {
  type Room,
  addChat,
  mirrorLog,
  setThinking,
  clearThinking,
  createRoom,
  findRoomByOccupant,
  joinRoom,
  pickSuspect,
  removeOccupant,
  disconnectOccupant,
  reconnectOccupant,
  hasConnectedHuman,
  deleteRoom,
  setSlot,
  bootPlayer,
  leaveGameAsBot,
  serializeRoom,
  loadRoom,
  startGameInRoom,
  toLobbyView,
} from './rooms';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

const clientDist = path.resolve(__dirname, '../../client/dist');
const serveClient = fs.existsSync(path.join(clientDist, 'index.html'));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: serveClient ? undefined : { origin: true, credentials: true },
});

function emitLobby(room: Room): void {
  io.to(room.code).emit(SOCKET_EVENTS.LOBBY, { lobby: toLobbyView(room) });
}

function emitChat(room: Room): void {
  io.to(room.code).emit(SOCKET_EVENTS.CHAT, { chat: room.chat });
}

// Last round number we auto-saved per room, so we save once per completed round.
const autoSaveRound = new Map<string, number>();
function buildSave(room: Room, auto: boolean): SaveGameDataPayload {
  return {
    meta: {
      savedAt: Date.now(),
      round: room.game?.round ?? 0,
      players: room.slots.filter((s) => s.occupant).length,
      auto,
    },
    blob: serializeRoom(room),
  };
}
/** Auto-save (to every human's browser) once per completed round of play. */
function maybeAutoSave(room: Room): void {
  const g = room.game;
  if (!g || g.phase !== 'play') return;
  const round = g.round ?? 0;
  if (round > (autoSaveRound.get(room.code) ?? 0)) {
    autoSaveRound.set(room.code, round);
    io.to(room.code).emit(SOCKET_EVENTS.SAVE_GAME_DATA, buildSave(room, true));
  }
}

const RNG = makeRng(Math.floor(Math.random() * 0x7fffffff) + 1);

// Pace every bot action ~10s apart so human players can read pop-ups and digest each move. While a
// bot is on the clock the chat shows a transient "<bot> is thinking…" line.
const BOT_DELAY = 10000;

// Per-room bot memory: cards each bot has seen revealed, rooms it has suggested in, and — keyed by
// `${responderId}|${recipientId}` — which of its own cards it has already shown to each player.
const botMem = new Map<
  string,
  { reveals: Map<string, Set<string>>; visited: Map<string, Set<string>>; shown: Map<string, Set<string>> }
>();
function memFor(room: Room) {
  let m = botMem.get(room.code);
  if (!m) {
    m = { reveals: new Map(), visited: new Map(), shown: new Map() };
    botMem.set(room.code, m);
  }
  return m;
}
/** Cards a bot knows are not in the envelope: its own hand plus everything revealed to it. */
function ruledOutFor(g: GameState, botId: string, room: Room): Set<string> {
  const hand = getPlayer(g, botId)?.hand ?? [];
  return new Set([...hand, ...(memFor(room).reveals.get(botId) ?? [])]);
}
/** Record a card a bot saw, once a suggestion it made is disproven. */
function recordReveals(room: Room): void {
  const g = room.game;
  const sg = g?.currentSuggestion;
  if (!g || !sg?.resolved || !sg.anyRevealed || !sg.revealedCardId) return;
  if (!getPlayer(g, sg.suggesterId)?.isBot) return;
  const set = memFor(room).reveals.get(sg.suggesterId) ?? new Set<string>();
  set.add(sg.revealedCardId);
  memFor(room).reveals.set(sg.suggesterId, set);
}

/** Push each human their own tailored game view. */
function broadcastGame(room: Room): void {
  const g = room.game;
  if (!g) return;
  for (const slot of room.slots) {
    const occ = slot.occupant;
    if (occ && !occ.isBot) io.to(occ.id).emit(SOCKET_EVENTS.GAME_STARTED, { view: viewFor(g, occ.id) });
  }
}

/** Run an in-game turn intent for the requesting socket, with error reporting. */
function withGame(socket: Socket, fn: (room: Room, g: GameState) => GameState): void {
  // Rooms/players are keyed by the stable clientId (not socket.id), so resolve through cid().
  const room = findRoomByOccupant(cid(socket));
  if (!room?.game || room.game.phase !== 'play') return;
  try {
    room.game = fn(room, room.game);
    progress(room);
  } catch (err) {
    emitError(socket, (err as Error).message);
  }
}

/** Broadcast, then advance the world: a bot auto-reveals if it must disprove a suggestion;
 *  otherwise a bot takes its turn if it's up. Humans pending a reveal just wait for their click. */
function progress(room: Room): void {
  const g = room.game;
  if (!g) return;
  recordReveals(room); // bots remember what their suggestions surfaced
  mirrorLog(room); // fold new game events into the chat feed
  broadcastGame(room);
  emitChat(room);
  maybeAutoSave(room); // snapshot to browsers after each completed round
  if (g.phase !== 'play') return;

  const sg = g.currentSuggestion;
  if (sg && !sg.resolved && sg.pendingResponderId) {
    const responder = getPlayer(g, sg.pendingResponderId);
    if (responder?.isBot) scheduleBotReveal(room, responder.id);
    return; // waiting on a reveal
  }
  scheduleBots(room);
}

/** A bot responding to a suggestion "thinks" for a beat, then reveals a matching card — or, if it
 *  holds none, passes ("cannot disprove it"). Either way it spends the same time deliberating. */
function scheduleBotReveal(room: Room, botId: string): void {
  const g = room.game;
  if (g) {
    setThinking(room, getPlayer(g, botId)?.name ?? 'Someone');
    emitChat(room);
  }
  setTimeout(() => {
    const s = room.game;
    clearThinking(room);
    if (!s || s.phase !== 'play') return;
    const sg = s.currentSuggestion;
    if (!sg || sg.resolved || sg.pendingResponderId !== botId) return;
    const trio = [sg.suspectId, sg.weaponId, sg.roomId];
    const matches = (getPlayer(s, botId)?.hand ?? []).filter((c) => trio.includes(c));
    try {
      if (matches.length === 0) {
        room.game = passSuggestion(s, botId, RNG);
      } else {
        const mem = memFor(room);
        const shownKey = `${botId}|${sg.suggesterId}`;
        const shownToSuggester = mem.shown.get(shownKey) ?? new Set<string>();
        // how many distinct players have already seen each card from this bot
        const exposure = new Map<string, number>();
        for (const [k, cards] of mem.shown) {
          if (!k.startsWith(`${botId}|`)) continue;
          for (const c of cards) exposure.set(c, (exposure.get(c) ?? 0) + 1);
        }
        const card = botRevealCard(matches, shownToSuggester, exposure, RNG);
        shownToSuggester.add(card);
        mem.shown.set(shownKey, shownToSuggester);
        room.game = respondToSuggestion(s, botId, card, RNG);
      }
      progress(room);
    } catch {
      /* ignore */
    }
  }, BOT_DELAY);
}

/** A bot's turn: deduce, move toward a useful room, suggest, and accuse when confident. */
function scheduleBots(room: Room): void {
  const g = room.game;
  if (!g || g.phase !== 'play') return;
  const cur = getPlayer(g, currentPlayerId(g));
  if (!cur || !cur.isBot || cur.eliminated) return;

  // --- movement phase ---
  setThinking(room, cur.name);
  emitChat(room);
  setTimeout(() => {
    clearThinking(room);
    let s = room.game;
    // re-check isBot: a dropped player may have reconnected and reclaimed human control.
    if (!s || s.phase !== 'play' || currentPlayerId(s) !== cur.id || !getPlayer(s, cur.id)?.isBot) {
      emitChat(room);
      return;
    }
    try {
      const ruled = ruledOutFor(s, cur.id, room);
      for (let step = 0; step < 4; step++) {
        if (s.turnPhase === 'awaitRoll') {
          const me = getPlayer(s, cur.id);
          const visited = memFor(room).visited.get(cur.id) ?? new Set<string>();
          s = botShouldStay(me?.inRoomId, ruled, visited) ? skipMovement(s, cur.id) : rollAndMove(s, cur.id, RNG);
        } else if (s.turnPhase === 'awaitMove') {
          const dest = botMoveTarget(activeReachable(s), ruled, RNG);
          if (!dest) break;
          s = moveTo(s, cur.id, dest);
        } else if (s.turnPhase === 'awaitElevator' && s.elevatorRide) {
          const opts = elevatorOptions(s.elevatorRide.fromFloor);
          s = chooseFloor(s, cur.id, opts[Math.floor(RNG() * opts.length)], RNG);
        } else {
          break;
        }
      }
      room.game = s;
      mirrorLog(room);
      broadcastGame(room);
      emitChat(room);
    } catch {
      /* fall through to the decision phase */
    }

    // --- decision phase: accuse if certain, else suggest from a room, else end ---
    setThinking(room, cur.name);
    emitChat(room);
    setTimeout(() => {
      clearThinking(room);
      let s2 = room.game;
      if (!s2 || s2.phase !== 'play' || currentPlayerId(s2) !== cur.id || !getPlayer(s2, cur.id)?.isBot) {
        emitChat(room);
        return;
      }
      try {
        const ruled = ruledOutFor(s2, cur.id, room);
        const me = getPlayer(s2, cur.id);

        if (s2.turnPhase === 'postMove') {
          const accusation = botAccusation(ruled);
          if (accusation) {
            s2 = makeAccusation(s2, cur.id, accusation.suspectId, accusation.weaponId, accusation.roomId, RNG).state;
            room.game = s2;
            progress(room);
            return;
          }
          if (me?.inRoomId) {
            const sugg = botSuggestion(ruled, me.hand, me.inRoomId, RNG);
            const visited = memFor(room).visited.get(cur.id) ?? new Set<string>();
            visited.add(me.inRoomId);
            memFor(room).visited.set(cur.id, visited);
            s2 = makeSuggestion(s2, cur.id, sugg.suspectId, sugg.weaponId, me.inRoomId, RNG);
            room.game = s2;
            progress(room);
            return;
          }
        }
        s2 = s2.turnPhase === 'postMove' ? endTurn(s2, cur.id, RNG) : passTurn(s2, cur.id, RNG);
        room.game = s2;
        progress(room);
      } catch {
        // Last resort: never strand the table — pass the turn.
        const s3 = room.game;
        if (s3 && s3.phase === 'play' && currentPlayerId(s3) === cur.id) {
          try {
            room.game = passTurn(s3, cur.id, RNG);
            progress(room);
          } catch {
            /* ignore */
          }
        }
      }
    }, BOT_DELAY);
  }, BOT_DELAY);
}

function emitError(socket: Socket, message: string): void {
  socket.emit(SOCKET_EVENTS.ERROR, { message });
}

// Player identity is a stable clientId (from localStorage), not the socket id — so a refresh keeps
// the seat. This maps each live socket to its clientId; each socket also joins a room named by its
// clientId so per-player views can be addressed across reconnects.
const socketClient = new Map<string, string>();
const cid = (socket: Socket): string => socketClient.get(socket.id) ?? socket.id;

const roomCleanup = new Map<string, NodeJS.Timeout>();
const CLEANUP_MS = 3 * 60 * 1000;
function cancelCleanup(code: string): void {
  const t = roomCleanup.get(code);
  if (t) {
    clearTimeout(t);
    roomCleanup.delete(code);
  }
}
function scheduleCleanupIfEmpty(room: Room): void {
  if (hasConnectedHuman(room)) {
    cancelCleanup(room.code);
    return;
  }
  cancelCleanup(room.code);
  roomCleanup.set(
    room.code,
    setTimeout(() => {
      deleteRoom(room.code);
      botMem.delete(room.code);
      roomCleanup.delete(room.code);
    }, CLEANUP_MS),
  );
}

/** Display name of a socket within its room (for chat / logs). */
function nameOf(room: Room, id: string): string {
  return room.slots.find((s) => s.occupant?.id === id)?.occupant?.name ?? 'Someone';
}

io.on('connection', (socket) => {
  const register = (clientId: string) => {
    socketClient.set(socket.id, clientId);
    socket.join(clientId); // per-player address that survives reconnects
    socket.emit(SOCKET_EVENTS.YOU_ARE, { id: clientId });
  };

  socket.on(SOCKET_EVENTS.CREATE_GAME, (p: CreateGamePayload) => {
    try {
      const clientId = p?.clientId || socket.id;
      register(clientId);
      const room = createRoom(clientId, p?.name ?? '');
      socket.join(room.code);
      emitLobby(room);
      emitChat(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.JOIN_GAME, (p: JoinGamePayload) => {
    try {
      const clientId = p?.clientId || socket.id;
      register(clientId);
      const { room } = joinRoom(p?.code ?? '', clientId, p?.name ?? '');
      socket.join(room.code);
      cancelCleanup(room.code);
      addChat(room, 'System', `${nameOf(room, clientId)} joined the game.`, true);
      emitLobby(room);
      emitChat(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.REJOIN, (p: RejoinPayload) => {
    const clientId = p?.clientId;
    const room = clientId ? findRoomByOccupant(clientId) : undefined;
    if (!clientId || !room) {
      socket.emit(SOCKET_EVENTS.REJOIN_FAILED);
      return;
    }
    register(clientId);
    socket.join(room.code);
    cancelCleanup(room.code);
    reconnectOccupant(clientId);
    addChat(room, 'System', `${nameOf(room, clientId)} reconnected.`, true);
    emitLobby(room);
    emitChat(room);
    if (room.game) socket.emit(SOCKET_EVENTS.GAME_STARTED, { view: viewFor(room.game, clientId) });
  });

  socket.on(SOCKET_EVENTS.SET_SLOT, (p: SetSlotPayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room) return;
    try {
      setSlot(room, cid(socket), p.index, p.status);
      emitLobby(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.PICK_SUSPECT, (p: PickSuspectPayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room) return;
    try {
      pickSuspect(room, cid(socket), p.suspectId);
      emitLobby(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.LOBBY_CHAT, (p: LobbyChatPayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room) return;
    addChat(room, nameOf(room, cid(socket)), p?.text ?? '');
    emitChat(room);
  });

  socket.on(SOCKET_EVENTS.START_GAME, () => {
    const room = findRoomByOccupant(cid(socket));
    if (!room) return;
    try {
      botMem.delete(room.code); // fresh deductions for a new game
      startGameInRoom(room, cid(socket));
      emitLobby(room); // phase is now 'play'
      mirrorLog(room); // seed the chat with the opening game-log lines
      emitChat(room); // so the in-game chat panel carries the lobby history
      broadcastGame(room); // each human their own tailored view
      scheduleBots(room); // in case the first player is a bot
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.ROLL_MOVE, () => withGame(socket, (_room, g) => rollAndMove(g, cid(socket), RNG)));
  socket.on(SOCKET_EVENTS.MOVE_TO, (p: MoveToPayload) => withGame(socket, (_room, g) => moveTo(g, cid(socket), p.tile)));
  socket.on(SOCKET_EVENTS.CHOOSE_FLOOR, (p: ChooseFloorPayload) =>
    withGame(socket, (_room, g) => chooseFloor(g, cid(socket), p.floor, RNG)),
  );
  socket.on(SOCKET_EVENTS.TAKE_SHORTCUT, () => withGame(socket, (_room, g) => takeShortcut(g, cid(socket))));
  socket.on(SOCKET_EVENTS.SKIP_MOVE, () => withGame(socket, (_room, g) => skipMovement(g, cid(socket))));
  socket.on(SOCKET_EVENTS.END_TURN, () => withGame(socket, (_room, g) => endTurn(g, cid(socket), RNG)));

  socket.on(SOCKET_EVENTS.MAKE_SUGGESTION, (p: MakeSuggestionPayload) =>
    withGame(socket, (_room, g) => {
      const me = getPlayer(g, cid(socket));
      if (currentPlayerId(g) !== cid(socket)) throw new Error('Not your turn.');
      if (g.turnPhase !== 'postMove') throw new Error('You can only suggest after the movement phase.');
      if (!me?.inRoomId) throw new Error('You must be in a room to make a suggestion.');
      return makeSuggestion(g, cid(socket), p.suspectId, p.weaponId, me.inRoomId, RNG);
    }),
  );
  socket.on(SOCKET_EVENTS.REVEAL_CARD, (p: RevealCardPayload) =>
    withGame(socket, (_room, g) => respondToSuggestion(g, cid(socket), p.cardId, RNG)),
  );
  socket.on(SOCKET_EVENTS.PASS_SUGGESTION, () =>
    withGame(socket, (_room, g) => passSuggestion(g, cid(socket), RNG)),
  );
  socket.on(SOCKET_EVENTS.MAKE_ACCUSATION, (p: MakeAccusationPayload) =>
    withGame(socket, (_room, g) => {
      if (currentPlayerId(g) !== cid(socket)) throw new Error('Not your turn.');
      if (g.turnPhase !== 'postMove') throw new Error('You can only accuse after the movement phase.');
      return makeAccusation(g, cid(socket), p.suspectId, p.weaponId, p.roomId, RNG).state;
    }),
  );

  socket.on(SOCKET_EVENTS.BOOT_PLAYER, (p: BootPlayerPayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room) return;
    try {
      const name = room.game?.players.find((pl) => pl.id === p.targetId)?.name ?? nameOf(room, p.targetId);
      bootPlayer(room, cid(socket), p.targetId);
      addChat(room, 'System', `The host replaced ${name} with a bot.`, true);
      emitLobby(room);
      if (room.game) progress(room); // resume play — the bot acts if it's that seat's turn / owed reveal
      else emitChat(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.SAVE_GAME, () => {
    const room = findRoomByOccupant(cid(socket));
    if (!room?.game) return;
    socket.emit(SOCKET_EVENTS.SAVE_GAME_DATA, buildSave(room, false));
  });

  socket.on(SOCKET_EVENTS.LOAD_GAME, (p: LoadGamePayload) => {
    try {
      const clientId = p?.clientId || socket.id;
      register(clientId);
      const room = loadRoom(p.blob, clientId, p?.name ?? '');
      botMem.delete(room.code); // fresh bot deductions for the resumed game
      autoSaveRound.set(room.code, room.game?.round ?? 0);
      socket.join(room.code);
      cancelCleanup(room.code);
      addChat(room, 'System', `${nameOf(room, clientId)} loaded a saved game.`, true);
      emitLobby(room);
      progress(room); // broadcast the resumed view and let any up-next bot act
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.LEAVE, () => {
    const clientId = cid(socket);
    socketClient.delete(socket.id);
    // Drop out of every socket.io room so this socket stops receiving the game's broadcasts (which
    // would otherwise re-save the room and bounce the player back into the game).
    [...socket.rooms].forEach((r) => r !== socket.id && socket.leave(r));
    const room = findRoomByOccupant(clientId);
    if (!room) return;
    if (room.game) {
      // Leaving mid-game is intentional: detach the player's id and let a bot finish their seat.
      const name = nameOf(room, clientId);
      leaveGameAsBot(room, clientId);
      addChat(room, 'System', `${name} left — a bot is finishing their game.`, true);
      emitLobby(room);
      broadcastGame(room);
      emitChat(room);
      scheduleBots(room);
      scheduleCleanupIfEmpty(room);
    } else {
      const { deleted } = removeOccupant(clientId);
      if (!deleted) emitLobby(room);
    }
  });

  socket.on('disconnect', () => {
    const clientId = socketClient.get(socket.id);
    socketClient.delete(socket.id);
    if (!clientId) return;
    if ([...socketClient.values()].includes(clientId)) return; // another tab still open
    const room = disconnectOccupant(clientId); // stays human — the table waits for them to return
    if (!room) return;
    addChat(room, 'System', `${nameOf(room, clientId)} disconnected — the game waits for them to return.`, true);
    emitLobby(room);
    emitChat(room);
    if (room.game) {
      broadcastGame(room);
      scheduleBots(room); // resume any *other* bot whose turn it is; the dropped human is not botted
    }
    scheduleCleanupIfEmpty(room);
  });
});

if (serveClient) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res.send('Ultra Clue server is running (dev mode). The client lives on the Vite dev server.'),
  );
}

httpServer.listen(PORT, () => {
  console.log(
    `Ultra Clue server listening on :${PORT}  (${serveClient ? 'serving built client' : 'dev / API only'})`,
  );
});
