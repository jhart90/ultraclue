import { describe, it, expect } from 'vitest';
import { deduceBotKnowledge, botNotesGrid, suggestionMarks, rollForgotten, BOT_LAPSE_ODDS, makeRng, type SuggestionEvent } from '../src';

const PLAYERS = ['bot', 'p1', 'p2', 'p3'];

describe('bot case-notes deduction', () => {
  it('marks its own hand held, and absent from everyone else', () => {
    const k = deduceBotKnowledge('bot', ['suspect-valentine', 'weapon-rope'], PLAYERS, []);
    expect(k.has.get('bot')!.has('suspect-valentine')).toBe(true);
    expect(k.hasnt.get('p1')!.has('suspect-valentine')).toBe(true);
    expect(k.ruledOut.has('weapon-rope')).toBe(true);
  });

  it('records an X when a player passes (holds none of the trio)', () => {
    const events: SuggestionEvent[] = [
      { suggesterId: 'p3', trio: ['suspect-mulberry', 'weapon-dagger', 'room-study'], passers: ['p1'] },
    ];
    const k = deduceBotKnowledge('bot', [], PLAYERS, events);
    for (const c of ['suspect-mulberry', 'weapon-dagger', 'room-study']) expect(k.hasnt.get('p1')!.has(c)).toBe(true);
  });

  it('marks a card solid when the bot itself was shown it', () => {
    const events: SuggestionEvent[] = [
      {
        suggesterId: 'bot',
        trio: ['suspect-mulberry', 'weapon-dagger', 'room-study'],
        passers: ['p1'],
        responderId: 'p2',
        revealedCardId: 'weapon-dagger',
      },
    ];
    const k = deduceBotKnowledge('bot', [], PLAYERS, events);
    expect(k.has.get('p2')!.has('weapon-dagger')).toBe(true);
    expect(k.ruledOut.has('weapon-dagger')).toBe(true);
    // the card is now known to be in p2's hand, so nobody else holds it
    expect(k.hasnt.get('p3')!.has('weapon-dagger')).toBe(true);
  });

  it('forms a "one of these" group when someone disproves a suggestion it did not make', () => {
    const events: SuggestionEvent[] = [
      { suggesterId: 'p1', trio: ['suspect-mulberry', 'weapon-dagger', 'room-study'], passers: [], responderId: 'p2' },
    ];
    const k = deduceBotKnowledge('bot', [], PLAYERS, events);
    const g = k.groups.find((x) => x.playerId === 'p2');
    expect(g?.cards.sort()).toEqual(['room-study', 'suspect-mulberry', 'weapon-dagger']);
    expect(k.ruledOut.has('suspect-mulberry')).toBe(false); // a group does not pin any single card
  });

  it('resolves a group to a solid once the other cards are eliminated', () => {
    const events: SuggestionEvent[] = [
      // p2 holds one of {mulberry, dagger, study}…
      { suggesterId: 'p1', trio: ['suspect-mulberry', 'weapon-dagger', 'room-study'], passers: [], responderId: 'p2' },
      // …but later passes on a suggestion including mulberry and dagger -> it must be the study
      { suggesterId: 'p3', trio: ['suspect-mulberry', 'weapon-dagger', 'room-library'], passers: ['p2'] },
    ];
    const k = deduceBotKnowledge('bot', [], PLAYERS, events);
    expect(k.has.get('p2')!.has('room-study')).toBe(true);
    expect(k.ruledOut.has('room-study')).toBe(true);
    expect(k.groups.length).toBe(0); // the group collapsed
  });

  it('renders solids, Xs and group symbols into the notes grid by turn-order column', () => {
    const events: SuggestionEvent[] = [
      { suggesterId: 'p1', trio: ['suspect-mulberry', 'weapon-dagger', 'room-study'], passers: [], responderId: 'p2' },
    ];
    const k = deduceBotKnowledge('bot', ['suspect-valentine'], PLAYERS, events);
    const grid = botNotesGrid(k, PLAYERS); // columns: bot=0, p1=1, p2=2, p3=3
    expect(grid['suspect-valentine'][0]).toBe(1); // bot holds it -> solid
    expect(grid['suspect-valentine'][1]).toBe(2); // p1 cannot -> X
    const sym = grid['suspect-mulberry'][2];
    expect(sym).toBeGreaterThanOrEqual(3); // p2's group cards share a symbol
    expect(grid['weapon-dagger'][2]).toBe(sym);
    expect(grid['room-study'][2]).toBe(sym);
  });

  it('writes one column per seat, so a 40-seat table gets 40-wide rows with no holes', () => {
    const seats = Array.from({ length: 40 }, (_, i) => (i === 0 ? 'bot' : `p${i}`));
    const events: SuggestionEvent[] = [
      { suggesterId: 'p1', trio: ['suspect-mulberry', 'weapon-dagger', 'room-study'], passers: [], responderId: 'p39' },
    ];
    const k = deduceBotKnowledge('bot', ['suspect-valentine'], seats, events);
    const grid = botNotesGrid(k, seats);
    expect(grid['suspect-valentine']).toHaveLength(40);
    expect(grid['suspect-valentine'][39]).toBe(2); // the last seat cannot hold the bot's own card
    expect(grid['suspect-mulberry'][39]).toBeGreaterThanOrEqual(3); // the responder's group symbol lands in column 39
    expect(grid['suspect-mulberry'].every((v) => Number.isInteger(v))).toBe(true);
  });
});

