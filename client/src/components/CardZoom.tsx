import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { AnyCard, CardBackId } from 'shared';
import { Card } from './Card';
import { CardBack } from './CardBack';
import { CARD_BACK_LABEL } from '../render/cardBacks';
import './CardZoom.css';

// One app-wide "look closer" pop-up. Any card drawn anywhere (gallery, hand, pop-ups, chat log)
// opens here at the largest size the viewport allows — the override art is 900px square, so this
// is where it's actually seen at full resolution. Opened with a list, it also pages prev/next.
// A face-down card opens here too, as its back design.

/** Something the viewer can show: a card face, or a card back by design. */
export type ZoomItem = AnyCard | { back: CardBackId };
const isBack = (item: ZoomItem): item is { back: CardBackId } => 'back' in item;

interface ZoomState {
  cards: ZoomItem[];
  index: number;
  open: (cards: ZoomItem | ZoomItem[], index?: number) => void;
  step: (delta: number) => void;
  close: () => void;
}

export const useCardZoom = create<ZoomState>((set, get) => ({
  cards: [],
  index: 0,
  open: (cards, index = 0) => set({ cards: Array.isArray(cards) ? cards : [cards], index }),
  step: (delta) => {
    const { cards, index } = get();
    if (cards.length < 2) return;
    set({ index: (index + delta + cards.length) % cards.length });
  },
  close: () => set({ cards: [], index: 0 }),
}));

/** Open the zoom pop-up on a card (or on a list of cards, starting at `index`). */
export const openCardZoom = (cards: ZoomItem | ZoomItem[], index = 0) => useCardZoom.getState().open(cards, index);
/** Open the zoom pop-up on a card back. */
export const openCardBackZoom = (back: CardBackId) => useCardZoom.getState().open({ back });

// The card is authored at 200×306; scale it to fill ~90% of the viewport's tighter dimension.
const CARD_W = 200;
const CARD_H = 306;
function fitZoom(): number {
  const w = (window.innerWidth * 0.9) / CARD_W;
  const h = (window.innerHeight * 0.86) / CARD_H;
  return Math.max(1, Math.min(w, h));
}

export function CardZoomOverlay() {
  const cards = useCardZoom((s) => s.cards);
  const index = useCardZoom((s) => s.index);
  const step = useCardZoom((s) => s.step);
  const close = useCardZoom((s) => s.close);
  const [zoom, setZoom] = useState(fitZoom);
  const card = cards[index];
  const many = cards.length > 1;

  useEffect(() => {
    if (!card) return;
    const onResize = () => setZoom(fitZoom());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (many && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) step(-1);
      else if (many && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) step(1);
      else return;
      e.preventDefault();
    };
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [card, many, close, step]);

  if (!card) return null;
  const label = isBack(card) ? `${CARD_BACK_LABEL[card.back]} card back` : `${card.title} card`;

  return (
    <div className="cardzoom" onClick={close} role="dialog" aria-modal="true" aria-label={label}>
      <button className="cardzoom__x" onClick={close} aria-label="Close">
        ✕
      </button>
      <div className="cardzoom__row">
        {many && (
          <button
            className="cardzoom__nav"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
            aria-label="Previous card"
          >
            ‹
          </button>
        )}
        <div className="cardzoom__card" style={{ zoom }} onClick={(e) => e.stopPropagation()}>
          {isBack(card) ? <CardBack back={card.back} /> : <Card card={card} zoomable={false} hiRes />}
        </div>
        {many && (
          <button
            className="cardzoom__nav"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
            aria-label="Next card"
          >
            ›
          </button>
        )}
      </div>
      <div className="cardzoom__hint">
        {many ? `${index + 1} / ${cards.length} · ` : ''}click outside or press Esc to close
      </div>
    </div>
  );
}
