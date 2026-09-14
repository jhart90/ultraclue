import { CARD_BACKS } from 'shared';
import { useStore } from '../store';
import { CardBack, useCardBack } from './CardBack';
import { CARD_BACK_LABEL } from '../render/cardBacks';
import './CardBackSettings.css';

/** Pick the back your cards show, on this device only. The table deals a random back each game;
 *  "Table's pick" follows it, or choose one design to keep whatever the table draws. */
export function CardBackSettings() {
  const choice = useStore((s) => s.backChoice);
  const setBackChoice = useStore((s) => s.setBackChoice);
  const showing = useCardBack();
  return (
    <div className="backpick">
      <div className="game__settinghead2">Card back</div>
      <div className="backpick__row">
        {CARD_BACKS.map((id) => (
          <button
            key={id}
            type="button"
            className={`backpick__opt${choice === id ? ' backpick__opt--on' : ''}`}
            title={CARD_BACK_LABEL[id]}
            aria-pressed={choice === id}
            onClick={() => setBackChoice(id)}
          >
            <CardBack xs back={id} />
            <span className="backpick__name">{CARD_BACK_LABEL[id]}</span>
          </button>
        ))}
      </div>
      <label className="game__settoggle">
        <input type="radio" name="card-back" checked={choice === 'table'} onChange={() => setBackChoice('table')} />
        Table’s pick (a new back each game — now {CARD_BACK_LABEL[showing]})
      </label>
    </div>
  );
}
