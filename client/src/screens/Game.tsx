import { useCallback, useEffect, useRef, useState } from 'react';
import { getCard, shortcutDestForRoom, boardFor, poolOf, PUBLIC_ROOM_CODE, DICE_ANIM_MS, TURN_FLASH_MS, TURN_GAP_MS, defaultDice, BOT_DIFFICULTY_LABEL, type Announcement } from 'shared';
import { useStore, savedDice } from '../store';
import { TurnOrder, PlayerRoster } from '../components/TurnOrder';
import { DiceOverlay, DICE_FADE_MS, type DiceRollShow } from '../components/DiceOverlay';
import { DiceSettings } from '../components/DiceSettings';
import { Chat } from '../components/Chat';
import { Hand } from '../components/Hand';
import { HandFan } from '../components/HandFan';
import { CardName, RoomName } from '../components/CardName';
import { Board, WALK_STEP_MS } from '../components/Board';
import { Dice } from '../components/Dice';
import { Wordmark } from '../components/Wordmark';
import { DetectiveNotes } from '../components/DetectiveNotes';
import { SelectModal, RevealPanel, NoEvidencePanel } from '../components/SuggestPanels';
import { EndScreen } from '../components/EndScreen';
import { StatusModal, AccusationFlow, AccusingModal, type StatusButton } from '../components/GamePopups';
import { soundEnabled, setSoundEnabled } from '../util/sound';
import { contrastInk } from '../render/colorUtils';
import { highlightChat } from '../util/highlightChat';
import './Game.css';

function suspectColor(suspectId?: string): string {
  if (!suspectId) return '#555';
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? c.color : '#555';
}

/** Public games: the seconds left for the human on the clock — shown only for the last 30s, red
 *  for the last 10. Everyone sees it, so the table knows a stalled turn is about to be passed. */
