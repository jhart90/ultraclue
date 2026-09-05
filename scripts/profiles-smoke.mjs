// End-to-end check of player profiles against a running dev server: two humans both called "Jack"
// (different PINs) play a private game; Jack A accuses wrongly so Jack B wins by default. Then each
// profile is looked up by name + PIN, and the lobby/game views are checked for PIN leakage.
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://localhost:3001';
const fails = [];
const ok = (cond, label) => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}`);
    fails.push(label);
  }
};
const until = async (pred, label, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`timeout waiting for: ${label}`);
};
function client(clientId) {
  const s = io(URL, { forceNew: true });
  const state = { id: null, lobby: null, game: null, errors: [], raw: [] };
  s.on('youAre', (p) => (state.id = p.id));
  s.on('lobby', (p) => {
    state.lobby = p.lobby;
    state.raw.push(JSON.stringify(p));
  });
  s.on('gameStarted', (p) => {
    state.game = p.view;
    state.raw.push(JSON.stringify(p));
  });
  s.on('errorMsg', (e) => state.errors.push(e.message));
  return { s, state, clientId };
}
const ack = (s, ev, payload) => new Promise((res) => s.emit(ev, payload, res));

const stamp = Date.now().toString(36);
const A = client(`e2e-a-${stamp}`);
const B = client(`e2e-b-${stamp}`);
const NAME = `Jack${stamp.slice(-3)}`; // unique per run so the assertions below start from zero
const PIN_A = 'AB12';
const PIN_B = '9Z9Z';
try {
  await until(() => A.s.connected && B.s.connected, 'both connect');
  A.s.emit('createGame', { name: NAME, clientId: A.clientId, pin: PIN_A });
  await until(() => A.state.lobby, 'A has lobby');
  const code = A.state.lobby.code;
  B.s.emit('joinGame', { code, name: NAME, clientId: B.clientId, pin: PIN_B });
  await until(() => B.state.lobby && A.state.lobby.slots.filter((s) => s.occupant).length === 2, 'both seated');
  ok(A.state.lobby.slots.filter((s) => s.occupant?.name === NAME).length === 2, 'two seats both named ' + NAME);

  // No profile before any game has finished.
  const before = await ack(A.s, 'playerProfile', { name: NAME, pin: PIN_A });
  ok(before.profile === null, 'no profile before the first finished game');

  A.s.emit('startGame');
  await until(() => A.state.game && B.state.game, 'game started');

  // Drive the human turns: whoever is up moves to the first reachable tile, then accuses wrongly.
  const wrong = (view) => {
    const trio = { suspectId: 'suspect-scarlet', weaponId: 'weapon-rope', roomId: 'room-kitchen' };
    return trio;
  };
  let accusedBy = null;
  const drive = (C) => {
    const v = C.state.game;
    if (!v || v.phase !== 'play') return;
    const cur = v.turnOrder[v.activeIdx];
    if (cur !== C.state.id) return;
    if (v.turnPhase === 'awaitMove' && v.reachable?.length) {
      C.s.emit('moveTo', { tile: v.reachable[0] });
    } else if (v.turnPhase === 'awaitRoll') {
      C.s.emit('skipMove');
    } else if (v.turnPhase === 'postMove' && !accusedBy) {
      accusedBy = C.state.id;
      C.s.emit('makeAccusation', wrong(v)); // almost certainly wrong (1 in 64,000 to be right)
    } else if (v.turnPhase === 'postMove') {
      C.s.emit('endTurn');
    }
  };
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !(A.state.game?.phase === 'ended')) {
    drive(A);
    drive(B);
    await new Promise((r) => setTimeout(r, 150));
  }
  ok(A.state.game?.phase === 'ended', 'game ended after the wrong accusation');
  const loser = accusedBy;
  const winner = A.state.game.winnerId;
  ok(winner && winner !== loser, `winner (${winner}) is the other Jack`);
  await new Promise((r) => setTimeout(r, 400)); // let the server fold + save

  const [loserC, winnerC] = loser === A.state.id ? [A, B] : [B, A];
  const loserPin = loserC === A ? PIN_A : PIN_B;
  const winnerPin = winnerC === A ? PIN_A : PIN_B;
  const L = (await ack(A.s, 'playerProfile', { name: NAME, pin: loserPin })).profile;
  const W = (await ack(A.s, 'playerProfile', { name: NAME, pin: winnerPin })).profile;
  const N = (await ack(A.s, 'playerProfile', { name: NAME })).profile;
  ok(L && L.games === 1 && L.wins === 0 && L.eliminations === 1 && L.accusations === 1 && L.accusationsCorrect === 0, 'loser profile: 1 game, eliminated, 1 wrong accusation');
  ok(W && W.games === 1 && W.wins === 1 && W.solves === 0 && W.accusations === 0, 'winner profile: 1 game, 1 win by default');
  ok(L && W && L.id !== W.id && L.tag !== W.tag && L.tag.length === 3, `two distinct PIN profiles with tags #${L?.tag} / #${W?.tag}`);
  ok(L && W && L.hasPin && W.hasPin, 'both profiles marked as PIN-protected');
  ok(N === null, 'the same name WITHOUT a PIN is a separate (still empty) profile');
  ok(L && L.recent.length === 1 && L.recent[0].result === 'eliminated' && L.recent[0].isPublic === false, 'loser recent game: eliminated, private');
  ok(W && W.recent[0].result === 'won' && W.recent[0].winnerName === NAME, 'winner recent game: won');
  ok(L && Object.keys(L.characters).length === 1, 'loser character tally has one entry');
  const lowerPin = (await ack(A.s, 'playerProfile', { name: NAME.toLowerCase(), pin: loserPin.toLowerCase() })).profile;
  ok(lowerPin && lowerPin.id === L.id, 'lookup is case-insensitive for both name and PIN');

  // Leakage: nothing sent to clients ever contains a PIN or a profile id.
  const everything = A.state.raw.concat(B.state.raw).join('\n');
  ok(!everything.includes(PIN_A) && !everything.includes(PIN_B), 'PINs never appear in lobby/game broadcasts');
  ok(!/"p:[0-9a-f]{32}"/.test(everything) && !everything.includes('profileId'), 'profile ids never appear in lobby/game broadcasts');
  console.log('  profile sample:', JSON.stringify({ name: W.name, tag: W.tag, games: W.games, wins: W.wins, tiles: W.tiles, recent: W.recent.length }));
} catch (e) {
  console.log('  ✗ ' + e.message);
  fails.push(e.message);
} finally {
  A.s.close();
  B.s.close();
}
console.log(fails.length ? `FAILED (${fails.length})` : 'ALL OK');
process.exit(fails.length ? 1 : 0);
