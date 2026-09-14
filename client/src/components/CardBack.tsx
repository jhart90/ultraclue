import type { CardBackId } from 'shared';
import wordmark from '../../../40_alibis_wordmark_black_transparent.png';
import { useStore } from '../store';
import { cardBackArt, CARD_BACK_LABEL } from '../render/cardBacks';
import { openCardBackZoom } from './CardZoom';
import './CardBack.css';

/** The back everyone's cards show right now: the viewer's own pick from settings if they made one,
 *  else the back the table dealt for this game, else the one the title screen drew on load. */
export function useCardBack(): CardBackId {
  const choice = useStore((s) => s.backChoice);
  const dealt = useStore((s) => s.game?.cardBack);
  const table = useStore((s) => s.tableBack);
  return choice !== 'table' ? choice : (dealt ?? table);
}

/** The back of a card. `classic` is the 40 Alibis wordmark on a maroon playing-card lattice, drawn
 *  in CSS; the other designs are full-bleed art. `back` forces a design (for the settings previews);
 *  otherwise it follows `useCardBack`. `zoomable` opens it full size in the card viewer on a click,
 *  as a face-up card does. */
export function CardBack({ small, xs, back, zoomable = false }: { small?: boolean; xs?: boolean; back?: CardBackId; zoomable?: boolean }) {
  const current = useCardBack();
  const id = back ?? current;
  const art = cardBackArt(id);
  const size = xs ? ' cardback--xs' : small ? ' cardback--sm' : '';
  const zoomProps = zoomable
    ? {
        role: 'button' as const,
        tabIndex: 0,
        title: `${CARD_BACK_LABEL[id]} card back — click to enlarge`,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          openCardBackZoom(id);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openCardBackZoom(id);
          }
        },
      }
    : {};
  return (
    <div className={`cardback cardback--${id}${art ? ' cardback--art' : ''}${size}${zoomable ? ' cardback--zoomable' : ''}`} {...zoomProps}>
      {art ? (
        <img src={art} alt="card back" className="cardback__art" draggable={false} />
      ) : (
        <img src={wordmark} alt="card back" className="cardback__mark" draggable={false} />
      )}
    </div>
  );
}
