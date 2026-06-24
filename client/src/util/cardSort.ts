import { SUSPECTS, WEAPONS, ROOMS, type AnyCard } from 'shared';

/** Suspect surnames are the colour-based last word ("Miss Scarlet" -> "Scarlet"); used for sorting. */
export const surname = (title: string): string => title.trim().split(/\s+/).pop() ?? title;

const TYPE_ORDER: Record<string, number> = { suspect: 0, weapon: 1, room: 2 };
const alphaKey = (c: { type: string; title: string }): string => (c.type === 'suspect' ? surname(c.title) : c.title);

/** Sort by type (suspect, weapon, room) then alphabetically — suspects by surname. */
export function compareCards(a: AnyCard, b: AnyCard): number {
  const byType = (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9);
  return byType !== 0 ? byType : alphaKey(a).localeCompare(alphaKey(b));
}

export const SORTED_SUSPECTS = [...SUSPECTS].sort((a, b) => surname(a.title).localeCompare(surname(b.title)));
export const SORTED_WEAPONS = [...WEAPONS].sort((a, b) => a.title.localeCompare(b.title));
export const SORTED_ROOMS = [...ROOMS].sort((a, b) => a.title.localeCompare(b.title));
