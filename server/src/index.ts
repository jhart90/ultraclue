import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  SOCKET_EVENTS,
  DICE_ANIM_MS,
  TURN_FLASH_MS,
  PUBLIC_TURN_MS,
  BOT_SPEED_PACE,
  BOT_SPEED_PASS_PACE,
  viewFor,
  makeRng,
  currentPlayerId,
  getCard,
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
  botRevealCard,
  botMind,
  botDecideAccusation,
  botDecideSuggestion,
  botDecideStay,
  botDecideShortcut,
  botDecideMove,
  botDecideFloor,
  botNotesGrid,
  type BotMind,
  type SuggestionEvent,
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
  type TakeSeatPayload,
  type JoinObserverPayload,
  type SetAccusingPayload,
  type SetNotesPayload,
  type SetObserverPayload,
  type LoadGamePayload,
  type SaveGameDataPayload,
  type JoinPublicPayload,
  type SetRoomSettingsPayload,
  type SetDicePayload,
  type DiceStyle,
  type SetBotDifficultyPayload,
} from 'shared';
import {
  type Room,
  addChat,
  getRoom,
  takeSeat,
  joinAsObserver,
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
  setObserver,
  bootPlayer,
  leaveGameAsBot,
  serializeRoom,
  loadRoom,
  startGameInRoom,
  toLobbyView,
  getPublicRoom,
  createPublicRoom,
  joinPublicLobby,
  setRoomSettings,
  setBotDifficulty,
  roomBotDifficulty,
  roomBotSpeed,
  resetPublicRoom,
  electHost,
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
  // Whispers carry an audience (`to`); send each human only the messages they're allowed to see.
  const hasPrivate = room.chat.some((m) => m.to);
  if (!hasPrivate) {
    io.to(room.code).emit(SOCKET_EVENTS.CHAT, { chat: room.chat });
    return;
  }
  for (const slot of room.slots) {
    const occ = slot.occupant;
    if (!occ || occ.isBot) continue;
    const chat = room.chat.filter((m) => !m.to || m.to.includes(occ.id));
    io.to(occ.id).emit(SOCKET_EVENTS.CHAT, { chat });
  }
}

// Last round number we auto-saved per room, so we save once per completed round.
// Signature of the turn we last auto-saved, per room — so we snapshot once at the start of each turn.
const autoSaveTurn = new Map<string, string>();
function buildSave(room: Room, auto: boolean): SaveGameDataPayload {
  return {
    meta: {
      savedAt: Date.now(),
      round: room.game?.round ?? 0,
      players: room.slots.filter((s) => s.occupant && !s.occupant.observer).length,
      auto,
    },
    blob: serializeRoom(room),
  };
}
/** Auto-save (to every human's browser) at the start of each player's turn. The public game is
 *  never saved — it would clobber the player's private save with a 40-seat table they don't own. */
function maybeAutoSave(room: Room): void {
  const g = room.game;
  if (!g || g.phase !== 'play' || room.isPublic) return;
  const sig = `${g.round ?? 0}:${g.activeIdx}`;
  if (sig !== autoSaveTurn.get(room.code)) {
    autoSaveTurn.set(room.code, sig);
    io.to(room.code).emit(SOCKET_EVENTS.SAVE_GAME_DATA, buildSave(room, true));
  }
}

const RNG = makeRng(Math.floor(Math.random() * 0x7fffffff) + 1);

// Pace every bot action ~10s apart so human players can read pop-ups and digest each move. While a
// bot is on the clock the chat shows a transient "<bot> is thinking…" line. The public table seats
// up to 40 (mostly computers), so its bots move faster or a single round would take a quarter hour.
const BOT_DELAY = 10000;
const PUBLIC_BOT_DELAY = 5000;
/** The table's base pause, scaled by the host's computer-speed setting (slow ×1.33, fast ×0.5). */
const botDelay = (room: Room): number => (room.isPublic ? PUBLIC_BOT_DELAY : BOT_DELAY) * BOT_SPEED_PACE[roomBotSpeed(room)];
/** How long a bot waits before its next action: its pacing delay, stretched so a dice roll that is
 *  still animating on players' screens finishes first. */
