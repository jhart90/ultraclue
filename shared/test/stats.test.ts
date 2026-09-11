import { describe, it, expect } from 'vitest';
import {
  startGame,
  moveTo,
  makeSuggestion,
  respondToSuggestion,
  matchingCards,
  makeAccusation,
  activeReachable,
  makeRng,
  roomIdAt,
  summarizeStats,
  summarizeAccusations,
  noteWouldAccuse,
  ROOMS,
  syncParticipants,
  viewFor,
  BOARD,
  type Player,
} from '../src';

function lobbyPlayer(id: string, suspectId: string): Player {
  return { id, name: id.toUpperCase(), suspectId, isBot: false, isHost: false, connected: true, hand: [], eliminated: false, position: { x: 0, y: 0 } };
}

describe('game statistics', () => {
  it('starts every player at zero and counts the opening turn', () => {
    const s = startGame('S', [lobbyPlayer('p1', 'suspect-valentine'), lobbyPlayer('p2', 'suspect-mulberry')], makeRng(3));
    expect(s.stats).toBeTruthy();
    expect(s.stats!.turnsPlayed).toBe(1); // the first player's turn has begun
    expect(s.stats!.players.p1.turns).toBe(1);
    expect(s.stats!.players.p2.turns).toBe(0);
    expect(s.stats!.suggestionCount).toBe(0);
  });

  it('counts tiles walked and rooms visited when a piece moves', () => {
    let s = startGame('S', [lobbyPlayer('p1', 'suspect-valentine'), lobbyPlayer('p2', 'suspect-mulberry')], makeRng(3));
    const reach = activeReachable(s);
    const corridor = reach.find((t) => !roomIdAt(BOARD, t));
    const room = reach.find((t) => roomIdAt(BOARD, t));
    if (corridor) {
      s = moveTo(s, 'p1', corridor);
      expect(s.stats!.players.p1.tiles).toBe(s.lastMove!.path.length - 1);
      expect(s.stats!.players.p1.tiles).toBeGreaterThan(0);
      expect(s.stats!.players.p1.roomsVisited).toHaveLength(0);
    } else if (room) {
      s = moveTo(s, 'p1', room);
      expect(s.stats!.players.p1.roomsVisited).toEqual([roomIdAt(BOARD, room)]);
    }
  });

  it('tallies suggestions by suspect, weapon and room, and who showed a card', () => {
    let s = startGame('S', [lobbyPlayer('p1', 'suspect-valentine'), lobbyPlayer('p2', 'suspect-mulberry')], makeRng(3));
    // teleport p1 into a room so a suggestion is legal
    const roomId = 'room-lounge';
    s.players[0].inRoomId = roomId;
    s.players[0].position = BOARD.rooms[roomId].tiles[0];
    s.turnPhase = 'postMove';
    // pick a suspect/weapon p2 holds so a reveal happens
    const held = s.players[1].hand;
    const suspect = held.find((c) => c.startsWith('suspect-')) ?? 'suspect-mulberry';
    const weapon = held.find((c) => c.startsWith('weapon-')) ?? 'weapon-rope';
    s = makeSuggestion(s, 'p1', suspect, weapon, roomId, makeRng(1));
    expect(s.stats!.suggestionCount).toBe(1);
    expect(s.stats!.suspects[suspect]).toBe(1);
    expect(s.stats!.weapons[weapon]).toBe(1);
    expect(s.stats!.rooms[roomId]).toBe(1);
    expect(s.stats!.players.p1.suggestions).toBe(1);
    if (s.currentSuggestion?.pendingResponderId === 'p2') {
      const card = matchingCards(s, 'p2', s.currentSuggestion)[0];
      s = respondToSuggestion(s, 'p2', card, makeRng(1));
      expect(s.stats!.players.p2.reveals).toBe(1);
    }
  });

  it('remembers who took part, when, and stamps the finish', () => {
    let s = startGame('S', [lobbyPlayer('p1', 'suspect-valentine'), { ...lobbyPlayer('b1', 'suspect-mulberry'), name: 'Computer 2', isBot: true }], makeRng(3));
    expect(s.stats!.startedAt).toBeGreaterThan(0);
    expect(s.stats!.participants!.map((p) => [p.name, p.kind])).toEqual([
      ['P1', 'human'],
      ['Computer 2', 'computer'],
    ]);
    // a watcher arrives, then the human is replaced by a computer
    syncParticipants(
      s,
      [
        { name: 'P1', kind: 'human', suspectId: 'suspect-valentine' },
        { name: 'Computer 2', kind: 'computer', suspectId: 'suspect-mulberry' },
        { name: 'Watcher', kind: 'observer' },
      ],
      1000,
    );
    syncParticipants(
      s,
      [
        { name: 'Computer 1', kind: 'computer', suspectId: 'suspect-valentine' },
        { name: 'Computer 2', kind: 'computer', suspectId: 'suspect-mulberry' },
        { name: 'Watcher', kind: 'observer' },
      ],
      2000,
    );
    const names = s.stats!.participants!.map((p) => `${p.kind}:${p.name}${p.leftAt ? '@' + p.leftAt : ''}`);
    expect(names).toEqual(['human:P1@2000', 'computer:Computer 2', 'observer:Watcher', 'computer:Computer 1']);
    s.turnPhase = 'postMove';
    const env = s.envelope;
    s = makeAccusation(s, 'p1', env.suspectId, env.weaponId, env.roomId, makeRng(1)).state;
    expect(s.stats!.endedAt).toBeGreaterThanOrEqual(s.stats!.startedAt!);
  });

  it('counts accusations and exposes the stats only once the game has ended', () => {
    let s = startGame('S', [lobbyPlayer('p1', 'suspect-valentine'), lobbyPlayer('p2', 'suspect-mulberry')], makeRng(3));
    expect(viewFor(s, 'p1').stats).toBeUndefined();
    s.turnPhase = 'postMove';
    const env = s.envelope;
    s = makeAccusation(s, 'p1', env.suspectId, env.weaponId, env.roomId, makeRng(1)).state;
    expect(s.phase).toBe('ended');
    expect(s.stats!.players.p1.accusations).toBe(1);
    const view = viewFor(s, 'p2');
    expect(view.stats).toBeTruthy();
    const summary = summarizeStats(view)!;
    expect(summary.turnsPlayed).toBe(1);
    expect(summary.rows.map((r) => r.playerId)).toEqual(view.turnOrder);
    expect(summary.rows.find((r) => r.playerId === 'p1')!.accusations).toBe(1);
  });
});

