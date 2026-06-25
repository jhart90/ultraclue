import { describe, it, expect } from 'vitest';
import {
  startGame,
  makeSuggestion,
  respondToSuggestion,
  passSuggestion,
  makeAccusation,
  viewFor,
  makeRng,
} from '../src';
import type { GameState, Player } from '../src';

function player(id: string, suspectId: string, isHost = false): Player {
  return {
    id,
    name: id.toUpperCase(),
    suspectId,
    isBot: false,
    isHost,
    connected: true,
    hand: [],
    eliminated: false,
    position: { x: 0, y: 0 },
  };
}

/** A controlled 3-player state with a known envelope, so reveals/accusations are scriptable. */
function baseState(): GameState {
  return {
    code: 'T',
    phase: 'play',
    players: [
      player('p1', 'suspect-scarlet', true),
      player('p2', 'suspect-plum'),
      player('p3', 'suspect-green'),
    ],
    turnOrder: ['p1', 'p2', 'p3'],
    activeIdx: 0,
    envelope: { suspectId: 'suspect-mustard', weaponId: 'weapon-rope', roomId: 'room-study' },
    log: [],
    nextLogId: 1,
    weaponLocations: {},
    turnPhase: 'postMove',
  };
}

describe('setup / dealing', () => {
  const lobby = [
    player('p1', 'suspect-green', true), // turnOrder 5
    player('p2', 'suspect-scarlet'), //     turnOrder 1
    player('p3', 'suspect-plum'), //        turnOrder 4
  ];

  it('seats players by their suspect turn order (Scarlet first)', () => {
    const s = startGame('ROOM', lobby, makeRng(42));
    expect(s.turnOrder).toEqual(['p2', 'p3', 'p1']);
  });

  it('deals all 117 non-solution cards evenly with no duplicates or envelope leaks', () => {
    const s = startGame('ROOM', lobby, makeRng(42));
    expect(s.players.map((p) => p.hand.length)).toEqual([39, 39, 39]);
    const everything = [
      ...s.players.flatMap((p) => p.hand),
      s.envelope.suspectId,
      s.envelope.weaponId,
      s.envelope.roomId,
    ];
    expect(everything).toHaveLength(120);
    expect(new Set(everything).size).toBe(120); // every card accounted for exactly once
  });

  it('is deterministic for a given seed', () => {
    const a = startGame('ROOM', lobby, makeRng(7));
    const b = startGame('ROOM', lobby, makeRng(7));
    expect(a.envelope).toEqual(b.envelope);
    expect(a.players.map((p) => p.hand)).toEqual(b.players.map((p) => p.hand));
  });
});

describe('suggestions', () => {
  it('pauses on each responder; a card-less one passes, the next reveals and the turn ends', () => {
    const st = baseState();
    st.players[1].isBot = true;
    st.players[1].hand = ['weapon-dagger']; // p2: no match
    st.players[2].hand = ['weapon-candlestick']; // p3: holds the suggested weapon

    let s = makeSuggestion(st, 'p1', 'suspect-scarlet', 'weapon-candlestick', 'room-library', makeRng(1));
    expect(s.currentSuggestion?.pendingResponderId).toBe('p2'); // pauses on p2 even with no match
    expect(s.currentSuggestion?.passes).toEqual([]);
    expect(s.currentSuggestion?.resolved).toBe(false);

    s = passSuggestion(s, 'p2', makeRng(1)); // (the server drives a bot's pass after its "thinking" beat)
    expect(s.currentSuggestion?.passes).toEqual(['p2']);
    expect(s.currentSuggestion?.pendingResponderId).toBe('p3');

    s = respondToSuggestion(s, 'p3', 'weapon-candlestick', makeRng(1));
    expect(s.currentSuggestion?.resolved).toBe(true);
    expect(s.currentSuggestion?.anyRevealed).toBe(true);
    expect(s.currentSuggestion?.revealedCardId).toBe('weapon-candlestick');
    expect(s.turnOrder[s.activeIdx]).toBe('p2'); // turn advanced past the suggester
  });

  it('resolves with no reveal when nobody can disprove, and advances the turn', () => {
    const st = baseState();
    st.players.forEach((p) => (p.hand = ['weapon-dagger'])); // none in the suggested trio
    st.players[1].isBot = st.players[2].isBot = true;
    let s = makeSuggestion(st, 'p1', 'suspect-scarlet', 'weapon-candlestick', 'room-library', makeRng(1));
    expect(s.currentSuggestion?.pendingResponderId).toBe('p2');
    s = passSuggestion(s, 'p2', makeRng(1));
    s = passSuggestion(s, 'p3', makeRng(1));
    expect(s.currentSuggestion?.resolved).toBe(true);
    expect(s.currentSuggestion?.anyRevealed).toBe(false);
    expect(s.currentSuggestion?.passes).toEqual(['p2', 'p3']);
    expect(s.turnOrder[s.activeIdx]).toBe('p2');
  });

  it('pauses on a card-less human until they pass "Reveal nothing", then moves on', () => {
    const st = baseState();
    st.players[1].hand = ['weapon-dagger']; // p2: human, no match -> must acknowledge
    st.players[2].hand = ['weapon-candlestick']; // p3: can disprove
    let s = makeSuggestion(st, 'p1', 'suspect-scarlet', 'weapon-candlestick', 'room-library', makeRng(1));
    expect(s.currentSuggestion?.pendingResponderId).toBe('p2'); // stops on p2 even with no match
    expect(s.currentSuggestion?.passes).toEqual([]);
    expect(() => respondToSuggestion(s, 'p2', 'weapon-candlestick', makeRng(1))).toThrow(); // can't reveal a card they lack
    s = passSuggestion(s, 'p2', makeRng(1));
    expect(s.currentSuggestion?.passes).toEqual(['p2']);
    expect(s.currentSuggestion?.pendingResponderId).toBe('p3'); // now advanced to the next responder
  });

  it('forbids passing when you do hold a matching card', () => {
    const st = baseState();
    st.players[1].hand = ['weapon-candlestick']; // p2 can disprove -> may not "reveal nothing"
    const s = makeSuggestion(st, 'p1', 'suspect-scarlet', 'weapon-candlestick', 'room-library', makeRng(1));
    expect(() => passSuggestion(s, 'p2', makeRng(1))).toThrow();
  });

  it('rejects revealing a non-matching card', () => {
    const st = baseState();
    st.players[1].isBot = true;
    st.players[1].hand = [];
    st.players[2].hand = ['weapon-candlestick', 'weapon-dagger'];
    let s = makeSuggestion(st, 'p1', 'suspect-scarlet', 'weapon-candlestick', 'room-library', makeRng(1));
    s = passSuggestion(s, 'p2', makeRng(1)); // advance past the card-less p2 to p3
    expect(() => respondToSuggestion(s, 'p3', 'weapon-dagger', makeRng(1))).toThrow();
  });

  it('does not mutate the input state (pure)', () => {
    const st = baseState();
    st.players[1].hand = [];
    st.players[2].hand = ['weapon-candlestick'];
    const snapshot = structuredClone(st);
    makeSuggestion(st, 'p1', 'suspect-scarlet', 'weapon-candlestick', 'room-library', makeRng(1));
    expect(st).toEqual(snapshot);
  });
});

