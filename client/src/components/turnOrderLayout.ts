/**
 * Pure layout maths for the turn strip (TurnOrder.tsx). Every chip is measured once, unrotated, and
 * the rows are then worked out here by emulating the strip's `flex-wrap` — nothing is re-measured
 * after rotating or trimming, so the result can't feed back into itself and ping-pong between two
 * states (which used to blow React's update-depth limit).
 */

export interface StripInput {
  /** Each player's chip width in px, in turn order (the active player's includes its "to move" tag). */
  widths: number[];
  activeIdx: number;
  containerWidth: number;
  gap: number;
  /** Width of the "…and N more" chip for a hidden count, with or without its "to move" tag. */
  moreWidth: (hidden: number, activeHidden: boolean) => number;
}

export interface StripLayout {
  /** Index (into turn order) of the first chip shown. */
  start: number;
  /** How many player chips are shown; the rest fold into "…and N more". */
  visible: number;
  /** Player chips on the upper row, whose centre the player to move is kept at. */
  perRow: number;
}

/** Sub-pixel slack, erring towards wrapping early so a real browser never needs a third row. */
const FUZZ = 0.5;

/** The row each item lands on, as `flex-wrap: wrap` packs them (greedy, first row 0). */
export function wrapRows(widths: number[], containerWidth: number, gap: number): number[] {
  const rows: number[] = [];
  let row = -1;
  let used = 0;
  for (const w of widths) {
    if (row < 0 || used + gap + w > containerWidth - FUZZ) {
      row++;
      used = w;
    } else {
      used += gap + w;
    }
    rows.push(row);
  }
  return rows;
}

/** The most chips that fit on two rows (ending in "…and N more" if not everyone does) from `start`. */
function fit(input: StripInput, start: number): { visible: number; row1: number } {
  const { widths, activeIdx, containerWidth, gap, moreWidth } = input;
  const n = widths.length;
  const ordered = widths.map((_, i) => widths[(start + i) % n]);
  const activePos = (activeIdx - start + n) % n;
  let rows: number[] = [];
  let visible = n;
  for (; visible >= 1; visible--) {
    const ws = ordered.slice(0, visible);
    if (visible < n) ws.push(moreWidth(n - visible, activePos >= visible));
    rows = wrapRows(ws, containerWidth, gap);
    if (rows[rows.length - 1] <= 1) break;
  }
  visible = Math.max(1, visible);
  const row1 = rows.slice(0, visible).filter((r) => r === 0).length;
  return { visible, row1 };
}

/**
 * Where the strip starts and how much of it shows. Once the player to move has passed the centre of
 * the upper row, the strip rotates to keep them there. The upper row's size depends on the rotation
 * (chips differ in width), so this looks for a row size that reproduces itself; if the candidates
 * cycle instead, the smallest in the cycle wins. Bounded and deterministic either way.
 */
export function layoutStrip(input: StripInput): StripLayout {
  const n = input.widths.length;
  if (!n) return { start: 0, visible: 0, perRow: 0 };
  const activeIdx = Math.min(Math.max(0, input.activeIdx), n - 1);
  const startFor = (perRow: number) => {
    const centre = Math.floor(perRow / 2);
    return activeIdx > centre ? activeIdx - centre : 0;
  };
  const seen: number[] = [];
  let perRow = fit(input, 0).row1;
  while (!seen.includes(perRow)) {
    seen.push(perRow);
    const start = startFor(perRow);
    const { visible, row1 } = fit(input, start);
    if (row1 === perRow) return { start, visible, perRow };
    perRow = row1;
  }
  const cycle = seen.slice(seen.indexOf(perRow));
  perRow = Math.min(...cycle);
  const start = startFor(perRow);
  return { start, visible: fit(input, start).visible, perRow };
}
