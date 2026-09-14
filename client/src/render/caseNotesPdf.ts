import { jsPDF } from 'jspdf';

// A printable Case Notes pad, drawn as vectors so it stays sharp at any print size. One A4 page per
// card type (Suspects / Weapons / Rooms), each laid out like the on-screen sheet: a title pill, one
// rotated heading per seat, a ruled grid with one row per card in THIS game, and — for a marked
// copy — every mark the viewer has made, in the same 15 shapes the sheet uses. Loaded on demand
// (CaseNotes imports it dynamically), so jsPDF never lands in the main bundle.

export interface NotesPdfColumn {
  /** The heading: a human's name, or the character's colour word. */
  label: string;
  /** The viewer's own seat: its heading is inked solid. */
  you: boolean;
  /** Heading fill (colour look's tint, or the sepia sheet's banding); none = the paper. */
  head?: string;
  /** Cell fill for the whole column; none = the paper. */
  bg?: string;
  /** The ink this column's marks are drawn in. */
  mark: string;
}

export interface NotesPdfRow {
  cardId: string;
  title: string;
  /** A suspect's own colour, shown as a dot before the name on the colour look. */
  swatch?: string;
}

export interface NotesPdfOptions {
  roomCode: string;
  pages: { title: string; rows: NotesPdfRow[] }[];
  columns: NotesPdfColumn[];
  /** cardId -> one mark state per column. Omit for a blank pad. */
  notes?: Record<string, number[]>;
  paper: string;
  line: string;
  ink: string;
  fileName: string;
}

const PAGE_W = 595.28; // A4, points
const PAGE_H = 841.89;
const MARGIN = 30;
const PAD = 12; // the sheet's paper margin around the grid
const TITLE_H = 26;
const TITLE_GAP = 8;
const FOOT_H = 16;
const MAX_CELL = 22;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The standard PDF fonts only cover Latin-1: fold typographic punctuation to plain ASCII and
 *  replace anything else they cannot draw, so a player's emoji cannot garble the page. */
function printable(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^ -~ -ÿ]/g, '?');
}

