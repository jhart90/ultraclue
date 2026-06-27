import { describe, it, expect } from 'vitest';
import { deduceBotKnowledge, botNotesGrid, type SuggestionEvent } from '../src';

const PLAYERS = ['bot', 'p1', 'p2', 'p3'];

describe('bot detective-notes deduction', () => {
  it('marks its own hand held, and absent from everyone else', () => {
    const k = deduceBotKnowledge('bot', ['suspect-scarlet', 'weapon-rope'], PLAYERS, []);
    expect(k.has.get('bot')!.has('suspect-scarlet')).toBe(true);
    expect(k.hasnt.get('p1')!.has('suspect-scarlet')).toBe(true);
    expect(k.ruledOut.has('weapon-rope')).toBe(true);
  });

  it('records an X when a player passes (holds none of the trio)', () => {
    const events: SuggestionEvent[] = [
      { suggesterId: 'p3', trio: ['suspect-plum', 'weapon-dagger', 'room-study'], passers: ['p1'] },
    ];
    const k = deduceBotKnowledge('bot', [], PLAYERS, events);
    for (const c of ['suspect-plum', 'weapon-dagger', 'room-study']) expect(k.hasnt.get('p1')!.has(c)).toBe(true);
  });

  it('marks a card solid when the bot itself was shown it', () => {
    const events: SuggestionEvent[] = [
      {
        suggesterId: 'bot',
        trio: ['suspect-plum', 'weapon-dagger', 'room-study'],
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
      { suggesterId: 'p1', trio: ['suspect-plum', 'weapon-dagger', 'room-study'], passers: [], responderId: 'p2' },
    ];
    const k = deduceBotKnowledge('bot', [], PLAYERS, events);
    const g = k.groups.find((x) => x.playerId === 'p2');
    expect(g?.cards.sort()).toEqual(['room-study', 'suspect-plum', 'weapon-dagger']);
    expect(k.ruledOut.has('suspect-plum')).toBe(false); // a group does not pin any single card
  });

  it('resolves a group to a solid once the other cards are eliminated', () => {
    const events: SuggestionEvent[] = [
      // p2 holds one of {plum, dagger, study}…
      { suggesterId: 'p1', trio: ['suspect-plum', 'weapon-dagger', 'room-study'], passers: [], responderId: 'p2' },
      // …but later passes on a suggestion including plum and dagger -> it must be the study
      { suggesterId: 'p3', trio: ['suspect-plum', 'weapon-dagger', 'room-library'], passers: ['p2'] },
    ];
    const k = deduceBotKnowledge('bot', [], PLAYERS, events);
    expect(k.has.get('p2')!.has('room-study')).toBe(true);
    expect(k.ruledOut.has('room-study')).toBe(true);
    expect(k.groups.length).toBe(0); // the group collapsed
  });

  it('renders solids, Xs and group symbols into the notes grid by turn-order column', () => {
    const events: SuggestionEvent[] = [
      { suggesterId: 'p1', trio: ['suspect-plum', 'weapon-dagger', 'room-study'], passers: [], responderId: 'p2' },
    ];
    const k = deduceBotKnowledge('bot', ['suspect-scarlet'], PLAYERS, events);
    const grid = botNotesGrid(k, PLAYERS); // columns: bot=0, p1=1, p2=2, p3=3
    expect(grid['suspect-scarlet'][0]).toBe(1); // bot holds it -> solid
    expect(grid['suspect-scarlet'][1]).toBe(2); // p1 cannot -> X
    const sym = grid['suspect-plum'][2];
    expect(sym).toBeGreaterThanOrEqual(3); // p2's group cards share a symbol
    expect(grid['weapon-dagger'][2]).toBe(sym);
    expect(grid['room-study'][2]).toBe(sym);
  });
});
