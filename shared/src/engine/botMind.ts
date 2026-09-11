import { BOARD, getCard } from '../data';
import type { Board, Coord, FloorId } from '../data/board';
import { FULL_POOL, poolIds, type CardPool } from './pool';
import { type BotDifficulty, DEFAULT_BOT_DIFFICULTY } from '../game';
import { type RNG, pick } from '../rng';
import { elevatorFloorAt, roomIdAt, stepsToRooms } from './movement';
import { shortcutDestForRoom } from './turn';
import { deduceBotKnowledge, type BotKnowledge, type SuggestionEvent } from './botNotes';
import { botCandidates, botSuggestion, pickRoomTile, type BotAccusation, type BotSuggestion } from './bot';
import { personaOf, type BotPersona, type BotPersonaId } from './persona';

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
// No tier keeps a perfect sheet: each mark it witnesses has a small chance of never being written
// down — about one in 400 for hard, one in 200 for medium, one in 50 for easy (`rollForgotten`
// in botNotes.ts). The server rolls those lapses once per suggestion and passes them in `events`.
// Every tier above easy also works its "holds one of these" notes — a rival it saw disprove a
// suggestion without seeing the card. Naming one of those cards while that rival is still to
// answer settles the note either way (they show it, or they pass and it is crossed off), so
// suggestions and destinations go for such cards, as often as the persona's `interrogate` says.

export interface BotMind {
  difficulty: BotDifficulty;
  /** How this bot behaves with what it knows (see persona.ts). */
  persona: BotPersona;
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
  /** How many cards each seat holds. Hands are not fixed: when a wrong accusation knocks a rival
   *  out, their cards are shuffled back among everyone left, so the survivors' hands grow. */
  handCounts: Map<string, number>;
  /** Seats still in the game, in turn order. An eliminated player keeps answering suggestions but
   *  can never accuse again, so they are no threat to anybody. */
  activeIds: string[];
  /** Completed rounds so far — what an impatient persona counts. */
  round: number;
  /** Trios already accused and proven wrong, from `wrongAccusationTrios`. Public knowledge. */
  wrongTrios: string[][];
}

/** What a bot can see of the table beyond the suggestion log. */
export interface BotTable {
  /** Seats knocked out by a wrong accusation. */
  eliminatedIds?: readonly string[];
  /** Completed rounds (`GameState.round`). */
  round?: number;
  /** Trios already proven wrong (`wrongAccusationTrios(state)`). */
  wrongTrios?: readonly string[][];
}

// A bot gambles on an accusation once its odds reach the floor its persona will settle for. That
// floor is not fixed: it slides from the persona's calm `gambleMinOdds` toward its much looser
// `threatOdds` as the table starts to look dangerous (see `botThreatLevel`), and loosens further
// still as an impatient persona watches the rounds go by. A persona may also copy a rival's
// undisproved trio outright, or — when it can see it is losing — swing at whatever it has.

const EASY_MEMORY = 30; // suggestions an easy bot keeps in its head
const EASY_GAMBLE_COMBOS = 6; // easy guesses once (#suspects × #weapons × #rooms) left is this small
const THREAT_TELL = 0.55; // how much of a threat an undisproved suggestion is on its own
const THREAT_GATE = 0.5; // the level at which `botThreatened` reads true
const THREAT_BASE = 0.45; // how much of a rival's raw head start counts before that tell
const PATIENT_ROUNDS = 6; // rounds an impatient persona sits through before its odds start slipping
const RACE_GATE = 0.6; // no swinging wildly until the threat is real...
const RACE_MAX_COMBOS = 60; // ...and never on odds so long that accusing just hands the seat away
const MIN_ODDS = 1 / 40; // however impatient, no bot accuses on worse than this
// Global balance dial on top of every persona's own nerve: each one holds out for this much better
// odds than its dials alone would ask, and takes the wild routes (racing, copying) proportionally
// less often. Raise it to calm the whole table down, lower it to wind everyone up.
//
// The target it is tuned against is a 40-seat all-hard table: essentially every game should end
// with somebody naming the envelope rather than with a last detective standing, while still
// carrying one or more wrong accusations along the way. Check both with
//   npx tsx scripts/botsim.ts 40 <games> 800 7 hard
// which reports exactly those two figures.
const CAUTION = 1.1;
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
  persona?: BotPersonaId,
  table?: BotTable,
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
  const wrongTrios = (table?.wrongTrios ?? []).map((t) => [...t]);
  let envelope = d === 'easy' ? new Set<string>() : envelopeKnown(k, botId, playerIds, hand, ids);
  if (d !== 'easy' && wrongTrios.length) {
    // Fold in what the table's failed accusations prove. This can rule a card out, which can settle
    // a category, which can prove the next card — so it runs to a fixpoint, and the confirmed
    // envelope has to be recomputed afterwards.
    if (refuteFromAccusations(k, envelope, wrongTrios, pool)) {
      envelope = envelopeKnown(k, botId, playerIds, hand, ids);
    }
  }
  const out = new Set(table?.eliminatedIds ?? []);
  const activeIds = playerIds.filter((p) => !out.has(p));
  return {
    difficulty: d,
    persona: personaOf(persona),
    botId,
    hand,
    k,
    envelope,
    playerIds,
    events,
    pool,
    board,
    handCounts: handCounts ?? new Map(),
    activeIds,
    round: table?.round ?? 0,
    wrongTrios,
  };
}

