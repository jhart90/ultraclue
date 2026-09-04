import type { CardType } from 'shared';

// Build-time map of override assets. Vite globs the repo-root override folder; the map is empty
// until you drop files into assets/overrides/<type>/<card-id>.<ext>, at which point that art is
// bundled and used in place of the procedural SVG. (Requires server.fs.allow to reach the root —
// configured in vite.config.ts.)
const overrideUrls = import.meta.glob(
  '../../../assets/overrides/{suspects,weapons,rooms}/*.{svg,png,jpg,jpeg,webp}',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

// Downscaled twins of the same art (see .claude/skills/optimize-image-assets/scripts/make_thumbs.py).
// Every screen but the full-size zoom viewer draws a card at 200px or less, so it takes these
// instead — about a fifth of the bytes. Empty until thumbs are generated, in which case callers
// silently fall back to the master.
const thumbUrls = import.meta.glob(
  '../../../assets/overrides/thumbs/**/*.{svg,png,jpg,jpeg,webp}',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

const TYPE_FOLDER: Record<CardType, string> = {
  suspect: 'suspects',
  weapon: 'weapons',
  room: 'rooms',
};

/** Lower-case the title and collapse anything non-alphanumeric to single underscores, so
 *  "Admiral Navy" -> "admiral_navy" and "Trophy Room" -> "trophy_room". */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Returns the URL of an override image for this card, or undefined to fall back to procedural art.
 * A file matches if it is named after the card id (e.g. `suspect-navy.png`) OR after the card's
 * title (e.g. `admiral_navy.png`), so art can be dropped in using whichever name is handier.
 */
export function resolveOverride(cardId: string, type: CardType, title?: string): string | undefined {
  return lookup(overrideUrls, cardId, type, title, '');
}

/**
 * The small twin of `resolveOverride`, for anywhere a card is drawn at 200px or less. Falls back to
 * the full-size file when no thumbnail has been generated, so art always shows.
 */
export function resolveOverrideThumb(cardId: string, type: CardType, title?: string): string | undefined {
  return lookup(thumbUrls, cardId, type, title, 'thumbs/') ?? resolveOverride(cardId, type, title);
}

function lookup(
  urls: Record<string, string>,
  cardId: string,
  type: CardType,
  title: string | undefined,
  prefix: string,
): string | undefined {
  const folder = TYPE_FOLDER[type];
  const needles = [`/overrides/${prefix}${folder}/${cardId}.`];
  if (title) needles.push(`/overrides/${prefix}${folder}/${slug(title)}.`);
  // Case-insensitive so art dropped in as `Boat_House.webp` still matches the slug `boat_house`.
  for (const [path, url] of Object.entries(urls)) {
    const lower = path.toLowerCase();
    if (needles.some((n) => lower.includes(n.toLowerCase()))) return url;
  }
  return undefined;
}
