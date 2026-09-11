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
  wrongAccusationTrios,
  botDecideAccusation,
  botDecideSuggestion,
  botSplitValue,
  getCard,
  BOT_PERSONAS,
  type BotMind,
  botDecideStay,
  botDecideShortcut,
  botDecideMove,
  botDecideFloor,
  roomIdAt,
  type BotDifficulty,
  type Player,
  rollForgotten,
  suggestionMarks,
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
// INTERROGATE=<0..1> overrides every personality's appetite for putting a "holds one of these" note
// to its holder, so the same seed can be replayed with the habit switched off (0) or on for all (1).
if (process.env.INTERROGATE !== undefined) {
  for (const p of Object.values(BOT_PERSONAS)) p.interrogate = Number(process.env.INTERROGATE);
}
/** Whether the bot has a note it could put to its holder from here: a note card it may name (an
 *  open suspect or weapon, or this very room) whose holder answers before anyone known to hold it
 *  or this room — a room somebody earlier in the queue holds blocks every question asked from it. */
function noteReachable(m: BotMind, q: string[], roomId: string): boolean {
  return m.k.groups.some(
    (g) =>
      q.includes(g.playerId) &&
      g.cards.some((cd) => (cd === roomId || (!m.k.ruledOut.has(cd) && getCard(cd)?.type !== 'room')) && botSplitValue(m, q, cd === roomId ? [cd] : [cd, roomId]) > 0),
  );
}

