import { BOARD, getCard } from '../data';
import type { Board, Coord, FloorId } from '../data/board';
import { FULL_POOL, poolIds, type CardPool } from './pool';
import { type BotDifficulty, DEFAULT_BOT_DIFFICULTY } from '../game';
import { type RNG, pick } from '../rng';
import { roomIdAt, stepsToRooms } from './movement';
import { shortcutDestForRoom } from './turn';
import { deduceBotKnowledge, type BotKnowledge, type SuggestionEvent } from './botNotes';
import { botCandidates, botMoveTarget, botShouldStay, botSuggestion, type BotAccusation, type BotSuggestion } from './bot';

// A computer player's "mind" for one decision: its deduction (as good as its difficulty allows) plus
// the choices built on it. Three tiers:
//   hard   — full deduction incl. hand-size counting and confirmed-envelope cards; accuses as soon
//            as every category is pinned; isolates suspects/weapons as well as rooms; picks probe
//            pairs by who will have to answer; heads for useful rooms, using shortcuts and choosing
//            elevator floors by destination.
//   medium — today's bot: sound deduction, room isolation, random probe pairs, wanders when no room
//            is in reach. It does at least learn which cards are confirmed in the envelope, so it
//            stops walking back into the solution room.
//   easy   — remembers only the last few dozen suggestions, probes at random, never lingers in a
//            room, and gambles on an accusation once the field looks small.

export interface BotMind {
  difficulty: BotDifficulty;
  botId: string;
  hand: string[];
  k: BotKnowledge;
  /** Cards nobody can hold — i.e. confirmed in the envelope (empty for easy bots). */
  envelope: Set<string>;
  /** Everyone at the table, in turn order. */
  playerIds: string[];
  /** The suggestion history the bot is entitled to know (see botNotes.ts). */
  events: SuggestionEvent[];
  /** The cards in this game (the host may have switched wings off or trimmed the weapons). */
  pool: CardPool;
  /** The board this game is played on. */
  board: Board;
}

/** A medium/hard bot gambles on an accusation once its odds are at least this good… */
const GAMBLE_MIN_ODDS = 1 / 3;
/** …but only if a rival looks about to win: a suggestion of theirs, this round, that nobody could
 *  disprove and whose three cards are all still possible envelope cards by the bot's own reckoning. */

const EASY_MEMORY = 30; // suggestions an easy bot keeps in its head
const EASY_GAMBLE_COMBOS = 6; // easy guesses once (#suspects × #weapons × #rooms) left is this small
/** Cards (among `ids`, the cards in play) that must be in the envelope: no player, me included,
 *  can hold them. */
function envelopeKnown(k: BotKnowledge, botId: string, playerIds: string[], hand: string[], ids: string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (k.ruledOut.has(id) || hand.includes(id)) continue;
    if (playerIds.every((p) => p === botId || k.hasnt.get(p)?.has(id))) out.add(id);
  }
  return out;
}

/** Build a bot's current understanding of the game. `handCounts` (cards each player holds) lets a
 *  hard bot conclude that a player whose whole hand is known holds nothing else. */
export function botMind(
  difficulty: BotDifficulty | undefined,
  botId: string,
  hand: string[],
  playerIds: string[],
  events: SuggestionEvent[],
  handCounts?: Map<string, number>,
  pool: CardPool = FULL_POOL,
  board: Board = BOARD,
): BotMind {
  const d = difficulty ?? DEFAULT_BOT_DIFFICULTY;
  const ids = poolIds(pool);
  let evs = d === 'easy' ? events.slice(-EASY_MEMORY) : events;
  let k = deduceBotKnowledge(botId, hand, playerIds, evs, pool);
  if (d === 'hard' && handCounts) {
    // Hand-size counting, fed back as synthetic "passes" until nothing new falls out.
    for (let guard = 0; guard < 8; guard++) {
      const extra: SuggestionEvent[] = [];
      for (const p of playerIds) {
        const n = handCounts.get(p);
        const has = k.has.get(p);
        const hasnt = k.hasnt.get(p);
        if (n == null || !has || !hasnt || has.size < n) continue;
        const rest = ids.filter((c) => !has.has(c) && !hasnt.has(c));
        if (rest.length) extra.push({ suggesterId: '', trio: rest, passers: [p] });
      }
      if (!extra.length) break;
      evs = [...evs, ...extra];
      k = deduceBotKnowledge(botId, hand, playerIds, evs, pool);
    }
  }
  const envelope = d === 'easy' ? new Set<string>() : envelopeKnown(k, botId, playerIds, hand, ids);
  return { difficulty: d, botId, hand, k, envelope, playerIds, events, pool, board };
}

