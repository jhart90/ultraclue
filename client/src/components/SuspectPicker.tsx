import { SORTED_SUSPECTS_RAINBOW } from '../util/cardSort';
import './SuspectPicker.css';

export function SuspectPicker({
  takenByOthers,
  heldByComputers,
  mySuspectId,
  onPick,
  onClose,
}: {
  /** Characters other humans hold — not selectable. */
  takenByOthers: Set<string>;
  /** Characters a computer holds — selectable; the computer takes your current one in exchange. */
  heldByComputers?: Set<string>;
  mySuspectId?: string;
  onPick: (suspectId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="picker__backdrop" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker__head">
          <h2>Choose your character</h2>
          <button className="picker__x" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="picker__grid">
          {SORTED_SUSPECTS_RAINBOW.map((s) => {
            const taken = takenByOthers.has(s.id);
            const swap = !taken && !!heldByComputers?.has(s.id);
            const mine = s.id === mySuspectId;
            return (
              <button
                key={s.id}
                className={`picker__item${taken ? ' picker__item--taken' : ''}${mine ? ' picker__item--mine' : ''}`}
                disabled={taken}
                onClick={() => {
                  onPick(s.id);
                  onClose();
                }}
                title={taken ? 'Taken by another player' : swap ? `${s.title} — swap with the computer playing them` : s.title}
              >
                <span className="picker__swatch" style={{ background: s.color }} />
                <span className="picker__name">{s.title}</span>
                {swap && <span className="picker__swap">swap</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
