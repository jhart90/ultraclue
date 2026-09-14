import { describe, it, expect } from 'vitest';
import {
  startGame,
  makeSuggestion,
  respondToSuggestion,
  passSuggestion,
  makeAccusation,
  viewFor,
  makeRng,
  BOT_PERSONA_IDS,
  SUSPECTS,
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
      player('p1', 'suspect-valentine', true),
      player('p2', 'suspect-mulberry'),
      player('p3', 'suspect-verdant'),
    ],
    turnOrder: ['p1', 'p2', 'p3'],
    activeIdx: 0,
    envelope: { suspectId: 'suspect-dijon', weaponId: 'weapon-rope', roomId: 'room-study' },
    log: [],
    nextLogId: 1,
    weaponLocations: {},
    turnPhase: 'postMove',
  };
}

describe('setup / dealing', () => {
  const lobby = [
    player('p1', 'suspect-verdant', true), // turnOrder 19
    player('p2', 'suspect-valentine'), //     turnOrder 2
    player('p3', 'suspect-mulberry'), //        turnOrder 30
  ];

  it('seats players by their suspect turn order (lowest first)', () => {
    const s = startGame('ROOM', lobby, makeRng(42));
    expect(s.turnOrder).toEqual(['p2', 'p1', 'p3']);
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

  // The opening-deal animation replays the deal on every screen from hand sizes alone: card k of
  // the shuffled deck goes to seat k % n (seat order, not turn order), and each hand keeps deal order.
  it('deals round-robin in seat order and hands each viewer their cards in deal order', () => {
    const taken = new Set(lobby.map((p) => p.suspectId));
    const fourth = SUSPECTS.find((c) => !taken.has(c.id))!.id;
    const s = startGame('ROOM', [...lobby, player('p4', fourth)], makeRng(11));
    // 117 cards over 4 seats: the first seat takes the one left over.
    expect(s.players.map((p) => p.hand.length)).toEqual([30, 29, 29, 29]);
    for (const p of s.players) expect(viewFor(s, p.id).yourHand).toEqual(p.hand);
  });
});

describe('suggestions', () => {
  it('pauses on each responder; a card-less one passes, the next reveals and the turn ends', () => {
    const st = baseState();
    st.players[1].isBot = true;
    st.players[1].hand = ['weapon-dagger']; // p2: no match
    st.players[2].hand = ['weapon-candlestick']; // p3: holds the suggested weapon

    let s = makeSuggestion(st, 'p1', 'suspect-valentine', 'weapon-candlestick', 'room-library', makeRng(1));
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
    let s = makeSuggestion(st, 'p1', 'suspect-valentine', 'weapon-candlestick', 'room-library', makeRng(1));
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
    let s = makeSuggestion(st, 'p1', 'suspect-valentine', 'weapon-candlestick', 'room-library', makeRng(1));
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
    const s = makeSuggestion(st, 'p1', 'suspect-valentine', 'weapon-candlestick', 'room-library', makeRng(1));
    expect(() => passSuggestion(s, 'p2', makeRng(1))).toThrow();
  });

  it('rejects revealing a non-matching card', () => {
    const st = baseState();
    st.players[1].isBot = true;
    st.players[1].hand = [];
    st.players[2].hand = ['weapon-candlestick', 'weapon-dagger'];
    let s = makeSuggestion(st, 'p1', 'suspect-valentine', 'weapon-candlestick', 'room-library', makeRng(1));
    s = passSuggestion(s, 'p2', makeRng(1)); // advance past the card-less p2 to p3
    expect(() => respondToSuggestion(s, 'p3', 'weapon-dagger', makeRng(1))).toThrow();
  });

  it('does not mutate the input state (pure)', () => {
    const st = baseState();
    st.players[1].hand = [];
    st.players[2].hand = ['weapon-candlestick'];
    const snapshot = structuredClone(st);
    makeSuggestion(st, 'p1', 'suspect-valentine', 'weapon-candlestick', 'room-library', makeRng(1));
    expect(st).toEqual(snapshot);
  });
});

describe('accusations', () => {
  it('wins on an exact envelope match', () => {
    const { state, correct } = makeAccusation(
      baseState(),
      'p1',
      'suspect-dijon',
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
    st.players[0].hand = ['weapon-dagger', 'weapon-pillow'];
    st.players[1].hand = ['room-library'];
    st.players[2].hand = ['suspect-violet'];
    const before = st.players[1].hand.length + st.players[2].hand.length;

    const { state, correct } = makeAccusation(
      st,
      'p1',
      'suspect-valentine',
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
      players: [player('p1', 'suspect-valentine', true), player('p2', 'suspect-mulberry')],
      turnOrder: ['p1', 'p2'],
      activeIdx: 0,
      envelope: { suspectId: 'suspect-dijon', weaponId: 'weapon-rope', roomId: 'room-study' },
      log: [],
      nextLogId: 1,
      weaponLocations: {},
      turnPhase: 'postMove',
    };
    st.players[0].hand = ['weapon-dagger'];
    const { state } = makeAccusation(st, 'p1', 'suspect-valentine', 'weapon-rope', 'room-study', makeRng(1));
    expect(state.phase).toBe('ended');
    expect(state.winnerId).toBe('p2');
  });
});

describe('computer personalities', () => {
  const lobby: Player[] = [
    player('p1', 'suspect-dijon', true),
    { ...player('bot-1', 'suspect-valentine'), isBot: true, difficulty: 'hard' },
    { ...player('bot-2', 'suspect-mulberry'), isBot: true, difficulty: 'easy' },
  ];

  it('deals every computer a personality at the start, and no human', () => {
    const s = startGame('ROOM', lobby, makeRng(3));
    for (const p of s.players) {
      if (p.isBot) expect(BOT_PERSONA_IDS).toContain(p.persona);
      else expect(p.persona).toBeUndefined();
    }
  });

  it('keeps the personalities secret until the game has ended', () => {
    const s = startGame('ROOM', lobby, makeRng(3));
    const during = viewFor(s, 'p1');
    for (const p of during.players) expect(p.persona).toBeUndefined();
    const ended = { ...s, phase: 'ended' as const, winnerId: 'p1' };
    const after = viewFor(ended, 'p1');
    for (const p of after.players) {
      const real = s.players.find((x) => x.id === p.id)!;
      expect(p.persona).toBe(real.isBot ? real.persona : undefined);
    }
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

  it('shows the envelope to a wrong accuser once they are out, and still to no one else', () => {
    const st = baseState();
    st.players[0].hand = ['weapon-dagger'];
    const { state } = makeAccusation(st, 'p1', 'suspect-valentine', 'weapon-rope', 'room-study', makeRng(1));
    expect(state.phase).toBe('play'); // two detectives remain
    expect(viewFor(state, 'p1').envelope).toEqual(state.envelope); // the eliminated accuser's private look
    expect(viewFor(state, 'p2').envelope).toBeUndefined();
    expect(viewFor(state, 'p3').envelope).toBeUndefined();
  });

  it('reveals a disproving card to the suggester and the responder, but no one else', () => {
    const st = baseState();
    st.players[1].isBot = true;
    st.players[1].hand = [];
    st.players[2].hand = ['weapon-candlestick'];
    let s = makeSuggestion(st, 'p1', 'suspect-valentine', 'weapon-candlestick', 'room-library', makeRng(1));
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
      'suspect-dijon',
      'weapon-rope',
      'room-study',
      makeRng(1),
    );
    expect(viewFor(state, 'p2').envelope).toEqual(state.envelope);
  });
});
