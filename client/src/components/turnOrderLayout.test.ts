import { describe, expect, it } from 'vitest';
import { layoutStrip, wrapRows, type StripInput } from './turnOrderLayout';

const GAP = 8;
const TAG = 50;
const moreWidth = (hidden: number, activeHidden: boolean) => 90 + (hidden >= 10 ? 8 : 0) + (activeHidden ? TAG : 0);

function input(base: number[], activeIdx: number, containerWidth: number): StripInput {
  return { widths: base.map((w, i) => w + (i === activeIdx ? TAG : 0)), activeIdx, containerWidth, gap: GAP, moreWidth };
}

/** The rows the strip would actually render for a layout: the rotated, trimmed chips plus "more". */
function rendered(inp: StripInput, start: number, visible: number) {
  const n = inp.widths.length;
  const order = inp.widths.map((_, i) => (start + i) % n);
  const ws = order.slice(0, visible).map((i) => inp.widths[i]);
  const hidden = n - visible;
  if (hidden) ws.push(inp.moreWidth(hidden, order.slice(visible).includes(inp.activeIdx)));
  return { order, rows: wrapRows(ws, inp.containerWidth, inp.gap) };
}

// Mulberry32, so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('wrapRows', () => {
  it('packs greedily like flex-wrap', () => {
    expect(wrapRows([100, 100, 100], 320, 5)).toEqual([0, 0, 0]);
    expect(wrapRows([100, 100, 100], 310, 5)).toEqual([0, 0, 1]); // an exact fit wraps (sub-pixel slack)
    expect(wrapRows([100, 100, 100], 300, 5)).toEqual([0, 0, 1]);
    expect(wrapRows([400, 50], 300, 5)).toEqual([0, 1]); // an oversized chip still gets a row
  });
});

describe('layoutStrip', () => {
  it('shows everyone, unrotated, when the table fits and the first player is up', () => {
    expect(layoutStrip(input([120, 130, 140, 150], 0, 2000))).toEqual({ start: 0, visible: 4, perRow: 4 });
  });

  it('keeps the player to move at the centre of the upper row once past it', () => {
    const inp = input(Array(8).fill(100), 6, 620); // 5 per row (one with the tag) → centre 2
    const { start, visible, perRow } = layoutStrip(inp);
    expect(perRow).toBe(5);
    expect(start).toBe(4);
    expect(visible).toBe(8);
  });

  it('folds the tail into "…and N more" rather than a third row', () => {
    const inp = input(Array(40).fill(150), 0, 700);
    const { start, visible } = layoutStrip(inp);
    const { rows } = rendered(inp, start, visible);
    expect(visible).toBeLessThan(40);
    expect(Math.max(...rows)).toBe(1);
  });

  // Tables the old measure-and-reset effects never settled on (found by modelling them).
  it.each([
    [[162, 213, 225, 206, 189, 179, 152, 159], 3, 897],
    [[162, 147, 157, 133, 111, 136, 185, 189], 7, 431],
    [[230, 229, 133, 164, 179, 157, 135, 206], 3, 1162],
  ])('settles on a table that used to oscillate (%j, active %i, %ipx)', (base, active, width) => {
    const inp = input(base, active, width);
    const a = layoutStrip(inp);
    expect(layoutStrip(inp)).toEqual(a);
    expect(Math.max(...rendered(inp, a.start, a.visible).rows)).toBeLessThanOrEqual(1);
  });

  it('holds its invariants over random tables', () => {
    const rand = rng(40);
    for (let t = 0; t < 3000; t++) {
      const n = [2, 6, 8, 8, 12, 40][t % 6];
      const base = Array.from({ length: n }, () => Math.round(100 + rand() * 140));
      const activeIdx = Math.floor(rand() * n);
      const width = Math.round(340 + rand() * 1200);
      const inp = input(base, activeIdx, width);
      const { start, visible, perRow } = layoutStrip(inp);
      const { order, rows } = rendered(inp, start, visible);
      const ctx = JSON.stringify({ base, activeIdx, width, start, visible, perRow });

      expect(visible, ctx).toBeGreaterThanOrEqual(1);
      expect(visible, ctx).toBeLessThanOrEqual(n);
      // Never a third row (unless the strip is too narrow for even one chip and "more").
      if (visible > 1) expect(Math.max(...rows), ctx).toBeLessThanOrEqual(1);
      // …and nothing trimmed that would have fitted.
      if (visible < n) {
        const one = rendered(inp, start, visible + 1).rows;
        expect(Math.max(...one), ctx).toBeGreaterThan(1);
      }
      // The player to move is shown, and at the upper row's centre whenever the strip is rotated.
      const pos = order.indexOf(activeIdx);
      expect(pos, ctx).toBeLessThan(visible);
      if (start > 0) {
        // Rotated: always on the upper row, and exactly centred unless no rotation reproduces its
        // own row size (chip widths can make that impossible — then it sits just left of centre).
        expect(rows[pos], ctx).toBe(0);
        const row1 = rows.slice(0, visible).filter((r) => r === 0).length;
        if (row1 === perRow) expect(pos, ctx).toBe(Math.floor(perRow / 2));
      } else {
        expect(activeIdx, ctx).toBeLessThanOrEqual(Math.floor(perRow / 2));
      }
    }
  });
});