describe('accusations on the details screen', () => {
  const seats = () => [lobbyPlayer('p1', 'suspect-valentine'), lobbyPlayer('p2', 'suspect-mulberry'), lobbyPlayer('p3', 'suspect-dijon')];

  it('records the cards of every accusation made, right or wrong', () => {
    let s = startGame('S', seats(), makeRng(3));
    const env = s.envelope;
    const first = s.turnOrder[0];
    s.turnPhase = 'postMove';
    // a wrong accusation: same suspect and weapon, a different room
    const wrongRoom = ROOMS.find((r) => r.id !== env.roomId)!.id;
    s = makeAccusation(s, first, env.suspectId, env.weaponId, wrongRoom, makeRng(1)).state;
    expect(s.stats!.players[first].accusation).toEqual({
      suspectId: env.suspectId,
      weaponId: env.weaponId,
      roomId: wrongRoom,
      correct: false,
      playerTurn: 1,
      overallTurn: 1,
    });
    // …then the next player closes the case, on their own first turn but the game's second
    const second = s.turnOrder[s.activeIdx];
    s.turnPhase = 'postMove';
    s = makeAccusation(s, second, env.suspectId, env.weaponId, env.roomId, makeRng(2)).state;
    expect(s.phase).toBe('ended');
    expect(s.stats!.players[second].accusation).toEqual({ ...env, correct: true, playerTurn: 1, overallTurn: 2 });

    const lines = summarizeAccusations(viewFor(s, ''));
    expect(lines.filter((l) => l.kind === 'accused').map((l) => [l.playerId, l.playerTurn, l.overallTurn])).toEqual([
      [second, 1, 2],
      [first, 1, 1],
    ]);
    // the winning accusation first, then the wrong one, then whoever never accused
    expect(lines.map((l) => [l.playerId, l.kind, l.matches])).toEqual([
      [second, 'accused', 3],
      [first, 'accused', 2],
      [s.turnOrder.find((id) => id !== first && id !== second)!, 'none', undefined],
    ]);
    expect(lines[1].hits).toEqual([true, true, false]);
  });

  it('files a computer guess only for a seat that never accused, and ranks guesses closest first', () => {
    let s = startGame('S', seats(), makeRng(5));
    const env = s.envelope;
    const [a, b, c] = s.turnOrder;
    for (const id of [b, c]) s.players.find((p) => p.id === id)!.isBot = true;
    s.turnPhase = 'postMove';
    s = makeAccusation(s, a, env.suspectId, env.weaponId, env.roomId, makeRng(1)).state;
    const otherRoom = ROOMS.find((r) => r.id !== env.roomId)!.id;
    const otherWeapon = s.weaponIds?.find((w) => w !== env.weaponId) ?? 'weapon-rope';
    noteWouldAccuse(s, b, { suspectId: env.suspectId, weaponId: otherWeapon, roomId: otherRoom, combos: 12 });
    noteWouldAccuse(s, c, { suspectId: env.suspectId, weaponId: env.weaponId, roomId: otherRoom, combos: 3 });
    noteWouldAccuse(s, a, { suspectId: env.suspectId, weaponId: env.weaponId, roomId: otherRoom }); // ignored: a accused
    expect(s.stats!.players[a].wouldAccuse).toBeUndefined();
    expect(s.stats!.players[b].wouldAccuse?.combos).toBe(12);

    const lines = summarizeAccusations(viewFor(s, ''));
    expect(lines.map((l) => [l.playerId, l.kind, l.matches])).toEqual([
      [a, 'accused', 3],
      [c, 'would', 2],
      [b, 'would', 1],
    ]);
  });

  it('says nothing before the game has ended', () => {
    const s = startGame('S', seats(), makeRng(3));
    expect(summarizeAccusations(viewFor(s, 'p1'))).toEqual([]);
  });
});