describe('accusations', () => {
  it('wins on an exact envelope match', () => {
    const { state, correct } = makeAccusation(
      baseState(),
      'p1',
      'suspect-mustard',
      'weapon-rope',
      'room-study',
      makeRng(1),
    );
    expect(correct).toBe(true);
    expect(state.phase).toBe('ended');
    expect(state.winnerId).toBe('p1');
  });

  it('eliminates a wrong accuser and redistributes their hand', () => {
    const st = baseState();
    st.players[0].hand = ['weapon-dagger', 'weapon-cleaver'];
    st.players[1].hand = ['room-library'];
    st.players[2].hand = ['suspect-violet'];
    const before = st.players[1].hand.length + st.players[2].hand.length;

    const { state, correct } = makeAccusation(
      st,
      'p1',
      'suspect-scarlet',
      'weapon-rope',
      'room-study',
      makeRng(3),
    );
    expect(correct).toBe(false);
    expect(state.players[0].eliminated).toBe(true);
    expect(state.players[0].hand).toHaveLength(0);
    const after = state.players[1].hand.length + state.players[2].hand.length;
    expect(after).toBe(before + 2);
    expect(state.turnOrder[state.activeIdx]).toBe('p2'); // skipped the eliminated player
  });

  it('awards the win by default when elimination leaves one player', () => {
    const st: GameState = {
      code: 'T',
      phase: 'play',
      players: [player('p1', 'suspect-scarlet', true), player('p2', 'suspect-plum')],
      turnOrder: ['p1', 'p2'],
      activeIdx: 0,
      envelope: { suspectId: 'suspect-mustard', weaponId: 'weapon-rope', roomId: 'room-study' },
      log: [],
      nextLogId: 1,
      weaponLocations: {},
      turnPhase: 'postMove',
    };
    st.players[0].hand = ['weapon-dagger'];
    const { state } = makeAccusation(st, 'p1', 'suspect-scarlet', 'weapon-rope', 'room-study', makeRng(1));
    expect(state.phase).toBe('ended');
    expect(state.winnerId).toBe('p2');
  });
});

describe('per-player view (hidden-information boundary)', () => {
  it('shows your own hand, hides others as a count, and withholds the envelope mid-game', () => {
    const st = baseState();
    st.players[0].hand = ['weapon-dagger', 'room-attic'];
    st.players[1].hand = ['suspect-violet'];

    const v = viewFor(st, 'p1');
    expect(v.yourHand).toEqual(['weapon-dagger', 'room-attic']);
    expect(v.envelope).toBeUndefined();
    expect(v.players.find((p) => p.id === 'p2')?.handCount).toBe(1);
    // The view type carries no hand field for other players — assert nothing leaked.
    const p2View = v.players.find((p) => p.id === 'p2') as unknown as Record<string, unknown>;
    expect(p2View.hand).toBeUndefined();
  });

  it('reveals a disproving card to the suggester and the responder, but no one else', () => {
    const st = baseState();
    st.players[1].isBot = true;
    st.players[1].hand = [];
    st.players[2].hand = ['weapon-candlestick'];
    let s = makeSuggestion(st, 'p1', 'suspect-scarlet', 'weapon-candlestick', 'room-library', makeRng(1));
    s = passSuggestion(s, 'p2', makeRng(1)); // card-less p2 passes; play moves to p3
    s = respondToSuggestion(s, 'p3', 'weapon-candlestick', makeRng(1));

    expect(viewFor(s, 'p1').currentSuggestion?.revealedCardId).toBe('weapon-candlestick'); // suggester
    expect(viewFor(s, 'p3').currentSuggestion?.revealedCardId).toBe('weapon-candlestick'); // responder
    expect(viewFor(s, 'p2').currentSuggestion?.revealedCardId).toBeUndefined(); // uninvolved
  });

  it('reveals the envelope to everyone once the game has ended', () => {
    const { state } = makeAccusation(
      baseState(),
      'p1',
      'suspect-mustard',
      'weapon-rope',
      'room-study',
      makeRng(1),
    );
    expect(viewFor(state, 'p2').envelope).toEqual(state.envelope);
  });
});
