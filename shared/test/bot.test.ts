import { describe, it, expect } from 'vitest';
import {
  SUSPECTS,
  WEAPONS,
  ROOMS,
  BOARD,
  coordKey,
  makeRng,
  botAccusation,
  botSuggestion,
  botRevealCard,
  botMoveTarget,
  botShouldStay,
  botDecideAccusation,
  botThreatened,
  botThreatLevel,
  botMind,
  botBestGuess,
  type BotMind,
  FULL_POOL,
  NEUTRAL_PERSONA,
  BOT_PERSONAS,
} from '../src';

/** Rule out everything except the given solution triple. */
function ruledOutExcept(suspectId: string, weaponId: string, roomId: string): Set<string> {
  const keep = new Set([suspectId, weaponId, roomId]);
  const out = new Set<string>();
  for (const c of [...SUSPECTS, ...WEAPONS, ...ROOMS]) if (!keep.has(c.id)) out.add(c.id);
  return out;
}

describe('bot deduction', () => {
  it('does not accuse until every category is narrowed to one', () => {
    expect(botAccusation(new Set())).toBeNull();
    // rule out all but one suspect, but leave weapons/rooms open -> still no accusation
    const partial = new Set(SUSPECTS.slice(1).map((s) => s.id));
    expect(botAccusation(partial)).toBeNull();
  });

  it('accuses the lone remaining triple', () => {
    const ruled = ruledOutExcept('suspect-valentine', 'weapon-rope', 'room-study');
    expect(botAccusation(ruled)).toEqual({
      suspectId: 'suspect-valentine',
      weaponId: 'weapon-rope',
      roomId: 'room-study',
    });
  });

  it('probes for unknown suspect + weapon when not isolating a room', () => {
    // leave exactly one candidate suspect + weapon so the pick is forced and checkable
    const ruled = new Set<string>([
      ...SUSPECTS.filter((s) => s.id !== 'suspect-mulberry').map((s) => s.id),
      ...WEAPONS.filter((w) => w.id !== 'weapon-dagger').map((w) => w.id),
    ]);
    const sugg = botSuggestion(ruled, [], undefined, makeRng(5)); // no hand / no room -> just probe
    expect(sugg.suspectId).toBe('suspect-mulberry');
    expect(sugg.weaponId).toBe('weapon-dagger');
  });

  it('isolates an unknown room by suggesting a held suspect + held weapon', () => {
    const hand = ['suspect-mulberry', 'weapon-dagger', 'room-library']; // 1 held suspect, 1 held weapon
    const sugg = botSuggestion(new Set(), hand, 'room-study', makeRng(3));
    expect(sugg.suspectId).toBe('suspect-mulberry'); // from its own hand…
    expect(sugg.weaponId).toBe('weapon-dagger'); // …so the room is the only revealable card
  });

  it('reveals a card the suggester has already seen; otherwise the most-exposed one', () => {
    // p2 already saw weapon-rope from us -> re-show it (no new info)
    expect(botRevealCard(['weapon-rope', 'suspect-mulberry'], new Set(['weapon-rope']), new Map(), makeRng(1))).toBe(
      'weapon-rope',
    );
    // no repeat: reveal whichever card more other players already know
    const exposure = new Map([['suspect-mulberry', 2], ['weapon-rope', 0]]);
    expect(botRevealCard(['weapon-rope', 'suspect-mulberry'], new Set(), exposure, makeRng(1))).toBe('suspect-mulberry');
    // a single match is forced
    expect(botRevealCard(['room-study'], new Set(), new Map(), makeRng(1))).toBe('room-study');
  });

  it('prefers moving into a room over a corridor tile', () => {
    const roomTile = BOARD.rooms['room-study'].tiles[0];
    const pathTile = BOARD.starts[0].tile;
    const target = botMoveTarget([pathTile, roomTile], new Set(), makeRng(2));
    expect(coordKey(target!)).toBe(coordKey(roomTile));
  });

  it('weights its room pick per room, not per tile', () => {
    // One Lounge tile against every Ballroom tile: a per-tile pick would land in the Ballroom almost
    // every time; a per-room pick splits the visits evenly.
    const lounge = BOARD.rooms['room-lounge'].tiles.slice(0, 1);
    const ballroom = BOARD.rooms['room-ballroom'].tiles;
    const rng = makeRng(7);
    let loungeHits = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (coordKey(botMoveTarget([...ballroom, ...lounge], new Set(), rng)!) === coordKey(lounge[0])) loungeHits++;
    expect(loungeHits / N).toBeGreaterThan(0.4);
    expect(loungeHits / N).toBeLessThan(0.6);
  });

  it('stays only in an untested, still-unknown room', () => {
    expect(botShouldStay('room-study', new Set(), new Set())).toBe(true);
    expect(botShouldStay('room-study', new Set(['room-study']), new Set())).toBe(false); // ruled out
    expect(botShouldStay('room-study', new Set(), new Set(['room-study']))).toBe(false); // already tested
    expect(botShouldStay(undefined, new Set(), new Set())).toBe(false); // not in a room
  });
});