/** The card a category has settled on, or null while it is still open: one confirmed in the
 *  envelope, or a lone survivor of elimination. */
function settled(cands: { id: string }[], envelope: Set<string>): string | null {
  const confirmed = cands.find((x) => envelope.has(x.id));
  if (confirmed) return confirmed.id;
  return cands.length === 1 ? cands[0].id : null;
}

/**
 * Cross off what the table's failed accusations prove, extending `k.ruledOut` in place and
 * reporting whether anything moved.
 *
 * A wrong accusation only says the *combination* was wrong, so no single card of it can be crossed
 * off on its own — that trap is why this is worth spelling out. But once two of its three
 * categories have settled, the third card of a matching trio cannot be the answer. Ruling it out
 * can settle a fresh category, so the pass repeats until it stops finding anything.
 */
function refuteFromAccusations(k: BotKnowledge, envelope: Set<string>, wrongTrios: string[][], pool: CardPool): boolean {
  let moved = false;
  for (let guard = 0; guard < 8; guard++) {
    const c = botCandidates(k.ruledOut, pool);
    const s = settled(c.suspects, envelope);
    const w = settled(c.weapons, envelope);
    const r = settled(c.rooms, envelope);
    if (!s && !w && !r) break; // nothing settled yet, so nothing can fall out
    let changed = false;
    // Never contradict a card already confirmed in the envelope: with sound deduction that cannot
    // happen, and if it somehow does, the confirmed card is the safer of the two beliefs.
    const rule = (card: string) => {
      if (envelope.has(card) || k.ruledOut.has(card)) return;
      k.ruledOut.add(card);
      changed = true;
    };
    for (const [ws, ww, wr] of wrongTrios) {
      if (s && w && ws === s && ww === w) rule(wr);
      if (s && r && ws === s && wr === r) rule(ww);
      if (w && r && ww === w && wr === r) rule(ws);
    }
    if (!changed) break;
    moved = true;
  }
  return moved;
}

/** Which rivals floated a trio, within the last round (one suggestion per seat at most, so the last
 *  `players - 1` events), that nobody could disprove and that names only cards this bot still
 *  considers possible envelope cards. Whoever made it either holds those cards or has just
 *  confirmed the solution — and if it's the latter, they accuse on their next turn. */
function tellers(m: BotMind): Set<string> {
  const window = Math.max(1, m.playerIds.length - 1);
  const out = new Set<string>();
  for (const e of m.events.slice(-window)) {
    if (e.suggesterId === m.botId || e.suggesterId === '' || e.responderId) continue;
    const theirs = m.k.has.get(e.suggesterId);
    if (e.trio.every((c) => !m.k.ruledOut.has(c) && !m.hand.includes(c) && !theirs?.has(c))) out.add(e.suggesterId);
  }
  return out;
}

/** Cards each seat has been shown: one per suggestion of theirs that somebody answered. A repeated
 *  trio teaches nothing new, so it counts once. One pass over the log serves the whole table. */
function shownCounts(m: BotMind): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const e of m.events) {
    if (!e.responderId || !e.suggesterId) continue;
    let trios = seen.get(e.suggesterId);
    if (!trios) seen.set(e.suggesterId, (trios = new Set<string>()));
    trios.add(e.trio.join('|'));
  }
  const out = new Map<string, number>();
  for (const [p, trios] of seen) out.set(p, trios.size);
  return out;
}

/** How close one rival looks to solving the case, in 0..1. `need` is the number of cards that have
 *  to be accounted for before only the envelope is left; `mine` is this bot's own tally. */
