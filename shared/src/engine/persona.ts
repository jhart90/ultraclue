// A computer player's personality: a set of weights layered on top of its difficulty tier. The
// tier decides how well a bot deduces; the persona decides how it *behaves* with what it knows —
// where it walks, how long it lingers, what it suggests and how readily it gambles. Every bot is
// dealt one at random when the game starts and it stays secret until the end-of-game screen.

import type { RNG } from '../rng';
import { pick } from '../rng';

export type BotPersonaId =
  | 'tourist'
  | 'homebody'
  | 'gambler'
  | 'bluffer'
  | 'stalker'
  | 'rambler'
  | 'sprinter'
  | 'understudy';

export interface BotPersona {
  id: BotPersonaId | 'neutral';
  title: string;
  /** One line for the end-of-game reveal. */
  blurb: string;
  // ---- where to walk ---------------------------------------------------------------------
  /** Pull of each class of room when choosing a destination. The classes are tried in order of
   *  weight; a class with weight 0 is refused while a heavier class still has rooms on the board.
   *    unknown — rooms nobody is known to hold (worth learning about)
   *    probe   — rooms the bot holds or knows are in the envelope (safe to isolate a suspect/weapon)
   *    known   — rooms some other player holds */
  unknownRoomWeight: number;
  probeRoomWeight: number;
  knownRoomWeight: number;
  /** 0 ignores a room's door count; 1 weights rooms by it (more doors, quicker to leave). */
  doorBias: number;
  /** Refuse to walk back into a room it has already suggested from. */
  avoidVisited: boolean;
  /** Walk the corridor toward the nearest useful room when none is in reach (hard bots always do). */
  corridorWalk: boolean;
  /** Chance to step into a reachable lift for the ride, whether or not it leads anywhere useful. */
  liftChance: number;
  /** Ride the lift to the floor whose exit is *farthest* from a useful room, rather than nearest. */
  farFloors: boolean;
  /** Chance to take a secret passage at the start of a turn just because it is there. */
  shortcutChance: number;
  // ---- lingering -------------------------------------------------------------------------
  /** Consecutive turns it will stay put and suggest again from one room (0 = never). */
  maxStays: number;
  // ---- what to say -----------------------------------------------------------------------
  /** Chance to name a suspect and weapon from its own hand, so nobody learns anything. */
  bluffChance: number;
  /** Aim suggestions at the player with the most cards still unaccounted for. */
  stalk: boolean;
  // ---- when to accuse --------------------------------------------------------------------
  /** Accuse on a guess once the odds are at least this good, with nobody looking close. */
  gambleMinOdds: number;
  /** The odds it will settle for instead once the table looks about to solve the case. The live
   *  floor slides between `gambleMinOdds` and this as the read of the table hardens (see
   *  `botThreatLevel`), so a persona whose `threatOdds` is far looser than its `gambleMinOdds` is
   *  one that takes its big risks *precisely* when it senses somebody is about to accuse. Setting
   *  it equal to `gambleMinOdds` means a threat changes nothing. */
  threatOdds: number;
  /** Multiplier on that read of the table: above 1 jumps at shadows, below 1 barely notices. */
  threatSense: number;
  /** Faced with a hard threat, the chance of accusing whatever the odds — better to swing than to
   *  sit and watch somebody else win. Scaled by how bad the threat looks. */
  raceChance: number;
  /** How much the odds floor loosens as the game drags on: it is divided by
   *  `1 + impatience × (rounds - PATIENT_ROUNDS)`. 0 is endless patience. */
  impatience: number;
  /** Chance of simply accusing the trio a rival just floated that nobody could disprove. */
  copycatChance: number;
  /** Refuse to gamble at all until a rival looks close. This is the pre-persona rule, kept for
   *  `NEUTRAL_PERSONA`; the personalities below all steer with `threatOdds` instead. */
  gambleNeedsThreat: boolean;
}

/** The plain brain: today's behaviour, used when a bot has no persona (tests, old games). */
export const NEUTRAL_PERSONA: BotPersona = {
  id: 'neutral',
  title: 'Neutral',
  blurb: 'Plays it by the book.',
  unknownRoomWeight: 1,
  probeRoomWeight: 0.5,
  knownRoomWeight: 0.1,
  doorBias: 0,
  avoidVisited: false,
  corridorWalk: false,
  liftChance: 0,
  farFloors: false,
  shortcutChance: 0,
  maxStays: 2,
  bluffChance: 0,
  stalk: false,
  gambleMinOdds: 1 / 3,
  threatOdds: 1 / 3,
  threatSense: 1,
  raceChance: 0,
  impatience: 0,
  copycatChance: 0,
  gambleNeedsThreat: true,
};