describe('bot gambles when a rival is about to win', () => {
  const bot = 'bot';
  const rival = 'A';
  const others = ['B', 'C'];
  /** A hard bot that has pinned the weapon and room but still has two suspects in play. */
  function mind(events: BotMind['events'], envelope: string[] = []): BotMind {
    const ruledOut = ruledOutExcept('suspect-valentine', 'weapon-rope', 'room-study');
    ruledOut.delete('suspect-dijon'); // second suspect still possible
    return {
      difficulty: 'hard',
      persona: NEUTRAL_PERSONA,
      botId: bot,
      hand: [],
      k: { has: new Map(), hasnt: new Map(), groups: [], ruledOut },
      envelope: new Set(envelope),
      playerIds: [bot, rival, ...others],
      pool: FULL_POOL,
      board: BOARD,
      events,
      handCounts: new Map(),
      activeIds: [bot, rival, ...others],
      round: 0,
      wrongTrios: [],
    };
  }
  const undisproved = { suggesterId: rival, trio: ['suspect-valentine', 'weapon-rope', 'room-study'], passers: [bot, ...others] };

  it('never guesses while nobody looks close', () => {
    expect(botThreatened(mind([]))).toBe(false);
    expect(botDecideAccusation(mind([]), makeRng(1))).toBeNull();
  });

  it('guesses at 1-in-2 odds after a rival\'s undisproved suggestion of still-possible cards', () => {
    const m = mind([undisproved]);
    expect(botThreatened(m)).toBe(true);
    const acc = botDecideAccusation(m, makeRng(7));
    expect(acc).not.toBeNull();
    expect(['suspect-valentine', 'suspect-dijon']).toContain(acc!.suspectId);
    expect(acc!.weaponId).toBe('weapon-rope');
    expect(acc!.roomId).toBe('room-study');
  });

  it('ignores a suggestion that was disproved, is stale, or names a card already ruled out', () => {
    expect(botThreatened(mind([{ ...undisproved, responderId: 'B' }]))).toBe(false);
    expect(botThreatened(mind([{ ...undisproved, trio: ['suspect-mulberry', 'weapon-rope', 'room-study'] }]))).toBe(false);
    // older than one round: three later suggestions push it out of the window
    const later = { suggesterId: 'B', trio: ['suspect-mulberry', 'weapon-candlestick', 'room-lounge'], passers: [], responderId: 'C' };
    expect(botThreatened(mind([undisproved, later, later, later]))).toBe(false);
  });

  it('holds out when the odds are worse than 1 in 3, even under threat', () => {
    const m = mind([undisproved]);
    m.k.ruledOut.delete('weapon-candlestick'); // 2 suspects x 2 weapons = 1 in 4
    expect(botDecideAccusation(m, makeRng(3))).toBeNull();
  });
});

