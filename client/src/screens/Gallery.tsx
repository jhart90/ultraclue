import { useMemo, useState } from 'react';
import { SUSPECTS, WEAPONS, ROOMS, type AnyCard, type CardType } from 'shared';
import { Card } from '../components/Card';
import { Wordmark } from '../components/Wordmark';
import { useStore } from '../store';
import './Gallery.css';

type Filter = 'all' | CardType;

const TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All 120' },
  { key: 'suspect', label: 'Suspects' },
  { key: 'weapon', label: 'Weapons' },
  { key: 'room', label: 'Rooms' },
];

export function Gallery() {
  const [filter, setFilter] = useState<Filter>('all');
  const goto = useStore((s) => s.goto);

  const cards: AnyCard[] = useMemo(() => {
    if (filter === 'suspect') return SUSPECTS;
    if (filter === 'weapon') return WEAPONS;
    if (filter === 'room') return ROOMS;
    return [...SUSPECTS, ...WEAPONS, ...ROOMS];
  }, [filter]);

  return (
    <div className="gallery">
      <header className="gallery__head">
        <button className="gallery__back" onClick={() => goto('title')}>
          ← Back
        </button>
        <Wordmark size="md" />
        <p className="gallery__sub">The 120 cards of the manor</p>
        <nav className="gallery__tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={t.key === filter ? 'tab tab--on' : 'tab'}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="gallery__grid">
        {cards.map((card) => (
          <Card key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}
