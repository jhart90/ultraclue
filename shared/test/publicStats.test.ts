import { describe, it, expect } from 'vitest';
import { startGame, makeAccusation, makeRng, viewFor, emptyPublicStats, foldPublicGame, backfillPublicStats, PUBLIC_STATS_RECENT, type Player } from '../src';

function lobbyPlayer(id: string, suspectId: string, isBot = false): Player {
  return { id, name: isBot ? `Computer ${id}` : id.toUpperCase(), suspectId, isBot, isHost: false, connected: true, hand: [], eliminated: false, position: { x: 0, y: 0 } };
}

function finishedGame(seed: number, correct: boolean) {
  let s = startGame('PUBLIC', [lobbyPlayer('p1', 'suspect-scarlet'), lobbyPlayer('b1', 'suspect-plum', true)], makeRng(seed));
  s.turnPhase = 'postMove';
  const env = s.envelope;
  const trio = correct ? env : { suspectId: 'suspect-plum', weaponId: env.weaponId, roomId: env.roomId };
  s = makeAccusation(s, 'p1', trio.suspectId, trio.weaponId, trio.roomId, makeRng(1)).state;
  expect(s.phase).toBe('ended');
  return viewFor(s, '');
}

describe('public game history', () => {
  it('folds a solved game into the aggregates and the archive', () => {
    const stats = emptyPublicStats();
    const view = finishedGame(7, true);
    const archived = foldPublicGame(stats, view, 'g1');
    expect(stats.totalGames).toBe(1);
    expect(stats.solvedGames).toBe(1);
    expect(stats.turnsInSolvedGames).toBe(stats.totalTurns);
    expect(stats.humanWins).toEqual({ P1: 1 });
    expect(stats.characterWins).toEqual({ 'suspect-scarlet': 1 });
    expect(stats.murderers[view.envelope!.suspectId]).toBe(1);
    expect(stats.weapons[view.envelope!.weaponId]).toBe(1);
    expect(stats.rooms[view.envelope!.roomId]).toBe(1);
    expect(archived.solved).toBe(true);
    expect(stats.characterGames).toEqual({ 'suspect-scarlet': 1, 'suspect-plum': 1 });
    expect(stats.characterAccusations).toEqual({ 'suspect-scarlet': 1 });
    expect(stats.characterCorrect).toEqual({ 'suspect-scarlet': 1 });
    expect(stats.characterTiles['suspect-scarlet'] ?? 0).toBe(0);
    expect(archived.humans).toBe(1);
    expect(archived.computers).toBe(1);
    // the archived view carries what the details screen needs and nothing private
    expect(archived.view.stats).toBeTruthy();
    expect(archived.view.envelope).toEqual(view.envelope);
    expect(archived.view.yourHand).toEqual([]);
    expect(archived.view.log).toEqual([]);
    expect(stats.recent[0].id).toBe('g1');
  });

  it('credits a computer win to the character but not to the human table', () => {
    const stats = emptyPublicStats();
    const view = finishedGame(8, false); // the human accuses wrongly; the computer wins by default
    const archived = foldPublicGame(stats, view, 'g2');
    expect(archived.solved).toBe(false);
    expect(archived.winnerIsBot).toBe(true);
    expect(stats.solvedGames).toBe(0);
    expect(stats.humanWins).toEqual({});
    expect(stats.characterWins).toEqual({ 'suspect-plum': 1 });
  });

  it('keeps only the newest games in the archive, newest first', () => {
    const stats = emptyPublicStats();
    const view = finishedGame(9, true);
    for (let i = 0; i < PUBLIC_STATS_RECENT + 5; i++) foldPublicGame(stats, view, `g${i}`);
    expect(stats.totalGames).toBe(PUBLIC_STATS_RECENT + 5);
    expect(stats.recent).toHaveLength(PUBLIC_STATS_RECENT);
    expect(stats.recent[0].id).toBe(`g${PUBLIC_STATS_RECENT + 4}`);
  });
});

describe('suggestion tallies across public games', () => {
  it('sums how often each weapon and room was named, game after game', () => {
    const stats = emptyPublicStats();
    const a = finishedGame(11, true);
    a.stats!.weapons = { 'weapon-rope': 2, 'weapon-dagger': 1 };
    a.stats!.rooms = { 'room-study': 3 };
    const b = finishedGame(12, false);
    b.stats!.weapons = { 'weapon-rope': 1 };
    b.stats!.rooms = { 'room-study': 1, 'room-lounge': 2 };
    foldPublicGame(stats, a, 'g1');
    foldPublicGame(stats, b, 'g2');
    expect(stats.weaponsSuggested).toEqual({ 'weapon-rope': 3, 'weapon-dagger': 1 });
    expect(stats.roomsSuggested).toEqual({ 'room-study': 4, 'room-lounge': 2 });
  });

  it('backfills the tallies from the archive when an older stats file lacks them', () => {
    const stats = emptyPublicStats();
    const a = finishedGame(13, true);
    a.stats!.weapons = { 'weapon-candlestick': 2 };
    a.stats!.rooms = { 'room-kitchen': 1 };
    foldPublicGame(stats, a, 'g1');
    // simulate a file written before the tallies existed
    const raw = { ...stats } as Partial<typeof stats>;
    delete raw.weaponsSuggested;
    delete raw.roomsSuggested;
    const loaded = { ...emptyPublicStats(), ...raw, recent: stats.recent };
    expect(backfillPublicStats(loaded, raw)).toBe(true);
    expect(loaded.weaponsSuggested).toEqual({ 'weapon-candlestick': 2 });
    expect(loaded.roomsSuggested).toEqual({ 'room-kitchen': 1 });
    // a file that already has them is left alone
    expect(backfillPublicStats(loaded, loaded)).toBe(false);
  });
it('keeps two humans with the same name apart on the winners board via their profiles', () => {
    const stats = emptyPublicStats();
    const view = finishedGame(15, true); // P1 wins
    foldPublicGame(stats, view, 'g1', { id: 'p:aaa', name: 'P1', tag: 'K7Q' });
    foldPublicGame(stats, view, 'g2', { id: 'p:bbb', name: 'P1', tag: '2FD' });
    foldPublicGame(stats, view, 'g3'); // no profile given → the PIN-less profile for the name
    foldPublicGame(stats, view, 'g4', { id: 'p:aaa', name: 'p1', tag: 'K7Q' });
    expect(stats.humanWins).toEqual({ P1: 4 }); // legacy by-name tally still adds up
    expect(stats.humanWinners).toEqual({
      'p:aaa': { name: 'p1', tag: 'K7Q', wins: 2 },
      'p:bbb': { name: 'P1', tag: '2FD', wins: 1 },
      'n:p1': { name: 'P1', tag: '', wins: 1 },
    });
  });

  it('turns legacy by-name wins into PIN-less profiles when an older file has no winners table', () => {
    const raw = { ...emptyPublicStats(), humanWins: { Jack: 3, Jill: 1 } } as Partial<ReturnType<typeof emptyPublicStats>>;
    delete raw.humanWinners;
    const loaded = { ...emptyPublicStats(), ...raw };
    expect(backfillPublicStats(loaded, raw)).toBe(true);
    expect(loaded.humanWinners).toEqual({ 'n:jack': { name: 'Jack', tag: '', wins: 3 }, 'n:jill': { name: 'Jill', tag: '', wins: 1 } });
    expect(backfillPublicStats(loaded, loaded)).toBe(false);
  });
});
