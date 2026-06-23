import { useState } from 'react';
import { SUSPECTS, WEAPONS, ROOMS, getCard, type GameView } from 'shared';
import { Card } from './Card';
import './SuggestPanels.css';

/** Suspect/weapon(/room) picker for a suggestion or an accusation. */
export function SelectModal({
  mode,
  fixedRoomId,
  onCancel,
  onSubmit,
  onPeekNotes,
}: {
  mode: 'suggest' | 'accuse';
  fixedRoomId?: string;
  onCancel: () => void;
  onSubmit: (suspectId: string, weaponId: string, roomId: string) => void;
  onPeekNotes?: () => void;
}) {
  const [suspectId, setSuspectId] = useState('');
  const [weaponId, setWeaponId] = useState('');
  const [roomId, setRoomId] = useState(fixedRoomId ?? '');
  const ready = suspectId && weaponId && roomId;

  return (
    <div className="sp__backdrop" onClick={onCancel}>
      <div className="sp" onClick={(e) => e.stopPropagation()}>
        <div className="sp__title">{mode === 'suggest' ? 'Make a Suggestion' : 'Make an Accusation'}</div>
        <div className="sp__hint">
          {mode === 'suggest'
            ? 'Summon a suspect and weapon into your room — the other detectives will try to disprove it.'
            : 'Name the suspect, weapon, and room. A wrong accusation eliminates you from the game.'}
        </div>
        <div className="sp__cols">
          <div className="sp__col">
            <h4>Suspect</h4>
            <div className="sp__list">
              {SUSPECTS.map((s) => (
                <button
                  key={s.id}
                  className={`sp__chip${suspectId === s.id ? ' sp__chip--on' : ''}`}
                  onClick={() => setSuspectId(s.id)}
                >
                  <span className="sp__sw" style={{ background: s.color }} />
                  {s.title}
                </button>
              ))}
            </div>
          </div>
          <div className="sp__col">
            <h4>Weapon</h4>
            <div className="sp__list">
              {WEAPONS.map((w) => (
                <button
                  key={w.id}
                  className={`sp__chip${weaponId === w.id ? ' sp__chip--on' : ''}`}
                  onClick={() => setWeaponId(w.id)}
                >
                  {w.title}
                </button>
              ))}
            </div>
          </div>
          <div className="sp__col">
            <h4>Room</h4>
            {mode === 'suggest' ? (
              <div className="sp__fixed">
                {getCard(fixedRoomId ?? '')?.title}
                <div className="sp__fixednote">(your current room)</div>
              </div>
            ) : (
              <div className="sp__list">
                {ROOMS.map((r) => (
                  <button
                    key={r.id}
                    className={`sp__chip${roomId === r.id ? ' sp__chip--on' : ''}`}
                    onClick={() => setRoomId(r.id)}
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sp__foot">
          {onPeekNotes && (
            <button className="btn sp__notesbtn" onClick={onPeekNotes}>
              📓 Detective Notes
            </button>
          )}
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--primary" disabled={!ready} onClick={() => onSubmit(suspectId, weaponId, roomId)}>
            {mode === 'suggest' ? 'Suggest' : 'Accuse'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown to the player who must disprove a suggestion: select one matching card, then reveal it. */
export function RevealPanel({
  trio,
  hand,
  suggesterName,
  onReveal,
}: {
  trio: string[];
  hand: string[];
  suggesterName: string;
  onReveal: (cardId: string) => void;
}) {
  const matches = trio.filter((c) => hand.includes(c));
  const [selected, setSelected] = useState<string | null>(matches.length === 1 ? matches[0] : null);
  return (
    <div className="sp__backdrop">
      <div className="sp sp--reveal">
        <div className="sp__title">Disprove the suggestion</div>
        <div className="sp__hint">
          Select one matching card to reveal to {suggesterName} (only they will see which one).
        </div>
        <div className="sp__cards">
          {matches.map((c) => {
            const card = getCard(c);
            return card ? (
              <button
                key={c}
                className={`sp__cardbtn${selected === c ? ' sp__cardbtn--sel' : ''}`}
                onClick={() => setSelected(c)}
              >
                <Card card={card} />
              </button>
            ) : null;
          })}
        </div>
        <button className="btn btn--primary sp__revealbtn" disabled={!selected} onClick={() => selected && onReveal(selected)}>
          Reveal Card
        </button>
      </div>
    </div>
  );
}

/** Game-over overlay: winner + the revealed envelope. */
export function EndScreen({ game, myId, onLeave }: { game: GameView; myId: string; onLeave: () => void }) {
  const winner = game.players.find((p) => p.id === game.winnerId);
  const won = game.winnerId === myId;
  const env = game.envelope;
  return (
    <div className="sp__backdrop">
      <div className="sp sp--end">
        <div className="sp__endtitle">{won ? '🎉 You solved the case!' : `${winner?.name ?? 'Someone'} wins!`}</div>
        <div className="sp__hint">The CLASSIFIED envelope contained:</div>
        <div className="sp__cards">
          {env &&
            [env.suspectId, env.weaponId, env.roomId].map((id) => {
              const card = getCard(id);
              return card ? <Card key={id} card={card} /> : null;
            })}
        </div>
        <button className="btn btn--primary" onClick={onLeave}>
          Back to Title
        </button>
      </div>
    </div>
  );
}
