// Two-client integration smoke test for the M3 lobby/networking layer.
// Run against a server started on PORT=3020. Exits non-zero on failure.
import { io } from 'socket.io-client';

const URL = 'http://localhost:3020';
const fails = [];
const ok = (cond, label) => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}`);
    fails.push(label);
  }
};

function client() {
  const s = io(URL, { forceNew: true });
  const state = { id: null, lobby: null, game: null, chat: [], errors: [] };
  s.on('youAre', (p) => (state.id = p.id));
  s.on('lobby', (p) => (state.lobby = p.lobby));
  s.on('chat', (p) => (state.chat = p.chat));
  s.on('gameStarted', (p) => (state.game = p.view));
  s.on('errorMsg', (e) => state.errors.push(e.message));
  return { s, state };
}

const until = async (pred, label, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout waiting for: ${label}`);
};

try {
  const A = client();
  await until(() => A.s.connected && A.state.id, 'A connects + gets id');
  A.s.emit('createGame', { name: 'Alice' });
  await until(() => A.state.lobby, 'A receives lobby after create');
  const code = A.state.lobby.code;
  ok(/^[A-Z0-9]{4}$/.test(code), `room code generated (${code})`);
  ok(A.state.lobby.hostId === A.state.id, 'Alice is host');

  const B = client();
  await until(() => B.s.connected && B.state.id, 'B connects + gets id');
  B.s.emit('joinGame', { code, name: 'Bob' });
  await until(() => B.state.lobby, 'B receives lobby after join');
  await until(() => A.state.lobby.slots.filter((s) => s.occupant).length === 2, 'Alice sees 2 seated');
  ok(B.state.lobby.code === code, 'Bob joined the same room');

  // Host adds a bot in seat 3.
  A.s.emit('setSlot', { index: 2, status: 'bot' });
  await until(() => A.state.lobby.slots[2].occupant?.isBot, 'bot added to seat 3');

  // Suspect picks.
  A.s.emit('pickSuspect', { suspectId: 'suspect-scarlet' });
  B.s.emit('pickSuspect', { suspectId: 'suspect-plum' });
  await until(
    () => A.state.lobby.slots.find((s) => s.occupant?.id === A.state.id)?.occupant?.suspectId === 'suspect-scarlet',
    'Alice picked Scarlet',
  );

  // Duplicate pick should be rejected.
  B.s.emit('pickSuspect', { suspectId: 'suspect-scarlet' });
  await until(() => B.state.errors.some((e) => /taken/i.test(e)), 'duplicate suspect rejected');

  // Chat broadcast.
  A.s.emit('lobbyChat', { text: 'Hello detectives' });
  await until(() => B.state.chat.some((m) => m.text === 'Hello detectives'), 'chat broadcast to Bob');

  // Non-host cannot start.
  B.s.emit('startGame');
  await until(() => B.state.errors.some((e) => /host/i.test(e)), 'non-host start rejected');

  // Host starts.
  A.s.emit('startGame');
  await until(() => A.state.game && B.state.game, 'both receive tailored game views');

  const ah = A.state.game.yourHand;
  const bh = B.state.game.yourHand;
  ok(ah.length > 0 && bh.length > 0, `both have cards (A=${ah.length}, B=${bh.length})`);
  ok(ah.filter((c) => bh.includes(c)).length === 0, 'hands are disjoint (no shared cards)');
  ok(A.state.game.envelope == null, 'envelope hidden from Alice mid-game');
  ok(A.state.game.players.length === 3, '3 players in game (Alice, Bob, bot)');
  ok(A.state.game.turnOrder[0] === A.state.id, 'Scarlet (Alice) leads the turn order');
  const botP = A.state.game.players.find((p) => p.isBot);
  ok(!!botP?.suspectId && !['suspect-scarlet', 'suspect-plum'].includes(botP.suspectId), 'bot auto-assigned a free suspect');
  // Other players' hands must not leak into the view.
  const aliceInB = B.state.game.players.find((p) => p.id === A.state.id);
  ok(aliceInB && aliceInB.hand === undefined && typeof aliceInB.handCount === 'number', "Bob sees Alice's hand as a count only");

  A.s.close();
  B.s.close();
} catch (err) {
  console.log(`  ✗ EXCEPTION: ${err.message}`);
  fails.push(err.message);
}

if (fails.length) {
  console.log(`\nFAILED (${fails.length}): ${fails.join('; ')}`);
  process.exit(1);
} else {
  console.log('\nALL CHECKS PASSED');
  process.exit(0);
}