function rivalThreat(theirs: number, mine: number, need: number, tell: boolean): number {
  // Every card in a hand is a card ruled out of the envelope for free, so hand size is a head
  // start — and a growing one, since an eliminated rival's cards are dealt back out to the table.
  const progress = Math.min(1, theirs / need);
  // Measured against this bot's own footing, so what registers is "they are ahead of me" rather
  // than "the game is late". A quarter of the deck of advantage either way saturates it.
  const edge = Math.max(-1, Math.min(1, ((theirs - mine) / need) * 4));
  const base = (THREAT_BASE * progress * (1 + edge)) / 2;
  return tell ? base + (1 - base) * THREAT_TELL : base;
}

/**
 * The chance that somebody accuses before this bot's next turn, in 0..1.
 *
 * Between now and then every rival still in the game takes exactly one turn, and any of them might
 * solve it. Each rival is judged on what the bot can honestly see — the classic undisproved-
 * suggestion tell, how many cards they hold, and how many they have been shown — and those chances
 * are then combined across the whole table. More seats still in play means more chances for one of
 * them to get there first; a crowded table also deals everyone a smaller hand, so the two effects
 * largely cancel and the reading stays sane from three players up to forty.
 *
 * The persona's `threatSense` scales the result: a jumpy personality reads danger into a quiet
 * table, a phlegmatic one shrugs at a rival who is genuinely one turn away.
 */
export function botThreatLevel(m: BotMind): number {
  const rivals = m.activeIds.filter((p) => p !== m.botId);
  if (!rivals.length) return 0;
  const tell = tellers(m);
  const shown = shownCounts(m);
  const need = Math.max(1, poolIds(m.pool).length - 3);
  const mine = m.hand.length + (shown.get(m.botId) ?? 0);
  let safe = 1;
  for (const p of rivals) {
    const theirs = (m.handCounts.get(p) ?? 0) + (shown.get(p) ?? 0);
    safe *= 1 - rivalThreat(theirs, mine, need, tell.has(p));
  }
  return Math.max(0, Math.min(1, (1 - safe) * m.persona.threatSense));
}

/** Does some other player look set to solve the case before this bot's next turn? */
export function botThreatened(m: BotMind): boolean {
  return botThreatLevel(m) >= THREAT_GATE;
}

/** The odds this bot will settle for right now: its persona's calm floor, slid toward its threat
 *  floor by how dangerous the table looks, then loosened by impatience as the game drags on. */
function oddsFloor(m: BotMind, level: number): number {
  const P = m.persona;
  const slid = P.gambleMinOdds + (P.threatOdds - P.gambleMinOdds) * level;
  const late = Math.max(0, m.round - PATIENT_ROUNDS);
  return CAUTION * Math.max(MIN_ODDS, slid / (1 + P.impatience * late));
}

/** The most recent trio a rival floated that nobody could disprove and that this bot cannot rule
 *  out itself. Null when there is none — including when the bot holds one of the three, which is
 *  the tell that the suggestion was a bluff rather than a solution. */
function copycatTrio(m: BotMind, refuted: Set<string>): BotAccusation | null {
  const window = Math.max(1, m.playerIds.length - 1);
  const recent = m.events.slice(-window);
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i];
    if (e.suggesterId === m.botId || e.suggesterId === '' || e.responderId) continue;
    if (e.trio.length !== 3) continue; // synthetic hand-count events are not suggestions
    if (!e.trio.every((c) => !m.k.ruledOut.has(c) && !m.hand.includes(c))) continue;
    if (refuted.has(e.trio.join('|'))) continue; // somebody already tried this one and lost
    return { suspectId: e.trio[0], weaponId: e.trio[1], roomId: e.trio[2] };
  }
  return null;
}

/** Trios already proven wrong, as lookup keys. */
function refutedTrios(m: BotMind): Set<string> {
  return new Set(m.wrongTrios.map((t) => t.join('|')));
}

/** How many of the trios still open to this bot have already been accused and lost. */
function refutedWithin(refuted: Set<string>, S: { id: string }[], W: { id: string }[], R: { id: string }[]): number {
  if (!refuted.size) return 0;
  const has = (cands: { id: string }[], id: string) => cands.some((x) => x.id === id);
  let n = 0;
  for (const key of refuted) {
    const [s, w, r] = key.split('|');
    if (has(S, s) && has(W, w) && has(R, r)) n++;
  }
  return n;
}

