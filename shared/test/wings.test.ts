import { describe, it, expect } from 'vitest';
import {
  BOARD,
  ROOMS,
  WEAPONS,
  WINGS,
  boardFor,
  wingsKey,
  coordKey,
  makeRng,
  startGame,
  chooseWeapons,
  chooseSuspects,
  SUSPECTS,
  poolOf,
  reachableTiles,
  blockedCells,
  elevatorOptions,
  makeSuggestion,
  botMind,
  botDecideAccusation,
  MIN_WEAPONS,
  type Player,
} from '../src';

function lobbyPlayer(id: string, suspectId: string, isBot = false): Player {
  return { id, name: id, suspectId, isBot, isHost: id === 'p1', connected: true, hand: [], eliminated: false, position: { x: 0, y: 0 } };
}
const TWO = [lobbyPlayer('p1', 'suspect-scarlet'), lobbyPlayer('p2', 'suspect-plum')];

describe('boards with wings switched off', () => {
  it('the full board is the default and is shared', () => {
    expect(boardFor()).toBe(BOARD);
    expect(boardFor([])).toBe(BOARD);
    expect(boardFor(['not-a-wing'])).toBe(BOARD);
    expect(wingsKey(['basement', 'upper-floor'])).toBe('upper-floor+basement');
    expect(boardFor(['basement', 'upper-floor'])).toBe(boardFor(['upper-floor', 'basement']));
  });

  it('drops the wing: its tiles, rooms, stairs, passages and chamfers', () => {
    const b = boardFor(['grounds']);
    expect(b.wingsOff).toEqual(['grounds']);
    expect(b.sections.map((s) => s.id)).not.toContain('grounds');
    expect(b.cells.some((c) => c.sectionId === 'grounds')).toBe(false);
    expect(b.rooms['room-courtyard']).toBeUndefined();
    expect(b.rooms['room-ballroom']).toBeDefined();
    expect(b.fountain).toEqual([]);
    expect(b.chamfers.some((c) => c.roomId === 'room-gazebo')).toBe(false);
    expect(b.stairs.some((s) => s.from === 'grounds' || s.to === 'grounds')).toBe(false);
    expect(b.stairs.some((s) => s.id === 'stairs-grand')).toBe(true);
    // The Chapel <-> Cemetery crypt passage needs both rooms.
    expect(b.shortcuts.some((sc) => sc.aRoomId === 'room-cemetery' || sc.bRoomId === 'room-cemetery')).toBe(false);
    expect(b.shortcuts.some((sc) => sc.aRoomId === 'room-trophy')).toBe(true);
  });

  it('boards up the lift when it has nowhere to go, and keeps it otherwise', () => {
    const only = boardFor(['upper-floor', 'basement']);
    expect(only.elevators).toEqual([]);
    expect(only.cells.some((c) => c.type === 'elevator')).toBe(false);
    expect(elevatorOptions('ground-floor', only)).toEqual([]);
    const noBasement = boardFor(['basement']);
    expect(noBasement.elevators.map((e) => e.floor).sort()).toEqual(['ground-floor', 'upper-floor']);
    expect(elevatorOptions('ground-floor', noBasement)).toEqual(['upper-floor']);
  });

  it('every suspect still has a start tile on a hall in a wing that is in play', () => {
    for (const off of [['grounds'], ['basement'], ['upper-floor', 'grounds', 'basement']]) {
      const b = boardFor(off);
      const halls = new Set(b.cells.filter((c) => c.type === 'path').map(coordKey));
      expect(b.starts).toHaveLength(40);
      const used = new Set<string>();
      for (const s of b.starts) {
        expect(halls.has(coordKey(s.tile))).toBe(true);
        expect(used.has(coordKey(s.tile))).toBe(false);
        used.add(coordKey(s.tile));
      }
    }
  });

  it('nothing on a trimmed board can be walked into a wing that is off', () => {
    const b = boardFor(['upper-floor']);
    const offTiles = new Set(BOARD.cells.filter((c) => c.sectionId === 'upper-floor').map(coordKey));
    // From the grand-staircase landing on the ground floor a big roll used to cross to the upper floor.
    const landing = BOARD.stairs.find((s) => s.id === 'stairs-grand')!.a[0];
    const reach = reachableTiles(b, landing, 12, blockedCells(b, []));
    expect(reach.length).toBeGreaterThan(0);
    expect(reach.some((t) => offTiles.has(coordKey(t)))).toBe(false);
  });
});

