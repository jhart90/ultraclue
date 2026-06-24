import { useState } from 'react';
import { getCard, type Announcement } from 'shared';
import { Card } from './Card';
import { CardBack } from './CardBack';
import { Dice } from './Dice';
import { highlightChat } from '../util/highlightChat';
import './GamePopups.css';

type Trio = { suspectId: string; weaponId: string; roomId: string };

/**
 * The two-step accusation reveal everyone sees: first "<name> has made an accusation!" with the
 * three accused cards, then the verdict — a win (envelope revealed, "End Game") or a loss
 * ("Continue Game", or "End Game" if the loss left one player standing).
 */
export function AccusationFlow({
  announcement,
  envelope,
  ended,
  winnerName,
  onContinue,
  onEndGame,
}: {
  announcement: Announcement;
  envelope?: Trio;
  ended: boolean;
  winnerName?: string;
  onContinue: () => void;
  onEndGame: () => void;
}) {
  const [stage, setStage] = useState<'announce' | 'result'>('announce');
  const a = announcement;
  const trio = [a.suspectId, a.weaponId, a.roomId];
  const cardsOf = (ids: string[]) =>
    ids.map((id) => {
      const c = getCard(id);
      return c ? <Card key={id} card={c} /> : null;
    });

  if (stage === 'announce') {
    return (
      <div className="sp__backdrop">
        <div className="sp sp--end">
          <div className="sp__endtitle">{highlightChat(`${a.byName} has made an accusation!`)}</div>
          <div className="sp__cards">{cardsOf(trio)}</div>
          <button className="btn btn--primary" onClick={() => setStage('result')}>
            See the verdict
          </button>
        </div>
      </div>
    );
  }

  if (a.correct) {
    const env = envelope ? [envelope.suspectId, envelope.weaponId, envelope.roomId] : trio;
    return (
      <div className="sp__backdrop">
        <div className="sp sp--end">
          <div className="sp__endtitle">{highlightChat(`🎉 ${a.byName} Wins!`)}</div>
          <div className="sp__hint">The CLASSIFIED envelope contained:</div>
          <div className="sp__cards">{cardsOf(env)}</div>
          <button className="btn btn--primary" onClick={onEndGame}>
            End Game
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sp__backdrop">
      <div className="sp sp--end">
        <div className="sp__endtitle">{highlightChat(`${a.byName} Loses!`)}</div>
        <div className="sp__hint">
          {ended
            ? highlightChat(`Their cards are redistributed — ${winnerName ?? 'the last detective'} wins by default.`)
            : 'Their cards will be redistributed among the other players.'}
        </div>
        <button className="btn btn--primary" onClick={ended ? onEndGame : onContinue}>
          {ended ? 'End Game' : 'Continue Game'}
        </button>
      </div>
    </div>
  );
}

export interface StatusButton {
  label: string;
  icon: string;
  onClick: () => void;
  primary?: boolean;
}

/** Big pop-up mirroring the turn-status bar — appears whenever your actionable status changes. */
export function StatusModal({
  dice,
  lines,
  buttons,
  onClose,
}: {
  dice?: [number, number];
  lines: string[];
  buttons: StatusButton[];
  onClose: () => void;
}) {
  return (
    <div className="sp__backdrop" onClick={onClose}>
      <div className="statpop" onClick={(e) => e.stopPropagation()}>
        <button className="statpop__x" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
        {dice && (
          <div className="statpop__dice">
            <Dice values={dice} />
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={i === 0 ? 'statpop__line1' : 'statpop__line2'}>
            {highlightChat(l)}
          </div>
        ))}
        <div className="statpop__btns">
          {buttons.map((b, i) => (
            <button key={i} className={`btn statpop__btn${b.primary ? ' btn--primary' : ''}`} onClick={b.onClick}>
              <span className="statpop__icon">{b.icon}</span>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "<name> has made a suggestion/accusation:" + the three named cards. Shown to every player. */
export function AnnouncementModal({ announcement, onClose }: { announcement: Announcement; onClose: () => void }) {
  const a = announcement;
  const cards = [a.suspectId, a.weaponId, a.roomId];
  return (
    <div className="sp__backdrop" onClick={onClose}>
      <div className="sp sp--end" onClick={(e) => e.stopPropagation()}>
        <div className="popup__title">
          {highlightChat(`${a.byName} has made ${a.kind === 'suggestion' ? 'a suggestion' : 'an accusation'}:`)}
        </div>
        <div className="sp__cards">
          {cards.map((id) => {
            const c = getCard(id);
            return c ? <Card key={id} card={c} /> : null;
          })}
        </div>
        <button className="btn btn--primary" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * "<responder> has shown a card to <suggester>, disproving the suggestion." The two players in on
 * the reveal (the suggester it was shown to, and the responder who showed it) see the actual card
 * face-up; everyone else sees a generic face-down back.
 */
export function RevealModal({
  responderName,
  suggesterName,
  revealedCardId,
  onClose,
}: {
  responderName: string;
  suggesterName: string;
  revealedCardId?: string;
  onClose: () => void;
}) {
  const revealedCard = revealedCardId ? getCard(revealedCardId) : undefined;
  return (
    <div className="sp__backdrop" onClick={onClose}>
      <div className="sp sp--end" onClick={(e) => e.stopPropagation()}>
        <div className="popup__title">
          {highlightChat(`${responderName} has shown a card to ${suggesterName}, disproving the suggestion.`)}
        </div>
        <div className="sp__cards">{revealedCard ? <Card card={revealedCard} /> : <CardBack />}</div>
        <button className="btn btn--primary" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