/** Shorten `text` with an ellipsis until it fits `maxW` in the doc's current font. */
function fit(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}...`) > maxW) t = t.slice(0, -1);
  return `${t}...`;
}

/** One mark, in the sheet's 20-unit cell, scaled to a `size`-point cell at (x, y). */
function drawMark(doc: jsPDF, state: number, x: number, y: number, size: number, ink: string) {
  const u = size / 20;
  const r = (rx: number, ry: number, w: number, h: number) => doc.rect(x + rx * u, y + ry * u, w * u, h * u, 'F');
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    doc.triangle(x + ax * u, y + ay * u, x + bx * u, y + by * u, x + cx * u, y + cy * u, 'F');
  doc.setFillColor(ink);
  doc.setDrawColor(ink);
  switch (state) {
    case 1:
      return r(0, 0, 20, 20);
    case 2:
      doc.setLineWidth(3.4 * u);
      doc.setLineCap('round');
      doc.line(x + 3.5 * u, y + 3.5 * u, x + 16.5 * u, y + 16.5 * u);
      doc.line(x + 16.5 * u, y + 3.5 * u, x + 3.5 * u, y + 16.5 * u);
      doc.setLineCap('butt');
      return;
    case 3:
      return tri(0, 0, 20, 0, 20, 20);
    case 4:
      return tri(20, 0, 20, 20, 0, 20);
    case 5:
      return tri(0, 0, 0, 20, 20, 20);
    case 6:
      return tri(0, 0, 20, 0, 0, 20);
    case 7:
      return r(0, 0, 20, 10);
    case 8:
      return r(10, 0, 10, 20);
    case 9:
      return r(0, 10, 20, 10);
    case 10:
      return r(0, 0, 10, 20);
    case 11:
      return r(0, 0, 10, 10);
    case 12:
      return r(10, 0, 10, 10);
    case 13:
      return r(10, 10, 10, 10);
    case 14:
      return r(0, 10, 10, 10);
  }
}

function drawPage(doc: jsPDF, opts: NotesPdfOptions, page: NotesPdfOptions['pages'][number], pageNo: number) {
  const cols = opts.columns;
  const rows = page.rows;
  const nCols = Math.max(1, cols.length);
  const nRows = Math.max(1, rows.length);
  const labels = cols.map((c) => printable(c.label).toUpperCase());
  const titles = rows.map((row) => printable(row.title));
  const hasSwatch = rows.some((row) => row.swatch);

  // Fonts scale with the cell, and the label column and heading band scale with the fonts, so
  // settle the three together: a few passes converge.
  let cell = 16;
  let headFs = 7;
  let rowFs = 8;
  let labelW = 120;
  let headH = 60;
  for (let pass = 0; pass < 4; pass++) {
    headFs = clamp(cell * 0.5, 4.5, 8);
    rowFs = clamp(cell * 0.6, 5, 10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(headFs);
    const longestHead = Math.max(0, ...labels.map((l) => doc.getTextWidth(l)));
    headH = clamp(longestHead + 8, 36, 96);
    doc.setFont('times', 'bolditalic');
    doc.setFontSize(rowFs);
    const longestTitle = Math.max(0, ...titles.map((t) => doc.getTextWidth(t)));
    labelW = clamp(longestTitle + 10 + (hasSwatch ? rowFs + 3 : 0), 70, 170);
    const availW = PAGE_W - 2 * MARGIN - 2 * PAD - labelW;
    const availH = PAGE_H - 2 * MARGIN - 2 * PAD - TITLE_H - TITLE_GAP - headH - FOOT_H;
    cell = Math.min(MAX_CELL, availW / nCols, availH / nRows);
  }

  const gridW = labelW + nCols * cell;
  const gridH = headH + nRows * cell;
  const sheetW = gridW + 2 * PAD;
  const sheetH = TITLE_H + TITLE_GAP + gridH + FOOT_H + 2 * PAD;
  const sx = (PAGE_W - sheetW) / 2;
  const sy = MARGIN;
  const gx = sx + PAD;
  const titleY = sy + PAD;
  const headY = titleY + TITLE_H + TITLE_GAP;
  const bodyY = headY + headH;
  const bottomY = bodyY + nRows * cell;
  const colX = (i: number) => gx + labelW + i * cell;

  // the parchment sheet
  doc.setFillColor(opts.paper);
  doc.setDrawColor('#1f1a14');
  doc.setLineWidth(0.8);
  doc.rect(sx, sy, sheetW, sheetH, 'FD');

  // title pill
  doc.setDrawColor(opts.ink);
  doc.setLineWidth(1.6);
  doc.roundedRect(gx, titleY, gridW, TITLE_H, 11, 11, 'S');
  doc.setTextColor(opts.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setCharSpace(1.2);
  doc.text(page.title.toUpperCase(), gx + gridW / 2, titleY + TITLE_H / 2, { align: 'center', baseline: 'middle' });
  doc.setCharSpace(0);

  // column fills: heading tints, the viewer's inked heading, and whole-column cell tints
  cols.forEach((c, i) => {
    const x = colX(i);
    const headFill = c.you ? opts.ink : c.head;
    if (headFill) {
      doc.setFillColor(headFill);
      doc.rect(x, headY, cell, headH, 'F');
    }
    if (c.bg) {
      doc.setFillColor(c.bg);
      doc.rect(x, bodyY, cell, nRows * cell, 'F');
    }
  });

  // marks
  if (opts.notes) {
    rows.forEach((row, r) => {
      const states = opts.notes![row.cardId];
      if (!states) return;
      cols.forEach((c, i) => {
        const state = states[i] ?? 0;
        if (state > 0) drawMark(doc, state, colX(i), bodyY + r * cell, cell, c.mark);
      });
    });
  }

  // ruled grid
  doc.setDrawColor(opts.line);
  doc.setLineWidth(0.5);
  doc.line(gx, headY, gx + gridW, headY);
  for (let r = 1; r < nRows; r++) doc.line(gx, bodyY + r * cell, gx + gridW, bodyY + r * cell);
  doc.line(gx, headY, gx, bottomY);
  for (let i = 0; i <= nCols; i++) doc.line(colX(i), headY, colX(i), bottomY);
  doc.line(gx, bottomY, gx + gridW, bottomY);
  doc.setDrawColor(opts.ink);
  doc.setLineWidth(1.4);
  doc.line(gx, bodyY, gx + gridW, bodyY); // the heavy rule under the headings

  // column headings, reading bottom to top as on the printed sheet
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(headFs);
  cols.forEach((c, i) => {
    doc.setTextColor(c.you ? opts.paper : opts.ink);
    const text = fit(doc, labels[i], headH - 7);
    doc.text(text, colX(i) + cell / 2 + headFs * 0.35, bodyY - 4, { angle: 90 });
  });

  // row labels
  doc.setFont('times', 'bolditalic');
  doc.setFontSize(rowFs);
  doc.setTextColor(opts.ink);
  rows.forEach((row, r) => {
    const cy = bodyY + r * cell + cell / 2;
    let tx = gx + 5;
    if (row.swatch) {
      const rad = Math.min(rowFs, cell) * 0.32;
      doc.setFillColor(row.swatch);
      doc.setDrawColor('#000000');
      doc.setLineWidth(0.4);
      doc.circle(tx + rad, cy, rad, 'FD');
      tx += rad * 2 + 3;
    }
    doc.text(fit(doc, titles[r], gx + labelW - 4 - tx), tx, cy, { baseline: 'middle' });
  });

  // footer
  doc.setFont('times', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor('#6c634f');
  const footY = bottomY + FOOT_H / 2 + 2;
  const kind = opts.notes ? `marked ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'blank sheet';
  doc.text(printable(`Room ${opts.roomCode} - ${kind}`), gx, footY, { baseline: 'middle' });
  doc.text(`40 ALIBIS / CASE NOTES / ${pageNo} OF ${opts.pages.length}`, gx + gridW, footY, { align: 'right', baseline: 'middle' });
}

/** Build the pad as a jsPDF document (one page per card type). */
export function buildCaseNotesPdf(opts: NotesPdfOptions): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  doc.setProperties({ title: `40 Alibis - Case Notes - ${opts.roomCode}`, creator: '40 Alibis' });
  opts.pages.forEach((page, i) => {
    if (i > 0) doc.addPage();
    drawPage(doc, opts, page, i + 1);
  });
  return doc;
}

/** Build the pad and hand it to the browser as a download. */
export function downloadCaseNotesPdf(opts: NotesPdfOptions): void {
  buildCaseNotesPdf(opts).save(opts.fileName);
}
