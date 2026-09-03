import { getCard, defaultDice, type LogCard } from 'shared';
import { Card } from './Card';
import { CardBack } from './CardBack';
import type { ChatPlayer } from '../util/highlightChat';
import './ChatCard.css';

// Game events drawn as cards in the chat log (instead of pop-ups): a roll, a suggestion with its
// three cards and the responses under it, a reveal (face-down for the table, face-up for the two
// in on it), and an accusation with its verdict. Styled after Roll67's roll cards: a dim caption,
// the pieces themselves, and a tinted border where there's a verdict.

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function MiniDie({ value, color, pips }: { value: number; color: string; pips: string }) {
  return (
    <span className="chatcard__die" style={{ background: color }}>
      {Array.from({ length: 9 }, (_, i) => {
        const on = PIPS[value]?.some(([c, r]) => c === i % 3 && r === Math.floor(i / 3));
        return <span key={i} className="chatcard__pip" style={on ? { background: pips } : undefined} />;
      })}
    </span>
  );
}

/** 1 -> "1st", 22 -> "22nd", 113 -> "113th". */
function ordinal(n: number): string {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

function Mini({ id }: { id: string }) {
  const card = getCard(id);
  if (!card) return null;
  return (
    <span className="chatcard__mini">
      <Card card={card} />
    </span>
  );
}

/** Response chips folded under a suggestion card: who couldn't disprove it, and how it ended. */
export interface SuggestionResponse {
  text: string; // the original log line
  kind: 'pass' | 'nobody' | 'shown';
}

export function ChatCard({
  card,
  caption,
  players,
  responses = [],
}: {
  card: LogCard;
  caption: React.ReactNode;
  players: ChatPlayer[];
  responses?: SuggestionResponse[];
}) {
  const playerById = (id: string) => players.find((p) => p.id === id);

  if (card.kind === 'turn') {
    return (
      <div className="chatcard chatcard--turn">
        <div className="chatcard__turnname">{caption}</div>
        <div className="chatcard__turnsub">
          {ordinal(card.playerTurn)} turn individually, {ordinal(card.overallTurn)} turn overall
        </div>
      </div>
    );
  }

  if (card.kind === 'roll') {
    const p = playerById(card.playerId);
    const dice = p?.dice ?? defaultDice(p?.suspectId);
    return (
      <div className="chatcard chatcard--roll">
        <div className="chatcard__caption">{caption}</div>
        <div className="chatcard__rollrow">
          <MiniDie value={card.dice[0]} color={dice.color} pips={dice.pips} />
          <span className="chatcard__op">+</span>
          <MiniDie value={card.dice[1]} color={dice.color} pips={dice.pips} />
          <span className="chatcard__op">=</span>
          <span className="chatcard__total">{card.dice[0] + card.dice[1]}</span>
        </div>
      </div>
    );
  }

  if (card.kind === 'suggestion') {
    return (
      <div className="chatcard chatcard--suggestion">
        <div className="chatcard__caption">{caption}</div>
        <div className="chatcard__trio">
          <Mini id={card.suspectId} />
          <Mini id={card.weaponId} />
          <Mini id={card.roomId} />
        </div>
        {responses.length > 0 && (
          <div className="chatcard__responses">
            {responses.map((r, i) => (
              <span key={i} className={`chatcard__resp chatcard__resp--${r.kind}`}>
                {r.kind === 'pass' ? r.text.replace(/ cannot disprove it\.$/, ': nothing') : r.text}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (card.kind === 'reveal') {
    const shown = card.cardId ? getCard(card.cardId) : undefined;
    return (
      <div className={`chatcard chatcard--reveal${shown ? ' chatcard--private' : ''}`}>
        <div className="chatcard__caption">{caption}</div>
        <div className="chatcard__trio">
          {shown ? <Mini id={shown.id} /> : <span className="chatcard__mini chatcard__mini--back"><CardBack small /></span>}
          {shown && <span className="chatcard__note">Only you two can see which card.</span>}
        </div>
      </div>
    );
  }

  // accusation
  return (
    <div className={`chatcard chatcard--accusation ${card.correct ? 'chatcard--correct' : 'chatcard--wrong'}`}>
      <div className="chatcard__caption">{caption}</div>
      <div className="chatcard__trio">
        <Mini id={card.suspectId} />
        <Mini id={card.weaponId} />
        <Mini id={card.roomId} />
      </div>
      <div className="chatcard__verdict">{card.correct ? '✔ Correct — case solved' : '✘ Wrong — accuser eliminated'}</div>
    </div>
  );
}
