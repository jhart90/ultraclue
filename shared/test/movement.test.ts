import { describe, it, expect } from 'vitest';
import {
  startGame,
  moveTo,
  endTurn,
  rollAndMove,
  activeReachable,
  reachableTiles,
  blockedCells,
  roomIdAt,
  makeRng,
  coordKey,
  BOARD,
  type Player,
} from '../src';

function lobbyPlayer(id: string, suspectId: string): Player {
  return {
    id,
    name: id.toUpperCase(),
    suspectId,
    isBot: false,
    isHost: false,
    connected: true,
    hand: [],
    eliminated: false,
    position: { x: 0, y: 0 },
  };
}

function newGame(seed = 5) {
  return startGame('M', [lobbyPlayer('p1', 'suspect-scarlet'), lobbyPlayer('p2', 'suspect-plum')], makeRng(seed));
}

describe('movement', () => {
  it('auto-rolls for the first player (who starts in the open) and offers reachable squares', () => {
    const s = newGame();
    expect(s.turnPhase).toBe('awaitMove');
    expect(s.lastRoll).toBeDefined();
    expect(s.players[0].position).toEqual(BOARD.starts.find((st) => st.suspectId === 'suspect-scarlet')!.tile);
    expect(activeReachable(s).length).toBeGreaterThan(0);
  });

  it('moves the piece to a chosen square, records a path, and advances on end turn', () => {
    const s = newGame();
    const dest = activeReachable(s)[0];
    const s2 = moveTo(s, 'p1', dest);
    expect(s2.players[0].position).toEqual(dest);
    expect(s2.turnPhase).toBe('postMove');
    expect((s2.lastMove?.path.length ?? 0)).toBeGreaterThan(0);
    expect(s2.lastMove?.path.at(-1)).toEqual(dest);
    // entering a room sets inRoomId consistently with the board
    expect(s2.players[0].inRoomId).toBe(roomIdAt(BOARD, dest));

    const s3 = endTurn(s2, 'p1', makeRng(1));
    expect(s3.turnOrder[s3.activeIdx]).toBe('p2');
  });

  it('rejects an out-of-range destination and a move out of turn', () => {
    const s = newGame();
    expect(() => moveTo(s, 'p1', { x: 999, y: 999 })).toThrow();
    expect(() => moveTo(s, 'p2', activeReachable(s)[0])).toThrow(); // not p2's turn
  });

  it('treats corridor cells occupied by other pieces as impassable', () => {
    const s = newGame();
    const steps = (s.lastRoll![0] + s.lastRoll![1]);
    const open = reachableTiles(BOARD, s.players[0].position, steps, new Set());
    const corridorTarget = open.find((t) => roomIdAt(BOARD, t) === undefined);
    if (!corridorTarget) return; // all reachable were rooms; nothing to assert
    const blocked = blockedCells(BOARD, [corridorTarget]);
    const withBlock = reachableTiles(BOARD, s.players[0].position, steps, blocked);
    expect(withBlock.some((t) => coordKey(t) === coordKey(corridorTarget))).toBe(false);
  });

  it('only lets an in-room player roll via rollAndMove (not the auto-roll path)', () => {
    const s = newGame();
    // p1 is in the open, so the in-room action is illegal here
    expect(() => rollAndMove(s, 'p1', makeRng(1))).toThrow();
  });
});
