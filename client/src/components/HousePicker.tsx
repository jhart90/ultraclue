import { WINGS, MIN_WEAPONS, MAX_WEAPONS, WEAPONS, type WingId } from 'shared';
import './HousePicker.css';

// Host controls for how much of the house, and how many weapons, the next game is played with.
//  - WingsPicker: the three optional wings as one row of connected toggle buttons, every one lit
//    by default; switching a wing off takes its rooms off the board and out of the deck.
//  - WeaponCountPicker: a plain select, like the table size.

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

const WEAPON_COUNTS = Array.from({ length: MAX_WEAPONS - MIN_WEAPONS + 1 }, (_, i) => MAX_WEAPONS - i);

/** How many of the 40 weapons are in the game. */
export function WeaponCountPicker({
  value,
  onChange,
  readOnly = false,
  title,
}: {
  value: number;
  onChange?: (n: number) => void;
  readOnly?: boolean;
  title?: string;
}) {
  const n = Math.max(MIN_WEAPONS, Math.min(MAX_WEAPONS, value || WEAPONS.length));
  if (readOnly) return <strong title={title}>{n}</strong>;
  return (
    <select value={n} onChange={(e) => onChange?.(Number(e.target.value))} title={title}>
      {WEAPON_COUNTS.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );
}
