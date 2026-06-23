import { SUSPECTS } from 'shared';
import './SuspectPicker.css';

export function SuspectPicker({
  takenByOthers,
  mySuspectId,
  onPick,
  onClose,
}: {
  takenByOthers: Set<string>;
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
          {SUSPECTS.map((s) => {
            const taken = takenByOthers.has(s.id);
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
                title={taken ? 'Taken' : s.title}
              >
                <span className="picker__swatch" style={{ background: s.color }} />
                <span className="picker__name">{s.title}</span>
                <span className="picker__order">#{s.turnOrder}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
