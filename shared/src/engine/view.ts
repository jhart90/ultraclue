import type { GameState, GameView, PlayerView, SuggestionView } from '../game';
import { getPlayer, currentPlayerId } from './util';
import { activeReachable, elevatorOptions } from './turn';
import { boardOf } from './pool';

/**
 * Project the authoritative state down to what a single viewer is allowed to see. This is the
 * security boundary for hidden information:
 *   - other players' hands become a count only;
 *   - the envelope is withheld until the game ends — except from an eliminated seat: a wrong
 *     accuser checks the envelope in private, as in the boxed game;
 *   - a revealed card is shown only to the two players in on it: the suggester it was
 *     revealed to, and the responder who revealed it.
 */
export function viewFor(state: GameState, viewerId: string): GameView {
  const players: PlayerView[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    suspectId: p.suspectId,
    isBot: p.isBot,
    isHost: p.isHost,
    connected: p.connected,
    eliminated: p.eliminated,
    dice: p.dice,
    difficulty: p.difficulty,
    // A computer's personality stays secret until the case is closed.
    persona: state.phase === 'ended' && p.isBot ? p.persona : undefined,
    handCount: p.hand.length,
    position: p.position,
    inRoomId: p.inRoomId,
  }));

  let currentSuggestion: SuggestionView | undefined;
  if (state.currentSuggestion) {
    const sg = state.currentSuggestion;
    const inOnIt = viewerId === sg.suggesterId || viewerId === sg.responderId;
    currentSuggestion = {
      suggesterId: sg.suggesterId,
      suspectId: sg.suspectId,
      weaponId: sg.weaponId,
      roomId: sg.roomId,
      queue: sg.queue,
      passes: sg.passes,
      pendingResponderId: sg.pendingResponderId,
      responderId: sg.responderId,
      // Only the two players in on the reveal (suggester + responder) learn which card was shown.
      revealedCardId: inOnIt ? sg.revealedCardId : undefined,
      anyRevealed: sg.anyRevealed,
      resolved: sg.resolved,
    };
  }

  return {
    code: state.code,
    phase: state.phase,
    players,
    turnOrder: state.turnOrder,
    activeIdx: state.activeIdx,
    round: state.round,
    wingsOff: state.wingsOff,
    weaponIds: state.weaponIds,
    suspectIds: state.suspectIds,
    cardBack: state.cardBack,
    yourId: viewerId,
    // A viewer who isn't one of the dealt players is watching in observer mode.
    observer: !state.players.some((p) => p.id === viewerId),
    yourHand: getPlayer(state, viewerId)?.hand ?? [],
    currentSuggestion,
    announcement: state.announcement,
    // Elimination only ever follows a wrong accusation (makeAccusation), so an eliminated viewer is
    // the accuser who has earned a look; their client turns the three cards over for them alone.
    envelope: state.phase === 'ended' || getPlayer(state, viewerId)?.eliminated ? state.envelope : undefined,
    winnerId: state.winnerId,
    stats: state.phase === 'ended' ? state.stats : undefined,
    // A reveal's card id is only for the two players who saw it.
    log: state.log.map((e) =>
      e.card?.kind === 'reveal' && e.card.cardId && viewerId !== e.card.responderId && viewerId !== e.card.suggesterId
        ? { ...e, card: { kind: 'reveal' as const, responderId: e.card.responderId, suggesterId: e.card.suggesterId } }
        : e,
    ),
    weaponLocations: state.weaponLocations,
    turnPhase: state.turnPhase,
    lastRoll: state.lastRoll,
    rollSeq: state.rollSeq,
    lastMove: state.lastMove,
    reachable: activeReachable(state),
    elevatorFloors:
      state.turnPhase === 'awaitElevator' && state.elevatorRide && currentPlayerId(state) === viewerId
        ? elevatorOptions(state.elevatorRide.fromFloor, boardOf(state))
        : undefined,
  };
}
