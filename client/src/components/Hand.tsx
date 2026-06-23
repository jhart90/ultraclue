import { useEffect, useRef, useState } from 'react';
import { getCard, type AnyCard } from 'shared';
import { CardArt } from '../render/cardArt';
import { Card } from './Card';
import './Hand.css';

// The player's private hand: a draggable strip of cards they can reorder, plus a click-to-open
// "flip-through" viewer with prev/next. Order is local-only (cosmetic) and reconciles if the dealt
// hand changes later (e.g. redistribution after an elimination in M7).
export function Hand({ cardIds }: { cardIds: string[] }) {
  const [order, setOrder] = useState<string[]>(cardIds);
  const [focused, setFocused] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    setOrder((prev) => {
      const incoming = new Set(cardIds);
      const kept = prev.filter((id) => incoming.has(id));
      const added = cardIds.filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [cardIds]);

  const cards = order.map((id) => getCard(id)).filter((c): c is AnyCard => !!c);

  const move = (from: number, to: number) =>
    setOrder((prev) => {
      if (from === to) return prev;
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });

  return (
    <div className="hand">
      <div className="hand__strip">
        {cards.map((card, i) => (
          <div
            key={card.id}
            className={`hand__card hand__card--${card.type}`}
            draggable
            onDragStart={() => (dragFrom.current = i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom.current != null) move(dragFrom.current, i);
              dragFrom.current = null;
            }}
            onClick={() => setFocused(i)}
            title={`${card.title} — click to enlarge, drag to reorder`}
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
