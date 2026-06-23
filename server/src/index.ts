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
  skipMovement,
  makeSuggestion,
  respondToSuggestion,
  autoRevealCard,
  makeAccusation,
  endTurn,
  passTurn,
  activeReachable,
  type GameState,
  type CreateGamePayload,
  type JoinGamePayload,
  type LobbyChatPayload,
  type MoveToPayload,
  type MakeSuggestionPayload,
  type RevealCardPayload,
  type MakeAccusationPayload,
  type PickSuspectPayload,
  type SetSlotPayload,
} from 'shared';
import {
  type Room,
  addChat,
  createRoom,
  findRoomByOccupant,
  joinRoom,
  pickSuspect,
  removeOccupant,
  setSlot,
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

const RNG = makeRng(Math.floor(Math.random() * 0x7fffffff) + 1);

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
  const room = findRoomByOccupant(socket.id);
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
  broadcastGame(room);
  if (g.phase !== 'play') return;

  const sg = g.currentSuggestion;
  if (sg && !sg.resolved && sg.pendingResponderId) {
    const responder = getPlayer(g, sg.pendingResponderId);
    if (responder?.isBot) scheduleBotReveal(room, responder.id);
    return; // waiting on a reveal
  }
  scheduleBots(room);
}

/** A bot that must disprove a suggestion reveals a matching card after a short beat. */
function scheduleBotReveal(room: Room, botId: string): void {
  setTimeout(() => {
    const s = room.game;
    if (!s || s.phase !== 'play') return;
    const sg = s.currentSuggestion;
    if (!sg || sg.resolved || sg.pendingResponderId !== botId) return;
    try {
      room.game = respondToSuggestion(s, botId, autoRevealCard(s, botId), RNG);
      progress(room);
    } catch {
      /* ignore */
    }
  }, 900);
}

/** When the active player is a bot, play a simple turn after a short delay (full AI is M8). */
function scheduleBots(room: Room): void {
  const g = room.game;
  if (!g || g.phase !== 'play') return;
  const cur = getPlayer(g, currentPlayerId(g));
  if (!cur || !cur.isBot || cur.eliminated) return;

  setTimeout(() => {
    let s = room.game;
    if (!s || s.phase !== 'play' || currentPlayerId(s) !== cur.id) return;
    try {
      if (s.turnPhase === 'awaitRoll') {
        s = rollAndMove(s, cur.id, RNG); // bots always roll & move
        room.game = s;
        broadcastGame(room);
      }
      if (s.turnPhase === 'awaitMove') {
        const reach = activeReachable(s);
        if (reach.length) {
          s = moveTo(s, cur.id, reach[Math.floor(RNG() * reach.length)]);
          room.game = s;
          broadcastGame(room);
        }
      }
    } catch {
      /* fall through to ending the turn */
    }

    // Let the move animate, then end the turn and check the next player.
    setTimeout(() => {
      let s2 = room.game;
      if (!s2 || s2.phase !== 'play' || currentPlayerId(s2) !== cur.id) return;
      try {
        s2 = s2.turnPhase === 'postMove' ? endTurn(s2, cur.id, RNG) : passTurn(s2, cur.id, RNG);
        room.game = s2;
        broadcastGame(room);
      } catch {
        /* ignore */
      }
      scheduleBots(room);
    }, 750);
  }, 800);
}

function emitError(socket: Socket, message: string): void {
  socket.emit(SOCKET_EVENTS.ERROR, { message });
}

/** Display name of a socket within its room (for chat / logs). */
function nameOf(room: Room, id: string): string {
  return room.slots.find((s) => s.occupant?.id === id)?.occupant?.name ?? 'Someone';
}

