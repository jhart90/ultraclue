// Headless bot-vs-bot simulator: replicates the server's bot loop with no timers, so many games can
// be played in seconds and the computer players' strategy audited by difficulty.
//   npx tsx scripts/botsim.ts <players> <games> <maxTurns> <seed> <mode>
//   mode: easy | medium | hard | mixed (seats cycle easy/medium/hard) | em | mh (two-way match-ups)
import {
  SUSPECTS,
  BOARD,
  startGame,
  makeRng,
  currentPlayerId,
  getPlayer,
  rollAndMove,
  moveTo,
  chooseFloor,
  elevatorOptions,
  skipMovement,
  takeShortcut,
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
  roomIdAt,
  type BotDifficulty,
  type Player,
  type SuggestionEvent,
} from 'shared';

const N_PLAYERS = Number(process.argv[2] ?? 8);
const N_GAMES = Number(process.argv[3] ?? 10);
const MAX_TURNS = Number(process.argv[4] ?? 6000);
const SEED0 = Number(process.argv[5] ?? 1);
const MODE = process.argv[6] ?? 'mixed';
const TIERS: Record<string, BotDifficulty[]> = {
  easy: ['easy'],
  medium: ['medium'],
  hard: ['hard'],
  mixed: ['easy', 'medium', 'hard'],
  em: ['easy', 'medium'],
  mh: ['medium', 'hard'],
  eh: ['easy', 'hard'],
};
const tiers = TIERS[MODE] ?? TIERS.mixed;

const z = () => ({ easy: 0, medium: 0, hard: 0 });
const S = {
  games: 0, finished: 0, turnsToEnd: [] as number[], wins: z(), wrong: z(), eliminated: z(), turns: z(), seats: z(),
  moves: z(), intoUnknownRoom: z(), intoKnownRoom: z(), corridor: z(), stays: z(), shortcuts: z(), noSuggestion: z(),
  suggestions: z(), reveals: z(), revealsKnown: z(), nobody: z(),
};

