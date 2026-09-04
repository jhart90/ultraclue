// Build-time map of top-down room art painted onto the board itself (assets/board/rooms/). This is
// separate from the card art in assets/overrides/rooms/: the card shows a room from inside at eye
// level, the board shows its floor from above. See assets/board/README.md for the spec.
const boardRoomUrls = import.meta.glob('../../../assets/board/rooms/*.{svg,png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/**
 * Rooms painted by a single shared image, listed with the room whose title names the file first.
 * The image is stretched over the union of the group's bounding boxes and each room clips its own
 * share out of it, so a wall drawn between them lands on the tile boundary they actually share.
 * The Master Suite and its Walk-in Closet are one such pair: the closet is a 2x2 notch bitten out
 * of the suite, and together they fill one rectangle.
 */
const SHARED_ART: readonly (readonly string[])[] = [['room-master-suite', 'room-walk-in-closet']];

/** The group this room shares its art with, primary room first, or undefined if it paints alone. */
export function sharedArtGroup(roomId: string): readonly string[] | undefined {
  return SHARED_ART.find((group) => group.includes(roomId));
}

/** "Clock Tower" -> "clock_tower", matching how the files are named. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

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
