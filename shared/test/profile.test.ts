import { describe, it, expect } from 'vitest';
import {
  startGame,
  makeAccusation,
  makeSuggestion,
  makeRng,
  viewFor,
  cleanPin,
  normalizeName,
  pinlessProfileId,
  emptyProfile,
  foldProfileGame,
  profileLabel,
  PROFILE_RECENT,
  type Player,
} from '../src';

function lobbyPlayer(id: string, suspectId: string, isBot = false): Player {
  return { id, name: isBot ? `Computer ${id}` : id.toUpperCase(), suspectId, isBot, isHost: false, connected: true, hand: [], eliminated: false, position: { x: 0, y: 0 } };
}

/** p1 (human) suggests once, then accuses — correctly or not. A wrong accusation only ends the game
 *  when one opponent is left, so the wrong case plays against a single computer. Returns the ended state. */
function finishedGame(seed: number, correct: boolean) {
  const bots = [lobbyPlayer('b1', 'suspect-plum', true), lobbyPlayer('b2', 'suspect-green', true)].slice(0, correct ? 2 : 1);
  let s = startGame('ROOM', [lobbyPlayer('p1', 'suspect-scarlet'), ...bots], makeRng(seed));
  // Stand p1 in a room so they can suggest: borrow the envelope's room to keep the test simple.
  s.turnPhase = 'postMove';
  const p1 = s.players.find((p) => p.id === 'p1')!;
  p1.inRoomId = s.envelope.roomId;
  s = makeSuggestion(s, 'p1', 'suspect-plum', 'weapon-rope', s.envelope.roomId, makeRng(1));
  // resolve whatever the suggestion is waiting on by ending it the blunt way: accuse next turn
  s.currentSuggestion = undefined;
  s.turnPhase = 'postMove';
  s.activeIdx = s.turnOrder.indexOf('p1');
  const env = s.envelope;
  const trio = correct ? env : { suspectId: 'suspect-green', weaponId: env.weaponId, roomId: env.roomId };
  s = makeAccusation(s, 'p1', trio.suspectId, trio.weaponId, trio.roomId, makeRng(2)).state;
  return s;
}

describe('profile identity helpers', () => {
  it('accepts exactly four letters or digits as a PIN, case-insensitively', () => {
    expect(cleanPin('ab12')).toBe('AB12');
    expect(cleanPin(' 7777 ')).toBe('7777');
    expect(cleanPin('abc')).toBe('');
    expect(cleanPin('abcde')).toBe('');
    expect(cleanPin('ab!2')).toBe('');
    expect(cleanPin(undefined)).toBe('');
    expect(cleanPin(1234)).toBe('');
  });

  it('matches names loosely: case and spacing do not make a new profile', () => {
    expect(normalizeName('  Jack   Hart ')).toBe('jack hart');
    expect(pinlessProfileId('JACK')).toBe(pinlessProfileId('jack'));
    expect(pinlessProfileId('Jack')).toBe('n:jack');
  });

  it('labels a name with its tag only when asked', () => {
    expect(profileLabel('Jack', 'K7Q', true)).toBe('Jack #K7Q');
    expect(profileLabel('Jack', 'K7Q', false)).toBe('Jack');
    expect(profileLabel('Jack', '', true)).toBe('Jack');
  });
});

describe('folding games into a profile', () => {
  it('records a solved win with tiles, suggestions, accusations and favourites', () => {
    const s = finishedGame(11, true);
    expect(s.phase).toBe('ended');
    const view = viewFor(s, '');
    const prof = emptyProfile('p:abc', 'P1', 'K7Q', true, 1000);
    const game = foldProfileGame(prof, view, 'p1', { id: 'g1', isPublic: true }, 5000);
    expect(game?.result).toBe('won');
    expect(game?.solved).toBe(true);
    expect(game?.isPublic).toBe(true);
    expect(game?.suspectId).toBe('suspect-scarlet');
    expect(game?.players).toBe(3);
    expect(game?.humans).toBe(1);
    expect(prof.games).toBe(1);
    expect(prof.wins).toBe(1);
    expect(prof.solves).toBe(1);
    expect(prof.eliminations).toBe(0);
    expect(prof.suggestions).toBe(1);
    expect(prof.accusations).toBe(1);
    expect(prof.accusationsCorrect).toBe(1);
    expect(prof.characters).toEqual({ 'suspect-scarlet': 1 });
    expect(prof.suspectedSuspects).toEqual({ 'suspect-plum': 1 });
    expect(prof.suspectedWeapons).toEqual({ 'weapon-rope': 1 });
    expect(prof.suspectedRooms).toEqual({ [s.envelope.roomId]: 1 });
    expect(prof.recent).toHaveLength(1);
    expect(prof.lastPlayedAt).toBe(view.stats!.endedAt);
  });

  it('records a wrong accusation as an elimination and an incorrect accusation', () => {
    const s = finishedGame(12, false);
    expect(s.phase).toBe('ended');
    const view = viewFor(s, '');
    const prof = emptyProfile('n:p1', 'P1', '', false);
    const game = foldProfileGame(prof, view, 'p1', { id: 'g2', isPublic: false });
    expect(game?.result).toBe('eliminated');
    expect(game?.winnerName).not.toBe('P1');
    expect(prof.wins).toBe(0);
    expect(prof.eliminations).toBe(1);
    expect(prof.accusations).toBe(1);
    expect(prof.accusationsCorrect).toBe(0);
  });

  it('ignores players who were not dealt in and never counts a game twice', () => {
    const view = viewFor(finishedGame(13, true), '');
    const prof = emptyProfile('n:x', 'X', '', false);
    expect(foldProfileGame(prof, view, 'nobody', { id: 'g3', isPublic: true })).toBeUndefined();
    expect(prof.games).toBe(0);
    expect(foldProfileGame(prof, view, 'p1', { id: 'g3', isPublic: true })).toBeTruthy();
    expect(foldProfileGame(prof, view, 'p1', { id: 'g3', isPublic: true })).toBeUndefined();
    expect(prof.games).toBe(1);
  });

  it('keeps only the newest games, newest first', () => {
    const view = viewFor(finishedGame(14, true), '');
    const prof = emptyProfile('n:p1', 'P1', '', false);
    for (let i = 0; i < PROFILE_RECENT + 3; i++) foldProfileGame(prof, view, 'p1', { id: `g${i}`, isPublic: true });
    expect(prof.games).toBe(PROFILE_RECENT + 3);
    expect(prof.recent).toHaveLength(PROFILE_RECENT);
    expect(prof.recent[0].id).toBe(`g${PROFILE_RECENT + 2}`);
  });
});