function runGame(seed: number): void {
  const rng = makeRng(seed);
  const players: Player[] = SUSPECTS.slice()
    .sort(() => rng() - 0.5)
    .slice(0, N_PLAYERS)
    .map((s, i) => ({
      id: `bot-${i}`, name: s.title, suspectId: s.id, isBot: true, isHost: false, connected: true,
      hand: [], eliminated: false, position: { x: 0, y: 0 },
    }));
  let g = startGame('SIM', players, rng);
  const diff = new Map<string, BotDifficulty>();
  g.turnOrder.forEach((id, i) => {
    const d = tiers[i % tiers.length];
    diff.set(id, d);
    S.seats[d]++;
    getPlayer(g, id)!.difficulty = d;
  });
  const log: SuggestionEvent[] = [];
  const visited = new Map<string, Set<string>>();
  const stays = new Map<string, { room: string; n: number }>();
  const shown = new Map<string, Set<string>>();
  let lastKey = '';
  const handCounts = () => new Map(g.players.map((p) => [p.id, p.hand.length]));
  const mindOf = (pid: string) =>
    botMind(diff.get(pid), pid, getPlayer(g, pid)?.hand ?? [], g.turnOrder,
      log.map((e) => ({ ...e, revealedCardId: e.suggesterId === pid ? e.revealedCardId : undefined })), handCounts());
  const queueFor = (pid: string) => {
    const o = g.turnOrder; const st = o.indexOf(pid); const q: string[] = [];
    for (let k = 1; k < o.length; k++) { const id = o[(st + k) % o.length]; if (!getPlayer(g, id)!.eliminated) q.push(id); }
    return q;
  };
  const record = () => {
    const sg = g.currentSuggestion;
    if (!sg?.resolved) return;
    const key = `${sg.suggesterId}|${sg.suspectId}|${sg.weaponId}|${sg.roomId}|${sg.responderId ?? ''}|${sg.revealedCardId ?? ''}`;
    if (lastKey === key) return;
    lastKey = key;
    const revealed = sg.anyRevealed && sg.responderId != null;
    log.push({ suggesterId: sg.suggesterId, trio: [sg.suspectId, sg.weaponId, sg.roomId], passers: [...sg.passes],
      responderId: revealed ? sg.responderId : undefined, revealedCardId: revealed ? sg.revealedCardId : undefined });
  };
  const settle = () => {
    while (g.phase === 'play' && g.currentSuggestion && !g.currentSuggestion.resolved && g.currentSuggestion.pendingResponderId) {
      const sg = g.currentSuggestion; const botId = sg.pendingResponderId!;
      const trio = [sg.suspectId, sg.weaponId, sg.roomId];
      const matches = (getPlayer(g, botId)?.hand ?? []).filter((c) => trio.includes(c));
      if (!matches.length) { g = passSuggestion(g, botId, rng); continue; }
      const key = `${botId}|${sg.suggesterId}`;
      const seen = shown.get(key) ?? new Set<string>();
      const exposure = new Map<string, number>();
      for (const [k, cards] of shown) if (k.startsWith(`${botId}|`)) for (const c of cards) exposure.set(c, (exposure.get(c) ?? 0) + 1);
      const card = botRevealCard(matches, seen, exposure, rng);
      seen.add(card); shown.set(key, seen);
      g = respondToSuggestion(g, botId, card, rng);
    }
    record();
  };

  let turns = 0;
  while (g.phase === 'play' && turns < MAX_TURNS) {
    turns++;
    const cur = getPlayer(g, currentPlayerId(g))!;
    const d = diff.get(cur.id)!;
    S.turns[d]++;
    const mind = mindOf(cur.id);
    const unknownRooms = new Set(Object.keys(BOARD.rooms).filter((r) => !mind.k.ruledOut.has(r) && !mind.envelope.has(r)));
    for (let step = 0; step < 4; step++) {
      if (g.turnPhase === 'awaitRoll') {
        const me = getPlayer(g, cur.id)!;
        const v = visited.get(cur.id) ?? new Set<string>();
        const st = stays.get(cur.id);
        const n = st && st.room === me.inRoomId ? st.n : 0;
        if (botDecideShortcut(mind, me.inRoomId)) { g = takeShortcut(g, cur.id); stays.delete(cur.id); S.shortcuts[d]++; }
        else if (botDecideStay(mind, me.inRoomId, n, v)) { g = skipMovement(g, cur.id); stays.set(cur.id, { room: me.inRoomId!, n: n + 1 }); S.stays[d]++; }
        else { g = rollAndMove(g, cur.id, rng); stays.delete(cur.id); }
      } else if (g.turnPhase === 'awaitMove') {
        const dest = botDecideMove(mind, activeReachable(g), rng, queueFor(cur.id));
        if (!dest) break;
        g = moveTo(g, cur.id, dest);
        S.moves[d]++;
        const r = roomIdAt(BOARD, dest);
        if (r) (unknownRooms.has(r) ? S.intoUnknownRoom : S.intoKnownRoom)[d]++;
        else if (g.turnPhase !== 'awaitElevator') S.corridor[d]++;
      } else if (g.turnPhase === 'awaitElevator' && g.elevatorRide) {
        g = chooseFloor(g, cur.id, botDecideFloor(mind, elevatorOptions(g.elevatorRide.fromFloor), rng), rng);
      } else break;
    }
    const me = getPlayer(g, cur.id)!;
    const m2 = mindOf(cur.id);
    const acc = g.turnPhase === 'postMove' ? botDecideAccusation(m2, rng) : null;
    if (acc) {
      const out = makeAccusation(g, cur.id, acc.suspectId, acc.weaponId, acc.roomId, rng);
      g = out.state;
      if (!out.correct) { S.wrong[d]++; S.eliminated[d]++; }
      continue;
    }
    if (g.turnPhase === 'postMove' && me.inRoomId) {
      const sugg = botDecideSuggestion(m2, me.inRoomId, queueFor(cur.id), rng);
      const v = visited.get(cur.id) ?? new Set<string>(); v.add(me.inRoomId); visited.set(cur.id, v);
      S.suggestions[d]++;
      g = makeSuggestion(g, cur.id, sugg.suspectId, sugg.weaponId, me.inRoomId, rng);
      settle();
      const last = log[log.length - 1];
      if (last?.suggesterId === cur.id) {
        if (last.responderId) { S.reveals[d]++; if (m2.k.has.get(last.responderId)?.has(last.revealedCardId!)) S.revealsKnown[d]++; }
        else S.nobody[d]++;
      }
      continue;
    }
    S.noSuggestion[d]++;
    g = g.turnPhase === 'postMove' ? endTurn(g, cur.id, rng) : passTurn(g, cur.id, rng);
  }
  S.games++;
  if (g.phase === 'ended') {
    S.finished++;
    S.turnsToEnd.push(turns);
    const w = diff.get(g.winnerId ?? '');
    if (w) S.wins[w]++;
  }
}

const t0 = Date.now();
for (let i = 0; i < N_GAMES; i++) runGame(SEED0 + i);
const avg = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 'n/a');
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a');
console.log(`\n=== ${N_PLAYERS} players × ${N_GAMES} games, mode=${MODE} (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);
console.log(`finished: ${S.finished}/${S.games}  avg turns to end: ${avg(S.turnsToEnd)}  (cap ${MAX_TURNS})`);
for (const d of ['easy', 'medium', 'hard'] as BotDifficulty[]) {
  if (!S.seats[d]) continue;
  console.log(`--- ${d}: ${S.seats[d]} seats, ${S.wins[d]} wins (${pct(S.wins[d], S.seats[d])} per seat), ${S.wrong[d]} wrong accusations`);
  console.log(`  moves into unknown room ${pct(S.intoUnknownRoom[d], S.moves[d])}, known room ${pct(S.intoKnownRoom[d], S.moves[d])}, corridor ${pct(S.corridor[d], S.moves[d])}; stays ${pct(S.stays[d], S.turns[d])} of turns; shortcuts ${S.shortcuts[d]}`);
  console.log(`  turns with no suggestion ${pct(S.noSuggestion[d], S.turns[d])}; reveals ${S.reveals[d]}, already-known shown ${pct(S.revealsKnown[d], S.reveals[d])}, nobody disproved ${S.nobody[d]}`);
}
