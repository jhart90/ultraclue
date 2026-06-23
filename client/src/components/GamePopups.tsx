import { getCard, type Announcement } from 'shared';
import { Card } from './Card';
import { CardBack } from './CardBack';
import { Dice } from './Dice';
import './GamePopups.css';

export interface StatusButton {
  label: string;
  icon: string;
  onClick: () => void;
  primary?: boolean;
}

/** Big pop-up mirroring the turn-status bar — appears whenever your actionable status changes. */
export function StatusModal({
  dice,
  lines,
  buttons,
  onClose,
}: {
  dice?: [number, number];
  lines: string[];
  buttons: StatusButton[];
  onClose: () => void;
}) {
  return (
    <div className="sp__backdrop" onClick={onClose}>
      <div className="statpop" onClick={(e) => e.stopPropagation()}>
        <button className="statpop__x" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
        {dice && (
          <div className="statpop__dice">
            <Dice values={dice} />
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={i === 0 ? 'statpop__line1' : 'statpop__line2'}>
            {l}
          </div>
        ))}
        <div className="statpop__btns">
          {buttons.map((b, i) => (
            <button key={i} className={`btn statpop__btn${b.primary ? ' btn--primary' : ''}`} onClick={b.onClick}>
              <span className="statpop__icon">{b.icon}</span>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "<name> has made a suggestion/accusation:" + the three named cards. Shown to every player. */
export function AnnouncementModal({ announcement, onClose }: { announcement: Announcement; onClose: () => void }) {
  const a = announcement;
  const cards = [a.suspectId, a.weaponId, a.roomId];
  return (
    <div className="sp__backdrop" onClick={onClose}>
      <div className="sp sp--end" onClick={(e) => e.stopPropagation()}>
        <div className="popup__title">
          {a.byName} has made {a.kind === 'suggestion' ? 'a suggestion' : 'an accusation'}:
        </div>
        <div className="sp__cards">
          {cards.map((id) => {
            const c = getCard(id);
            return c ? <Card key={id} card={c} /> : null;
          })}
        </div>
        <button className="btn btn--primary" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** "<responder> has shown a card to <suggester>, disproving the suggestion" + a face-down card. */
export function RevealModal({
  responderName,
  suggesterName,
  onClose,
}: {
  responderName: string;
  suggesterName: string;
  onClose: () => void;
}) {
  return (
    <div className="sp__backdrop" onClick={onClose}>
      <div className="sp sp--end" onClick={(e) => e.stopPropagation()}>
        <div className="popup__title">
          {responderName} has shown a card to {suggesterName}, disproving the suggestion.
        </div>
        <div className="sp__cards">
          <CardBack />
        </div>
        <button className="btn btn--primary" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