function botWait(room: Room): number {
  const animEnds = (room.lastRollAt ?? 0) + TURN_FLASH_MS + DICE_ANIM_MS + 400;
  return Math.max(botDelay(room), animEnds - Date.now());
}
/** A bot answering a suggestion: the usual pause, but a bot with nothing to show answers much
 *  faster on the Fast setting (there's nothing to think about). Always at least a second, so a
 *  human reading the reveal card before it gets a beat. */
function botRevealWait(room: Room, willPass: boolean): number {
  const base = room.isPublic ? PUBLIC_BOT_DELAY : BOT_DELAY;
  const pace = willPass ? BOT_SPEED_PASS_PACE[roomBotSpeed(room)] : BOT_SPEED_PACE[roomBotSpeed(room)];
  return Math.max(1000, base * pace);
}

// Per-room bot memory: rooms each bot has already suggested in (so it explores), and — keyed by
// `${responderId}|${recipientId}` — which of its own cards it has already shown to each player.
// (Card deductions live in room.suggestionLog, replayed per-bot; see deductionFor.)
const botMem = new Map<
  string,
  { visited: Map<string, Set<string>>; shown: Map<string, Set<string>>; stays: Map<string, { room: string; n: number }> }
>();
function memFor(room: Room) {
  let m = botMem.get(room.code);
  if (!m) {
    m = { visited: new Map(), shown: new Map(), stays: new Map() };
    botMem.set(room.code, m);
  }
  return m;
}
/** The suggestion history as a given player is entitled to know it: the revealed card is filled in
 *  only for the suggestions that player made (they alone saw what was shown to them). */
function eventsForPlayer(room: Room, playerId: string): SuggestionEvent[] {
  return room.suggestionLog.map((e) => ({
    suggesterId: e.suggesterId,
    trio: e.trio,
    passers: e.passers,
    responderId: e.responderId,
    revealedCardId: e.suggesterId === playerId ? e.revealedCardId : undefined,
  }));
}
/** A bot's current understanding of the game, as good as its difficulty allows. */
function mindFor(g: GameState, playerId: string, room: Room): BotMind {
  const p = getPlayer(g, playerId);
  const handCounts = new Map(g.players.map((pl) => [pl.id, pl.hand.length]));
  return botMind(p?.difficulty ?? roomBotDifficulty(room), playerId, p?.hand ?? [], g.turnOrder, eventsForPlayer(room, playerId), handCounts);
}
/** The order in which the other players would be asked to disprove this player's suggestion. */
function responderQueue(g: GameState, suggesterId: string): string[] {
  const order = g.turnOrder;
  const start = order.indexOf(suggesterId);
  const q: string[] = [];
  for (let k = 1; k < order.length; k++) {
    const id = order[(start + k) % order.length];
    if (!getPlayer(g, id)?.eliminated) q.push(id);
  }
  return q;
}
/** Append a resolved suggestion to the room's log (once), so every bot can deduce from it. */
function recordSuggestion(room: Room): void {
  const g = room.game;
  const sg = g?.currentSuggestion;
  if (!g || !sg?.resolved) {
    room.lastLoggedSuggestion = undefined; // a fresh suggestion may log when it resolves
    return;
  }
  const key = `${sg.suggesterId}|${sg.suspectId}|${sg.weaponId}|${sg.roomId}|${sg.responderId ?? ''}|${sg.revealedCardId ?? ''}`;
  if (room.lastLoggedSuggestion === key) return;
  room.lastLoggedSuggestion = key;
  const revealed = sg.anyRevealed && sg.responderId != null;
  room.suggestionLog.push({
    suggesterId: sg.suggesterId,
    trio: [sg.suspectId, sg.weaponId, sg.roomId],
    passers: [...sg.passes],
    responderId: revealed ? sg.responderId : undefined,
    revealedCardId: revealed ? sg.revealedCardId : undefined,
  });
}
/** Refresh every bot's Detective Notes sheet from its current deduction, stored under its seat (so
 *  the notes ride along in saves and a human taking over a bot inherits its reasoning). */
function updateBotNotes(room: Room): void {
  const g = room.game;
  if (!g) return;
  for (const p of g.players) {
    if (!p.isBot) continue;
    const grid = botNotesGrid(mindFor(g, p.id, room).k, g.turnOrder);
    room.notes[p.id] = JSON.stringify(grid);
  }
}

