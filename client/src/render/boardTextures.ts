// Tile textures for the parts of the board that are not rooms (assets/board/textures/). Each file
// is one tile's worth of surface: it is drawn once per tile via an SVG pattern, so the wood grain,
// gravel or grass repeats on the tile grid. Missing files simply leave the flat theme colour.
const urls = import.meta.glob('../../../assets/board/textures/*.{webp,png,jpg,jpeg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export type BoardTexture =
  | 'wood_floor_horizontal'
  | 'wood_floor_vertical_light'
  | 'grass'
  | 'cobblestone'
  | 'path_vertical'
  | 'path_horizontal'
  | 'path_corner'
  | 'path_t_intersection'
  | 'path_plus_intersection'
  | 'wood_floor_vertical_light_pillar'
  | 'cobblestone_pillar';

export const BOARD_TEXTURES: readonly BoardTexture[] = [
  'wood_floor_horizontal',
  'wood_floor_vertical_light',
  'grass',
  'cobblestone',
  'path_vertical',
  'path_horizontal',
  'path_corner',
  'path_t_intersection',
  'path_plus_intersection',
  'wood_floor_vertical_light_pillar',
  'cobblestone_pillar',
];

/** URL of a texture file, or undefined if none has been dropped in. */
export function textureUrl(name: BoardTexture): string | undefined {
  const needle = `/textures/${name}.`;
  for (const [path, url] of Object.entries(urls)) if (path.toLowerCase().includes(needle)) return url;
  return undefined;
}

/** The SVG pattern id used for a texture (only valid when `textureUrl` returned a file). */
export const texturePatternId = (name: BoardTexture) => `tex-${name.replace(/_/g, '-')}`;
