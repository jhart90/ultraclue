import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SUSPECTS, WEAPONS, ROOMS, getCard, type AnyCard, type PlayerView, type RoomCard, type SuspectCard, type WeaponCard } from 'shared';
import { useStore } from '../store';
import { NoteBox, NOTE_STATES } from './NoteBox';
import { WeaponIcon } from './CardName';
import { shade } from '../render/colorUtils';
import type { NotesPdfColumn } from '../render/caseNotesPdf';
import './CaseNotes.css';

/** A sheet holds one column per seat, and a table seats at most 40. */
export const MAX_NOTE_COLS = 40;
/** The sepia sheet shades alternate blocks of five columns only from this many seats up; a
 *  smaller table's row is short enough to follow without them. */
const BAND_FROM_COLS = 10;
const EMPTY_ROW: number[] = [];
/** Your own column, on either look: inked solid from heading to last row, marks in the paper colour,
 *  so your seat stands out at a glance. The inline background also beats the sepia banding. */
const YOU_STYLE = {
  '--col-bg': 'var(--ink)',
  '--col-head': 'var(--ink)',
  '--note-mark': 'var(--paper)',
  '--hover-ring': 'var(--paper)',
  background: 'var(--ink)',
} as CSSProperties;

// Two looks, chosen in Settings and remembered per browser:
//  - 'sepia'  — the printed sheet: parchment, ink grid, and (10+ seats) every other block of five
//               columns shaded;
//  - 'colour' — the same sheet with each seat's column washed in a light tint of its character's
//               colour, and marks inked in that colour.
export type NotesTheme = 'sepia' | 'colour';
export const NOTES_THEME_KEY = 'ultraclue-notes-theme';
export function readNotesTheme(): NotesTheme {
  try {
    return localStorage.getItem(NOTES_THEME_KEY) === 'colour' ? 'colour' : 'sepia';
  } catch {
    return 'sepia';
  }
}
export function saveNotesTheme(theme: NotesTheme): void {
  try {
    localStorage.setItem(NOTES_THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

// Columns are sorted alphabetically; suspects by their colour-based surname (the last word).
const surname = (title: string) => title.trim().split(/\s+/).pop() ?? title;
const SORTED_SUSPECTS = [...SUSPECTS].sort((a, b) => surname(a.title).localeCompare(surname(b.title)));

type NotesState = Record<string, number[]>; // cardId -> one mark state per seat (turn order)

function suspectCard(suspectId?: string): SuspectCard | undefined {
  if (!suspectId) return undefined;
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? (c as SuspectCard) : undefined;
}

/** Darken a piece colour until it reads as ink on the pale sheet (pale pieces like Ivory need it). */
function inkOf(hex: string): string {
  let c = hex;
  for (let i = 0; i < 8; i++) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 <= 0.42) break;
    c = shade(c, -0.18);
  }
  return c;
}

function loadNotes(key: string): NotesState {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') as NotesState;
  } catch {
    return {};
  }
}

/** A row wide enough for every seat; older 8-wide rows (and a computer's exported sheet) are padded. */
function rowOf(prev: NotesState, cardId: string, cols: number): number[] {
  const row = prev[cardId] ? [...prev[cardId]] : [];
  while (row.length < cols) row.push(0);
  return row;
}

/** What the top of a column says: a human's own name, or the character's colour word. */
function columnLabel(p: PlayerView): string {
  if (!p.isBot && p.name.trim()) return p.name.trim();
  const c = suspectCard(p.suspectId);
  return c ? surname(c.title) : p.name;
}