/** Whisper the actual revealed card to just the two players in on it — "<A> reveals <Card> to <B>".
 *  Fires once per reveal (reset when the next suggestion is in flight). */
function whisperReveal(room: Room): void {
  const g = room.game;
  const sg = g?.currentSuggestion;
  if (!sg || !sg.resolved) {
    room.lastRevealWhisper = undefined; // fresh / no suggestion → allow the next reveal to whisper
    return;
  }
  if (!sg.anyRevealed || !sg.revealedCardId || sg.responderId == null) return;
  const key = `${sg.suggesterId}|${sg.responderId}|${sg.revealedCardId}`;
  if (room.lastRevealWhisper === key) return;
  room.lastRevealWhisper = key;
  const responder = getPlayer(g!, sg.responderId)?.name ?? 'Someone';
  const suggester = getPlayer(g!, sg.suggesterId)?.name ?? 'Someone';
  const card = getCard(sg.revealedCardId)?.title ?? 'a card';
  addChat(room, '', `${responder} reveals ${card} to ${suggester}.`, false, [sg.responderId, sg.suggesterId], true);
}

/** Hand a player the saved Detective Notes for the seat they hold (on resume / rejoin / takeover). */
function sendNotes(socket: Socket, room: Room, id: string): void {
  const notes = room.notes?.[id];
  if (notes) socket.emit(SOCKET_EVENTS.NOTES, { notes });
}

/** A viewer's game view, stamped with the room host's id so an observing host keeps host controls,
 *  and whoever is mid-accusation so the table can be warned. */
function gameView(room: Room, id: string) {
  return {
    ...viewFor(room.game!, id),
    hostId: room.hostId,
    accusingId: room.accusingId,
    turnDeadline: room.turnDeadline,
    serverNow: Date.now(),
  };
}