/**
 * Does some other player look set to solve the case before this bot's next turn? The tell is a
 * suggestion made within the last round (one per seat at most, so the last `players - 1` events)
 * that went undisproved, naming only cards the bot itself still considers possible envelope cards
 * and none the suggester is known to hold. Whoever made it either holds those cards or has just
 * confirmed the solution — and if it's the latter, they accuse on their next turn.
 */
export function botThreatened(m: BotMind): boolean {
  const window = Math.max(1, m.playerIds.length - 1);
  const recent = m.events.slice(-window);
  return recent.some((e) => {
    if (e.suggesterId === m.botId || e.suggesterId === '' || e.responderId) return false;
    const theirs = m.k.has.get(e.suggesterId);
    return e.trio.every((c) => !m.k.ruledOut.has(c) && !m.hand.includes(c) && !theirs?.has(c));
  });
}

/** Rooms still worth visiting to learn about: not held by anyone, not confirmed in the envelope. */
export function botUnknownRooms(m: BotMind): Set<string> {
  return new Set(m.pool.rooms.filter((r) => !m.k.ruledOut.has(r.id) && !m.envelope.has(r.id)).map((r) => r.id));
}

/** Rooms where nobody can answer a suggestion with the room card: ones I hold, or the envelope's.
 *  Standing there, a bot can isolate a single suspect or weapon per suggestion. */
export function botProbeRooms(m: BotMind): Set<string> {
  return new Set(m.pool.rooms.filter((r) => m.hand.includes(r.id) || m.envelope.has(r.id)).map((r) => r.id));
}

export function botDecideAccusation(m: BotMind, rng: RNG): BotAccusation | null {
  const c = botCandidates(m.k.ruledOut, m.pool);
  if (m.difficulty === 'easy') {
    if (c.suspects.length === 1 && c.weapons.length === 1 && c.rooms.length === 1) {
      return { suspectId: c.suspects[0].id, weaponId: c.weapons[0].id, roomId: c.rooms[0].id };
    }
    // Feeling lucky: once the field is small, guess rather than keep grinding.
    const combos = c.suspects.length * c.weapons.length * c.rooms.length;
    if (combos > 0 && combos <= EASY_GAMBLE_COMBOS) {
      return { suspectId: pick(c.suspects, rng).id, weaponId: pick(c.weapons, rng).id, roomId: pick(c.rooms, rng).id };
    }
    return null;
  }
  // Medium/hard: each category pinned either by elimination or by a confirmed envelope card.
  const one = (cands: { id: string }[]): string | null => {
    const confirmed = cands.find((x) => m.envelope.has(x.id));
    if (confirmed) return confirmed.id;
    return cands.length === 1 ? cands[0].id : null;
  };
  const s = one(c.suspects);
  const w = one(c.weapons);
  const r = one(c.rooms);
  if (s && w && r) return { suspectId: s, weaponId: w, roomId: r };

  // Not certain — but if a rival looks about to win, a good enough guess beats waiting to lose.
  const open = (cands: { id: string }[], pinned: string | null) => (pinned ? cands.filter((x) => x.id === pinned) : cands);
  const S = open(c.suspects, s);
  const W = open(c.weapons, w);
  const R = open(c.rooms, r);
  const combos = S.length * W.length * R.length;
  if (combos > 0 && 1 / combos >= GAMBLE_MIN_ODDS && botThreatened(m)) {
    return { suspectId: pick(S, rng).id, weaponId: pick(W, rng).id, roomId: pick(R, rng).id };
  }
  return null;
}

