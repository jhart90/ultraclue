import { getCard } from '../data';
import type { GameState } from '../game';
import { type RNG, shuffle } from '../rng';
import { activePlayers, clone, currentPlayerId, log, requirePlayer } from './util';
import { concludeTurn } from './turn';
import { noteAccusation, noteGameEnd } from './stats';
import { inPool, poolOf } from './pool';

export interface AccusationOutcome {
  state: GameState;
  correct: boolean;
}

/**
 * Every trio somebody has accused and got wrong, oldest first.
 *
 * An accusation is announced to the whole table, so this is public knowledge — but it proves less
 * than it looks. All it establishes is that the *combination* is not the solution: any one of the
 * three cards may still be in the envelope, so none of them can be crossed off on its own. What it
 * is good for is refusing to walk into the same wall twice, and — once two of the three categories
 * are certain — pinning the third. See `botMind`, which does both.
 */
export function wrongAccusationTrios(state: Pick<GameState, 'log'>): string[][] {
  const out: string[][] = [];
  for (const e of state.log) {
    const c = e.card;
    if (c?.kind === 'accusation' && !c.correct) out.push([c.suspectId, c.weaponId, c.roomId]);
  }
  return out;
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
  const pool = poolOf(s);
  if (!inPool(pool, suspectId) || !inPool(pool, weaponId) || !inPool(pool, roomId)) throw new Error('That card is not in this game.');
  const correct =
    s.envelope.suspectId === suspectId &&
    s.envelope.weaponId === weaponId &&
    s.envelope.roomId === roomId;
  noteAccusation(s, accuserId, correct, { suspectId, weaponId, roomId });

  s.announcement = {
    seq: (s.announcement?.seq ?? 0) + 1,
    kind: 'accusation',
    byId: accuserId,
    byName: accuser.name,
    suspectId,
    weaponId,
    roomId,
    correct,
  };

  log(
    s,
    `${accuser.name} accuses ${getCard(suspectId)?.title} with the ${getCard(weaponId)?.title} in the ${getCard(roomId)?.title}!`,
    { kind: 'accusation', byId: accuserId, suspectId, weaponId, roomId, correct },
  );

  if (correct) {
    s.phase = 'ended';
    s.winnerId = accuserId;
    noteGameEnd(s);
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
    noteGameEnd(s);
    log(s, `${remaining[0].name} is the last detective standing and wins by default!`);
    return { state: s, correct: false };
  }

  concludeTurn(s, rng);
  return { state: s, correct: false };
}
