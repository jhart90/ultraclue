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
    const ruled = ruledOutExcept('suspect-scarlet', 'weapon-rope', 'room-study');
    expect(botAccusation(ruled)).toEqual({
      suspectId: 'suspect-scarlet',
      weaponId: 'weapon-rope',
      roomId: 'room-study',
    });
  });

  it('probes for unknown suspect + weapon when not isolating a room', () => {
    // leave exactly one candidate suspect + weapon so the pick is forced and checkable
    const ruled = new Set<string>([
      ...SUSPECTS.filter((s) => s.id !== 'suspect-plum').map((s) => s.id),
      ...WEAPONS.filter((w) => w.id !== 'weapon-dagger').map((w) => w.id),
    ]);
    const sugg = botSuggestion(ruled, [], undefined, makeRng(5)); // no hand / no room -> just probe
    expect(sugg.suspectId).toBe('suspect-plum');
    expect(sugg.weaponId).toBe('weapon-dagger');
  });

  it('isolates an unknown room by suggesting a held suspect + held weapon', () => {
    const hand = ['suspect-plum', 'weapon-dagger', 'room-library']; // 1 held suspect, 1 held weapon
    const sugg = botSuggestion(new Set(), hand, 'room-study', makeRng(3));
    expect(sugg.suspectId).toBe('suspect-plum'); // from its own hand…
    expect(sugg.weaponId).toBe('weapon-dagger'); // …so the room is the only revealable card
  });

  it('reveals a card the suggester has already seen; otherwise the most-exposed one', () => {
    // p2 already saw weapon-rope from us -> re-show it (no new info)
    expect(botRevealCard(['weapon-rope', 'suspect-plum'], new Set(['weapon-rope']), new Map(), makeRng(1))).toBe(
      'weapon-rope',
    );
    // no repeat: reveal whichever card more other players already know
    const exposure = new Map([['suspect-plum', 2], ['weapon-rope', 0]]);
    expect(botRevealCard(['weapon-rope', 'suspect-plum'], new Set(), exposure, makeRng(1))).toBe('suspect-plum');
    // a single match is forced
    expect(botRevealCard(['room-study'], new Set(), new Map(), makeRng(1))).toBe('room-study');
  });

  it('prefers moving into a room over a corridor tile', () => {
    const roomTile = BOARD.rooms['room-study'].tiles[0];
    const pathTile = BOARD.starts[0].tile;
    const target = botMoveTarget([pathTile, roomTile], new Set(), makeRng(2));
    expect(coordKey(target!)).toBe(coordKey(roomTile));
  });

  it('stays only in an untested, still-unknown room', () => {
    expect(botShouldStay('room-study', new Set(), new Set())).toBe(true);
    expect(botShouldStay('room-study', new Set(['room-study']), new Set())).toBe(false); // ruled out
    expect(botShouldStay('room-study', new Set(), new Set(['room-study']))).toBe(false); // already tested
    expect(botShouldStay(undefined, new Set(), new Set())).toBe(false); // not in a room
  });
});