/**
 * What to suggest from `roomId`. `queue` is the order in which the other players will be asked.
 */
export function botDecideSuggestion(m: BotMind, roomId: string, queue: string[], rng: RNG): BotSuggestion {
  const c = botCandidates(m.k.ruledOut, m.pool);
  if (m.difficulty === 'easy') {
    return {
      suspectId: pick(c.suspects.length ? c.suspects : m.pool.suspects, rng).id,
      weaponId: pick(c.weapons.length ? c.weapons : m.pool.weapons, rng).id,
    };
  }
  if (m.difficulty === 'medium') return botSuggestion(m.k.ruledOut, m.hand, roomId, rng, m.pool);

  // ---- hard ----
  const heldSuspects = m.hand.filter((id) => getCard(id)?.type === 'suspect');
  const heldWeapons = m.hand.filter((id) => getCard(id)?.type === 'weapon');
  const roomUnknown = !m.k.ruledOut.has(roomId) && !m.envelope.has(roomId);
  // Isolate the room: only the room card could be shown.
  if (roomUnknown && heldSuspects.length && heldWeapons.length) {
    return { suspectId: pick(heldSuspects, rng), weaponId: pick(heldWeapons, rng) };
  }
  // In a room nobody can show, isolate a suspect or a weapon with one of my own cards.
  const roomSafe = m.hand.includes(roomId) || m.envelope.has(roomId);
  const openSus = c.suspects.filter((x) => !m.envelope.has(x.id));
  const openWea = c.weapons.filter((x) => !m.envelope.has(x.id));
  if (roomSafe) {
    if (openSus.length > 1 && heldWeapons.length && (openSus.length >= openWea.length || !heldSuspects.length)) {
      return { suspectId: pick(openSus, rng).id, weaponId: pick(heldWeapons, rng) };
    }
    if (openWea.length > 1 && heldSuspects.length) {
      return { suspectId: pick(heldSuspects, rng), weaponId: pick(openWea, rng).id };
    }
  }
  // Otherwise score probe pairs by walking the responders: a player known to hold one of the three
  // ends the walk (they'll show a card I already know); a player who might hold an unknown card is
  // a chance to learn something.
  const sus = openSus.length ? openSus : c.suspects.length ? c.suspects : m.pool.suspects;
  const wea = openWea.length ? openWea : c.weapons.length ? c.weapons : m.pool.weapons;
  const tries = Math.min(80, sus.length * wea.length);
  let best: BotSuggestion[] = [];
  let bestScore = -Infinity;
  for (let i = 0; i < tries; i++) {
    const s = pick(sus, rng).id;
    const w = pick(wea, rng).id;
    let score = 0;
    for (const p of queue) {
      const has = m.k.has.get(p);
      const hasnt = m.k.hasnt.get(p);
      if (has?.has(s) || has?.has(w) || has?.has(roomId)) {
        score -= 0.5;
        break;
      }
      const maybe = [s, w, roomId].filter((x) => !hasnt?.has(x) && !m.k.ruledOut.has(x)).length;
      score += maybe + (maybe > 0 ? 0.25 : 0);
    }
    if (score > bestScore) {
      bestScore = score;
      best = [{ suspectId: s, weaponId: w }];
    } else if (score === bestScore) best.push({ suspectId: s, weaponId: w });
  }
  return pick(best, rng);
}

/** Whether an in-room bot should skip moving and suggest again from here. `staysHere` counts the
 *  turns it has already stayed in this room in a row; `visited` is the rooms it has suggested in. */
export function botDecideStay(m: BotMind, roomId: string | undefined, staysHere: number, visited: Set<string>): boolean {
  if (!roomId) return false;
  if (m.difficulty === 'easy') return false;
  if (m.difficulty === 'medium') return botShouldStay(roomId, m.k.ruledOut, visited) && !m.envelope.has(roomId);
  if (!m.k.ruledOut.has(roomId) && !m.envelope.has(roomId)) return staysHere < 2; // keep probing it
  const c = botCandidates(m.k.ruledOut, m.pool);
  const stillOpen = c.suspects.length > 1 || c.weapons.length > 1;
  return botProbeRooms(m).has(roomId) && stillOpen && staysHere < 2;
}