describe('bots read the table', () => {
  const bot = 'bot';
  const seats = [bot, 'A', 'B', 'C', 'D', 'E'];
  /** A hard bot at a six-handed table with the weapon and room pinned and two suspects left. */
  function mind(over: Partial<BotMind> = {}): BotMind {
    const ruledOut = ruledOutExcept('suspect-valentine', 'weapon-rope', 'room-study');
    ruledOut.delete('suspect-dijon'); // second suspect still possible
    return {
      difficulty: 'hard',
      persona: NEUTRAL_PERSONA,
      botId: bot,
      hand: [],
      k: { has: new Map(), hasnt: new Map(), groups: [], ruledOut },
      envelope: new Set<string>(),
      playerIds: seats,
      pool: FULL_POOL,
      board: BOARD,
      events: [],
      handCounts: new Map(seats.map((p) => [p, 19])),
      activeIds: [...seats],
      round: 0,
      wrongTrios: [],
      ...over,
    };
  }
  const tellFrom = (p: string, trio = ['suspect-valentine', 'weapon-rope', 'room-study']) => ({
    suggesterId: p,
    trio,
    passers: seats.filter((x) => x !== p),
  });

  it('sees more danger in a full table than in a duel', () => {
    // Every rival still in takes a turn before this bot's next one, so each is another chance.
    expect(botThreatLevel(mind())).toBeGreaterThan(botThreatLevel(mind({ activeIds: [bot, 'A'] })));
  });

  it('ignores a knocked-out rival, however good their last suggestion looked', () => {
    const live = mind({ events: [tellFrom('A')] });
    const dead = mind({ events: [tellFrom('A')], activeIds: seats.filter((p) => p !== 'A') });
    expect(botThreatened(live)).toBe(true);
    expect(botThreatLevel(dead)).toBeLessThan(botThreatLevel(live));
    expect(botThreatened(dead)).toBe(false); // eliminated players never accuse again
  });

  it('takes rivals holding fat hands more seriously than rivals holding thin ones', () => {
    const thin = botThreatLevel(mind({ handCounts: new Map(seats.map((p) => [p, 4])) }));
    const fat = botThreatLevel(mind({ handCounts: new Map(seats.map((p) => [p, 30])) }));
    expect(fat).toBeGreaterThan(thin);
  });

  it('counts the cards a rival has been shown, not just the ones they hold', () => {
    const answered = Array.from({ length: 12 }, (_, i) => ({
      suggesterId: 'A',
      trio: [SUSPECTS[i].id, WEAPONS[i].id, ROOMS[i].id],
      passers: [],
      responderId: 'B',
    }));
    expect(botThreatLevel(mind({ events: answered }))).toBeGreaterThan(botThreatLevel(mind()));
  });

  it('the Understudy jumps at odds the by-the-book bot refuses', () => {
    const tryIt = (persona: BotMind['persona']) => {
      const m = mind({ persona, events: [tellFrom('A')] });
      m.k.ruledOut.delete('weapon-candlestick'); // 2 suspects x 2 weapons = 1 in 4
      return botDecideAccusation(m, makeRng(3));
    };
    expect(tryIt(NEUTRAL_PERSONA)).toBeNull();
    expect(tryIt(BOT_PERSONAS.understudy)).not.toBeNull();
  });

  it('an impatient persona settles for worse odds as the rounds go by', () => {
    const rambling = (round: number) => {
      const m = mind({ persona: BOT_PERSONAS.rambler, round });
      m.k.ruledOut.delete('weapon-candlestick');
      m.k.ruledOut.delete('room-lounge'); // 2 x 2 x 2 = 1 in 8
      return botDecideAccusation(m, makeRng(3));
    };
    expect(rambling(0)).toBeNull();
    expect(rambling(40)).not.toBeNull();
  });

  it('the Bluffer swallows a rival\'s undisproved trio whole', () => {
    const copied = ['suspect-dijon', 'weapon-rope', 'room-study'];
    const m = mind({ persona: BOT_PERSONAS.bluffer, events: [tellFrom('A', copied)] });
    // Widen the suspect field until the odds alone could never justify an accusation, so anything
    // it does say has to have been copied rather than reasoned out.
    for (const s of SUSPECTS.slice(0, 8)) m.k.ruledOut.delete(s.id);
    const rng = makeRng(11);
    const said: string[] = [];
    for (let i = 0; i < 100; i++) {
      const acc = botDecideAccusation(m, rng);
      if (acc) said.push([acc.suspectId, acc.weaponId, acc.roomId].join('|'));
    }
    expect(said.length).toBeGreaterThan(0);
    expect(said.every((t) => t === copied.join('|'))).toBe(true);
  });
});

