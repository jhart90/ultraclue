import { describe, it, expect } from 'vitest';
import { startGame, makeAccusation, makeRng, viewFor, emptyPublicStats, foldPublicGame, PUBLIC_STATS_RECENT, type Player } from '../src';

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