/** Pick a trio from the open candidates, never one the table has already disproved. */
function pickTrio(
  S: { id: string }[],
  W: { id: string }[],
  R: { id: string }[],
  refuted: Set<string>,
  rng: RNG,
): BotAccusation | null {
  if (!S.length || !W.length || !R.length) return null;
  for (let i = 0; i < 24; i++) {
    const s = pick(S, rng).id;
    const w = pick(W, rng).id;
    const r = pick(R, rng).id;
    if (!refuted.has(`${s}|${w}|${r}`)) return { suspectId: s, weaponId: w, roomId: r };
  }
  // Two dozen misses means the field is nearly all disproved, so it is small: take what is left.
  const left: BotAccusation[] = [];
  if (S.length * W.length * R.length <= 4096) {
    for (const s of S) for (const w of W) for (const r of R) {
      if (!refuted.has(`${s.id}|${w.id}|${r.id}`)) left.push({ suspectId: s.id, weaponId: w.id, roomId: r.id });
    }
  }
  return left.length ? pick(left, rng) : null;
}

/** What this bot would accuse if it had to accuse right now, whatever its nerve: every category it
 *  has settled is taken as read, and the rest is a pick from what it cannot rule out, steering
 *  clear of trios the table has already disproved. `combos` is how many trios were still open to
 *  it — 1 means it had the case solved. Null only if its notes have collapsed to nothing (which
 *  sound deduction never does). Used for the end-of-game screen's "would have accused" line. */
export function botBestGuess(m: BotMind, rng: RNG): (BotAccusation & { combos: number }) | null {
  const c = botCandidates(m.k.ruledOut, m.pool);
  const refuted = refutedTrios(m);
  const open = (cands: { id: string }[], all: { id: string }[]) => {
    if (!cands.length) return all; // notes contradict themselves: fall back to the whole category
    const pinned = settled(cands, m.envelope);
    return pinned ? cands.filter((x) => x.id === pinned) : cands;
  };
  const S = open(c.suspects, m.pool.suspects);
  const W = open(c.weapons, m.pool.weapons);
  const R = open(c.rooms, m.pool.rooms);
  const combos = Math.max(1, S.length * W.length * R.length - refutedWithin(refuted, S, W, R));
  const trio = pickTrio(S, W, R, refuted, rng) ?? pickTrio(S, W, R, new Set(), rng);
  return trio ? { ...trio, combos } : null;
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
  const P = m.persona;
  const level = botThreatLevel(m);
  const floor = oddsFloor(m, level);
  // Whatever else a bot works out, it does not walk into a wall somebody else already walked into.
  // Even the easy tier gets this: an accusation is announced to the table, so remembering one is
  // memory, not deduction.
  const refuted = refutedTrios(m);
  if (m.difficulty === 'easy') {
    if (c.suspects.length === 1 && c.weapons.length === 1 && c.rooms.length === 1) {
      const only = { suspectId: c.suspects[0].id, weaponId: c.weapons[0].id, roomId: c.rooms[0].id };
      return refuted.has(`${only.suspectId}|${only.weaponId}|${only.roomId}`) ? null : only;
    }
    // Feeling lucky: once the field is small, guess rather than keep grinding. A gambling persona —
    // or one that can see a rival closing in — is happy with a much longer shot than that.
    const combos = c.suspects.length * c.weapons.length * c.rooms.length - refutedWithin(refuted, c.suspects, c.weapons, c.rooms);
    const limit = Math.max(EASY_GAMBLE_COMBOS, Math.round(1 / floor));
    if (combos > 0 && combos <= limit) return pickTrio(c.suspects, c.weapons, c.rooms, refuted, rng);
    return null;
  }
  // Medium/hard: each category pinned either by elimination or by a confirmed envelope card.
  const s = settled(c.suspects, m.envelope);
  const w = settled(c.weapons, m.envelope);
  const r = settled(c.rooms, m.envelope);
  // All three pinned is a solved case — unless the table has already disproved that very trio, in
  // which case one of the three pins is wrong and it is better to keep playing than to hand the
  // seat away on a certainty that cannot be true.
  if (s && w && r) return refuted.has(`${s}|${w}|${r}`) ? null : { suspectId: s, weaponId: w, roomId: r };

  // Not certain — but if a rival looks about to win (or the persona simply likes a punt), a good
  // enough guess beats waiting to lose.
  const open = (cands: { id: string }[], pinned: string | null) => (pinned ? cands.filter((x) => x.id === pinned) : cands);
  const S = open(c.suspects, s);
  const W = open(c.weapons, w);
  const R = open(c.rooms, r);
  // Trios the table has already disproved are not live guesses, so they do not count towards the
  // odds either: a field of four with one of them already burned is a one-in-three shot.
  const combos = S.length * W.length * R.length - refutedWithin(refuted, S, W, R);
  if (combos <= 0) return null;

  // Somebody just floated a trio nobody could disprove: a copycat takes it at face value, which is
  // as often a bluff swallowed whole as it is a solution stolen.
  if (P.copycatChance > 0 && rng() < P.copycatChance / CAUTION) {
    const copy = copycatTrio(m, refuted);
    if (copy) return copy;
  }
  // Odds good enough for this persona, the floor having already slid toward `threatOdds` if the
  // table looks dangerous.
  if (1 / combos >= floor && (!P.gambleNeedsThreat || level >= THREAT_GATE)) {
    return pickTrio(S, W, R, refuted, rng);
  }
  // Losing anyway: swing at it rather than sit and watch. Not on odds so long that accusing is
  // simply handing the seat away.
  if (level >= RACE_GATE && combos <= RACE_MAX_COMBOS && rng() < (P.raceChance * level) / CAUTION) {
    return pickTrio(S, W, R, refuted, rng);
  }
  return null;
}