/** Hard bots take a secret passage when it leads somewhere more useful than rolling would. */
export function botDecideShortcut(m: BotMind, roomId: string | undefined): boolean {
  if (m.difficulty !== 'hard' || !roomId) return false;
  const dest = shortcutDestForRoom(roomId, m.board);
  if (!dest) return false;
  const unknown = botUnknownRooms(m);
  if (unknown.has(dest)) return true;
  return unknown.size === 0 && botProbeRooms(m).has(dest) && !botProbeRooms(m).has(roomId);
}

/** Pick a destination among the reachable tiles. `queue` (the order others would answer a
 *  suggestion) lets a hard bot judge whether a known room is still worth suggesting from. */
export function botDecideMove(m: BotMind, reach: Coord[], rng: RNG, queue: string[] = []): Coord | null {
  if (!reach.length) return null;
  if (m.difficulty === 'easy') {
    const roomTiles = reach.filter((t) => roomIdAt(m.board, t));
    return roomTiles.length && rng() < 0.7 ? pick(roomTiles, rng) : pick(reach, rng);
  }
  const unknown = botUnknownRooms(m);
  if (m.difficulty === 'medium') {
    // Today's rule, but "unknown" excludes the confirmed envelope room.
    const ruled = new Set([...m.k.ruledOut, ...m.envelope]);
    return botMoveTarget(reach, ruled, rng, m.board);
  }
  // ---- hard ----
  const probe = botProbeRooms(m);
  const roomTiles = reach.filter((t) => roomIdAt(m.board, t));
  const unknownTiles = roomTiles.filter((t) => unknown.has(roomIdAt(m.board, t)!));
  if (unknownTiles.length) return pick(unknownTiles, rng);
  const probeTiles = roomTiles.filter((t) => probe.has(roomIdAt(m.board, t)!));
  if (probeTiles.length) return pick(probeTiles, rng);
  // A known room is still worth a suggestion if its holder answers late: everyone asked before
  // them might have to show the suspect or weapon instead. Prefer the room with the longest run of
  // askers ahead of its holder, as long as at least two players are asked first.
  if (roomTiles.length && queue.length) {
    let bestTiles: Coord[] = [];
    let bestAhead = 1;
    for (const t of roomTiles) {
      const r = roomIdAt(m.board, t)!;
      const holderIdx = queue.findIndex((p) => m.k.has.get(p)?.has(r));
      const ahead = holderIdx < 0 ? queue.length : holderIdx;
      if (ahead > bestAhead) {
        bestAhead = ahead;
        bestTiles = [t];
      } else if (ahead === bestAhead && bestAhead > 1) bestTiles.push(t);
    }
    if (bestTiles.length) return pick(bestTiles, rng);
  }
  const targets = unknown.size ? unknown : probe;
  const corridor = reach.filter((t) => !roomIdAt(m.board, t));
  if (corridor.length && targets.size) {
    let best: Coord[] = [];
    let bestD = Infinity;
    for (const t of corridor) {
      const d = stepsToRooms(m.board, t, targets);
      if (d < bestD) {
        bestD = d;
        best = [t];
      } else if (d === bestD) best.push(t);
    }
    if (best.length) return pick(best, rng);
  }
  return pick(roomTiles.length ? roomTiles : reach, rng);
}

/** Which floor to ride the elevator to. Hard bots pick the floor whose exit is nearest a useful room. */
export function botDecideFloor(m: BotMind, options: FloorId[], rng: RNG): FloorId {
  if (m.difficulty !== 'hard') return pick(options, rng);
  const unknown = botUnknownRooms(m);
  const targets = unknown.size ? unknown : botProbeRooms(m);
  let best: FloorId[] = [];
  let bestD = Infinity;
  for (const f of options) {
    const elev = m.board.elevators.find((e) => e.floor === f);
    const d = elev ? stepsToRooms(m.board, elev.exit, targets) : Infinity;
    if (d < bestD) {
      bestD = d;
      best = [f];
    } else if (d === bestD) best.push(f);
  }
  return pick(best.length ? best : options, rng);
}