describe('the odd forgotten mark', () => {
  const trio = ['suspect-mulberry', 'weapon-dagger', 'room-study'];

  it('lists the marks a suggestion would put on the sheet, as this bot is entitled to see it', () => {
    const shownToMe: SuggestionEvent = { suggesterId: 'bot', trio, passers: ['p1', 'p3'], responderId: 'p2', revealedCardId: 'weapon-dagger' };
    expect(suggestionMarks(shownToMe).sort()).toEqual(
      ['p1:suspect-mulberry', 'p1:weapon-dagger', 'p1:room-study', 'p3:suspect-mulberry', 'p3:weapon-dagger', 'p3:room-study', 'p2:weapon-dagger'].sort(),
    );
    const outOfSight: SuggestionEvent = { suggesterId: 'p1', trio, passers: [], responderId: 'p2' };
    expect(suggestionMarks(outOfSight)).toEqual(['p2:*']);
    expect(suggestionMarks({ suggesterId: 'p1', trio, passers: [] })).toEqual([]);
  });

  it('leaves a forgotten X off the sheet but keeps the rest of the pass', () => {
    const events: SuggestionEvent[] = [{ suggesterId: 'p3', trio, passers: ['p1'], forgot: ['p1:weapon-dagger'] }];
    const k = deduceBotKnowledge('bot', [], PLAYERS, events);
    expect(k.hasnt.get('p1')!.has('suspect-mulberry')).toBe(true);
    expect(k.hasnt.get('p1')!.has('room-study')).toBe(true);
    expect(k.hasnt.get('p1')!.has('weapon-dagger')).toBe(false);
  });

  it('forgets a card it was shown outright: no solid, and no group in its place', () => {
    const events: SuggestionEvent[] = [
      { suggesterId: 'bot', trio, passers: ['p1'], responderId: 'p2', revealedCardId: 'weapon-dagger', forgot: ['p2:weapon-dagger'] },
    ];
    const k = deduceBotKnowledge('bot', [], PLAYERS, events);
    expect(k.has.get('p2')!.has('weapon-dagger')).toBe(false);
    expect(k.ruledOut.has('weapon-dagger')).toBe(false);
    expect(k.groups).toEqual([]);
    expect(k.hasnt.get('p1')!.has('weapon-dagger')).toBe(true); // the pass it did note still counts
  });

  it('can forget a "one of these" tag', () => {
    const events: SuggestionEvent[] = [{ suggesterId: 'p1', trio, passers: [], responderId: 'p2', forgot: ['p2:*'] }];
    expect(deduceBotKnowledge('bot', [], PLAYERS, events).groups).toEqual([]);
  });

  it('never invents a fact: with every mark forgotten it knows only its own hand', () => {
    const e: SuggestionEvent = { suggesterId: 'bot', trio, passers: ['p1', 'p3'], responderId: 'p2', revealedCardId: 'weapon-dagger' };
    const k = deduceBotKnowledge('bot', ['suspect-valentine'], PLAYERS, [{ ...e, forgot: suggestionMarks(e) }]);
    const blank = deduceBotKnowledge('bot', ['suspect-valentine'], PLAYERS, []);
    for (const p of PLAYERS) {
      expect([...k.has.get(p)!].sort()).toEqual([...blank.has.get(p)!].sort());
      expect([...k.hasnt.get(p)!].sort()).toEqual([...blank.hasnt.get(p)!].sort());
    }
    expect(k.groups).toEqual([]);
  });

  it("rolls every mark on its own, at the tier's odds: 2% easy, 0.5% medium, 0.25% hard", () => {
    expect(BOT_LAPSE_ODDS).toEqual({ easy: 0.02, medium: 0.005, hard: 0.0025 });
    const e: SuggestionEvent = { suggesterId: 'p1', trio, passers: ['bot', 'p2', 'p3'] }; // nine marks
    const marks = suggestionMarks(e);
    expect(marks).toHaveLength(9);
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const rng = makeRng(7);
      const N = 20_000;
      let forgot = 0;
      for (let i = 0; i < N; i++) {
        const f = rollForgotten(e, d, rng);
        forgot += f.length;
        for (const m of f) expect(marks).toContain(m);
      }
      const rate = forgot / (N * marks.length);
      expect(rate).toBeGreaterThan(BOT_LAPSE_ODDS[d] * 0.85);
      expect(rate).toBeLessThan(BOT_LAPSE_ODDS[d] * 1.15);
    }
    expect(rollForgotten(e, 'easy', () => 0.999)).toEqual([]); // a lucky day
    expect(rollForgotten(e, 'hard', () => 0)).toEqual(marks); // a very bad one
  });
});
