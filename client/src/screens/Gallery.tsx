import { useMemo, useState } from 'react';
import { SUSPECTS, WEAPONS, ROOMS, type AnyCard, type CardType } from 'shared';
import { Card } from '../components/Card';
import { Wordmark } from '../components/Wordmark';
import { useStore } from '../store';
import './Gallery.css';

type Filter = 'all' | CardType;

// Each category sorted alphabetically by title; the gallery always lists them suspects → weapons →
// rooms. (Weapon cards share one cream background, so they sort by name like the others.)
const byTitle = (a: AnyCard, b: AnyCard) => a.title.localeCompare(b.title);
const SORTED = {
  suspect: [...SUSPECTS].sort(byTitle),
  weapon: [...WEAPONS].sort(byTitle),
  room: [...ROOMS].sort(byTitle),
};

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
    if (filter === 'suspect') return SORTED.suspect;
    if (filter === 'weapon') return SORTED.weapon;
    if (filter === 'room') return SORTED.room;
    return [...SORTED.suspect, ...SORTED.weapon, ...SORTED.room];
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