// The private notes sheet (lives inside the bottom-dock manila folder): three pages
// (Suspects / Weapons / Rooms), each a ruled grid with one clickable cell per seat at the table —
// up to 40 columns. Marks persist to localStorage per room (and ride along in saves), so a refresh
// keeps your deductions. Pages sit side by side while they fit and stack once the table is wide.
export function CaseNotes({
  roomCode,
  players,
  selfId,
  hand,
  suspects = SUSPECTS,
  weapons = WEAPONS,
  rooms = ROOMS,
  theme = 'sepia',
  onClose,
}: {
  roomCode: string;
  players: PlayerView[];
  selfId?: string;
  hand?: string[];
  /** The suspect, weapon and room cards in this game (the host may have trimmed any); all 40 by default. */
  suspects?: SuspectCard[];
  weapons?: WeaponCard[];
  rooms?: RoomCard[];
  theme?: NotesTheme;
  onClose?: () => void;
}) {
  const sortedSuspects = suspects === SUSPECTS ? SORTED_SUSPECTS : [...suspects].sort((a, b) => surname(a.title).localeCompare(surname(b.title)));
  const sortedWeapons = [...weapons].sort((a, b) => a.title.localeCompare(b.title));
  const sortedRooms = [...rooms].sort((a, b) => a.title.localeCompare(b.title));
  const storageKey = `ultraclue-notes-${roomCode}`;
  const syncNotes = useStore((s) => s.syncNotes);
  const notesEpoch = useStore((s) => s.notesEpoch); // bumps when the server restores our notes
  const [notes, setNotes] = useState<NotesState>(() => loadNotes(storageKey));

  const columnPlayers = players.slice(0, MAX_NOTE_COLS);
  const cols = columnPlayers.length;
  const colour = theme === 'colour';

  // Persist locally and push to the server so the notes ride along in every save.
  useEffect(() => {
    const json = JSON.stringify(notes);
    localStorage.setItem(storageKey, json);
    syncNotes(json);
  }, [notes, storageKey, syncNotes]);

  // Re-read after the server hands us restored notes (resume / rejoin / takeover).
  useEffect(() => {
    setNotes(loadNotes(storageKey));
  }, [notesEpoch, storageKey]);

  // Once per game, pre-fill the marks for the cards in your own hand, in your own column. The
  // "seeded" flag remembers which hand was seeded: the public table keeps one room code forever, so
  // a different hand under the same code means a new game — the old sheet is wiped before seeding.
  // A restored sheet (resume / rejoin / takeover) stores '1' instead, and is only seeded on top of.
  useEffect(() => {
    const myCol = players.findIndex((p) => p.id === selfId);
    if (myCol < 0 || !hand?.length) return;
    const seededKey = `${storageKey}-seeded`;
    const sig = [...hand].sort().join(',');
    const flag = localStorage.getItem(seededKey);
    if (flag === sig) return;
    const freshGame = !!flag && flag !== '1';
    localStorage.setItem(seededKey, sig);
    setNotes((prev) => {
      const next = freshGame ? {} : { ...prev };
      for (const cardId of hand) {
        const row = rowOf(next, cardId, players.length);
        row[myCol] = 1; // 'filled in'
        next[cardId] = row;
      }
      return next;
    });
  }, [storageKey, selfId, hand, players]);

  const cycle = useCallback(
    (cardId: string, col: number) =>
      setNotes((prev) => {
        const row = rowOf(prev, cardId, cols);
        row[col] = ((row[col] ?? 0) + 1) % NOTE_STATES;
        return { ...prev, [cardId]: row };
      }),
    [cols],
  );

  // Right-click clears a cell straight back to blank.
  const reset = useCallback(
    (cardId: string, col: number) =>
      setNotes((prev) => {
        const row = rowOf(prev, cardId, cols);
        row[col] = 0;
        return { ...prev, [cardId]: row };
      }),
    [cols],
  );

  // One style object per column (shared by its header and all its cells) carrying the tints for the
  // colour-coded look; the sepia look ignores colour altogether. Your own column is inked either way.
  const colStyles = useMemo<(CSSProperties | undefined)[]>(
    () =>
      columnPlayers.map((p) => {
        if (p.id === selfId) return YOU_STYLE;
        if (!colour) return undefined;
        const base = suspectCard(p.suspectId)?.color ?? '#777777';
        return {
          '--col-bg': shade(base, 0.82),
          '--col-head': shade(base, 0.58),
          '--note-mark': inkOf(base),
        } as CSSProperties;
      }),
    [columnPlayers, colour, selfId],
  );

  // --- printable pads -----------------------------------------------------------------------
  // Two downloads under the sheet: a blank pad and a copy with this viewer's marks. Both are built
  // from THIS game — its trimmed suspect / weapon / room lists and one column per seat — in the
  // look chosen in Settings. The marked copy is only offered once something has been marked.
  const pdfPages = useMemo(
    () => [
      { title: 'Suspects', cards: sortedSuspects as AnyCard[] },
      { title: 'Weapons', cards: sortedWeapons as AnyCard[] },
      { title: 'Rooms', cards: sortedRooms as AnyCard[] },
    ],
    [sortedSuspects, sortedWeapons, sortedRooms],
  );
  const hasMarks = useMemo(
    () => pdfPages.some((pg) => pg.cards.some((c) => (notes[c.id] ?? EMPTY_ROW).slice(0, cols).some((v) => v > 0))),
    [pdfPages, notes, cols],
  );
  const [pdfBusy, setPdfBusy] = useState<null | 'blank' | 'marked'>(null);
  const downloadPdf = async (marked: boolean) => {
    if (pdfBusy) return;
    setPdfBusy(marked ? 'marked' : 'blank');
    try {
      const { downloadCaseNotesPdf } = await import('../render/caseNotesPdf');
      const ink = '#2a2219';
      const columns: NotesPdfColumn[] = columnPlayers.map((p, i) => {
        const base = suspectCard(p.suspectId)?.color ?? '#777777';
        const band = !colour && cols >= BAND_FROM_COLS && i % 10 >= 5 ? '#dcd5c2' : undefined;
        return {
          label: columnLabel(p),
          you: p.id === selfId,
          head: colour ? shade(base, 0.58) : band,
          bg: colour ? shade(base, 0.82) : band,
          mark: colour ? inkOf(base) : ink,
        };
      });
      downloadCaseNotesPdf({
        roomCode,
        pages: pdfPages.map((pg) => ({
          title: pg.title,
          rows: pg.cards.map((c) => ({
            cardId: c.id,
            title: c.title,
            swatch: colour && c.type === 'suspect' ? (c as SuspectCard).color : undefined,
          })),
        })),
        columns,
        notes: marked ? notes : undefined,
        paper: colour ? '#faf7ee' : '#f4eedd',
        line: colour ? '#a39b88' : '#8b8270',
        ink,
        fileName: `40-alibis-case-notes-${roomCode.toLowerCase()}-${marked ? 'marked' : 'blank'}.pdf`,
      });
    } catch (err) {
      console.error('[case notes] could not build the PDF:', err);
    } finally {
      setPdfBusy(null);
    }
  };

  // Denser cells once the table is wide, so a 40-seat page needs less sideways scrolling.
  const sheetStyle = { '--cell': cols > 24 ? '18px' : '20px', '--cols': cols } as CSSProperties;

  // Fill the folder's width. At their natural size, as many pages as fit sit side by side (1 to 3);
  // then every page is zoomed up by the same factor until that first row spans the width. Pages
  // never shrink: one that doesn't fit at natural size keeps it and scrolls sideways as before.
  // CSS zoom (unlike a transform) re-lays the page out, so text stays crisp and the wrap still works.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const fit = () => {
      const sheet = body.querySelector<HTMLElement>('.sheet');
      if (!sheet) return;
      const cs = getComputedStyle(body);
      const avail = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const gap = parseFloat(cs.columnGap) || 0;
      // Divide out the zoom the page actually has on screen, read from the DOM: the resize observer
      // can fire again before React has applied the last value we set.
      const applied = parseFloat(getComputedStyle(sheet).zoom) || 1;
      const natural = sheet.getBoundingClientRect().width / applied;
      if (avail <= 0 || natural <= 0) return;
      const perRow = Math.max(1, Math.min(3, Math.floor((avail + gap) / (natural + gap))));
      // a couple of pixels' slack so rounding never tips the last page of the row onto the next
      const next = Math.max(1, Math.floor(((avail - (perRow - 1) * gap - 2) / (perRow * natural)) * 1000) / 1000);
      if (Math.abs(next - applied) > 0.002) setZoom(next);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(body);
    return () => ro.disconnect();
  }, [cols]);
  // --sheet-zoom lets the sticky headings undo the zoom on their offset (see .notes__colhead).
  const pageStyle = zoom === 1 ? sheetStyle : ({ ...sheetStyle, zoom, '--sheet-zoom': zoom } as CSSProperties);

  const renderPage = (title: string, cards: AnyCard[], page: number) => (
    <section className="sheet" key={title} style={pageStyle}>
      <div className="sheet__title">{title}</div>
      <div className="sheet__grid">
        <div className="notes__colhead">
          <div className="notes__label notes__label--head" />
          <div className="notes__boxes notes__boxes--head">
            {columnPlayers.map((p, i) => {
              const character = suspectCard(p.suspectId)?.title ?? '';
              const you = p.id === selfId;
              const tip = `${p.name}${character ? ` · ${character}` : ''}${you ? ' (you)' : ''}`;
              return (
                <div className={`notes__phead${you ? ' notes__phead--you' : ''}`} key={p.id} title={tip} style={colStyles[i]}>
                  <span className="notes__pname">{columnLabel(p)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {cards.map((card) => {
          const row = notes[card.id] ?? EMPTY_ROW;
          return (
            <div className="notes__row" key={card.id}>
              <div className="notes__label">
                {colour && card.type === 'suspect' && <span className="notes__cswatch" style={{ background: (card as SuspectCard).color }} />}
                {colour && card.type === 'weapon' && <WeaponIcon id={card.id} />}
                <span className="notes__ctitle">{card.title}</span>
              </div>
              <div className="notes__boxes">
                {columnPlayers.map((p, col) => (
                  <NoteBox key={p.id} state={row[col] ?? 0} cardId={card.id} col={col} onCycle={cycle} onReset={reset} style={colStyles[col]} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="sheet__foot">
        40 Alibis / Case Notes / {page} of 3
      </div>
    </section>
  );

  return (
    <>
      <button className="cnotes__bar" onClick={onClose} title="Close Case Notes">
        Case Notes <span className="cnotes__barclose">▾ click to close</span>
      </button>
      <div ref={bodyRef} className={`notes__body notes__body--${theme}${cols >= BAND_FROM_COLS ? ' notes__body--banded' : ''}`}>
        {renderPage('Suspects', sortedSuspects, 1)}
        {renderPage('Weapons', sortedWeapons, 2)}
        {renderPage('Rooms', sortedRooms, 3)}
      </div>
      <div className="cnotes__foot">
        <button
          className="cnotes__pdf"
          onClick={() => downloadPdf(false)}
          disabled={!!pdfBusy}
          title="A printable blank pad for this game: its suspects, weapons and rooms, with a column for every seat"
        >
          {pdfBusy === 'blank' ? 'Preparing…' : '⬇ Blank Case Notes (PDF)'}
        </button>
        {hasMarks && (
          <button
            className="cnotes__pdf"
            onClick={() => downloadPdf(true)}
            disabled={!!pdfBusy}
            title="A printable copy of this sheet with every mark you have made"
          >
            {pdfBusy === 'marked' ? 'Preparing…' : '⬇ Case Notes with my marks (PDF)'}
          </button>
        )}
      </div>
    </>
  );
}