export const BOT_PERSONAS: Record<BotPersonaId, BotPersona> = {
  tourist: {
    ...NEUTRAL_PERSONA,
    id: 'tourist',
    title: 'The Tourist',
    blurb: 'Had to see every room before settling on anything, never suggested from the same room twice, and grew restless the longer the tour ran.',
    unknownRoomWeight: 1,
    probeRoomWeight: 0,
    knownRoomWeight: 0,
    avoidVisited: true,
    corridorWalk: true,
    maxStays: 0,
    gambleNeedsThreat: false,
    threatOdds: 1 / 12,
    impatience: 0.03,
  },
  homebody: {
    ...NEUTRAL_PERSONA,
    id: 'homebody',
    title: 'The Homebody',
    blurb: 'Found a comfortable room and squatted there, probing suspects and weapons turn after turn — and spooked easily, being the last to hear anything.',
    unknownRoomWeight: 0.4,
    probeRoomWeight: 1,
    knownRoomWeight: 0.1,
    maxStays: 5,
    gambleNeedsThreat: false,
    threatOdds: 1 / 10,
    threatSense: 1.3,
  },
  gambler: {
    ...NEUTRAL_PERSONA,
    id: 'gambler',
    title: 'The Gambler',
    blurb: 'Accused on a hunch as soon as the odds looked half decent, whether or not anyone else was close — and threw caution out altogether when they were.',
    gambleNeedsThreat: false,
    gambleMinOdds: 1 / 10,
    threatOdds: 1 / 25,
    raceChance: 0.5,
  },
  bluffer: {
    ...NEUTRAL_PERSONA,
    id: 'bluffer',
    title: 'The Bluffer',
    blurb: 'Kept naming cards from its own hand so nobody could disprove it, then fell for the very same trick whenever a rival tried it.',
    bluffChance: 0.6,
    gambleNeedsThreat: false,
    threatOdds: 1 / 8,
    copycatChance: 0.3,
  },
  stalker: {
    ...NEUTRAL_PERSONA,
    id: 'stalker',
    title: 'The Stalker',
    blurb: 'Read the table rather than the map: every suggestion was aimed at whoever had the most to hide, and it always knew who was closing in.',
    unknownRoomWeight: 1,
    knownRoomWeight: 0.7,
    probeRoomWeight: 0.5,
    stalk: true,
    gambleNeedsThreat: false,
    threatOdds: 1 / 9,
    threatSense: 1.6,
  },
  rambler: {
    ...NEUTRAL_PERSONA,
    id: 'rambler',
    title: 'The Rambler',
    blurb: 'Took every secret passage and lift it came across and rode them to the far end of the house, running out of patience long before it ran out of house.',
    corridorWalk: true,
    liftChance: 0.6,
    farFloors: true,
    shortcutChance: 0.8,
    gambleNeedsThreat: false,
    threatOdds: 1 / 12,
    impatience: 0.05,
  },
  sprinter: {
    ...NEUTRAL_PERSONA,
    id: 'sprinter',
    title: 'The Sprinter',
    blurb: 'Counted every step: headed for the nearest useful room, favoured rooms with plenty of doors, and hated coming second more than it feared being wrong.',
    doorBias: 1,
    corridorWalk: true,
    maxStays: 1,
    gambleNeedsThreat: false,
    threatOdds: 1 / 12,
    raceChance: 0.4,
  },
  understudy: {
    ...NEUTRAL_PERSONA,
    id: 'understudy',
    title: 'The Understudy',
    blurb: 'Waited in the wings all game, then the moment somebody else looked ready to solve it, jumped the queue with whatever it happened to be holding.',
    unknownRoomWeight: 1,
    probeRoomWeight: 0.6,
    knownRoomWeight: 0.1,
    corridorWalk: true,
    maxStays: 3,
    gambleNeedsThreat: false,
    threatOdds: 1 / 16,
    threatSense: 1.5,
    raceChance: 0.7,
  },
};

export const BOT_PERSONA_IDS: readonly BotPersonaId[] = [
  'tourist',
  'homebody',
  'gambler',
  'bluffer',
  'stalker',
  'rambler',
  'sprinter',
  'understudy',
];

/** Deal a random personality. */
export function randomPersona(rng: RNG): BotPersonaId {
  return pick(BOT_PERSONA_IDS, rng);
}

export function personaOf(id: BotPersonaId | undefined): BotPersona {
  return id ? BOT_PERSONAS[id] : NEUTRAL_PERSONA;
}
