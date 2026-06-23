import { useEffect, useRef, useState } from 'react';
import { getCard, shortcutDestForRoom } from 'shared';
import { useStore } from '../store';
import { Chat } from '../components/Chat';
import { Hand } from '../components/Hand';
import { Board } from '../components/Board';
import { Dice } from '../components/Dice';
import { Wordmark } from '../components/Wordmark';
import { DetectiveNotes } from '../components/DetectiveNotes';
import { SelectModal, RevealPanel, EndScreen } from '../components/SuggestPanels';
import { StatusModal, AnnouncementModal, RevealModal, type StatusButton } from '../components/GamePopups';
import './Game.css';

function suspectColor(suspectId?: string): string {
  if (!suspectId) return '#555';
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? c.color : '#555';
}

const FLOOR_LABELS: Record<string, string> = {
  'ground-floor': 'Ground Floor',
  'upper-floor': 'Upper Floor',
  basement: 'Basement',
};

export function Game() {
  const game = useStore((s) => s.game);
  const chat = useStore((s) => s.chat);
  const myId = useStore((s) => s.myId);
  const sendChat = useStore((s) => s.sendChat);
  const leave = useStore((s) => s.leave);
  const rollMove = useStore((s) => s.rollMove);
  const moveTo = useStore((s) => s.moveTo);
  const chooseFloor = useStore((s) => s.chooseFloor);
  const takeShortcut = useStore((s) => s.takeShortcut);
  const skipMove = useStore((s) => s.skipMove);
  const suggest = useStore((s) => s.suggest);
  const revealCard = useStore((s) => s.revealCard);
  const accuse = useStore((s) => s.accuse);
  const endTurn = useStore((s) => s.endTurn);
  const [notesOpen, setNotesOpen] = useState(false);
  const [modal, setModal] = useState<null | 'suggest' | 'accuse'>(null);
  const [notesFront, setNotesFront] = useState(false); // notes floated above the suggest/accuse modal

  // --- pop-up overlays (status / announcement / reveal) ---
  const [statusOpen, setStatusOpen] = useState(false);
  const [annOpen, setAnnOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const annSeqRef = useRef(0);
  const revealKeyRef = useRef('');
  const statusSigRef = useRef('');

  // Null-safe values the effects depend on (computed before the early return so hook order is stable).
  const myTurnNow = !!game && game.turnOrder[game.activeIdx] === myId;
  const meNow = game?.players.find((p) => p.id === myId);
  const sgNow = game?.currentSuggestion;
  const suggestionPendingNow = !!sgNow && !sgNow.resolved;
  const iMustRevealNow = suggestionPendingNow && sgNow!.pendingResponderId === myId;

  // New suggestion/accusation -> announce it to everyone (and clear any prior reveal pop-up).
  useEffect(() => {
    const a = game?.announcement;
    if (a && a.seq !== annSeqRef.current) {
      annSeqRef.current = a.seq;
      setRevealOpen(false);
      if (game?.phase === 'play') setAnnOpen(true);
    }
  }, [game?.announcement?.seq, game?.phase]);

  // A card was just revealed -> show the face-down reveal pop-up (replacing the announcement).
  useEffect(() => {
    if (sgNow?.resolved && sgNow.anyRevealed && sgNow.responderId) {
      const key = `${game?.announcement?.seq ?? 0}:${sgNow.responderId}`;
      if (key !== revealKeyRef.current) {
        revealKeyRef.current = key;
        setAnnOpen(false);
        setRevealOpen(true);
      }
    }
  }, [sgNow?.resolved, sgNow?.anyRevealed, sgNow?.responderId, game?.announcement?.seq]);

  // If I must disprove, the announcement pop-up gives way to the disprove panel.
  useEffect(() => {
    if (iMustRevealNow) setAnnOpen(false);
  }, [iMustRevealNow]);

  // Pop up the big status window whenever my actionable status changes (roll, room entry, etc.).
  useEffect(() => {
    if (!game || game.phase !== 'play' || !myTurnNow || suggestionPendingNow) {
      statusSigRef.current = '';
      setStatusOpen(false);
      return;
    }
    const sig = `${game.turnPhase}|${game.lastRoll?.join('-') ?? ''}|${meNow?.inRoomId ?? ''}`;
    if (sig !== statusSigRef.current) {
      statusSigRef.current = sig;
      setStatusOpen(true);
    }
  }, [game?.turnPhase, game?.lastRoll?.[0], game?.lastRoll?.[1], meNow?.inRoomId, myTurnNow, suggestionPendingNow, game?.phase]);

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
  const myShortcutDest = me?.inRoomId ? shortcutDestForRoom(me.inRoomId) : undefined;
  const myShortcutName = myShortcutDest ? getCard(myShortcutDest)?.title : undefined;

  const sug = game.currentSuggestion;
  const suggestionPending = !!sug && !sug.resolved;
  const iMustReveal = suggestionPending && sug!.pendingResponderId === myId;
  const pendingName = sug?.pendingResponderId
    ? game.players.find((p) => p.id === sug.pendingResponderId)?.name
    : null;
  const revealedToMe = sug?.resolved && sug.anyRevealed && sug.suggesterId === myId ? sug.revealedCardId : undefined;
  const revealedCard = revealedToMe ? getCard(revealedToMe) : undefined;

  // Big status pop-up content for the active player.
  const statusDesc: { dice?: [number, number]; lines: string[]; buttons: StatusButton[] } | null = (() => {
    if (!myTurn || suggestionPending || game.turnPhase === 'awaitElevator') return null;
    if (game.turnPhase === 'awaitRoll') {
      const buttons: StatusButton[] = [
        { label: 'Roll & Move', icon: '🎲', primary: true, onClick: () => (setStatusOpen(false), rollMove()) },
      ];
      if (myShortcutDest)
        buttons.push({ label: `Take Shortcut to ${myShortcutName}`, icon: '🕳️', onClick: () => (setStatusOpen(false), takeShortcut()) });
      buttons.push({ label: 'Skip movement', icon: '⏭️', onClick: () => (setStatusOpen(false), skipMove()) });
      return { lines: [`You are in the ${myRoom}.`, 'Roll, take the secret passage, or skip to stay.'], buttons };
    }
    if (game.turnPhase === 'awaitMove' && game.lastRoll) {
      return {
        dice: game.lastRoll,
        lines: [`You rolled ${game.lastRoll[0] + game.lastRoll[1]}.`, 'Click a highlighted square to move.'],
        buttons: [{ label: 'Got it', icon: '👍', primary: true, onClick: () => setStatusOpen(false) }],
      };
    }
    const buttons: StatusButton[] = [];
    if (me?.inRoomId)
      buttons.push({ label: 'Suggest', icon: '🔍', primary: true, onClick: () => (setStatusOpen(false), setModal('suggest')) });
    buttons.push({ label: 'Accuse', icon: '🗡️', onClick: () => (setStatusOpen(false), setModal('accuse')) });
    buttons.push({ label: 'End Turn', icon: '⏳', onClick: () => (setStatusOpen(false), endTurn()) });
    return {
      lines: me?.inRoomId
        ? [`You are in the ${myRoom}.`, 'Suggest, accuse, or end your turn.']
        : ['Move complete.', 'Accuse, or end your turn.'],
      buttons,
    };
  })();

  // Only one overlay shows at a time, by priority.
  const showEnd = game.phase === 'ended';
  const showDisprove = iMustReveal && !!sug;
  const showReveal = revealOpen && !showDisprove && !showEnd && !modal;
  const showAnn = annOpen && !!game.announcement && !showReveal && !showDisprove && !showEnd && !modal;
  const showStatus =
    statusOpen && !!statusDesc && !showAnn && !showReveal && !showDisprove && !showEnd && !modal && !iMustReveal;

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
                {getCard(p.suspectId)?.title !== p.name && (
                  <span className="po__char">{getCard(p.suspectId)?.title}</span>
                )}
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
                    {myShortcutDest && (
                      <button className="btn" onClick={takeShortcut}>🕳️ Take Shortcut to {myShortcutName}</button>
                    )}
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

      {showStatus && statusDesc && (
        <StatusModal
          dice={statusDesc.dice}
          lines={statusDesc.lines}
          buttons={statusDesc.buttons}
          onClose={() => setStatusOpen(false)}
        />
      )}

      {showAnn && game.announcement && (
        <AnnouncementModal announcement={game.announcement} onClose={() => setAnnOpen(false)} />
      )}

      {showReveal && sug && (
        <RevealModal
          responderName={game.players.find((p) => p.id === sug.responderId)?.name ?? 'A player'}
          suggesterName={game.players.find((p) => p.id === sug.suggesterId)?.name ?? 'the suggester'}
          revealedCardId={sug.revealedCardId}
          onClose={() => setRevealOpen(false)}
        />
      )}

      {showDisprove && sug && (
        <RevealPanel
          trio={[sug.suspectId, sug.weaponId, sug.roomId]}
          hand={game.yourHand}
          suggesterName={game.players.find((p) => p.id === sug.suggesterId)?.name ?? 'the suggester'}
          onReveal={(c) => revealCard(c)}
        />
      )}

      {myTurn && game.turnPhase === 'awaitElevator' && game.elevatorFloors && (
        <div className="sp__backdrop">
          <div className="statpop">
            <div className="statpop__line1">🛗 Elevator</div>
            <div className="statpop__line2">Which floor would you like to ride to?</div>
            <div className="statpop__btns">
              {game.elevatorFloors.map((f) => (
                <button key={f} className="btn btn--primary statpop__btn" onClick={() => chooseFloor(f)}>
                  {FLOOR_LABELS[f] ?? f}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showEnd && <EndScreen game={game} myId={myId} onLeave={leave} />}
    </div>
  );
}
