import type { GameState, GameView, PlayerView, SuggestionView } from '../game';
import { getPlayer } from './util';
import { activeReachable } from './turn';

/**
 * Project the authoritative state down to what a single viewer is allowed to see. This is the
 * security boundary for hidden information:
 *   - other players' hands become a count only;
 *   - the envelope is withheld until the game ends;
 *   - a revealed card is shown only to the suggester it was revealed to.
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
    handCount: p.hand.length,
    position: p.position,
    inRoomId: p.inRoomId,
  }));

  let currentSuggestion: SuggestionView | undefined;
  if (state.currentSuggestion) {
    const sg = state.currentSuggestion;
    const isSuggester = viewerId === sg.suggesterId;
    currentSuggestion = {
      suggesterId: sg.suggesterId,
      suspectId: sg.suspectId,
      weaponId: sg.weaponId,
      roomId: sg.roomId,
      queue: sg.queue,
      passes: sg.passes,
      pendingResponderId: sg.pendingResponderId,
      responderId: sg.responderId,
      // Only the suggester learns which card was shown.
      revealedCardId: isSuggester ? sg.revealedCardId : undefined,
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
    yourId: viewerId,
    yourHand: getPlayer(state, viewerId)?.hand ?? [],
    currentSuggestion,
    announcement: state.announcement,
    envelope: state.phase === 'ended' ? state.envelope : undefined,
    winnerId: state.winnerId,
    log: state.log,
    weaponLocations: state.weaponLocations,
    turnPhase: state.turnPhase,
    lastRoll: state.lastRoll,
    lastMove: state.lastMove,
    reachable: activeReachable(state),
  };
}
