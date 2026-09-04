import { getCard } from 'shared';
import { CardArt } from '../render/cardArt';
import { resolveOverrideThumb } from '../render/overrides';

/** A small square portrait of a character (override art if present, else the procedural crest),
 *  framed in the character's colour. Used by the public lobby seat rows and the in-game roster. */
export function SuspectThumb({ suspectId, className = 'pseat__thumb' }: { suspectId?: string; className?: string }) {
  const card = suspectId ? getCard(suspectId) : undefined;
  if (!card || card.type !== 'suspect') return <div className={className} />;
  const override = resolveOverrideThumb(card.id, 'suspect', card.title);
  return (
    <div className={className} style={{ borderColor: card.color }}>
      {override ? <img src={override} alt={card.title} /> : <CardArt card={card} />}
    </div>
  );
}
