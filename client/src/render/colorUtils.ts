// Small colour helpers used by the procedural card art.

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. amt in [-1, 1]. */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = parseHex(hex);
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  return toHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}

/** Returns a readable foreground (near-black or near-white) for text on the given background. */
export function contrastInk(hex: string): string {
  const [r, g, b] = parseHex(hex);
  // Relative luminance (sRGB approximation).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1c1a16' : '#f7f3ea';
}

/** Deterministic small hash of a string, for stable per-card art variation. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
