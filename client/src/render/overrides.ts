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

/** Returns the URL of an override image for this card, or undefined to fall back to procedural art. */
export function resolveOverride(cardId: string, type: CardType): string | undefined {
  const folder = TYPE_FOLDER[type];
  const needle = `/overrides/${folder}/${cardId}.`;
  for (const [path, url] of Object.entries(overrideUrls)) {
    if (path.includes(needle)) return url;
  }
  return undefined;
}
