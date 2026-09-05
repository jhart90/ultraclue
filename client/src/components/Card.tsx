import { useState } from 'react';
import type { AnyCard } from 'shared';
import { CardArt } from '../render/cardArt';
import { resolveOverride, resolveOverrideThumb } from '../render/overrides';
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
 *
 * The art is the small thumbnail unless `hiRes` is set: every screen but the zoom viewer draws the
 * card at 200px or less, so the 900px master would be ~5x the bytes for no visible gain.
 */
export function Card({ card, zoomable = true, hiRes = false }: { card: AnyCard; zoomable?: boolean; hiRes?: boolean }) {
  const override = hiRes ? resolveOverride(card.id, card.type, card.title) : resolveOverrideThumb(card.id, card.type, card.title);
  const thumb = hiRes ? resolveOverrideThumb(card.id, card.type, card.title) : undefined;
  // The cached thumbnail stands in behind the full-size file only until that file has arrived —
  // once it has, the placeholder goes, so a stray pixel of it can never show around the master.
  const [loaded, setLoaded] = useState(false);
  const placeholder = thumb && thumb !== override && !loaded;
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
      <div className="card__head">
        <div className="card__title">{card.title}</div>
        <div className="card__type">{TYPE_LABEL[card.type]}</div>
      </div>
      <div
        className={`card__art${override ? ' card__art--img' : ''}`}
        // While the full-size file downloads, the already-cached thumbnail stands in behind it,
        // cropped exactly as the <img> will be (cover, centred) so the two never show as a double.
        style={placeholder ? { backgroundImage: `url(${thumb})`, backgroundSize: 'auto 106%', backgroundPosition: 'center top' } : undefined}
      >
        {override ? (
          <img src={override} alt={card.title} className="card__override" onLoad={() => setLoaded(true)} />
        ) : (
          <CardArt card={card} />
        )}
      </div>
      <div className="card__body">
        <div className="card__phrase">{card.phrase}</div>
      </div>
    </div>
  );
}