io.on('connection', (socket) => {
  socket.emit(SOCKET_EVENTS.YOU_ARE, { id: socket.id });

  socket.on(SOCKET_EVENTS.CREATE_GAME, (p: CreateGamePayload) => {
    try {
      const room = createRoom(socket.id, p?.name ?? '');
      socket.join(room.code);
      emitLobby(room);
      emitChat(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.JOIN_GAME, (p: JoinGamePayload) => {
    try {
      const { room } = joinRoom(p?.code ?? '', socket.id, p?.name ?? '');
      socket.join(room.code);
      addChat(room, 'System', `${nameOf(room, socket.id)} joined the game.`);
      emitLobby(room);
      emitChat(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.SET_SLOT, (p: SetSlotPayload) => {
    const room = findRoomByOccupant(socket.id);
    if (!room) return;
    try {
      setSlot(room, socket.id, p.index, p.status);
      emitLobby(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.PICK_SUSPECT, (p: PickSuspectPayload) => {
    const room = findRoomByOccupant(socket.id);
    if (!room) return;
    try {
      pickSuspect(room, socket.id, p.suspectId);
      emitLobby(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.LOBBY_CHAT, (p: LobbyChatPayload) => {
    const room = findRoomByOccupant(socket.id);
    if (!room) return;
    addChat(room, nameOf(room, socket.id), p?.text ?? '');
    emitChat(room);
  });

  socket.on(SOCKET_EVENTS.START_GAME, () => {
    const room = findRoomByOccupant(socket.id);
    if (!room) return;
    try {
      startGameInRoom(room, socket.id);
      emitLobby(room); // phase is now 'play'
      emitChat(room); // so the in-game chat panel carries the lobby history
      broadcastGame(room); // each human their own tailored view
      scheduleBots(room); // in case the first player is a bot
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.ROLL_MOVE, () => withGame(socket, (_room, g) => rollAndMove(g, socket.id, RNG)));
  socket.on(SOCKET_EVENTS.MOVE_TO, (p: MoveToPayload) => withGame(socket, (_room, g) => moveTo(g, socket.id, p.tile)));
  socket.on(SOCKET_EVENTS.SKIP_MOVE, () => withGame(socket, (_room, g) => skipMovement(g, socket.id)));
  socket.on(SOCKET_EVENTS.END_TURN, () => withGame(socket, (_room, g) => endTurn(g, socket.id, RNG)));

  socket.on(SOCKET_EVENTS.MAKE_SUGGESTION, (p: MakeSuggestionPayload) =>
    withGame(socket, (_room, g) => {
      const me = getPlayer(g, socket.id);
      if (currentPlayerId(g) !== socket.id) throw new Error('Not your turn.');
      if (g.turnPhase !== 'postMove') throw new Error('You can only suggest after the movement phase.');
      if (!me?.inRoomId) throw new Error('You must be in a room to make a suggestion.');
      return makeSuggestion(g, socket.id, p.suspectId, p.weaponId, me.inRoomId, RNG);
    }),
  );
  socket.on(SOCKET_EVENTS.REVEAL_CARD, (p: RevealCardPayload) =>
    withGame(socket, (_room, g) => respondToSuggestion(g, socket.id, p.cardId, RNG)),
  );
  socket.on(SOCKET_EVENTS.MAKE_ACCUSATION, (p: MakeAccusationPayload) =>
    withGame(socket, (_room, g) => {
      if (currentPlayerId(g) !== socket.id) throw new Error('Not your turn.');
      if (g.turnPhase !== 'postMove') throw new Error('You can only accuse after the movement phase.');
      return makeAccusation(g, socket.id, p.suspectId, p.weaponId, p.roomId, RNG).state;
    }),
  );

  socket.on(SOCKET_EVENTS.LEAVE, () => {
    const { room, deleted } = removeOccupant(socket.id);
    socket.rooms.forEach((r) => r !== socket.id && socket.leave(r));
    if (room && !deleted) emitLobby(room);
  });

  socket.on('disconnect', () => {
    const room = findRoomByOccupant(socket.id);
    if (!room) return;
    const name = nameOf(room, socket.id);
    const { deleted } = removeOccupant(socket.id);
    if (!deleted) {
      addChat(room, 'System', `${name} disconnected.`);
      emitLobby(room);
      emitChat(room);
    }
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
