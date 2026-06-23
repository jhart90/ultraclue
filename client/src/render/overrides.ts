import type { CardType } from 'shared';

// Build-time map of override assets. Vite globs the repo-root override folder; the map is empty
// until you drop files into assets/overrides/<type>/<card-id>.<ext>, at which point that art is
// bundled and used in place of the procedural SVG. (Requires server.fs.allow to reach the root —
// configured in vite.config.ts.)
const overrideUrls = import.meta.glob(
  '../../../assets/overrides/**/*.{svg,png,jpg,jpeg,webp}',
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
  const folder = TYPE_FOLDER[type];
  const needles = [`/overrides/${folder}/${cardId}.`];
  if (title) needles.push(`/overrides/${folder}/${slug(title)}.`);
  for (const [path, url] of Object.entries(overrideUrls)) {
    if (needles.some((n) => path.includes(n))) return url;
  }
  return undefined;
}