/** The rival with the most cards the bot cannot yet account for: the one worth interrogating. */
function stalkTarget(m: BotMind, queue: string[]): string | undefined {
  let best: string | undefined;
  let bestN = 0;
  const total = poolIds(m.pool).length;
  for (const p of queue) {
    const known = m.k.has.get(p)?.size ?? 0;
    const denied = m.k.hasnt.get(p)?.size ?? 0;
    // Unknown cards = everything they haven't been shown to hold or not hold. Bigger is juicier.
    const n = total - known - denied;
    if (n > bestN) {
      bestN = n;
      best = p;
    }
  }
  return best;
}

/** Weight of naming a card from a rival's "holds one of these" note, per card, in the probe score
 *  on a turn the bot has decided to put the question (see `interrogate`). Well above what a pair
 *  can earn from the players who might have to show something, so it decides the suggestion. */
const KEEN_BONUS = 10;

/** The cards of `trio` that sit on a note the bot keeps about player `p` ("holds one of these"). */
function groupHits(m: BotMind, p: string, trio: string[]): number {
  let n = 0;
  for (const g of m.k.groups) if (g.playerId === p) for (const c of trio) if (g.cards.includes(c)) n++;
  return n;
}

/**
 * How much suggesting `trio` would settle the bot's "holds one of these" notes: one per note card
 * named, for every rival reached before someone known to hold a card of the trio (who would show
 * that and end the round). A reached rival either shows the note's card, pinning it, or passes and
 * has it crossed off the note; both are progress.
 */
export function botSplitValue(m: BotMind, queue: string[], trio: string[]): number {
  let n = 0;
  for (const p of queue) {
    const has = m.k.has.get(p);
    if (trio.some((c) => has?.has(c))) break;
    n += groupHits(m, p, trio);
  }
  return n;
}

/** Whether a rival in the queue has a note that one of these cards could settle. */
function hasSplittableGroup(m: BotMind, queue: string[], cards: string[]): boolean {
  return m.k.groups.some((g) => queue.includes(g.playerId) && g.cards.some((c) => cards.includes(c)));
}

/** Pick one of `cands` for a suggestion. On a turn the bot is putting a question (`keen`) it takes
 *  whichever settles the most notes, ties drawn at random; otherwise a plain draw. `trioOf`
 *  completes the suggestion. */
function pickInterrogating(m: BotMind, queue: string[], cands: { id: string }[], trioOf: (id: string) => string[], rng: RNG, keen: boolean): string {
  if (!keen || cands.length < 2) return pick(cands, rng).id;
  let best: { id: string }[] = [];
  let bestValue = 0;
  for (const c of cands) {
    const v = botSplitValue(m, queue, trioOf(c.id));
    if (v > bestValue) {
      bestValue = v;
      best = [c];
    } else if (v === bestValue && v > 0) best.push(c);
  }
  return pick(best.length ? best : cands, rng).id;
}

/** Score probe pairs by walking the responders: a player known to hold one of the three ends the
 *  walk (they'll show a card I already know); a player who might hold an unknown card is a chance
 *  to learn something; on a turn the bot is putting a question (`keen`), a card on that player's
 *  note is the thing to name. A stalking persona also rewards pairs its target may have to answer. */
