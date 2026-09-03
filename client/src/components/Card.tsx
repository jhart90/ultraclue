import type { AnyCard } from 'shared';
import { CardArt } from '../render/cardArt';
import { resolveOverride } from '../render/overrides';
import { openCardZoom } from './CardZoom';
import './Card.css';

const TYPE_LABEL: Record<AnyCard['type'], string> = {
  suspect: 'Suspect',
  weapon: 'Weapon',
  room: 'Room',
};

/**
 * One game card. By default clicking it (or pressing Enter/Space on it) opens the full-size zoom
 * viewer; pass `zoomable={false}` where the card is decorative or already the target of another
 * click (the title scatter, the reveal picker, the zoom viewer itself).
 */
export function Card({ card, zoomable = true }: { card: AnyCard; zoomable?: boolean }) {
  const override = resolveOverride(card.id, card.type, card.title);
  const zoomProps = zoomable
    ? {
        role: 'button' as const,
        tabIndex: 0,
        title: `${card.title} — click to enlarge`,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation(); // don't also dismiss a pop-up the card sits in
          openCardZoom(card);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openCardZoom(card);
          }
        },
      }
    : {};
  return (
    <div className={`card card--${card.type}${zoomable ? ' card--zoomable' : ''}`} {...zoomProps}>
      <div className={`card__art${override ? ' card__art--img' : ''}`}>
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