describe('the deck follows the wings and the weapon count', () => {
  it('a room in a wing that is off is in nobody\'s hand and never the solution', () => {
    const offRooms = new Set(ROOMS.filter((r) => !boardFor(['basement']).rooms[r.id]).map((r) => r.id));
    expect(offRooms.size).toBeGreaterThan(0);
    for (let seed = 1; seed <= 20; seed++) {
      const s = startGame('W', TWO, makeRng(seed), { wingsOff: ['basement'] });
      expect(s.wingsOff).toEqual(['basement']);
      expect(offRooms.has(s.envelope.roomId)).toBe(false);
      for (const p of s.players) for (const c of p.hand) expect(offRooms.has(c)).toBe(false);
      // Every card in play is dealt or in the envelope — nothing goes missing.
      const dealt = s.players.flatMap((p) => p.hand).length + 3;
      expect(dealt).toBe(40 + 40 + (40 - offRooms.size));
    }
  });

  it('with the whole house and all weapons the game is stored as before', () => {
    const s = startGame('W', TWO, makeRng(3));
    expect(s.wingsOff).toBeUndefined();
    expect(s.weaponIds).toBeUndefined();
    expect(Object.keys(s.weaponLocations)).toHaveLength(40);
  });

  it('fewer weapons: the ones tied to rooms in play come first, then a random rest', () => {
    const b = boardFor(['upper-floor', 'grounds', 'basement']);
    const roomWeapons = new Set(Object.values(b.rooms).map((r) => r.weaponId));
    expect(roomWeapons.size).toBe(Object.keys(b.rooms).length);
    const some = chooseWeapons(b, roomWeapons.size + 2, makeRng(5));
    expect(some).toHaveLength(roomWeapons.size + 2);
    for (const w of roomWeapons) expect(some).toContain(w);
    const fewer = chooseWeapons(b, MIN_WEAPONS, makeRng(5));
    expect(fewer).toHaveLength(MIN_WEAPONS);
    for (const w of fewer) expect(roomWeapons.has(w)).toBe(true);
    // Canonical order, and the full set is untouched.
    const order = new Map(WEAPONS.map((w, i) => [w.id, i]));
    expect([...some].sort((a, c) => order.get(a)! - order.get(c)!)).toEqual(some);
    expect(chooseWeapons(BOARD, 40, makeRng(1))).toEqual(WEAPONS.map((w) => w.id));
    expect(chooseWeapons(BOARD, 1, makeRng(1))).toHaveLength(MIN_WEAPONS);
  });

  it('a trimmed deck deals only its weapons, places every one of them, and guards suggestions', () => {
    const s = startGame('W', TWO, makeRng(9), { wingsOff: ['grounds', 'basement'], weaponCount: 10 });
    expect(s.weaponIds).toHaveLength(10);
    const inDeck = new Set(s.weaponIds);
    expect(inDeck.has(s.envelope.weaponId)).toBe(true);
    for (const p of s.players) for (const c of p.hand) if (c.startsWith('weapon-')) expect(inDeck.has(c)).toBe(true);
    expect(Object.keys(s.weaponLocations).sort()).toEqual([...inDeck].sort());
    for (const room of Object.values(s.weaponLocations)) expect(boardFor(s.wingsOff).rooms[room]).toBeDefined();
    const pool = poolOf(s);
    expect(pool.weapons).toHaveLength(10);
    expect(pool.rooms.length).toBe(Object.keys(boardFor(['grounds', 'basement']).rooms).length);

    // Put the active player in a room and make sure a card that is not in play is refused.
    const active = s.players.find((p) => p.id === s.turnOrder[s.activeIdx])!;
    const room = Object.values(boardFor(s.wingsOff).rooms)[0];
    active.position = { ...room.tiles[0] };
    active.inRoomId = room.id;
    s.turnPhase = 'postMove';
    const outWeapon = WEAPONS.find((w) => !inDeck.has(w.id))!.id;
    expect(() => makeSuggestion(s, active.id, 'suspect-scarlet', outWeapon, room.id, makeRng(1))).toThrow(/not in this game/);
    expect(() => makeSuggestion(s, active.id, 'suspect-scarlet', s.weaponIds![0], 'room-courtyard', makeRng(1))).toThrow(/not in this game/);
    expect(() => makeSuggestion(s, active.id, 'suspect-scarlet', s.weaponIds![0], room.id, makeRng(1))).not.toThrow();
  });

  it('a bot reasons over the cards in play, not the full set', () => {
    const s = startGame('W', TWO, makeRng(11), { wingsOff: ['upper-floor', 'grounds', 'basement'], weaponCount: MIN_WEAPONS });
    const pool = poolOf(s);
    const bot = s.players[0];
    // Tell the bot everything: the other player holds every non-envelope card the bot does not.
    const other = s.players[1];
    const events = other.hand.map((c) => ({ suggesterId: bot.id, trio: [c, c, c], passers: [], responderId: other.id, revealedCardId: c }));
    const m = botMind('hard', bot.id, bot.hand, s.turnOrder, events, undefined, pool, boardFor(s.wingsOff));
    const acc = botDecideAccusation(m, makeRng(1));
    expect(acc).toEqual(s.envelope);
  });
});