function scoredProbe(m: BotMind, roomId: string, queue: string[], sus: { id: string }[], wea: { id: string }[], rng: RNG, keen = false): BotSuggestion {
  const target = m.persona.stalk ? stalkTarget(m, queue) : undefined;
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
      if (p === target) score += 2 * maybe;
      if (keen) score += KEEN_BONUS * groupHits(m, p, [s, w, roomId]);
    }
    if (score > bestScore) {
      bestScore = score;
      best = [{ suspectId: s, weaponId: w }];
    } else if (score === bestScore) best.push({ suspectId: s, weaponId: w });
  }
  return pick(best, rng);
}

/**
 * What to suggest from `roomId`. `queue` is the order in which the other players will be asked.
 */
export function botDecideSuggestion(m: BotMind, roomId: string, queue: string[], rng: RNG): BotSuggestion {
  const c = botCandidates(m.k.ruledOut, m.pool);
  const heldSuspects = m.hand.filter((id) => getCard(id)?.type === 'suspect');
  const heldWeapons = m.hand.filter((id) => getCard(id)?.type === 'weapon');
  // A bluffer names its own cards: nobody can disprove the suggestion, and rivals who trust an
  // undisproved suggestion cross the wrong cards off.
  if (heldSuspects.length && heldWeapons.length && m.persona.bluffChance > 0 && rng() < m.persona.bluffChance) {
    return { suspectId: pick(heldSuspects, rng), weaponId: pick(heldWeapons, rng) };
  }
  if (m.difficulty === 'easy') {
    return {
      suspectId: pick(c.suspects.length ? c.suspects : m.pool.suspects, rng).id,
      weaponId: pick(c.weapons.length ? c.weapons : m.pool.weapons, rng).id,
    };
  }
  // Whether, this turn, it puts a "holds one of these" note to its holder: as often as its
  // personality bothers, and only when it has such a note about somebody still to answer.
  const P = m.persona;
  const keen =
    P.interrogate > 0 &&
    hasSplittableGroup(m, queue, [...c.suspects.map((x) => x.id), ...c.weapons.map((x) => x.id), roomId]) &&
    rng() < P.interrogate;
  if (m.difficulty === 'medium') {
    const sus = c.suspects.length ? c.suspects : m.pool.suspects;
    const wea = c.weapons.length ? c.weapons : m.pool.weapons;
    // A stalker always weighs who will answer; anyone else does so on a turn it puts a question.
    if (P.stalk || keen) return scoredProbe(m, roomId, queue, sus, wea, rng, keen);
    return botSuggestion(m.k.ruledOut, m.hand, roomId, rng, m.pool);
  }

  // ---- hard ----
  const roomUnknown = !m.k.ruledOut.has(roomId) && !m.envelope.has(roomId);
  // Isolate the room: only the room card could be shown. On a turn it is putting a question, only
  // if the room itself is on the note — otherwise the question goes to the suspect or weapon below.
  if (roomUnknown && heldSuspects.length && heldWeapons.length && (!keen || botSplitValue(m, queue, [roomId]) > 0)) {
    return { suspectId: pick(heldSuspects, rng), weaponId: pick(heldWeapons, rng) };
  }
  // In a room nobody can show, isolate a suspect or a weapon with one of my own cards.
  const roomSafe = m.hand.includes(roomId) || m.envelope.has(roomId);
  const openSus = c.suspects.filter((x) => !m.envelope.has(x.id));
  const openWea = c.weapons.filter((x) => !m.envelope.has(x.id));
  if (roomSafe) {
    // Isolating a card that sits on a rival's note is the cleanest interrogation there is: only
    // that card can be shown, so the answer settles the note outright.
    if (openSus.length > 1 && heldWeapons.length && (openSus.length >= openWea.length || !heldSuspects.length)) {
      const w = pick(heldWeapons, rng);
      return { suspectId: pickInterrogating(m, queue, openSus, (x) => [x, w, roomId], rng, keen), weaponId: w };
    }
    if (openWea.length > 1 && heldSuspects.length) {
      const s = pick(heldSuspects, rng);
      return { suspectId: s, weaponId: pickInterrogating(m, queue, openWea, (x) => [s, x, roomId], rng, keen) };
    }
  }
  const sus = openSus.length ? openSus : c.suspects.length ? c.suspects : m.pool.suspects;
  const wea = openWea.length ? openWea : c.weapons.length ? c.weapons : m.pool.weapons;
  return scoredProbe(m, roomId, queue, sus, wea, rng, keen);
}

/** Whether an in-room bot should skip moving and suggest again from here. `staysHere` counts the
 *  turns it has already stayed in this room in a row; `visited` is the rooms it has suggested in. */
