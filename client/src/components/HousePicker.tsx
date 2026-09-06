import { WINGS, type WingId } from 'shared';
import './HousePicker.css';

// Host controls for how much of the house, and how many cards and seats, the next game has.
//  - WingsPicker: the three optional wings as one row of connected toggle buttons, every one lit
//    by default; switching a wing off takes its rooms off the board and out of the deck.
//  - CountPicker: a plain select over a range — seats at the table, suspects and weapons in play.

const WING_BLURB: Record<WingId, string> = {
  'upper-floor': 'The Upper Floor: Library, Study, Gallery, Master Suite, Planetarium and the rest of upstairs.',
  grounds: 'The Grounds: Courtyard, Gazebo, Hedge Maze, Boat House and the other rooms outdoors.',
  basement: 'The Basement: Wine Cellar, Chapel, Laboratory, Bunker and the rest below stairs.',
};

/** Which wings are in play, as three connected toggles. `wingsOff` lists the ones switched off. */
export function WingsPicker({
  wingsOff,
  onChange,
  readOnly = false,
  title,
}: {
  wingsOff: readonly string[];
  onChange?: (wingsOff: string[]) => void;
  readOnly?: boolean;
  title?: string;
}) {
  const off = new Set(wingsOff);
  return (
    <span className={`wings${readOnly ? ' wings--ro' : ''}`} role="group" title={title}>
      {WINGS.map((w) => {
        const on = !off.has(w.id);
        return (
          <button
            key={w.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={readOnly}
            className={`wings__opt wings__opt--${w.id}${on ? ' wings__opt--on' : ''}`}
            title={readOnly ? `${WING_BLURB[w.id]} ${on ? 'In play.' : 'Closed off for this game.'}` : `${WING_BLURB[w.id]} Click to switch it ${on ? 'off' : 'on'}.`}
            onClick={(e) => {
              e.stopPropagation();
              if (readOnly) return;
              const next = new Set(off);
              if (on) next.add(w.id);
              else next.delete(w.id);
              onChange?.(WINGS.map((x) => x.id).filter((id) => next.has(id)));
            }}
          >
            {w.title}
          </button>
        );
      })}
    </span>
  );
}

/** A number in `min`..`max` as a select (host) or plain text (everyone else). Listed high to low
 *  so the usual full-size choice is at the top. */
export function CountPicker({
  value,
  min,
  max,
  onChange,
  readOnly = false,
  title,
}: {
  value: number;
  min: number;
  max: number;
  onChange?: (n: number) => void;
  readOnly?: boolean;
  title?: string;
}) {
  const n = Math.max(min, Math.min(max, value || max));
  if (readOnly) return <strong title={title}>{n}</strong>;
  const options = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => max - i);
  return (
    <select value={n} onChange={(e) => onChange?.(Number(e.target.value))} title={title}>
      {options.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}