const z = () => ({ easy: 0, medium: 0, hard: 0 });
type PersonaRow = { seats: number; wins: number; wrong: number; turns: number; stays: number; shortcuts: number; lifts: number; unknown: number; known: number; corridor: number; bluffs: number; noteTurns: number; splits: number };
const PS = new Map<string, PersonaRow>();
const prow = (id: string): PersonaRow => {
  let r = PS.get(id);
  if (!r) { r = { seats: 0, wins: 0, wrong: 0, turns: 0, stays: 0, shortcuts: 0, lifts: 0, unknown: 0, known: 0, corridor: 0, bluffs: 0, noteTurns: 0, splits: 0 }; PS.set(id, r); }
  return r;
};
const S = {
  games: 0, finished: 0, solved: 0, lastStanding: 0, wrongPerGame: [] as number[],
  turnsToEnd: [] as number[], wins: z(), wrong: z(), eliminated: z(), turns: z(), seats: z(),
  moves: z(), intoUnknownRoom: z(), intoKnownRoom: z(), corridor: z(), stays: z(), shortcuts: z(), noSuggestion: z(),
  suggestions: z(), reveals: z(), revealsKnown: z(), nobody: z(), marks: z(), forgot: z(),
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
    prow(getPlayer(g, id)!.persona ?? 'none').seats++;
    getPlayer(g, id)!.difficulty = d;
  });
  const log: SuggestionEvent[] = [];
  const visited = new Map<string, Set<string>>();
  const stays = new Map<string, { room: string; n: number }>();
  const shown = new Map<string, Set<string>>();
  let lastKey = '';
  const handCounts = () => new Map(g.players.map((p) => [p.id, p.hand.length]));
  // Like the server: each seat's forgotten marks are rolled the first time it looks at a suggestion
  // and kept, keyed by log index, so a lapse stays a lapse.
  const lapses = new Map<string, Map<number, string[]>>();
  const mindOf = (pid: string) => {
    const d = diff.get(pid)!;
    let mine = lapses.get(pid);
    if (!mine) lapses.set(pid, (mine = new Map()));
    const events = log.map((e, i) => {
      const view: SuggestionEvent = { ...e, revealedCardId: e.suggesterId === pid ? e.revealedCardId : undefined };
      let forgot = mine!.get(i);
      if (!forgot) {
        forgot = rollForgotten(view, d, rng);
        mine!.set(i, forgot);
        S.marks[d] += suggestionMarks(view).length;
        S.forgot[d] += forgot.length;
      }
      if (forgot.length) view.forgot = forgot;
      return view;
    });
    return botMind(d, pid, getPlayer(g, pid)?.hand ?? [], g.turnOrder, events, handCounts(), undefined, undefined,
      getPlayer(g, pid)?.persona,
      { eliminatedIds: g.players.filter((p) => p.eliminated).map((p) => p.id), round: g.round ?? 0, wrongTrios: wrongAccusationTrios(g) });
  };
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
  let wrongHere = 0;
  let solvedIt = false;
  while (g.phase === 'play' && turns < MAX_TURNS) {
    turns++;
    const cur = getPlayer(g, currentPlayerId(g))!;
    const d = diff.get(cur.id)!;
    S.turns[d]++;
    const pr = prow(cur.persona ?? 'none');
    pr.turns++;
    const mind = mindOf(cur.id);
    const unknownRooms = new Set(Object.keys(BOARD.rooms).filter((r) => !mind.k.ruledOut.has(r) && !mind.envelope.has(r)));
    for (let step = 0; step < 4; step++) {
      if (g.turnPhase === 'awaitRoll') {
        const me = getPlayer(g, cur.id)!;
        const v = visited.get(cur.id) ?? new Set<string>();
        const st = stays.get(cur.id);
        const n = st && st.room === me.inRoomId ? st.n : 0;
        if (botDecideShortcut(mind, me.inRoomId, rng)) { g = takeShortcut(g, cur.id); stays.delete(cur.id); S.shortcuts[d]++; pr.shortcuts++; }
        else if (botDecideStay(mind, me.inRoomId, n, v)) { g = skipMovement(g, cur.id); stays.set(cur.id, { room: me.inRoomId!, n: n + 1 }); S.stays[d]++; pr.stays++; }
        else { g = rollAndMove(g, cur.id, rng); stays.delete(cur.id); }
      } else if (g.turnPhase === 'awaitMove') {
        const dest = botDecideMove(mind, activeReachable(g), rng, queueFor(cur.id), visited.get(cur.id));
        if (!dest) break;
        g = moveTo(g, cur.id, dest);
        S.moves[d]++;
        const r = roomIdAt(BOARD, dest);
        if (r) { (unknownRooms.has(r) ? S.intoUnknownRoom : S.intoKnownRoom)[d]++; if (unknownRooms.has(r)) pr.unknown++; else pr.known++; }
        else if (g.turnPhase !== 'awaitElevator') { S.corridor[d]++; pr.corridor++; }
        else pr.lifts++;
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
      if (out.correct) solvedIt = true;
      else { S.wrong[d]++; S.eliminated[d]++; pr.wrong++; wrongHere++; }
      continue;
    }
    if (g.turnPhase === 'postMove' && me.inRoomId) {
      const q = queueFor(cur.id);
      const sugg = botDecideSuggestion(m2, me.inRoomId, q, rng);
      if (me.hand.includes(sugg.suspectId) && me.hand.includes(sugg.weaponId)) pr.bluffs++;
      // Interrogation: of the turns where it held a "holds one of these" note about a rival still to
      // answer, how often its suggestion put one of that note's cards to them.
      if (noteReachable(m2, q, me.inRoomId)) {
        pr.noteTurns++;
        if (botSplitValue(m2, q, [sugg.suspectId, sugg.weaponId, me.inRoomId]) > 0) pr.splits++;
      }
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
  S.wrongPerGame.push(wrongHere);
  if (g.phase === 'ended') {
    S.finished++;
    // A game ends one of two ways: somebody names the envelope, or wrong accusations knock everyone
    // else out and the survivor wins by default. Only the first is a real finish.
    if (solvedIt) S.solved++;
    else S.lastStanding++;
    S.turnsToEnd.push(turns);
    const w = diff.get(g.winnerId ?? '');
    if (w) S.wins[w]++;
    const wp = getPlayer(g, g.winnerId ?? '');
    if (wp) prow(wp.persona ?? 'none').wins++;
  }
}

const t0 = Date.now();
for (let i = 0; i < N_GAMES; i++) runGame(SEED0 + i);
const avg = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 'n/a');
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a');
console.log(`\n=== ${N_PLAYERS} players × ${N_GAMES} games, mode=${MODE} (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);
console.log(`finished: ${S.finished}/${S.games}  avg turns to end: ${avg(S.turnsToEnd)}  (cap ${MAX_TURNS})`);
const withWrong = S.wrongPerGame.filter((n) => n > 0).length;
console.log(`solved by a correct accusation: ${S.solved}/${S.games} (${pct(S.solved, S.games)}); last detective standing: ${S.lastStanding}; unfinished: ${S.games - S.finished}`);
console.log(`wrong accusations per game: avg ${avg(S.wrongPerGame)}, at least one in ${withWrong}/${S.games} (${pct(withWrong, S.games)}), max ${Math.max(0, ...S.wrongPerGame)}`);
for (const d of ['easy', 'medium', 'hard'] as BotDifficulty[]) {
  if (!S.seats[d]) continue;
  console.log(`--- ${d}: ${S.seats[d]} seats, ${S.wins[d]} wins (${pct(S.wins[d], S.seats[d])} per seat), ${S.wrong[d]} wrong accusations`);
  console.log(`  moves into unknown room ${pct(S.intoUnknownRoom[d], S.moves[d])}, known room ${pct(S.intoKnownRoom[d], S.moves[d])}, corridor ${pct(S.corridor[d], S.moves[d])}; stays ${pct(S.stays[d], S.turns[d])} of turns; shortcuts ${S.shortcuts[d]}`);
  console.log(`  turns with no suggestion ${pct(S.noSuggestion[d], S.turns[d])}; reveals ${S.reveals[d]}, already-known shown ${pct(S.revealsKnown[d], S.reveals[d])}, nobody disproved ${S.nobody[d]}`);
  console.log(`  marks witnessed ${S.marks[d]}, never written down ${S.forgot[d]} (${(S.marks[d] ? (100 * S.forgot[d]) / S.marks[d] : 0).toFixed(2)}%)`);
}
console.log('--- by personality (per seat): wins, wrong accusations; per turn: stays, passages, lift rides, moves into unknown/known rooms, corridor stops, own-hand suggestions; notes: suggestions that put a note to its holder, of turns it could');
for (const [id, r] of [...PS.entries()].sort()) {
  const pt = (n: number) => pct(n, r.turns);
  console.log(`  ${id.padEnd(9)} seats ${String(r.seats).padStart(3)}  wins ${pct(r.wins, r.seats).padStart(6)}  wrong ${pct(r.wrong, r.seats).padStart(6)} | stays ${pt(r.stays).padStart(5)} passages ${pt(r.shortcuts).padStart(5)} lifts ${pt(r.lifts).padStart(5)} unknown ${pt(r.unknown).padStart(5)} known ${pt(r.known).padStart(5)} corridor ${pt(r.corridor).padStart(5)} bluffs ${pt(r.bluffs).padStart(5)} | notes ${pct(r.splits, r.noteTurns).padStart(6)} of ${String(r.noteTurns).padStart(4)}`);
}