export function botDecideStay(m: BotMind, roomId: string | undefined, staysHere: number, visited: Set<string>): boolean {
  if (!roomId) return false;
  if (m.difficulty === 'easy') return false;
  const P = m.persona;
  if (P.maxStays <= 0) return false; // a restless persona never lingers
  const unknownHere = !m.k.ruledOut.has(roomId) && !m.envelope.has(roomId);
  if (m.difficulty === 'medium') {
    // Today's medium rule: linger only in a room it has not yet tested. (The visited set fills
    // when it suggests, so in practice it moves on.) A squatting persona stays a little longer.
    if (P.maxStays <= 1) return unknownHere && !visited.has(roomId);
    return unknownHere ? staysHere < Math.min(2, P.maxStays) : botProbeRooms(m).has(roomId) && staysHere < Math.min(2, P.maxStays);
  }
  // ---- hard ----
  if (unknownHere) return staysHere < P.maxStays; // keep probing it
  const c = botCandidates(m.k.ruledOut, m.pool);
  const stillOpen = c.suspects.length > 1 || c.weapons.length > 1;
  return botProbeRooms(m).has(roomId) && stillOpen && staysHere < P.maxStays;
}

/** Take a secret passage when it leads somewhere more useful than rolling would (hard bots), or
 *  simply because it is there (a rambling persona). */
export function botDecideShortcut(m: BotMind, roomId: string | undefined, rng?: RNG): boolean {
  if (!roomId) return false;
  const dest = shortcutDestForRoom(roomId, m.board);
  if (!dest) return false;
  if (rng && m.persona.shortcutChance > 0 && rng() < m.persona.shortcutChance) return true;
  if (m.difficulty !== 'hard') return false;
  const unknown = botUnknownRooms(m);
  if (unknown.has(dest)) return true;
  // Nothing left to learn from rooms: a probe room is still worth having, a known room is not.
  return unknown.size === 0 && botProbeRooms(m).has(dest) && !botProbeRooms(m).has(roomId);
}

type RoomClass = 'unknown' | 'probe' | 'known';

/** The three classes of room a bot tells apart when choosing where to walk, heaviest first. */
function roomClasses(m: BotMind): { cls: RoomClass; rooms: Set<string>; weight: number }[] {
  const unknown = botUnknownRooms(m);
  const probe = botProbeRooms(m);
  const known = new Set(m.pool.rooms.map((r) => r.id).filter((r) => !unknown.has(r) && !probe.has(r)));
  const P = m.persona;
  return [
    { cls: 'unknown' as const, rooms: unknown, weight: P.unknownRoomWeight },
    { cls: 'probe' as const, rooms: probe, weight: P.probeRoomWeight },
    { cls: 'known' as const, rooms: known, weight: P.knownRoomWeight },
  ].sort((a, b) => b.weight - a.weight);
}

/** Pick a room tile, every room weighted equally except for a persona's door bias. On a move the
 *  bot is putting a question (`keen`), only rooms on a note about a rival still to answer (`queue`)
 *  count, when any are in reach: standing there puts the question to that rival directly. */
function pickRoomTileBiased(m: BotMind, tiles: Coord[], rng: RNG, queue: string[] = [], keen = false): Coord {
  if (keen) {
    const noted = tiles.filter((t) => botSplitValue(m, queue, [roomIdAt(m.board, t)!]) > 0);
    if (noted.length) tiles = noted;
  }
  const bias = m.persona.doorBias;
  if (bias <= 0) return pickRoomTile(tiles, rng, m.board);
  const byRoom = new Map<string, Coord[]>();
  for (const t of tiles) {
    const r = roomIdAt(m.board, t)!;
    const list = byRoom.get(r);
    if (list) list.push(t);
    else byRoom.set(r, [t]);
  }
  const rooms = [...byRoom.keys()];
  const weights = rooms.map((r) => 1 + bias * ((m.board.rooms[r]?.entrances.length ?? 1) - 1));
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rooms.length; i++) {
    roll -= weights[i];
    if (roll < 0) return pick(byRoom.get(rooms[i])!, rng);
  }
  return pick(byRoom.get(rooms[rooms.length - 1])!, rng);
}

/** Pick a destination among the reachable tiles. `queue` (the order others would answer a
 *  suggestion) lets a hard bot judge whether a known room is still worth suggesting from;
 *  `visited` (rooms it has suggested from) lets a restless persona steer clear of them. */
