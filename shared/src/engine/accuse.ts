import { getCard } from '../data';
import type { GameState } from '../game';
import { type RNG, shuffle } from '../rng';
import { activePlayers, clone, currentPlayerId, log, requirePlayer } from './util';
import { concludeTurn } from './turn';

export interface AccusationOutcome {
  state: GameState;
  correct: boolean;
}

/**
 * Resolve an accusation against the envelope.
 *  - All three match  -> the accuser wins, game ends.
 *  - Any mismatch     -> the accuser is eliminated; their hand is shuffled and redistributed
 *                        round-robin to the remaining active players; the turn advances.
 *  - If elimination leaves a single active player, that player wins by default.
 */
export function makeAccusation(
  state: GameState,
  accuserId: string,
  suspectId: string,
  weaponId: string,
  roomId: string,
  rng: RNG,
): AccusationOutcome {
  const s = clone(state);
  if (s.phase !== 'play') throw new Error('Not in play.');
  if (currentPlayerId(s) !== accuserId) throw new Error('Not your turn.');

  const accuser = requirePlayer(s, accuserId);
  const correct =
    s.envelope.suspectId === suspectId &&
    s.envelope.weaponId === weaponId &&
    s.envelope.roomId === roomId;

  log(
    s,
    `${accuser.name} accuses ${getCard(suspectId)?.title} with the ${getCard(weaponId)?.title} in the ${getCard(roomId)?.title}!`,
  );

  if (correct) {
    s.phase = 'ended';
    s.winnerId = accuserId;
    log(s, `The accusation is CORRECT. ${accuser.name} has solved the case and wins!`);
    return { state: s, correct: true };
  }

  // Wrong: eliminate and redistribute.
  accuser.eliminated = true;
  log(s, `The accusation is WRONG. ${accuser.name} is eliminated.`);

  const hand = shuffle(accuser.hand, rng);
  accuser.hand = [];
  const recipients = activePlayers(s);
  if (recipients.length > 0) {
    hand.forEach((cardId, i) => recipients[i % recipients.length].hand.push(cardId));
    if (hand.length > 0) {
      log(s, `Their ${hand.length} cards are shuffled and redistributed to the remaining players.`);
    }
  }

  const remaining = activePlayers(s);
  if (remaining.length === 1) {
    s.phase = 'ended';
    s.winnerId = remaining[0].id;
    log(s, `${remaining[0].name} is the last detective standing and wins by default!`);
    return { state: s, correct: false };
  }

  concludeTurn(s, rng);
  return { state: s, correct: false };
}