function TurnTimer({ deadline, serverOffset }: { deadline?: number; serverOffset: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  const remaining = Math.max(0, deadline - (now + serverOffset));
  if (remaining > 30_000) return null;
  const secs = Math.ceil(remaining / 1000);
  return (
    <div className={`pill pill--timer${secs <= 10 ? ' pill--timer-red' : ''}`} title="Time left to act">
      ⏱ {secs}s
    </div>
  );
}

/** Retires the resting dice once a pop-up window is showing — but not before they've landed.
 *  (A child component, so Game's own hook order stays fixed around its early return.) */
function DiceRetirer({ active, animUntil, onRetire }: { active: boolean; animUntil: number; onRetire: () => void }) {
  useEffect(() => {
    if (!active) return;
    const wait = animUntil - Date.now();
    if (wait <= 0) {
      onRetire();
      return;
    }
    const t = setTimeout(onRetire, wait);
    return () => clearTimeout(t);
  }, [active, animUntil, onRetire]);
  return null;
}

const CAMERA_LOCK_KEY = 'ultraclue-camlock';
/** 'on' = the old flat shelf of thumbnails instead of the fan of cards. Viewer-local. */
const HAND_SHELF_KEY = 'ultraclue-hand-shelf';
function readHandShelf(): boolean {
  try {
    return localStorage.getItem(HAND_SHELF_KEY) === 'on';
  } catch {
    return false;
  }
}
function readCameraLock(): boolean {
  try {
    return localStorage.getItem(CAMERA_LOCK_KEY) !== 'off';
  } catch {
    return true;
  }
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
  const setAccusing = useStore((s) => s.setAccusing);
  const endTurn = useStore((s) => s.endTurn);
  const bootPlayer = useStore((s) => s.bootPlayer);
  const saveGame = useStore((s) => s.saveGame);
  const savedAt = useStore((s) => s.savedAt);
  const serverOffset = useStore((s) => s.serverOffset);
  const setDice = useStore((s) => s.setDice);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [handShelf, setHandShelf] = useState(readHandShelf);
  // "Lock camera on player to move": off means the map never follows a move or recentres on a turn.
  const [cameraLock, setCameraLock] = useState(readCameraLock);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(soundEnabled);
  // The 3D dice for the latest roll; they rest on screen until a pop-up, the next roll, or a click.
  const [diceShow, setDiceShow] = useState<DiceRollShow | null>(null);
  const diceShowRef = useRef(diceShow);
  diceShowRef.current = diceShow;
  // True while dice left over from the previous turn are fading out.
  const [diceFading, setDiceFading] = useState(false);
  const animUntilRef = useRef(0);
  const retireDice = useCallback(() => setDiceShow(null), []);
  const [modal, setModal] = useState<null | 'suggest' | 'accuse'>(null);
  const [dock, setDock] = useState<null | 'map' | 'notes'>(null); // bottom dock: Manor Map / Detective Notes
  const [mapMounted, setMapMounted] = useState(false); // mount the (heavy) second board only once opened

  // --- pop-up overlays (status / announcement / reveal) ---
  const [statusOpen, setStatusOpen] = useState(false);
  const [elevatorReady, setElevatorReady] = useState(false); // gated until the piece reaches the lift

  // A captured accusation (so its two-step reveal survives later announcements overwriting the live one).
  const [accFlow, setAccFlow] = useState<{
    ann: Announcement;
    envelope?: { suspectId: string; weaponId: string; roomId: string };
    ended: boolean;
    winnerName?: string;
  } | null>(null);
  const accSeqRef = useRef(0);
  const annSeqRef = useRef(0);
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
      setAccFlow((prev) => (prev && prev.ann.seq < a.seq ? null : prev));
    }
  }, [game?.announcement?.seq, game?.phase]);

  // New accusation -> capture it for the two-step reveal (so it survives later announcements).
  useEffect(() => {
    const a = game?.announcement;
    if (a && a.kind === 'accusation' && a.seq !== accSeqRef.current) {
      accSeqRef.current = a.seq;
      if (a.byId !== myId) return; // everyone else sees the verdict as a card in the chat
      setAccFlow({
        ann: a,
        envelope: game?.envelope,
        ended: game?.phase === 'ended',
        winnerName: game?.players.find((p) => p.id === game?.winnerId)?.name,
      });
    }
  }, [game?.announcement?.seq, game?.phase, game?.envelope, game?.winnerId, game?.players]);

  // Floating notices — the "<name>'s turn" flash and each new event card's toast — share one spot
  // over the board. A new notice goes on top and pushes whatever is still showing down a row, so
  // two never overlap; each leaves on its own timer.
  // Every notice stays up for the same beat, whatever its kind, unless it is clicked away.
  type Notice = { id: string; kind: 'flash' | 'toast'; text: string; color?: string };
  const NOTICE_MS = 4200;
  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dismissNotice = useCallback((id: string) => {
    clearTimeout(noticeTimers.current.get(id));
    noticeTimers.current.delete(id);
    setNotices((cur) => cur.filter((x) => x.id !== id));
  }, []);
  const pushNotice = useCallback((n: Notice, ttl: number) => {
    setNotices((cur) => [n, ...cur.filter((x) => x.id !== n.id)].slice(0, 4));
    const timers = noticeTimers.current;
    clearTimeout(timers.get(n.id));
    timers.set(
      n.id,
      setTimeout(() => {
        timers.delete(n.id);
        setNotices((cur) => cur.filter((x) => x.id !== n.id));
      }, ttl),
    );
  }, []);
  useEffect(() => {
    const timers = noticeTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // Announce each new event card (a suggestion, reveal or accusation) as a toast.
  const lastCardIdRef = useRef(0);
  useEffect(() => {
    const last = [...chat].reverse().find((m) => m.card && m.card.kind !== 'roll' && m.card.kind !== 'turn');
    if (!last || last.id <= lastCardIdRef.current) return;
    const first = lastCardIdRef.current === 0;
    lastCardIdRef.current = last.id;
    if (first) return; // don't toast the backlog on (re)join
    pushNotice({ id: `toast:${last.id}`, kind: 'toast', text: last.text }, NOTICE_MS);
  }, [chat, pushNotice]);

  // Every roll (mine or a bot's) throws the 3D dice in the roller's colours. rollSeq bumps even
  // when the values repeat. The overlay plays the sound itself.
  // Each new turn flashes "<name>'s turn" in the character's colours for a beat before anything else
  // happens; a roll that opens the turn waits for that beat, so a reveal or a move never runs
  // straight into the next player's dice.
  const turnKey = game ? `${game.round ?? 0}:${game.activeIdx}` : '';
  const turnKeyRef = useRef(turnKey);
  /** When the current turn's flash shows (or showed): a turn is announced TURN_GAP_MS after it begins. */
  const flashAtRef = useRef(0);
  /** The player the top notch names — it follows the real turn after the same gap. */
  const [notchActiveId, setNotchActiveId] = useState<string | undefined>(undefined);
  // On arrival (or a reload) the notch shows whoever is up right now — there is no previous turn to
  // give a beat to; from then on it lags each new turn by the gap.
  useEffect(() => {
    if (game && notchActiveId === undefined) setNotchActiveId(game.turnOrder[game.activeIdx]);
  }, [game, notchActiveId]);
  useEffect(() => {
    if (!game || game.phase !== 'play' || turnKey === turnKeyRef.current) return;
    turnKeyRef.current = turnKey;
    const gap = TURN_GAP_MS;
    flashAtRef.current = Date.now() + gap;
    // Dice still resting from the previous turn fade out as this one begins — and are gone before
    // this turn's own roll (which waits out the flash) lands.
    let fadeT: ReturnType<typeof setTimeout> | undefined;
    const resting = diceShowRef.current;
    if (resting) {
      const seq = resting.seq;
      setDiceFading(true);
      fadeT = setTimeout(() => {
        setDiceShow((cur) => (cur && cur.seq === seq ? null : cur));
        setDiceFading(false);
      }, DICE_FADE_MS);
    }
    const active = game.players.find((p) => p.id === game.turnOrder[game.activeIdx]);
    if (!active) return () => clearTimeout(fadeT);
    // The previous turn's last pill keeps the spotlight for the gap; then this turn is announced.
    const flashT = setTimeout(() => {
      setNotchActiveId(active.id);
      pushNotice(
        { id: `flash:${turnKey}`, kind: 'flash', text: active.id === myId ? 'Your turn' : `${active.name}'s turn`, color: suspectColor(active.suspectId) },
        NOTICE_MS,
      );
    }, gap);
    return () => {
      clearTimeout(fadeT);
      clearTimeout(flashT);
    };
  }, [turnKey, game?.phase, pushNotice]);

  useEffect(() => {
    const rs = game?.rollSeq ?? 0;
    if (rs > rollSeqRef.current && game?.lastRoll) {
      const roller = game.players.find((p) => p.id === game.turnOrder[game.activeIdx]);
      const style = roller?.dice ?? defaultDice(roller?.suspectId);
      // A roll that arrived together with the turn flash waits for the gap and the flash; a mid-turn
      // roll shows at once.
      const wait = rollSeqRef.current > 0 ? Math.max(0, flashAtRef.current + TURN_FLASH_MS - Date.now()) : 0;
      animUntilRef.current = Date.now() + wait + DICE_ANIM_MS;
      const show = { seq: rs, values: game.lastRoll, color: style.color, pips: style.pips, name: roller?.name ?? 'Someone' };
      rollSeqRef.current = rs;
      const land = () => {
        setDiceFading(false);
        setDiceShow(show);
      };
      if (!wait) {
        land();
        return;
      }
      const t = setTimeout(land, wait);
      return () => clearTimeout(t);
    }
    rollSeqRef.current = rs;
  }, [game?.rollSeq]);

  // Any click clears the resting dice (the overlay itself never catches clicks).
  useEffect(() => {
    if (!diceShow) return;
    const clear = () => setDiceShow(null);
    window.addEventListener('pointerdown', clear, true);
    return () => window.removeEventListener('pointerdown', clear, true);
  }, [diceShow]);

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
    // Likewise, if my dice are still tumbling, let them land before the "You rolled N" window.
    const diceWait = Math.max(0, animUntilRef.current - Date.now());
    // And a turn that opens in a room (no dice) still waits for its own announcement.
    const gapWait = Math.max(0, flashAtRef.current - Date.now());
    if (tilesToWalk <= 0 && diceWait <= 0 && gapWait <= 0) {
      setStatusOpen(true);
      return;
    }
    setStatusOpen(false);
    const t = setTimeout(() => setStatusOpen(true), Math.max(tilesToWalk * WALK_STEP_MS + 80, diceWait, gapWait));
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
  // The notch lags the real turn by TURN_GAP_MS (see the flash effect); before it has caught up
  // once it simply shows the live player.
  const notchPlayer = game.players.find((p) => p.id === notchActiveId) ?? activePlayer;
  const turnLabel = notchPlayer?.id === myId ? 'Your turn' : `${notchPlayer?.name ?? '—'}'s turn`;
  const orderedPlayers = game.turnOrder
    .map((id) => game.players.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  /** Everyone at the table with their character's colour, so names can be tinted in chat and pills. */
  const chatPlayers = game.players.map((p) => ({ id: p.id, name: p.name, color: suspectColor(p.suspectId), suspectId: p.suspectId, dice: p.dice }));

  // The board this game is played on (the house minus any wings the host closed) and the cards in
  // it. boardFor() hands back one shared object per wing combination, so this is cheap to redo.
  const board = boardFor(game.wingsOff ?? []);
  const pool = poolOf(game);

  const myRoom = me?.inRoomId ? getCard(me.inRoomId)?.title : null;
  const myShortcutDest = me?.inRoomId ? shortcutDestForRoom(me.inRoomId, board) : undefined;
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
        buttons.push({
          label: (
            <>
              Take Shortcut to <RoomName title={myShortcutName ?? '?'} />
            </>
          ),
          icon: '🕳️',
          onClick: () => (setStatusOpen(false), takeShortcut()),
        });
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
    buttons.push({ label: 'Accuse', icon: '🗡️', onClick: () => (setStatusOpen(false), setAccusing(true), setModal('accuse')) });
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
  const showStatus =
    statusOpen && !!statusDesc && !showAccFlow && !showDisprove && !showNoEvidence && !showEnd && !modal && !iAmResponder;
  // Someone else is composing an accusation — warn this player (not the accuser).
  const accuser = game.accusingId && game.accusingId !== myId ? game.players.find((p) => p.id === game.accusingId) : undefined;
  const showAccusing = !!accuser && !showAccFlow && !showEnd;
  // A pop-up window opening retires the resting dice (once they've actually landed).
  const anyPopup = showAccFlow || showEnd || showDisprove || showNoEvidence || showStatus || showAccusing || !!modal;

  // The hand fan (default) or the classic shelf; the fan needs the folder tabs moved out of its way.
  const fan = !observer && !handShelf;

  return (
    <div className={`game${fan ? ' game--fan' : ''}`}>
      <header className="game__top">
        <div className="game__title">
          <Wordmark size="sm" /> <span className="game__code">{game.code === PUBLIC_ROOM_CODE ? 'Public Game' : `Room ${game.code}`}</span>
          {observer && <span className="game__obsbadge">👁 Observer</span>}
        </div>
        <div
          className="game__turn"
          style={{ background: suspectColor(notchPlayer?.suspectId), color: contrastInk(suspectColor(notchPlayer?.suspectId)) }}
        >
          {turnLabel}
        </div>
        <TurnTimer deadline={game.turnDeadline} serverOffset={serverOffset} />
        <button className="btn btn--danger" onClick={leave}>
          Leave
        </button>
      </header>

      <div className="game__main">
        <div className="game__board">
          <TurnOrder players={orderedPlayers} activeId={activeId} myId={myId} onOpenRoster={() => setRosterOpen(true)} />

          <div className="game__controls">
            {game.lastRoll && !suggestionPending && <Dice values={game.lastRoll} />}
            {revealedCard && (
              <div className="game__revealed" title="A card was revealed only to you">
                <span className="game__revealedlbl">Shown to you:</span>
                <span className="game__revealedname">
                  <CardName card={revealedCard} />
                </span>
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
                  <span>
                    You are in the <RoomName title={myRoom ?? ''} />. Roll to leave, or skip to stay.
                  </span>
                ) : game.turnPhase === 'awaitMove' ? (
                  <span>Click a highlighted square to move.</span>
                ) : me?.inRoomId ? (
                  <span>
                    You're in the <RoomName title={myRoom ?? ''} />. Suggest, accuse, or end your turn.
                  </span>
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
                      <button className="btn" onClick={takeShortcut}>
                        🕳️ Take Shortcut to <RoomName title={myShortcutName ?? '?'} />
                      </button>
                    )}
                    <button className="btn" onClick={skipMove}>Skip movement</button>
                  </>
                )}
                {game.turnPhase === 'postMove' && (
                  <>
                    {me?.inRoomId && (
                      <button className="btn btn--primary" onClick={() => setModal('suggest')}>Suggest</button>
                    )}
                    <button className="btn" onClick={() => (setAccusing(true), setModal('accuse'))}>Accuse</button>
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
            cameraLock={cameraLock}
            weaponLocations={game.weaponLocations}
            canMove={myTurn && game.turnPhase === 'awaitMove' && !suggestionPending}
            onMoveTo={moveTo}
            myId={myId}
            activeId={activeId}
            round={game.round ?? 0}
            board={board}
          />
        </div>

        <aside className="game__chat">
          <Chat messages={chat} onSend={sendChat} players={chatPlayers} />
        </aside>
      </div>

      <div className={`game__bottom${fan ? ' game__bottom--fan' : ''}`}>
        {observer ? (
          <div className="game__observing">👁 Observer Mode — watching the game. You hold no cards and make no moves.</div>
        ) : fan ? (
          <HandFan cardIds={game.yourHand} />
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
              cameraLock={cameraLock}
              canMove={false}
              keyboardZoom={false}
              round={game.round ?? 0}
              board={board}
            />
          )}
        </div>
      </div>
      {!observer && (
        <div className={`dock__panel${dock === 'notes' ? ' dock__panel--open' : ''}`} aria-hidden={dock !== 'notes'}>
          <div className="dock__folder dock__folder--notes">
            <DetectiveNotes roomCode={game.code} players={orderedPlayers} selfId={myId} hand={game.yourHand} weapons={pool.weapons} rooms={pool.rooms} onClose={() => setDock(null)} />
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
          <span className="dock__tabicon">🗺️</span> <span className="dock__tablabel">Manor Map</span>
        </button>
        {!observer && (
          <button
            className={`dock__tab${dock === 'notes' ? ' dock__tab--active' : ''}`}
            onClick={() => setDock((d) => (d === 'notes' ? null : 'notes'))}
          >
            <span className="dock__tabicon">📓</span> <span className="dock__tablabel">Detective Notes</span>
          </button>
        )}
      </div>

      {modal && me && (
        <SelectModal
          mode={modal}
          fixedRoomId={modal === 'suggest' ? me.inRoomId : undefined}
          weapons={pool.weapons}
          rooms={pool.rooms}
          onCancel={() => {
            if (modal === 'accuse') setAccusing(false); // withdrew — clear the table's warning
            setModal(null);
          }}
          onSubmit={(s, w, r) => {
            if (modal === 'suggest') suggest(s, w);
            else {
              accuse(s, w, r);
              setAccusing(false);
            }
            setModal(null);
          }}
        />
      )}

      <div className="notices" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className="notices__slot">
            <div
              className={`pill pill--stacked pill--${n.kind}`}
              style={n.color ? { background: n.color, color: contrastInk(n.color), borderColor: contrastInk(n.color) } : undefined}
              title="Click to dismiss"
              onClick={() => dismissNotice(n.id)}
            >
              {/* The turn flash is already painted in the character's colour, so it is left plain;
                  event toasts get every name tinted the way the chat log tints them. */}
              {n.kind === 'toast' ? highlightChat(n.text, chatPlayers) : n.text}
            </div>
          </div>
        ))}
      </div>
      <DiceOverlay roll={diceShow} fading={diceFading} />
      <DiceRetirer active={anyPopup && !!diceShow} animUntil={animUntilRef.current} onRetire={retireDice} />

      {rosterOpen && (
        <PlayerRoster players={orderedPlayers} activeId={activeId} myId={myId} hostId={game.hostId} onClose={() => setRosterOpen(false)} />
      )}

      {showStatus && statusDesc && (
        <StatusModal
          dice={statusDesc.dice}
          lines={statusDesc.lines}
          buttons={statusDesc.buttons}
          onClose={() => setStatusOpen(false)}
        />
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

      {showAccusing && accuser && <AccusingModal name={accuser.name} />}


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

      {showEnd && <EndScreen game={game} myId={myId} serverOffset={serverOffset} onLeave={leave} />}

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
              const status = p.isBot ? `Bot · ${BOT_DIFFICULTY_LABEL[p.difficulty ?? 'medium']}` : p.isHost ? 'Host' : p.connected ? 'Online' : 'Disconnected';
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

            <DiceSettings current={me?.dice ?? savedDice() ?? defaultDice(me?.suspectId)} onChange={setDice} />

            <div className="game__settinghead2">Camera</div>
            <label className="game__settoggle">
              <input
                type="checkbox"
                checked={cameraLock}
                onChange={(e) => {
                  setCameraLock(e.target.checked);
                  try {
                    localStorage.setItem(CAMERA_LOCK_KEY, e.target.checked ? 'on' : 'off');
                  } catch {
                    /* ignore */
                  }
                }}
              />
              Lock camera on player to move
            </label>

            <div className="game__settinghead2">Hand</div>
            <label className="game__settoggle">
              <input
                type="checkbox"
                checked={handShelf}
                onChange={(e) => {
                  setHandShelf(e.target.checked);
                  try {
                    localStorage.setItem(HAND_SHELF_KEY, e.target.checked ? 'on' : 'off');
                  } catch {
                    /* ignore */
                  }
                }}
              />
              Classic shelf (a row of small thumbnails instead of the fan)
            </label>

            <div className="game__settinghead2">Sound</div>
            <label className="game__settoggle">
              <input
                type="checkbox"
                checked={soundOn}
                onChange={(e) => {
                  setSoundEnabled(e.target.checked);
                  setSoundOn(e.target.checked);
                }}
              />
              Dice and card sounds
            </label>

            <div className="game__settinghead2">Save</div>
            <button className="btn game__savebtn" onClick={saveGame}>
              💾 Save game
            </button>
            <div className="game__setnote">
              {savedAt
                ? `Saved to this browser at ${new Date(savedAt).toLocaleTimeString()}.`
                : 'Stored in this browser. Load it from the title screen.'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
