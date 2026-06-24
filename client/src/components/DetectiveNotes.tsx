import { useEffect, useState } from 'react';
import { SUSPECTS, WEAPONS, ROOMS, getCard, type AnyCard, type PlayerView } from 'shared';
import { NoteBox, NOTE_STATES } from './NoteBox';
import './DetectiveNotes.css';

const COLS = 8;
const EMPTY_ROW = new Array(COLS).fill(0);

// Columns are sorted alphabetically; suspects by their colour-based surname (the last word).
const surname = (title: string) => title.trim().split(/\s+/).pop() ?? title;
const SORTED_SUSPECTS = [...SUSPECTS].sort((a, b) => surname(a.title).localeCompare(surname(b.title)));
const SORTED_WEAPONS = [...WEAPONS].sort((a, b) => a.title.localeCompare(b.title));
const SORTED_ROOMS = [...ROOMS].sort((a, b) => a.title.localeCompare(b.title));

type NotesState = Record<string, number[]>; // cardId -> 8 mark states

function suspectColor(suspectId?: string): string {
  if (!suspectId) return '#555';
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? c.color : '#555';
}

function loadNotes(key: string): NotesState {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') as NotesState;
  } catch {
    return {};
  }
}

// The private notes sheet (lives inside the bottom-dock manila folder): three 40-row columns
// (Suspects / Weapons / Rooms), each row with 8 clickable cells — one per seat. Marks persist to
// localStorage per room, so a refresh keeps your deductions.
export function DetectiveNotes({ roomCode, players }: { roomCode: string; players: PlayerView[] }) {
  const storageKey = `ultraclue-notes-${roomCode}`;
  const [notes, setNotes] = useState<NotesState>(() => loadNotes(storageKey));

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(notes));
  }, [notes, storageKey]);

  const cycle = (cardId: string, col: number) =>
    setNotes((prev) => {
      const row = prev[cardId] ? [...prev[cardId]] : new Array(COLS).fill(0);
      row[col] = (row[col] + 1) % NOTE_STATES;
      return { ...prev, [cardId]: row };
    });

  // Right-click clears a cell straight back to blank.
  const reset = (cardId: string, col: number) =>
    setNotes((prev) => {
      const row = prev[cardId] ? [...prev[cardId]] : new Array(COLS).fill(0);
      row[col] = 0;
      return { ...prev, [cardId]: row };
    });

  const columnPlayers: (PlayerView | undefined)[] = Array.from({ length: COLS }, (_, i) => players[i]);

  const renderColumn = (title: string, cards: AnyCard[]) => (
    <section className="notes__col" key={title}>
      <div className="notes__colhead">
        <div className="notes__label notes__label--head">{title}</div>
        <div className="notes__boxes">
          {columnPlayers.map((p, i) => (
            <div className="notes__phead" key={i} title={p ? p.name : 'empty seat'}>
              <span
                className={`notes__pswatch${p ? '' : ' notes__pswatch--empty'}`}
                style={p ? { background: suspectColor(p.suspectId) } : undefined}
              />
            </div>
          ))}
        </div>
      </div>

      {cards.map((card) => {
        const row = notes[card.id] ?? EMPTY_ROW;
        return (
          <div className="notes__row" key={card.id}>
            <div className="notes__label">
              {card.type === 'suspect' && (
                <span className="notes__cswatch" style={{ background: (card as { color: string }).color }} />
              )}
              <span className="notes__ctitle">{card.title}</span>
            </div>
            <div className="notes__boxes">
              {Array.from({ length: COLS }, (_, col) => (
                <NoteBox key={col} state={row[col] ?? 0} onClick={() => cycle(card.id, col)} onReset={() => reset(card.id, col)} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );

  return (
    <>
      <div className="dnotes__hint">
        Click a cell to cycle through marks · one column per player · saved to this device
      </div>
      <div className="notes__body">
        {renderColumn('Suspects', SORTED_SUSPECTS)}
        {renderColumn('Weapons', SORTED_WEAPONS)}
        {renderColumn('Rooms', SORTED_ROOMS)}
      </div>
    </>
  );
}
