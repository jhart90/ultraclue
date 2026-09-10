// Build-time map of top-down room art painted onto the board itself (assets/board/rooms/). This is
// separate from the card art in assets/cards/rooms/: the card shows a room from inside at eye
// level, the board shows its floor from above. See assets/board/README.md for the spec.
const boardRoomUrls = import.meta.glob('../../../assets/board/rooms/*.{svg,png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// Which rooms share one painting, and the file-name slug, live in roomLayout.ts (which has no
// Vite-only imports, so the board scripts can use them too); re-exported here for the board.
import { sharedArtGroup, slug } from './roomLayout';
export { sharedArtGroup };

/**
 * Returns the URL of the board floorplan art for this room, or undefined if none has been painted
 * yet. Files match by card id (`room-clock-tower.webp`) or by title slug (`Clock_Tower.webp`),
 * case-insensitively, like the card overrides.
 */
export function resolveBoardArt(roomId: string, title?: string): string | undefined {
  const needles = [`/rooms/${roomId}.`.toLowerCase()];
  if (title) needles.push(`/rooms/${slug(title)}.`);
  for (const [path, url] of Object.entries(boardRoomUrls)) {
    const lower = path.toLowerCase();
    if (needles.some((n) => lower.includes(n))) return url;
  }
  return undefined;
}
