import { getCard, type AnyCard } from 'shared';
import { CardArt } from '../render/cardArt';
import { resolveOverride } from '../render/overrides';
import { openCardZoom } from './CardZoom';
import { compareCards } from '../util/cardSort';
import './Hand.css';

// The player's private hand: a tidy shelf sorted by type (suspect, weapon, room) then alphabetically
// (suspects by surname). Clicking a card opens it full-size in the shared zoom viewer, which pages
// prev/next through the rest of the hand.
export function Hand({ cardIds }: { cardIds: string[] }) {
  const cards = cardIds
    .map((id) => getCard(id))
    .filter((c): c is AnyCard => !!c)
    .sort(compareCards);

  return (
    <div className="hand">
      <div className="hand__strip">
        {cards.map((card, i) => (
          <div
            key={card.id}
            className={`hand__card hand__card--${card.type}`}
            role="button"
            tabIndex={0}
            onClick={() => openCardZoom(cards, i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openCardZoom(cards, i);
              }
            }}
            title={`${card.title} — click to enlarge`}
          >
            <div className="hand__thumb">
              {(() => {
                const override = resolveOverride(card.id, card.type, card.title);
                return override ? (
                  <img src={override} alt={card.title} className="hand__thumbimg" />
                ) : (
                  <CardArt card={card} />
                );
              })()}
            </div>
            <div className="hand__name">{card.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
