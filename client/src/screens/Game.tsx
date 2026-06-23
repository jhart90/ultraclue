import { useState } from 'react';
import { getCard } from 'shared';
import { useStore } from '../store';
import { Chat } from '../components/Chat';
import { Hand } from '../components/Hand';
import { Board } from '../components/Board';
import { Dice } from '../components/Dice';
import { Wordmark } from '../components/Wordmark';
import { DetectiveNotes } from '../components/DetectiveNotes';
import { SelectModal, RevealPanel, EndScreen } from '../components/SuggestPanels';
import './Game.css';

function suspectColor(suspectId?: string): string {
  if (!suspectId) return '#555';
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? c.color : '#555';
}

export function Game() {
  const game = useStore((s) => s.game);
  const chat = useStore((s) => s.chat);
  const myId = useStore((s) => s.myId);
  const sendChat = useStore((s) => s.sendChat);
  const leave = useStore((s) => s.leave);
  const rollMove = useStore((s) => s.rollMove);
  const moveTo = useStore((s) => s.moveTo);
  const skipMove = useStore((s) => s.skipMove);
  const suggest = useStore((s) => s.suggest);
  const revealCard = useStore((s) => s.revealCard);
  const accuse = useStore((s) => s.accuse);
  const endTurn = useStore((s) => s.endTurn);
  const [notesOpen, setNotesOpen] = useState(false);
  const [modal, setModal] = useState<null | 'suggest' | 'accuse'>(null);
  const [notesFront, setNotesFront] = useState(false); // notes floated above the suggest/accuse modal

  if (!game) {
    return (
      <div className="game game--loading">
        <p>Dealing the cards…</p>
      </div>
    );
  }

  const activeId = game.turnOrder[game.activeIdx];
  const activePlayer = game.players.find((p) => p.id === activeId);
  const me = game.players.find((p) => p.id === myId);
  const myTurn = activeId === myId;
  const turnLabel = myTurn ? 'Your turn' : `${activePlayer?.name ?? '—'}'s turn`;
  const orderedPlayers = game.turnOrder
    .map((id) => game.players.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);

  const myRoom = me?.inRoomId ? getCard(me.inRoomId)?.title : null;

  const sug = game.currentSuggestion;
  const suggestionPending = !!sug && !sug.resolved;
  const iMustReveal = suggestionPending && sug!.pendingResponderId === myId;
  const pendingName = sug?.pendingResponderId
    ? game.players.find((p) => p.id === sug.pendingResponderId)?.name
    : null;
  const revealedToMe = sug?.resolved && sug.anyRevealed && sug.suggesterId === myId ? sug.revealedCardId : undefined;
  const revealedCard = revealedToMe ? getCard(revealedToMe) : undefined;

  return (
    <div className="game">
      <header className="game__top">
        <div className="game__title">
          <Wordmark size="sm" /> <span className="game__code">Room {game.code}</span>
        </div>
        <div className="game__turn">{turnLabel}</div>
        <button className="btn btn--danger" onClick={leave}>
          Leave
        </button>
      </header>

      <div className="game__main">
        <div className="game__board">
          <div className="game__turnorder">
            {orderedPlayers.map((p) => (
              <div
                key={p.id}
                className={`po${p.id === activeId ? ' po--active' : ''}${p.eliminated ? ' po--out' : ''}`}
              >
                <span className="po__sw" style={{ background: suspectColor(p.suspectId) }} />
                <span className="po__name">
                  {p.name}
                  {p.id === myId ? ' (you)' : ''}
                </span>
                <span className="po__char">{getCard(p.suspectId)?.title}</span>
                {p.id === activeId && <span className="po__tag">to move</span>}
              </div>
            ))}
          </div>

          <div className="game__controls">
            {game.lastRoll && !suggestionPending && <Dice values={game.lastRoll} />}
            {revealedCard && (
              <div className="game__revealed" title="A card was revealed only to you">
                <span className="game__revealedlbl">Shown to you:</span>
                <span className="game__revealedname">{revealedCard.title}</span>
              </div>
            )}
            <div className="game__ctext">
              {suggestionPending ? (
                <span>
                  {sug!.suggesterId === myId ? 'Your suggestion' : 'A suggestion'} is in play —{' '}
                  {pendingName ? `${pendingName} is deciding whether to disprove it…` : 'resolving…'}
                </span>
              ) : myTurn ? (
                game.turnPhase === 'awaitRoll' ? (
                  <span>You are in the {myRoom}. Roll to leave, or skip to stay.</span>
                ) : game.turnPhase === 'awaitMove' ? (
                  <span>Click a highlighted square to move.</span>
                ) : me?.inRoomId ? (
                  <span>You're in the {myRoom}. Suggest, accuse, or end your turn.</span>
                ) : (
                  <span>Accuse, or end your turn.</span>
                )
              ) : (
                <span>Waiting for {activePlayer?.name}…</span>
              )}
            </div>
            {myTurn && !suggestionPending && (
              <div className="game__cbtns">
                {game.turnPhase === 'awaitRoll' && (
                  <>
                    <button className="btn btn--primary" onClick={rollMove}>🎲 Roll &amp; Move</button>
                    <button className="btn" onClick={skipMove}>Skip movement</button>
                  </>
                )}
                {game.turnPhase === 'postMove' && (
                  <>
                    {me?.inRoomId && (
                      <button className="btn btn--primary" onClick={() => setModal('suggest')}>Suggest</button>
                    )}
                    <button className="btn" onClick={() => setModal('accuse')}>Accuse</button>
                    <button className="btn" onClick={endTurn}>End Turn</button>
                  </>
                )}
              </div>
            )}
          </div>

          <Board
            players={orderedPlayers}
            reachable={game.reachable}
            lastMove={game.lastMove}
            weaponLocations={game.weaponLocations}
            canMove={myTurn && game.turnPhase === 'awaitMove' && !suggestionPending}
            onMoveTo={moveTo}
          />
          <div className="game__log">
            <div className="game__logtitle">Case Log</div>
            {game.log.map((l) => (
              <div key={l.id} className="game__logline">
                {l.text}
              </div>
            ))}
          </div>
        </div>

        <aside className="game__chat">
          <Chat messages={chat} onSend={sendChat} />
        </aside>
      </div>

      <div className="game__bottom">
        <div className="game__handwrap">
          <div className="game__handlabel">Your hand · {me?.handCount ?? game.yourHand.length} cards</div>
          <Hand cardIds={game.yourHand} />
        </div>
        <button className="game__notestab" onClick={() => setNotesOpen(true)}>
          📓 Detective Notes
        </button>
      </div>

      {notesOpen && (
        <DetectiveNotes roomCode={game.code} players={orderedPlayers} onClose={() => setNotesOpen(false)} />
      )}

      {modal && me && (
        <>
          {/* Detective Notes sits behind the modal; the 📓 button floats it on top and back. */}
          <DetectiveNotes
            roomCode={game.code}
            players={orderedPlayers}
            zIndex={notesFront ? 90 : 70}
            backLabel={modal === 'suggest' ? 'Suggestion' : 'Accusation'}
            onBack={() => setNotesFront(false)}
            onClose={() => setNotesFront(false)}
          />
          <SelectModal
            mode={modal}
            fixedRoomId={modal === 'suggest' ? me.inRoomId : undefined}
            onCancel={() => {
              setModal(null);
              setNotesFront(false);
            }}
            onPeekNotes={() => setNotesFront(true)}
            onSubmit={(s, w, r) => {
              if (modal === 'suggest') suggest(s, w);
              else accuse(s, w, r);
              setModal(null);
              setNotesFront(false);
            }}
          />
        </>
      )}

      {iMustReveal && sug && (
        <RevealPanel
          trio={[sug.suspectId, sug.weaponId, sug.roomId]}
          hand={game.yourHand}
          suggesterName={game.players.find((p) => p.id === sug.suggesterId)?.name ?? 'the suggester'}
          onReveal={(c) => revealCard(c)}
        />
      )}

      {game.phase === 'ended' && <EndScreen game={game} myId={myId} onLeave={leave} />}
    </div>
  );
}
