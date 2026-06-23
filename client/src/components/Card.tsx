import type { AnyCard } from 'shared';
import { CardArt } from '../render/cardArt';
import { resolveOverride } from '../render/overrides';
import './Card.css';

const TYPE_LABEL: Record<AnyCard['type'], string> = {
  suspect: 'Suspect',
  weapon: 'Weapon',
  room: 'Room',
};

export function Card({ card }: { card: AnyCard }) {
  const override = resolveOverride(card.id, card.type, card.title);
  return (
    <div className={`card card--${card.type}`}>
      <div className="card__art">
        {override ? (
          <img src={override} alt={card.title} className="card__override" />
        ) : (
          <CardArt card={card} />
        )}
      </div>
      <div className="card__body">
        <div className="card__type">{TYPE_LABEL[card.type]}</div>
        <div className="card__title">{card.title}</div>
        <div className="card__phrase">{card.phrase}</div>
      </div>
    </div>
  );
}
