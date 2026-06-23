import { describe, it, expect } from 'vitest';
import { SUSPECTS, WEAPONS, ROOMS, ALL_CARDS, getCard, suspectsByTurnOrder } from '../src/data';

describe('card data integrity', () => {
  it('has exactly 40 of each card type (120 total)', () => {
    expect(SUSPECTS).toHaveLength(40);
    expect(WEAPONS).toHaveLength(40);
    expect(ROOMS).toHaveLength(40);
    expect(ALL_CARDS).toHaveLength(120);
  });

  it('has unique card ids', () => {
    const ids = ALL_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every card has a title and phrase', () => {
    for (const c of ALL_CARDS) {
      expect(c.title.length, c.id).toBeGreaterThan(0);
      expect(c.phrase.length, c.id).toBeGreaterThan(0);
    }
  });

  it('suspects have unique turn orders 1..40 and valid hex colours', () => {
    const orders = SUSPECTS.map((s) => s.turnOrder).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    for (const s of SUSPECTS) {
      expect(s.color, s.id).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('Miss Scarlet leads the turn order', () => {
    expect(suspectsByTurnOrder()[0].id).toBe('suspect-scarlet');
  });

  it('getCard resolves by id', () => {
    expect(getCard('weapon-candlestick')?.title).toBe('Candlestick');
    expect(getCard('nope')).toBeUndefined();
  });
});
