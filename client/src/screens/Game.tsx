import { useEffect, useRef, useState } from 'react';
import { getCard, shortcutDestForRoom, type Announcement } from 'shared';
import { useStore } from '../store';
import { Chat } from '../components/Chat';
import { Hand } from '../components/Hand';
import { Board, WALK_STEP_MS } from '../components/Board';
import { Dice } from '../components/Dice';
import { Wordmark } from '../components/Wordmark';
import { DetectiveNotes } from '../components/DetectiveNotes';
import { SelectModal, RevealPanel, NoEvidencePanel, EndScreen } from '../components/SuggestPanels';
import { StatusModal, AnnouncementModal, AccusationFlow, RevealModal, type StatusButton } from '../components/GamePopups';
import { playDiceRoll } from '../util/sound';
import { contrastInk } from '../render/colorUtils';
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
  const passSuggestion = useStore((s) => s.passSuggestion);
  const accuse = useStore((s) => s.accuse);
  const endTurn = useStore((s) => s.endTurn);
  const bootPlayer = useStore((s) => s.bootPlayer);
  const saveGame = useStore((s) => s.saveGame);
  const savedAt = useStore((s) => s.savedAt);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modal, setModal] = useState<null | 'suggest' | 'accuse'>(null);
  const [dock, setDock] = useState<null | 'map' | 'notes'>(null); // bottom dock: Manor Map / Detective Notes
  const [mapMounted, setMapMounted] = useState(false); // mount the (heavy) second board only once opened

  // --- pop-up overlays (status / announcement / reveal) ---
  const [statusOpen, setStatusOpen] = useState(false);
  const [elevatorReady, setElevatorReady] = useState(false); // gated until the piece reaches the lift
  const [annOpen, setAnnOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  // A captured accusation (so its two-step reveal survives later announcements overwriting the live one).
  const [accFlow, setAccFlow] = useState<{
    ann: Announcement;
    envelope?: { suspectId: string; weaponId: string; roomId: string };
    ended: boolean;
    winnerName?: string;
  } | null>(null);
  const accSeqRef = useRef(0);
  const annSeqRef = useRef(0);
  const revealKeyRef = useRef('');
  const statusSigRef = useRef('');
  const rollSeqRef = useRef(0);

  // Null-safe values the effects depend on (computed before the early return so hook order is stable).
  const myTurnNow = !!game && game.turnOrder[game.activeIdx] === myId;
  const meNow = game?.players.find((p) => p.id === myId);
  const sgNow = game?.currentSuggestion;
  const suggestionPendingNow = !!sgNow && !sgNow.resolved;
  const iMustRevealNow = suggestionPendingNow && sgNow!.pendingResponderId === myId;

  // New suggestion -> announce it to everyone (and clear any prior reveal pop-up). A fresh
  // suggestion also retires a lingering accusation verdict, so a new pop-up always replaces the old
  // one — important for observers, who never click "Dismiss".
  useEffect(() => {
    const a = game?.announcement;
    if (a && a.kind === 'suggestion' && a.seq !== annSeqRef.current) {
      annSeqRef.current = a.seq;
      setRevealOpen(false);
      setAccFlow((prev) => (prev && prev.ann.seq < a.seq ? null : prev));
      if (game?.phase === 'play') setAnnOpen(true);
    }
  }, [game?.announcement?.seq, game?.phase]);

  // New accusation -> capture it for the two-step reveal (so it survives later announcements).
  useEffect(() => {
    const a = game?.announcement;
    if (a && a.kind === 'accusation' && a.seq !== accSeqRef.current) {
      accSeqRef.current = a.seq;
      setAnnOpen(false);
      setRevealOpen(false);
      setAccFlow({
        ann: a,
        envelope: game?.envelope,
        ended: game?.phase === 'ended',
        winnerName: game?.players.find((p) => p.id === game?.winnerId)?.name,
      });
    }
  }, [game?.announcement?.seq, game?.phase, game?.envelope, game?.winnerId, game?.players]);

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

  // Play the dice sound on every roll (mine or a bot's). rollSeq bumps even when values repeat.
  useEffect(() => {
    const rs = game?.rollSeq ?? 0;
    if (rs > rollSeqRef.current) playDiceRoll();
    rollSeqRef.current = rs;
  }, [game?.rollSeq]);

  // Pop up the big status window whenever my actionable status changes (roll, room entry, etc.).
  useEffect(() => {
    if (!game || game.phase !== 'play' || !myTurnNow || suggestionPendingNow) {
      statusSigRef.current = '';
      setStatusOpen(false);
      return;
    }
    const sig = `${game.turnPhase}|${game.lastRoll?.join('-') ?? ''}|${meNow?.inRoomId ?? ''}`;
    if (sig === statusSigRef.current) return;
    statusSigRef.current = sig;
    // If my token just walked a path, wait for it to finish entering before popping the menu so the
    // suspect/accuse/end-turn options don't appear while the piece is still mid-move.
    const mv = game.lastMove;
    const tilesToWalk = mv && mv.playerId === myId ? mv.path.length - 1 : 0;
    if (tilesToWalk <= 0) {
      setStatusOpen(true);
      return;
    }
    setStatusOpen(false);
    const t = setTimeout(() => setStatusOpen(true), tilesToWalk * WALK_STEP_MS + 80);
    return () => clearTimeout(t);
    // lastMove is intentionally omitted: it changes in lock-step with turnPhase/inRoomId (which are
    // listed), and including the fresh object each tick would cancel the pending timeout.
  }, [game?.turnPhase, game?.lastRoll?.[0], game?.lastRoll?.[1], meNow?.inRoomId, myTurnNow, suggestionPendingNow, game?.phase, myId]);

  // Hold the elevator floor-chooser until my piece has finished walking into the lift.
  useEffect(() => {
    if (!game || game.turnPhase !== 'awaitElevator' || !myTurnNow) {
      setElevatorReady(false);
      return;
    }
    const mv = game.lastMove;
    const tilesToWalk = mv && mv.playerId === myId ? mv.path.length - 1 : 0;
    if (tilesToWalk <= 0) {
      setElevatorReady(true);
      return;
    }
    setElevatorReady(false);
    const t = setTimeout(() => setElevatorReady(true), tilesToWalk * WALK_STEP_MS + 80);
    return () => clearTimeout(t);
  }, [game?.turnPhase, myTurnNow, myId, game?.lastMove]);

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

  const observer = !!game.observer; // watching only — no piece, hand, notes, or private reveals
  // Host id comes straight from the room, so an observing host (not among the players) keeps controls.
  const iAmHost = game.hostId ? game.hostId === myId : (game.players.find((p) => p.id === myId)?.isHost ?? false);
  const sug = game.currentSuggestion;
  const suggestionPending = !!sug && !sug.resolved;
  // The human the table is currently waiting on, if they've dropped: the pending disprover during a
  // suggestion, otherwise the active player. Their seat isn't auto-botted — the game just waits.
  const blockingPlayer = (() => {
    const id = suggestionPending ? sug?.pendingResponderId : activeId;
    const p = id ? game.players.find((pl) => pl.id === id) : undefined;
    return p && !p.isBot && !p.connected ? p : null;
  })();
  const iAmResponder = suggestionPending && sug!.pendingResponderId === myId;
  // The suggested cards I actually hold (if any). With none, I acknowledge "Reveal nothing".
  const myMatches = sug ? [sug.suspectId, sug.weaponId, sug.roomId].filter((c) => game.yourHand.includes(c)) : [];
  const iMustReveal = iAmResponder && myMatches.length > 0;
  const iMustPass = iAmResponder && myMatches.length === 0;
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

  // Only one overlay shows at a time, by priority. The accusation reveal trumps everything,
  // and the end screen waits until that reveal has been dismissed.
  const showAccFlow = !!accFlow;
  const showEnd = game.phase === 'ended' && !showAccFlow;
  const showDisprove = iMustReveal && !!sug && !showAccFlow;
  const showNoEvidence = iMustPass && !!sug && !showAccFlow;
  const showReveal = revealOpen && !showAccFlow && !showDisprove && !showNoEvidence && !showEnd && !modal;
  const showAnn = annOpen && !!game.announcement && !showAccFlow && !showReveal && !showDisprove && !showNoEvidence && !showEnd && !modal;
  const showStatus =
    statusOpen && !!statusDesc && !showAccFlow && !showAnn && !showReveal && !showDisprove && !showNoEvidence && !showEnd && !modal && !iAmResponder;

  return (
    <div className="game">
      <header className="game__top">
        <div className="game__title">
          <Wordmark size="sm" /> <span className="game__code">Room {game.code}</span>
          {observer && <span className="game__obsbadge">👁 Observer</span>}
        </div>
        <div
          className="game__turn"
          style={{ background: suspectColor(activePlayer?.suspectId), color: contrastInk(suspectColor(activePlayer?.suspectId)) }}
        >
          {turnLabel}
        </div>
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
            myId={myId}
            activeId={activeId}
          />
        </div>

        <aside className="game__chat">
          <Chat
            messages={chat}
            onSend={sendChat}
            players={game.players.map((p) => ({ name: p.name, color: suspectColor(p.suspectId) }))}
          />
        </aside>
      </div>

      <div className="game__bottom">
        {observer ? (
          <div className="game__observing">👁 Observer Mode — watching the game. You hold no cards and make no moves.</div>
        ) : (
          <div className="game__handwrap">
            <div className="game__handlabel">Your hand · {me?.handCount ?? game.yourHand.length} cards</div>
            <Hand cardIds={game.yourHand} />
          </div>
        )}
      </div>

      {/* Bottom dock — Manor Map + Detective Notes folders. Only one opens at a time; the open one
          slides up over everything (above every pop-up), and the tabs stay reachable at the bottom. */}
      <div className={`dock__panel${dock === 'map' ? ' dock__panel--open' : ''}`} aria-hidden={dock !== 'map'}>
        <div className="dock__folder">
          {mapMounted && (
            <Board
              players={orderedPlayers}
              weaponLocations={game.weaponLocations}
              lastMove={game.lastMove}
              canMove={false}
              keyboardZoom={false}
            />
          )}
        </div>
      </div>
      {!observer && (
        <div className={`dock__panel${dock === 'notes' ? ' dock__panel--open' : ''}`} aria-hidden={dock !== 'notes'}>
          <div className="dock__folder dock__folder--notes">
            <DetectiveNotes roomCode={game.code} players={orderedPlayers} selfId={myId} hand={game.yourHand} onClose={() => setDock(null)} />
          </div>
        </div>
      )}
      <div className="dock__tabs">
        <button
          className={`dock__tab${dock === 'map' ? ' dock__tab--active' : ''}`}
          onClick={() => {
            setMapMounted(true);
            setDock((d) => (d === 'map' ? null : 'map'));
          }}
        >
          🗺️ Manor Map
        </button>
        {!observer && (
          <button
            className={`dock__tab${dock === 'notes' ? ' dock__tab--active' : ''}`}
            onClick={() => setDock((d) => (d === 'notes' ? null : 'notes'))}
          >
            📓 Detective Notes
          </button>
        )}
      </div>

      {modal && me && (
        <SelectModal
          mode={modal}
          fixedRoomId={modal === 'suggest' ? me.inRoomId : undefined}
          onCancel={() => setModal(null)}
          onSubmit={(s, w, r) => {
            if (modal === 'suggest') suggest(s, w);
            else accuse(s, w, r);
            setModal(null);
          }}
        />
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

      {accFlow && (
        <AccusationFlow
          key={accFlow.ann.seq}
          announcement={accFlow.ann}
          envelope={accFlow.envelope}
          ended={accFlow.ended}
          winnerName={accFlow.winnerName}
          onContinue={() => setAccFlow(null)}
          onEndGame={() => setAccFlow(null)}
        />
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

      {showNoEvidence && sug && (
        <NoEvidencePanel trio={[sug.suspectId, sug.weaponId, sug.roomId]} onPass={() => passSuggestion()} />
      )}

      {myTurn && game.turnPhase === 'awaitElevator' && game.elevatorFloors && elevatorReady && (
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

      {/* The table waits indefinitely for a dropped human; the host can replace them with a bot. */}
      {blockingPlayer && (
        <div className="game__waiting">
          <span>⏳ Waiting for {blockingPlayer.name} to reconnect…</span>
          {iAmHost && (
            <button className="btn game__waitingboot" onClick={() => bootPlayer(blockingPlayer.id)}>
              Replace with bot
            </button>
          )}
        </div>
      )}

      {/* Settings wheel (lower-left): the host can replace any human seat with a bot. */}
      <button
        className="game__gear"
        title="Settings"
        aria-label="Settings"
        onClick={() => setSettingsOpen((o) => !o)}
      >
        ⚙
      </button>
      {settingsOpen && (
        <>
          <div className="game__settingsback" onClick={() => setSettingsOpen(false)} />
          <div className="game__settings">
            <div className="game__settingshead">Players</div>
            {orderedPlayers.map((p) => {
              const status = p.isBot ? 'Bot' : p.isHost ? 'Host' : p.connected ? 'Online' : 'Disconnected';
              const off = !p.isBot && !p.connected;
              return (
                <div className="game__setrow" key={p.id}>
                  <span className="game__setsw" style={{ background: suspectColor(p.suspectId) }} />
                  <span className="game__setname">
                    {p.name}
                    {p.id === myId ? ' (you)' : ''}
                  </span>
                  <span className={`game__setstatus${off ? ' game__setstatus--off' : ''}`}>{status}</span>
                  {iAmHost && !p.isBot && !p.isHost && (
                    <button className="game__setboot" onClick={() => bootPlayer(p.id)}>
                      Replace with bot
                    </button>
                  )}
                </div>
              );
            })}
            {!iAmHost && <div className="game__setnote">Only the host can replace players.</div>}

            <div className="game__settinghead2">Save</div>
            <button className="btn game__savebtn" onClick={saveGame}>
              💾 Save game
            </button>
            <div className="game__setnote">
              {savedAt
                ? `Saved to this browser at ${new Date(savedAt).toLocaleTimeString()}. It also auto-saves every round.`
                : 'Stored in this browser; auto-saves after every full round. Load it from the title screen.'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
