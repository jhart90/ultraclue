import { SUSPECTS, WEAPONS, ROOMS } from '../data';

// A bot's Clue deduction. From the suggestions it has witnessed it works out, for each player:
//  - cards they definitely HOLD (a card was shown, or it's deducible),
//  - cards they definitely DON'T hold (they passed, or someone else holds it),
//  - "holds one of these" possibility groups (they disproved a suggestion but we didn't see which
//    card), which get refined as more is learned.
// This drives both the bot's Detective Notes sheet and its move/suggest/accuse decisions.

export interface SuggestionEvent {
  suggesterId: string;
  trio: string[]; // [suspectId, weaponId, roomId]
  passers: string[]; // players who showed nothing
  responderId?: string; // player who disproved by showing a card
  /** The shown card — present only for events where THIS bot is allowed to know it (it suggested). */
  revealedCardId?: string;
}

export interface BotKnowledge {
  has: Map<string, Set<string>>; // playerId -> cards they hold
  hasnt: Map<string, Set<string>>; // playerId -> cards they don't hold
  groups: { playerId: string; cards: string[] }[]; // "holds one of these" (size >= 2)
  ruledOut: Set<string>; // cards held by some player — i.e. not in the envelope
}

const CATEGORIES = [SUSPECTS, WEAPONS, ROOMS];

/** Run the deduction for one bot. `events` must already be filtered so `revealedCardId` is only set
 *  on suggestions this bot was entitled to see (the ones it made). */
export function deduceBotKnowledge(
  botId: string,
  hand: string[],
  playerIds: string[],
  events: SuggestionEvent[],
): BotKnowledge {
  const has = new Map(playerIds.map((p) => [p, new Set<string>()]));
  const hasnt = new Map(playerIds.map((p) => [p, new Set<string>()]));
  const setHas = (p: string, c: string): boolean => {
    const s = has.get(p);
    if (!s || s.has(c)) return false;
    s.add(c);
    return true;
  };
  const setHasnt = (p: string, c: string): boolean => {
    const s = hasnt.get(p);
    if (!s || s.has(c)) return false;
    s.add(c);
    return true;
  };

  // Our own hand: we hold it; nobody else does.
  for (const c of hand) {
    setHas(botId, c);
    for (const p of playerIds) if (p !== botId) setHasnt(p, c);
  }

  // Direct facts from each witnessed suggestion.
  const groups: { playerId: string; cards: Set<string> }[] = [];
  for (const e of events) {
    for (const p of e.passers) for (const c of e.trio) setHasnt(p, c);
    if (e.responderId) {
      if (e.revealedCardId) setHas(e.responderId, e.revealedCardId);
      else groups.push({ playerId: e.responderId, cards: new Set(e.trio) });
    }
  }

  const heldByAnyone = (): Set<string> => {
    const s = new Set<string>();
    for (const p of playerIds) for (const c of has.get(p)!) s.add(c);
    return s;
  };

  // Propagate to a fixpoint.
  let changed = true;
  while (changed) {
    changed = false;
    // A card one player holds is held by no one else.
    for (const p of playerIds) for (const c of has.get(p)!) for (const o of playerIds) if (o !== p) changed = setHasnt(o, c) || changed;
    // Refine groups: drop cards the player is known to lack; if one card remains, they hold it.
    for (const g of groups) {
      for (const c of [...g.cards]) if (hasnt.get(g.playerId)!.has(c)) (g.cards.delete(c), (changed = true));
      if (g.cards.size === 1) changed = setHas(g.playerId, [...g.cards][0]) || changed;
    }
    // If a category has exactly one card no one holds, that's the envelope — so nobody holds it.
    const ruled = heldByAnyone();
    for (const cat of CATEGORIES) {
      const unknown = cat.filter((c) => !ruled.has(c.id));
      if (unknown.length === 1) for (const p of playerIds) changed = setHasnt(p, unknown[0].id) || changed;
    }
  }

  return {
    has,
    hasnt,
    groups: groups.filter((g) => g.cards.size >= 2).map((g) => ({ playerId: g.playerId, cards: [...g.cards] })),
    ruledOut: heldByAnyone(),
  };
}

// NoteBox states: 1 = solid (has), 2 = X (hasn't), 3..14 = the diagonal/straight/quarter marks used
// to tag a possibility group (each group gets a distinct symbol, in matching sets across its cards).
const GROUP_SYMBOLS = [11, 12, 13, 14, 3, 4, 5, 6, 7, 8, 9, 10];

/** Render a deduction into the Detective Notes grid (cardId -> 8 column states, one per seat in
 *  turn order) — the same shape the human notes sheet persists. */
export function botNotesGrid(k: BotKnowledge, turnOrder: string[]): Record<string, number[]> {
  const col = new Map(turnOrder.map((id, i) => [id, i]));
  const grid: Record<string, number[]> = {};
  const row = (c: string): number[] => (grid[c] ??= new Array(8).fill(0));

  for (const [p, cards] of k.hasnt) {
    const i = col.get(p);
    if (i == null) continue;
    for (const c of cards) row(c)[i] = 2; // X
  }
  for (const [p, cards] of k.has) {
    const i = col.get(p);
    if (i == null) continue;
    for (const c of cards) row(c)[i] = 1; // solid (overrides any X)
  }
  k.groups.forEach((g, gi) => {
    const i = col.get(g.playerId);
    if (i == null) return;
    const sym = GROUP_SYMBOLS[gi % GROUP_SYMBOLS.length];
    for (const c of g.cards) if (row(c)[i] === 0) row(c)[i] = sym;
  });
  return grid;
}