describe('bots learn from a failed accusation', () => {
  const bot = 'bot';
  const seats = [bot, 'A', 'B', 'C'];
  const [SUS, WEA] = ['suspect-valentine', 'weapon-rope'];

  /** A hard bot with the suspect and weapon pinned and `rooms` still open. `tell` makes a rival
   *  look about to win, which is what the by-the-book persona needs before it will gamble at all. */
  function mind(rooms: string[], wrongTrios: string[][] = [], tell = true): BotMind {
    const ruledOut = ruledOutExcept(SUS, WEA, rooms[0]);
    for (const r of rooms) ruledOut.delete(r);
    return {
      difficulty: 'hard',
      persona: NEUTRAL_PERSONA,
      botId: bot,
      hand: [],
      k: { has: new Map(), hasnt: new Map(), groups: [], ruledOut },
      envelope: new Set<string>(),
      playerIds: seats,
      pool: FULL_POOL,
      board: BOARD,
      events: tell ? [{ suggesterId: 'A', trio: [SUS, WEA, rooms[0]], passers: [bot, 'B', 'C'] }] : [],
      handCounts: new Map(seats.map((p) => [p, 29])),
      activeIds: [...seats],
      round: 0,
      wrongTrios,
    };
  }

  it('never re-accuses a trio the table has already disproved', () => {
    // One trio left and a rival closing in: without the record of the failure it accuses at once.
    expect(botDecideAccusation(mind(['room-study']), makeRng(4))).not.toBeNull();
    expect(botDecideAccusation(mind(['room-study'], [[SUS, WEA, 'room-study']]), makeRng(4))).toBeNull();
  });

  it('steers its guess away from the burned trio', () => {
    const m = mind(['room-study', 'room-lounge'], [[SUS, WEA, 'room-lounge']]);
    const rng = makeRng(9);
    let said = 0;
    for (let i = 0; i < 40; i++) {
      const acc = botDecideAccusation(m, rng);
      if (!acc) continue;
      said++;
      expect(acc.roomId).toBe('room-study');
    }
    expect(said).toBeGreaterThan(0);
  });

  it('prices a burned trio out of the odds', () => {
    // Three rooms open is a 1-in-3 shot, just under the by-the-book floor once CAUTION is applied,
    // so it waits. Burn one of the three and the remaining field is a coin flip, which it takes.
    const rooms = ['room-study', 'room-lounge', 'room-kitchen'];
    expect(botDecideAccusation(mind(rooms), makeRng(2))).toBeNull();
    const acc = botDecideAccusation(mind(rooms, [[SUS, WEA, 'room-kitchen']]), makeRng(2));
    expect(acc).not.toBeNull();
    expect(acc!.roomId).not.toBe('room-kitchen');
  });

  it('does not cross off the cards of a failed accusation on their own', () => {
    // With nothing else settled, "not this combination" says nothing about any single card. A bot
    // that crossed all three off would be ruling the real solution out of its own notes.
    const m = botMind('hard', bot, [], seats, [], undefined, FULL_POOL, BOARD, undefined, {
      wrongTrios: [['suspect-dijon', 'weapon-dagger', 'room-lounge']],
    });
    for (const c of ['suspect-dijon', 'weapon-dagger', 'room-lounge']) expect(m.k.ruledOut.has(c)).toBe(false);
  });

  it('pins the third card once the other two categories are settled', () => {
    // A hand holding all but one suspect and all but one weapon settles both by elimination, and
    // leaves three rooms open.
    const hand = [
      ...SUSPECTS.filter((s) => s.id !== SUS).map((s) => s.id),
      ...WEAPONS.filter((w) => w.id !== WEA).map((w) => w.id),
      ...ROOMS.filter((r) => !['room-study', 'room-lounge', 'room-library'].includes(r.id)).map((r) => r.id),
    ];
    const build = (wrongTrios: string[][]) =>
      botMind('hard', bot, hand, seats, [], undefined, FULL_POOL, BOARD, undefined, { wrongTrios });
    expect(build([]).k.ruledOut.has('room-lounge')).toBe(false);
    const after = build([[SUS, WEA, 'room-lounge']]);
    expect(after.k.ruledOut.has('room-lounge')).toBe(true); // that room cannot be the answer...
    expect(after.k.ruledOut.has(SUS)).toBe(false); // ...but the settled pair is untouched
    expect(after.k.ruledOut.has(WEA)).toBe(false);
  });

  it('chains one refutation into the next', () => {
    // Two rooms open and two failed accusations naming both: the first settles the room, and with
    // it the whole case, so nothing is left to guess at.
    const hand = [
      ...SUSPECTS.filter((s) => s.id !== SUS).map((s) => s.id),
      ...WEAPONS.filter((w) => w.id !== WEA).map((w) => w.id),
      ...ROOMS.filter((r) => !['room-study', 'room-lounge'].includes(r.id)).map((r) => r.id),
    ];
    const m = botMind('hard', bot, hand, seats, [], undefined, FULL_POOL, BOARD, undefined, {
      wrongTrios: [[SUS, WEA, 'room-lounge']],
    });
    expect(m.k.ruledOut.has('room-lounge')).toBe(true);
    expect(botDecideAccusation(m, makeRng(1))).toEqual({ suspectId: SUS, weaponId: WEA, roomId: 'room-study' });
  });
});