describe('a trimmed suspect deck', () => {
  it('always holds every seated character, then random others up to the count', () => {
    const seated = ['suspect-scarlet', 'suspect-plum', 'suspect-green'];
    const some = chooseSuspects(seated, 10, makeRng(4));
    expect(some).toHaveLength(10);
    for (const s of seated) expect(some).toContain(s);
    // Never fewer than the seats, however low the count; the full set stays untouched.
    expect(chooseSuspects(seated, 1, makeRng(4)).length).toBeGreaterThanOrEqual(seated.length);
    expect(chooseSuspects(seated, 40, makeRng(1))).toEqual(SUSPECTS.map((s) => s.id));
  });

  it('deals only its suspects and refuses one that is not in play', () => {
    const s = startGame('W', TWO, makeRng(21), { suspectCount: 6 });
    expect(s.suspectIds).toHaveLength(6);
    const inDeck = new Set(s.suspectIds);
    for (const p of s.players) expect(inDeck.has(p.suspectId)).toBe(true);
    expect(inDeck.has(s.envelope.suspectId)).toBe(true);
    for (const p of s.players) for (const c of p.hand) if (c.startsWith('suspect-')) expect(inDeck.has(c)).toBe(true);
    expect(poolOf(s).suspects).toHaveLength(6);
    const active = s.players.find((p) => p.id === s.turnOrder[s.activeIdx])!;
    const room = Object.values(BOARD.rooms)[0];
    active.position = { ...room.tiles[0] };
    active.inRoomId = room.id;
    s.turnPhase = 'postMove';
    const outSuspect = SUSPECTS.find((x) => !inDeck.has(x.id))!.id;
    expect(() => makeSuggestion(s, active.id, outSuspect, 'weapon-rope', room.id, makeRng(1))).toThrow(/not in this game/);
  });
});

describe('WINGS', () => {
  it('names the three optional wings', () => {
    expect(WINGS.map((w) => w.id)).toEqual(['upper-floor', 'grounds', 'basement']);
  });
});
