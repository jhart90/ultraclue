import { CARD_BACKS, type CardBackId } from 'shared';

// The card-back art, globbed from the repo-root backs folder at build time (the same arrangement as
// the card-front overrides — see overrides.ts). `classic` has no file: CardBack draws it in CSS.
// A file matches an id by basename, so `40alibis_cardback_artdeco.webp` is `artdeco`.
const urls = import.meta.glob('../../../assets/cards/backs/*.{svg,png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const artById = new Map<CardBackId, string>();
for (const [path, url] of Object.entries(urls)) {
  const base = path.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase();
  const id = CARD_BACKS.find((b) => b !== 'classic' && base.includes(b));
  if (id && !artById.has(id)) artById.set(id, url);
}

/** The art for a back, or undefined for `classic` (and for any back whose file is missing). */
export function cardBackArt(id: CardBackId): string | undefined {
  return artById.get(id);
}

export const CARD_BACK_LABEL: Record<CardBackId, string> = {
  classic: 'Classic',
  artdeco: 'Art Deco',
  blueprint: 'Blueprint',
  stainedglass: 'Stained glass',
  fingerprint: 'Fingerprint',
  mahogany: 'Mahogany',
  peacock: 'Peacock',
};

export function randomCardBack(): CardBackId {
  return CARD_BACKS[Math.floor(Math.random() * CARD_BACKS.length)];
}

/** A viewer's own setting: a fixed back, or `table` to follow whatever the table drew. */
export type CardBackChoice = CardBackId | 'table';

const CHOICE_KEY = 'ultraclue-cardback';

export function readCardBackChoice(): CardBackChoice {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return v && (CARD_BACKS as readonly string[]).includes(v) ? (v as CardBackId) : 'table';
  } catch {
    return 'table';
  }
}

export function saveCardBackChoice(choice: CardBackChoice): void {
  try {
    if (choice === 'table') localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    /* ignore */
  }
}
