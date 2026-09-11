import wordmark from '../../../40_alibis_wordmark_black_transparent.png';
import './CardBack.css';

/** The back of a card: the Ultra Clue wordmark on a maroon playing-card lattice. */
export function CardBack({ small }: { small?: boolean }) {
  return (
    <div className={`cardback${small ? ' cardback--sm' : ''}`}>
      <img src={wordmark} alt="card back" className="cardback__mark" draggable={false} />
    </div>
  );
}
