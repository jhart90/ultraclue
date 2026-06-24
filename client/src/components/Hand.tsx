import { useState } from 'react';
import { getCard, type AnyCard } from 'shared';
import { CardArt } from '../render/cardArt';
import { Card } from './Card';
import { compareCards } from '../util/cardSort';
import './Hand.css';

// The player's private hand: a tidy shelf sorted by type (suspect, weapon, room) then alphabetically
// (suspects by surname), plus a click-to-open "flip-through" viewer with prev/next.
export function Hand({ cardIds }: { cardIds: string[] }) {
  const [focused, setFocused] = useState<number | null>(null);

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
            onClick={() => setFocused(i)}
            title={`${card.title} — click to enlarge`}
          >
            <div className="hand__thumb">
              <CardArt card={card} />
            </div>
            <div className="hand__name">{card.title}</div>
          </div>
        ))}
      </div>

      {focused != null && cards[focused] && (
        <div className="hand__viewer" onClick={() => setFocused(null)}>
          <div className="hand__viewerinner" onClick={(e) => e.stopPropagation()}>
            <button
              className="hand__nav"
              onClick={() => setFocused((focused - 1 + cards.length) % cards.length)}
              aria-label="Previous card"
            >
              ‹
            </button>
            <Card card={cards[focused]} />
            <button
              className="hand__nav"
              onClick={() => setFocused((focused + 1) % cards.length)}
              aria-label="Next card"
            >
              ›
            </button>
          </div>
          <div className="hand__viewerhint">
            {focused + 1} / {cards.length} · click outside to close
          </div>
        </div>
      )}
    </div>
  );
}