/** Push each human their own tailored game view (observers included — they watch). */
function broadcastGame(room: Room): void {
  const g = room.game;
  if (!g) return;
  // Note each fresh roll: clients now play the dice animation, so bots hold off until it's done.
  if ((g.rollSeq ?? 0) !== (room.lastRollSeq ?? 0)) {
    room.lastRollSeq = g.rollSeq ?? 0;
    room.lastRollAt = Date.now();
  }
  for (const slot of room.slots) {
    const occ = slot.occupant;
    if (occ && !occ.isBot) io.to(occ.id).emit(SOCKET_EVENTS.GAME_STARTED, { view: gameView(room, occ.id) });
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
  // The "is accusing" warning only stands while it's still that player's live turn.
  if (room.accusingId && (g.phase !== 'play' || currentPlayerId(g) !== room.accusingId)) {
    room.accusingId = undefined;
  }
  // A winning accusation: hold its "case solved" reveal out of the chat for 30s (let the verdict
  // pop-up land first), then drop it in with a sign-off. Fires once per win, human or bot.
  const ann = g.announcement;
  if (g.phase === 'ended' && ann?.kind === 'accusation' && ann.correct && room.winAnnounced !== ann.seq) {
    room.winAnnounced = ann.seq;
    const winnerName = getPlayer(g, g.winnerId ?? '')?.name;
    if (g.log.length && /CORRECT/i.test(g.log[g.log.length - 1].text)) g.log.pop(); // keep it out of mirrorLog
    if (winnerName) {
      const code = room.code;
      setTimeout(() => {
        const r = getRoom(code);
        if (!r) return;
        addChat(r, 'System', `The accusation is CORRECT — ${winnerName} has solved the case and wins!`, true);
        addChat(r, 'System', 'Thanks for playing ULTRA CLUE!', true);
        emitChat(r);
      }, 30_000);
    }
  }
  recordSuggestion(room); // log a resolved suggestion so every bot can deduce from it
  updateBotNotes(room); // refresh each bot's Detective Notes from its latest deduction
  mirrorLog(room); // fold new game events into the chat feed
  armTurnTimer(room); // public: (re)start the 90s clock for whichever human the table waits on
  broadcastGame(room);
  emitChat(room);
  maybeAutoSave(room); // snapshot to browsers after each completed round
  if (g.phase === 'ended' && room.isPublic) schedulePublicReset(); // the next public lobby forms shortly
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
  let willPass = false;
  if (g) {
    setThinking(room, getPlayer(g, botId)?.name ?? 'Someone');
    emitChat(room);
    const sg = g.currentSuggestion;
    if (sg) {
      const trio = [sg.suspectId, sg.weaponId, sg.roomId];
      willPass = !(getPlayer(g, botId)?.hand ?? []).some((c) => trio.includes(c));
    }
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
  }, botRevealWait(room, willPass));
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
    // The movement runs as a series of steps. A roll the bot makes itself (it was in a room) is
    // broadcast on its own, and the token only moves once the dice have finished tumbling on every
    // screen (DICE_ANIM_MS) plus a short beat. A turn-opening roll was broadcast with the previous
    // turn's end, and botWait() already holds the whole movement phase until that animation is over.
    const mem = memFor(room);
    const movementStep = (): void => {
      let s = room.game;
      if (!s || s.phase !== 'play' || currentPlayerId(s) !== cur.id || !getPlayer(s, cur.id)?.isBot) {
        emitChat(room);
        return;
      }
      try {
        const mind = mindFor(s, cur.id, room);
        for (let step = 0; step < 4; step++) {
          if (s.turnPhase === 'awaitRoll') {
            const me = getPlayer(s, cur.id);
            const visited = mem.visited.get(cur.id) ?? new Set<string>();
            const st = mem.stays.get(cur.id);
            const staysHere = st && st.room === me?.inRoomId ? st.n : 0;
            if (botDecideShortcut(mind, me?.inRoomId)) {
              s = takeShortcut(s, cur.id);
              mem.stays.delete(cur.id);
            } else if (botDecideStay(mind, me?.inRoomId, staysHere, visited)) {
              s = skipMovement(s, cur.id);
              mem.stays.set(cur.id, { room: me!.inRoomId!, n: staysHere + 1 });
            } else {
              s = rollAndMove(s, cur.id, RNG);
              mem.stays.delete(cur.id);
              room.game = s;
              mirrorLog(room);
              broadcastGame(room); // everyone sees the dice fly…
              emitChat(room);
              setTimeout(movementStep, DICE_ANIM_MS + 300); // …and only then does the token move
              return;
            }
          } else if (s.turnPhase === 'awaitMove') {
            const dest = botDecideMove(mind, activeReachable(s), RNG, responderQueue(s, cur.id));
            if (!dest) break;
            s = moveTo(s, cur.id, dest);
          } else if (s.turnPhase === 'awaitElevator' && s.elevatorRide) {
            const opts = elevatorOptions(s.elevatorRide.fromFloor);
            s = chooseFloor(s, cur.id, botDecideFloor(mind, opts, RNG), RNG);
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
      decide();
    };

    // --- decision phase: accuse if certain, else suggest from a room, else end ---
    const decide = (): void => {
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
        const mind = mindFor(s2, cur.id, room);
        const me = getPlayer(s2, cur.id);

        if (s2.turnPhase === 'postMove') {
          const accusation = botDecideAccusation(mind, RNG);
          if (accusation) {
            s2 = makeAccusation(s2, cur.id, accusation.suspectId, accusation.weaponId, accusation.roomId, RNG).state;
            room.game = s2;
            progress(room);
            return;
          }
          if (me?.inRoomId) {
            const sugg = botDecideSuggestion(mind, me.inRoomId, responderQueue(s2, cur.id), RNG);
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
    }, botWait(room));
    };
    movementStep();
  }, botWait(room));
}

function emitError(socket: Socket, message: string): void {
  socket.emit(SOCKET_EVENTS.ERROR, { message });
}

const HEX = /^#[0-9a-f]{6}$/i;
function cleanDice(p: Partial<SetDicePayload> | undefined): DiceStyle | undefined {
  if (!p || typeof p.color !== 'string' || typeof p.pips !== 'string') return undefined;
  if (!HEX.test(p.color) || !HEX.test(p.pips)) return undefined;
  return { color: p.color.toLowerCase(), pips: p.pips.toLowerCase() };
}

// ---- the public room's lifecycle ------------------------------------------------------------
// One public room always exists. Its lobby runs a server-side clock; when it hits zero the game
// starts with whoever is seated (computers fill the rest). When that game ends, a fresh lobby forms
// after a short pause and everyone still connected is carried across.
const PUBLIC_RESET_DELAY = 60_000;
const PUBLIC_DROP_GRACE = 60_000; // a public player who disconnects gets this long to come back
let publicStartTimer: NodeJS.Timeout | undefined;
let publicResetTimer: NodeJS.Timeout | undefined;
const publicDropTimers = new Map<string, NodeJS.Timeout>();

function ensurePublicRoom(): Room {
  let room = getPublicRoom();
  if (!room) {
    room = createPublicRoom();
    addChat(room, 'System', 'Welcome to the public table. Every seat is a computer until someone takes it — the game starts when the clock runs out.', true);
    armPublicClock(room);
  }
  return room;
}

function armPublicClock(room: Room): void {
  if (publicStartTimer) clearTimeout(publicStartTimer);
  const delay = Math.max(0, (room.startsAt ?? Date.now()) - Date.now());
  publicStartTimer = setTimeout(() => {
    publicStartTimer = undefined;
    startPublicGame();
  }, delay);
}

function startPublicGame(): void {
  const room = getPublicRoom();
  if (!room || room.phase !== 'lobby') return;
  try {
    botMem.delete(room.code);
    startGameInRoom(room, room.hostId, { force: true });
    addChat(room, 'System', 'The clock has run out — the public game begins!', true);
    emitLobby(room);
    mirrorLog(room);
    emitChat(room);
    broadcastGame(room);
    scheduleBots(room);
  } catch (err) {
    console.error('[public] failed to start, retrying in 30s:', (err as Error).message);
    room.startsAt = Date.now() + 30_000;
    emitLobby(room);
    armPublicClock(room);
  }
}

function schedulePublicReset(): void {
  if (publicResetTimer) return;
  publicResetTimer = setTimeout(() => {
    publicResetTimer = undefined;
    const room = resetPublicRoom();
    botMem.delete(room.code);
    autoSaveTurn.delete(room.code);
    for (const t of publicDropTimers.values()) clearTimeout(t);
    publicDropTimers.clear();
    addChat(room, 'System', 'A new public game is forming — the clock is running.', true);
    emitLobby(room);
    emitChat(room);
    armPublicClock(room);
  }, PUBLIC_RESET_DELAY);
}

// ---- public turn clock ----------------------------------------------------------------------
// A human on the clock in the public game (their own turn, or a suggestion they must answer) has
// PUBLIC_TURN_MS to act; then the server acts for them so nobody can hold up a 40-seat table.
let publicTurnTimer: NodeJS.Timeout | undefined;

function clearTurnTimer(room: Room): void {
  if (publicTurnTimer) clearTimeout(publicTurnTimer);
  publicTurnTimer = undefined;
  room.turnDeadline = undefined;
  room.turnKey = undefined;
}

function armTurnTimer(room: Room): void {
  if (!room.isPublic) return;
  const g = room.game;
  if (!g || g.phase !== 'play') {
    clearTurnTimer(room);
    return;
  }
  const sg = g.currentSuggestion;
  const awaitedId = sg && !sg.resolved && sg.pendingResponderId ? sg.pendingResponderId : currentPlayerId(g);
  const awaited = getPlayer(g, awaitedId);
  if (!awaited || awaited.isBot) {
    clearTurnTimer(room);
    return;
  }
  const key = `${g.round ?? 0}:${g.activeIdx}:${awaitedId}`;
  if (key === room.turnKey) return; // same wait — the clock keeps running
  clearTurnTimer(room);
  room.turnKey = key;
  room.turnDeadline = Date.now() + PUBLIC_TURN_MS;
  publicTurnTimer = setTimeout(forcePublicTurn, PUBLIC_TURN_MS);
}

function forcePublicTurn(): void {
  publicTurnTimer = undefined;
  const room = getPublicRoom();
  const g = room?.game;
  if (!room || !g || g.phase !== 'play') return;
  try {
    const sg = g.currentSuggestion;
    if (sg && !sg.resolved && sg.pendingResponderId) {
      const rid = sg.pendingResponderId;
      const p = getPlayer(g, rid);
      if (!p || p.isBot) return;
      const trio = [sg.suspectId, sg.weaponId, sg.roomId];
      const match = p.hand.find((c) => trio.includes(c));
      room.game = match ? respondToSuggestion(g, rid, match, RNG) : passSuggestion(g, rid, RNG);
      addChat(room, 'System', `${p.name} ran out of time — ${match ? 'a card was shown for them' : 'they could not disprove it'}.`, true);
    } else {
      const id = currentPlayerId(g);
      const p = getPlayer(g, id);
      if (!p || p.isBot) return;
      room.game = g.turnPhase === 'postMove' ? endTurn(g, id, RNG) : passTurn(g, id, RNG);
      if (room.accusingId === id) room.accusingId = undefined;
      addChat(room, 'System', `${p.name} ran out of time — their turn was passed.`, true);
    }
    room.turnKey = undefined; // whatever comes next is a fresh wait
    progress(room);
  } catch (err) {
    console.error('[public] turn clock could not act:', (err as Error).message);
  }
}

function cancelPublicDrop(clientId: string): void {
  const t = publicDropTimers.get(clientId);
  if (t) {
    clearTimeout(t);
    publicDropTimers.delete(clientId);
  }
}

/** A public player dropped: unless they're back within the grace period, their seat goes to a
 *  computer so the table never waits on them. (Their id is detached, so a later "Join Public
 *  Game" lands them on the seat picker like any newcomer.) */
function schedulePublicDrop(room: Room, clientId: string): void {
  cancelPublicDrop(clientId);
  publicDropTimers.set(
    clientId,
    setTimeout(() => {
      publicDropTimers.delete(clientId);
      const r = getPublicRoom();
      const occ = r?.slots.find((s) => s.occupant?.id === clientId)?.occupant;
      if (!r || !occ || occ.isBot || occ.connected) return;
      const name = occ.name;
      if (r.game) {
        leaveGameAsBot(r, clientId);
        addChat(r, 'System', `${name} didn't come back — a computer is finishing their game.`, true);
      } else {
        removeOccupant(clientId); // public: the seat is handed straight back to a computer
        addChat(r, 'System', `${name} didn't come back — their seat is a computer again.`, true);
      }
      electHost(r);
      emitLobby(r);
      emitChat(r);
      if (r.game) {
        broadcastGame(r);
        progress(r);
      }
    }, PUBLIC_DROP_GRACE),
  );
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
  if (room.isPublic) return; // the public room is permanent
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
      const existing = getRoom(p?.code ?? '');
      // Joining an in-progress (loaded) game: don't auto-seat — let them pick a seat to take over.
      if (existing && existing.phase === 'play') {
        socket.join(existing.code);
        cancelCleanup(existing.code);
        emitLobby(existing); // client shows a seat picker (phase 'play' & not yet seated)
        return;
      }
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

  // The public room needs no code: in the lobby you take over a computer seat on the spot; once
  // the game is running you land on the seat picker (take over a computer, or observe).
  socket.on(SOCKET_EVENTS.JOIN_PUBLIC, (p: JoinPublicPayload) => {
    try {
      const clientId = p?.clientId || socket.id;
      register(clientId);
      cancelPublicDrop(clientId);
      const room = ensurePublicRoom();
      socket.join(room.code);
      const seated = room.slots.find((s) => s.occupant?.id === clientId)?.occupant;
      if (room.phase === 'lobby') {
        if (!seated) {
          joinPublicLobby(room, clientId, p?.name ?? '', !!p?.observer);
          addChat(room, 'System', `${nameOf(room, clientId)} ${p?.observer ? 'is watching the public game' : 'joined the public game'}.`, true);
        } else {
          reconnectOccupant(clientId);
        }
        emitLobby(room);
        emitChat(room);
        return;
      }
      if (room.phase === 'play') {
        if (seated && !seated.isBot) {
          // Still holding a seat (e.g. back from a drop within the grace period): resume it.
          reconnectOccupant(clientId);
          emitLobby(room);
          socket.emit(SOCKET_EVENTS.GAME_STARTED, { view: gameView(room, clientId) });
          emitChat(room);
          sendNotes(socket, room, clientId);
          return;
        }
        if (p?.observer && !seated) {
          // Asked to watch: straight into an observer seat, no seat picker.
          joinAsObserver(room, clientId, p?.name ?? '');
          addChat(room, 'System', `${nameOf(room, clientId)} is now observing.`, true);
          emitLobby(room);
          socket.emit(SOCKET_EVENTS.GAME_STARTED, { view: gameView(room, clientId) });
          emitChat(room);
          return;
        }
        emitLobby(room); // not seated & in play → the client shows the seat picker
        return;
      }
      emitError(socket, 'The public game just ended — a new one forms in a moment. Try again shortly.');
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.SET_ROOM_SETTINGS, (p: SetRoomSettingsPayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room) return;
    try {
      const before = { ...(room.settings ?? {}) };
      setRoomSettings(room, cid(socket), {
        totalPlayers: p?.totalPlayers == null ? undefined : Number(p.totalPlayers),
        botDifficulty: p?.botDifficulty,
        botSpeed: p?.botSpeed,
      });
      const who = nameOf(room, cid(socket));
      if (room.settings?.totalPlayers !== before.totalPlayers) {
        addChat(room, 'System', `${who} set the table to ${room.settings?.totalPlayers} players.`, true);
      }
      if (room.settings?.botDifficulty !== before.botDifficulty) {
        addChat(room, 'System', `${who} set the computers to ${room.settings?.botDifficulty} difficulty.`, true);
      }
      if (room.settings?.botSpeed !== before.botSpeed) {
        addChat(room, 'System', `${who} set the computer speed to ${room.settings?.botSpeed}.`, true);
      }
      emitLobby(room);
      emitChat(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.SET_BOT_DIFFICULTY, (p: SetBotDifficultyPayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room) return;
    try {
      setBotDifficulty(room, cid(socket), Number(p?.index), p?.difficulty);
      const occ = room.slots[Number(p?.index)]?.occupant;
      addChat(room, 'System', `${nameOf(room, cid(socket))} set ${occ?.name ?? 'a computer'} to ${p?.difficulty} difficulty.`, true);
      emitLobby(room);
      if (room.game) broadcastGame(room);
      emitChat(room);
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.TAKE_SEAT, (p: TakeSeatPayload) => {
    const room = getRoom(p?.code ?? '');
    if (!room) {
      emitError(socket, 'That game no longer exists.');
      return;
    }
    try {
      const clientId = cid(socket);
      takeSeat(room, clientId, p?.name ?? '', p?.index ?? -1);
      addChat(room, 'System', `${nameOf(room, clientId)} joined the game.`, true);
      emitLobby(room);
      if (room.paused) {
        room.paused = false; // first human took a seat — start the loaded game running
        progress(room);
      } else {
        armTurnTimer(room); // public: if it's already this seat's move, their clock starts now
        broadcastGame(room);
        emitChat(room);
      }
      sendNotes(socket, room, clientId); // restore the notes for the seat they took over
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  socket.on(SOCKET_EVENTS.JOIN_OBSERVER, (p: JoinObserverPayload) => {
    const room = getRoom(p?.code ?? '');
    if (!room) {
      emitError(socket, 'That game no longer exists.');
      return;
    }
    try {
      const clientId = cid(socket);
      socket.join(room.code);
      cancelCleanup(room.code);
      joinAsObserver(room, clientId, p?.name ?? '');
      addChat(room, 'System', `${nameOf(room, clientId)} is now observing.`, true);
      emitLobby(room);
      if (room.paused) {
        room.paused = false; // a loaded game starts running (all bots) so the observer can watch
        progress(room);
      } else {
        socket.emit(SOCKET_EVENTS.GAME_STARTED, { view: gameView(room, clientId) });
        emitChat(room);
      }
    } catch (err) {
      emitError(socket, (err as Error).message);
    }
  });

  // A player opened (or closed) the accusation picker — warn the rest of the table.
  socket.on(SOCKET_EVENTS.SET_ACCUSING, (p: SetAccusingPayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room?.game || room.game.phase !== 'play') return;
    const id = cid(socket);
    // Only the active player can be composing an accusation.
    if (p?.accusing) {
      if (currentPlayerId(room.game) !== id) return;
      room.accusingId = id;
    } else if (room.accusingId === id) {
      room.accusingId = undefined;
    }
    broadcastGame(room);
  });

  // A player picked new dice colours: remember them on the seat and (if playing) the player.
  socket.on(SOCKET_EVENTS.SET_DICE, (p: SetDicePayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room) return;
    const style = cleanDice(p);
    if (!style) return;
    const occ = room.slots.find((s) => s.occupant?.id === cid(socket))?.occupant;
    if (occ) occ.dice = style;
    const gp = room.game?.players.find((pl) => pl.id === cid(socket));
    if (gp) gp.dice = style;
    if (room.game) broadcastGame(room);
    else emitLobby(room);
  });

  // A player's Detective Notes changed — keep the server copy current so every save carries them.
  socket.on(SOCKET_EVENTS.SET_NOTES, (p: SetNotesPayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room || typeof p?.notes !== 'string') return;
    room.notes[cid(socket)] = p.notes.slice(0, 200_000);
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
    cancelPublicDrop(clientId);
    reconnectOccupant(clientId);
    addChat(room, 'System', `${nameOf(room, clientId)} reconnected.`, true);
    emitLobby(room);
    emitChat(room);
    if (room.game) socket.emit(SOCKET_EVENTS.GAME_STARTED, { view: gameView(room, clientId) });
    sendNotes(socket, room, clientId); // hand back their notes on reconnect
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

  socket.on(SOCKET_EVENTS.SET_OBSERVER, (p: SetObserverPayload) => {
    const room = findRoomByOccupant(cid(socket));
    if (!room) return;
    try {
      setObserver(room, cid(socket), !!p.observer);
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
    const me = cid(socket);
    const myName = nameOf(room, me);
    const raw = (p?.text ?? '').trim();

    // "/w <Player Name> <message>" → a whisper only the sender and the named recipient can see.
    const w = raw.match(/^\/w\s+(.+)$/i);
    if (w) {
      const rest = w[1];
      const occupants = room.slots.map((s) => s.occupant).filter((o): o is NonNullable<typeof o> => !!o);
      // match the longest occupant name that the text starts with (names can contain spaces)
      const target = occupants
        .filter((o) => rest.toLowerCase() === o.name.toLowerCase() || rest.toLowerCase().startsWith(o.name.toLowerCase() + ' '))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (!target) {
        addChat(room, 'System', `No one here is called "${rest.split(/\s+/)[0]}".`, true, [me], true);
      } else {
        const msg = rest.slice(target.name.length).trim();
        if (msg) addChat(room, '', `${myName} whispers to ${target.name}: ${msg}`, false, [me, target.id], true);
      }
      emitChat(room);
      return;
    }

    addChat(room, myName, raw);
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
      autoSaveTurn.set(room.code, `${room.game?.round ?? 0}:${room.game?.activeIdx ?? 0}`);
      socket.join(room.code);
      cancelCleanup(room.code);
      addChat(room, 'System', `${p?.name?.trim() || 'A player'} loaded a saved game.`, true);
      // The game stays paused (all seats bots); the loader picks a seat from the seat picker, which
      // un-pauses play. Don't broadcast a game view yet — they have no seat / no cards to see.
      emitLobby(room);
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
      const name = nameOf(room, clientId);
      const { deleted } = removeOccupant(clientId);
      if (!deleted) {
        if (room.isPublic) addChat(room, 'System', `${name} left the public game.`, true);
        emitLobby(room);
        emitChat(room);
      }
    }
  });

  socket.on('disconnect', () => {
    const clientId = socketClient.get(socket.id);
    socketClient.delete(socket.id);
    if (!clientId) return;
    if ([...socketClient.values()].includes(clientId)) return; // another tab still open
    const room = disconnectOccupant(clientId); // stays human — the table waits for them to return
    if (!room) return;
    if (room.accusingId === clientId) room.accusingId = undefined; // drop a stale "is accusing" warning
    addChat(
      room,
      'System',
      room.isPublic
        ? `${nameOf(room, clientId)} disconnected — a computer takes their seat if they're not back in a minute.`
        : `${nameOf(room, clientId)} disconnected — the game waits for them to return.`,
      true,
    );
    emitLobby(room);
    emitChat(room);
    if (room.game) {
      broadcastGame(room);
      scheduleBots(room); // resume any *other* bot whose turn it is; the dropped human is not botted
    }
    if (room.isPublic) schedulePublicDrop(room, clientId); // …unless it's the public table, after a grace period
    scheduleCleanupIfEmpty(room);
  });
});

ensurePublicRoom(); // the public table is open from the moment the server is up

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