describe('what a bot would accuse if made to', () => {
  const bot = 'bot';
  const seats = [bot, 'A', 'B', 'C'];
  const [SUS, WEA] = ['suspect-valentine', 'weapon-rope'];

  function mind(rooms: string[], wrongTrios: string[][] = []): BotMind {
    const ruledOut = ruledOutExcept(SUS, WEA, rooms[0]);
    for (const r of rooms) ruledOut.delete(r);
    return {
      difficulty: 'hard',
      persona: NEUTRAL_PERSONA,
      botId: bot,
      hand: [],
      k: { has: new Map(), hasnt: new Map(), groups: [], ruledOut },
      envelope: new Set<string>(),
      playerIds: seats,
      pool: FULL_POOL,
      board: BOARD,
      events: [],
      handCounts: new Map(seats.map((p) => [p, 29])),
      activeIds: [...seats],
      round: 0,
      wrongTrios,
    };
  }

  it('names the solved case with one combination open', () => {
    const g = botBestGuess(mind(['room-study']), makeRng(1));
    expect(g).toEqual({ suspectId: SUS, weaponId: WEA, roomId: 'room-study', combos: 1 });
  });

  it('keeps the settled cards and guesses the open category, never a burned trio', () => {
    const m = mind(['room-study', 'room-lounge', 'room-kitchen'], [[SUS, WEA, 'room-kitchen']]);
    const rng = makeRng(7);
    for (let i = 0; i < 30; i++) {
      const g = botBestGuess(m, rng)!;
      expect(g.suspectId).toBe(SUS);
      expect(g.weaponId).toBe(WEA);
      expect(['room-study', 'room-lounge']).toContain(g.roomId);
      expect(g.combos).toBe(2); // three rooms open, one of them already disproved
    }
  });

  it('always answers, even with nothing ruled out', () => {
    const m = botMind('easy', bot, [], seats, []);
    const g = botBestGuess(m, makeRng(3))!;
    expect(g).not.toBeNull();
    expect(g.suspectId.startsWith('suspect-')).toBe(true);
    expect(g.weaponId.startsWith('weapon-')).toBe(true);
    expect(g.roomId.startsWith('room-')).toBe(true);
    expect(g.combos).toBe(40 * 40 * 40);
  });
});