export function botDecideMove(m: BotMind, reach: Coord[], rng: RNG, queue: string[] = [], visited: Set<string> = new Set()): Coord | null {
  if (!reach.length) return null;
  const P = m.persona;
  const board = m.board;
  // A rambler steps into the lift for the ride.
  if (P.liftChance > 0) {
    const lifts = reach.filter((t) => elevatorFloorAt(board, t));
    if (lifts.length && rng() < P.liftChance) return pick(lifts, rng);
  }
  const allRoomTiles = reach.filter((t) => roomIdAt(board, t));
  const roomTiles = P.avoidVisited ? allRoomTiles.filter((t) => !visited.has(roomIdAt(board, t)!)) : allRoomTiles;
  if (m.difficulty === 'easy') {
    if (roomTiles.length && rng() < 0.7) return pickRoomTileBiased(m, roomTiles, rng);
    return pick(reach, rng);
  }

  // Whether, this move, it heads for a room on a "holds one of these" note to put the question.
  const keen = P.interrogate > 0 && m.k.groups.length > 0 && queue.length > 0 && rng() < P.interrogate;
  const classes = roomClasses(m);
  for (const cls of classes) {
    if (cls.weight <= 0) break; // refused while a heavier class still has rooms anywhere
    const tiles = roomTiles.filter((t) => cls.rooms.has(roomIdAt(board, t)!));
    if (!tiles.length) continue;
    if (cls.cls === 'known' && m.difficulty === 'hard' && queue.length) {
      // A known room whose holder answers late is still worth a suggestion: everyone asked before
      // them might have to show the suspect or weapon instead. Prefer the longest run of askers
      // ahead of the holder, as long as at least two are asked first.
      let bestTiles: Coord[] = [];
      let bestAhead = 1;
      for (const t of tiles) {
        const r = roomIdAt(board, t)!;
        const holderIdx = queue.findIndex((p) => m.k.has.get(p)?.has(r));
        const ahead = holderIdx < 0 ? queue.length : holderIdx;
        if (ahead > bestAhead) {
          bestAhead = ahead;
          bestTiles = [t];
        } else if (ahead === bestAhead && bestAhead > 1) bestTiles.push(t);
      }
      if (bestTiles.length) return pickRoomTileBiased(m, bestTiles, rng, queue, keen);
      continue; // no such room: walk toward something better instead
    }
    return pickRoomTileBiased(m, tiles, rng, queue, keen);
  }

  // No room worth entering in reach: walk the corridor toward the nearest room of the best class
  // that still has any (hard bots and restless personas), else take whatever room there is.
  if (m.difficulty === 'hard' || P.corridorWalk) {
    const targetCls = classes.find((c) => c.weight > 0 && c.rooms.size > 0);
    const targets = new Set([...(targetCls?.rooms ?? [])].filter((r) => !(P.avoidVisited && visited.has(r))));
    const corridor = reach.filter((t) => !roomIdAt(board, t) && !elevatorFloorAt(board, t));
    if (corridor.length && targets.size) {
      let best: Coord[] = [];
      let bestD = Infinity;
      for (const t of corridor) {
        const d = stepsToRooms(board, t, targets);
        if (d < bestD) {
          bestD = d;
          best = [t];
        } else if (d === bestD) best.push(t);
      }
      if (best.length && bestD < Infinity) return pick(best, rng);
    }
  }
  if (roomTiles.length) return pickRoomTileBiased(m, roomTiles, rng, queue, keen);
  // Nothing useful anywhere: any room beats standing in a corridor.
  if (allRoomTiles.length) return pickRoomTileBiased(m, allRoomTiles, rng);
  return pick(reach, rng);
}

/** Which floor to ride the elevator to. Hard bots pick the floor whose exit is nearest a useful
 *  room; a rambling persona picks the farthest instead. */
export function botDecideFloor(m: BotMind, options: FloorId[], rng: RNG): FloorId {
  const far = m.persona.farFloors;
  if (m.difficulty !== 'hard' && !far) return pick(options, rng);
  const unknown = botUnknownRooms(m);
  const targets = unknown.size ? unknown : botProbeRooms(m);
  let best: FloorId[] = [];
  let bestD = far ? -Infinity : Infinity;
  for (const f of options) {
    const elev = m.board.elevators.find((e) => e.floor === f);
    const d = elev ? stepsToRooms(m.board, elev.exit, targets) : Infinity;
    if (d === Infinity && far) continue; // a floor with nothing to reach is no adventure
    if (far ? d > bestD : d < bestD) {
      bestD = d;
      best = [f];
    } else if (d === bestD) best.push(f);
  }
  return pick(best.length ? best : options, rng);
}
