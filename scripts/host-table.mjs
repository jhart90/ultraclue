// Dev helper: host a private table with computers so a browser can join it and watch a game.
// Creates a room, fills seats 2..N with computers, writes the room code to scripts/.host-table-code,
// waits for a human to join (or 30 s), starts the game, then plays its own turns blandly (walk to
// the first reachable tile, end turn) for a few minutes so the table never waits on the host.
//   node scripts/host-table.mjs [bots=2] [url=http://localhost:3001]
import { io } from 'socket.io-client';
import fs from 'node:fs';

const BOTS = Number(process.argv[2] ?? 2);
const SERVER = process.argv[3] ?? process.env.URL ?? 'http://localhost:3001';
const s = io(SERVER, { forceNew: true });
const st = { id: null, lobby: null, game: null };
s.on('youAre', (p) => (st.id = p.id));
s.on('lobby', (p) => (st.lobby = p.lobby));
s.on('gameStarted', (p) => (st.game = p.view));
s.on('errorMsg', (e) => console.log('error:', e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (pred, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await sleep(50);
  }
  return false;
};

await until(() => s.connected);
s.emit('createGame', { name: 'Host', clientId: `host-${Date.now().toString(36)}` });
await until(() => st.lobby);
const code = st.lobby.code;
fs.writeFileSync(new globalThis.URL('./.host-table-code', import.meta.url), code);
console.log('room', code);
for (let i = 1; i <= BOTS; i++) s.emit('setSlot', { index: i, status: 'bot' });
await until(() => st.lobby.slots.filter((x) => x.occupant).length >= 1 + BOTS);
console.log('computers seated; waiting up to 30 s for a human to join…');
await until(() => st.lobby.slots.filter((x) => x.occupant && !x.occupant.isBot).length >= 2, 30000);
s.emit('startGame');
await until(() => st.game);
console.log('game started');
const t0 = Date.now();
while (Date.now() - t0 < 5 * 60_000 && st.game?.phase === 'play') {
  const v = st.game;
  if (v.turnOrder[v.activeIdx] === st.id) {
    if (v.turnPhase === 'awaitMove' && v.reachable?.length) s.emit('moveTo', { tile: v.reachable[0] });
    else if (v.turnPhase === 'awaitRoll') s.emit('skipMove');
    else if (v.turnPhase === 'postMove') s.emit('endTurn');
    else if (v.turnPhase === 'awaitElevator' && v.elevatorFloors?.length) s.emit('chooseFloor', { floor: v.elevatorFloors[0] });
  }
  const sg = v.currentSuggestion;
  if (sg && !sg.resolved && sg.pendingResponderId === st.id) {
    const mine = v.yourHand.find((c) => [sg.suspectId, sg.weaponId, sg.roomId].includes(c));
    if (mine) s.emit('revealCard', { cardId: mine });
  }
  await sleep(1500);
}
console.log('host leaving');
s.close();
