import { useEffect, useState } from 'react';
import {
  getCard,
  MIN_PLAYERS,
  PRIVATE_MIN_PLAYERS,
  PRIVATE_MAX_PLAYERS,
  PUBLIC_MIN_PLAYERS,
  PUBLIC_MAX_PLAYERS,
  DEFAULT_BOT_DIFFICULTY,
  DEFAULT_BOT_SPEED,
  MIN_SUSPECTS,
  MAX_SUSPECTS,
  MIN_WEAPONS,
  MAX_WEAPONS,
} from 'shared';
import { DifficultyPicker, SpeedPicker } from '../components/DifficultyPicker';
import { WingsPicker, CountPicker } from '../components/HousePicker';
import { useStore } from '../store';
import { Chat } from '../components/Chat';
import { SuspectPicker } from '../components/SuspectPicker';
import { SuspectThumb } from '../components/SuspectThumb';
import './Lobby.css';

// One lobby for both kinds of table. Every seat is a computer until a human takes it, the host
// picks how many seats there are (8..40 public, 2..40 private) and how many suspects and weapons
// are in the deck, and the frame is the same either way — header, settings strip, a dense grid of
// slim seat rows (thumbnail, name, character), chat column, footer. Only the bits that genuinely
// differ change: the public table shows a countdown clock and starts itself; a private room shows
// its code and share link, and the host presses Start.

function suspectColor(suspectId?: string): string {
  if (!suspectId) return '#555';
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? c.color : '#555';
}

function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Share a direct join link (?join=CODE) via the native share sheet — Messages, WhatsApp, etc. —
 *  falling back to the SMS composer where Web Share isn't available. */
async function sendInvite(code: string): Promise<void> {
  const url = `${window.location.origin}${window.location.pathname}?join=${code}`;
  const msg = `Join my Ultra Clue game — room ${code}!`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Ultra Clue', text: msg, url });
    } catch {
      /* the user dismissed the share sheet */
    }
    return;
  }
  window.location.href = `sms:?&body=${encodeURIComponent(`${msg} ${url}`)}`;
}

export function Lobby() {
  const lobby = useStore((s) => s.lobby);
  const myId = useStore((s) => s.myId);
  const chat = useStore((s) => s.chat);
  const error = useStore((s) => s.error);
  const serverOffset = useStore((s) => s.serverOffset);
  const pickSuspect = useStore((s) => s.pickSuspect);
  const setObserver = useStore((s) => s.setObserver);
  const sendChat = useStore((s) => s.sendChat);
  const startGame = useStore((s) => s.startGame);
  const setRoomSettings = useStore((s) => s.setRoomSettings);
  const setBotDifficulty = useStore((s) => s.setBotDifficulty);
  const leave = useStore((s) => s.leave);

  const [picking, setPicking] = useState(false);
  // The public clock ticks twice a second; harmless (and unused) in a private room.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  if (!lobby) return null;

  const isPublic = !!lobby.isPublic;
  const amHost = lobby.hostId === myId;
  const host = lobby.slots.find((s) => s.occupant?.id === lobby.hostId)?.occupant;
  const mySlot = lobby.slots.find((s) => s.occupant?.id === myId);
  const mySuspectId = mySlot?.occupant?.suspectId;
  const amObserver = !!mySlot?.occupant?.observer;
  const total = lobby.settings?.totalPlayers ?? lobby.slots.length;
  const humans = lobby.slots.filter((s) => s.occupant && !s.occupant.isBot && !s.occupant.observer).length;
  const watchers = lobby.slots.filter((s) => s.occupant?.observer).length;
  const cpus = lobby.slots.filter((s) => s.occupant?.isBot).length;
  const canStart = amHost && humans + cpus >= MIN_PLAYERS;
  const botDifficulty = lobby.settings?.botDifficulty ?? DEFAULT_BOT_DIFFICULTY;
  const botSpeed = lobby.settings?.botSpeed ?? DEFAULT_BOT_SPEED;
  const wingsOff = lobby.settings?.wingsOff ?? [];
  const weaponCount = lobby.settings?.weaponCount ?? MAX_WEAPONS;
  // Every seated character is in the deck, so the suspect count can't go below the seats.
  const suspectCount = Math.max(lobby.settings?.suspectCount ?? MAX_SUSPECTS, total);
  // The server's clock drives a public start; correct for our own clock's skew so everyone agrees.
  const remaining = Math.max(0, (lobby.startsAt ?? now) - (now + serverOffset));
  const soon = remaining < 60_000;

  // Only other humans' characters are off-limits; a computer's character can be swapped for yours.
  const takenByOthers = new Set(
    lobby.slots
      .filter((s) => s.occupant && !s.occupant.isBot && s.occupant.id !== myId && s.occupant.suspectId)
      .map((s) => s.occupant!.suspectId as string),
  );
  const heldByComputers = new Set(
    lobby.slots.filter((s) => s.occupant?.isBot && s.occupant.suspectId).map((s) => s.occupant!.suspectId as string),
  );

  const hint = isPublic
    ? 'Every seat is a computer until a human takes it. When the clock runs out the game begins with whoever is here.'
    : amHost
      ? 'Every seat is a computer until a friend takes it. Send them the code, set up the game, and press Start when ready.'
      : 'Waiting for the host to start the game.';
  const hostNote = amHost
    ? 'You are the host — you set the seats, the computers, which wings of the house are open, and how many characters and weapons are in play.'
    : host
      ? `${host.name} is the host and sets the seats, the computers, the wings in play and the character and weapon counts.`
      : 'The first human to join becomes the host.';

  return (
    <div className={`lobby${isPublic ? ' plobby' : ''}`}>
      <header className="lobby__head">
        <div>
          <h1>{isPublic ? 'Public Lobby' : 'Game Lobby'}</h1>
          <p className="lobby__hint">{hint}</p>
        </div>
        {isPublic ? (
          <div className={`plobby__clock${soon ? ' plobby__clock--soon' : ''}`}>
            <span>Game starts in</span>
            <strong>{fmtCountdown(remaining)}</strong>
          </div>
        ) : (
          <div className="lobby__codecol">
            <div className="lobby__code">
              <span>Room Code</span>
              <strong>{lobby.code}</strong>
            </div>
            <button className="lobby__sendlink" onClick={() => sendInvite(lobby.code)}>
              📲 Send link
            </button>
          </div>
        )}
      </header>

      <div className="plobby__settings">
        <label>
          Player slots
          <CountPicker
            value={total}
            min={isPublic ? PUBLIC_MIN_PLAYERS : PRIVATE_MIN_PLAYERS}
            max={isPublic ? PUBLIC_MAX_PLAYERS : PRIVATE_MAX_PLAYERS}
            readOnly={!amHost}
            onChange={(n) => setRoomSettings({ totalPlayers: n })}
            title="Seats at the table — each one a computer until a human takes it"
          />
        </label>
        <label>
          Characters
          <CountPicker
            value={suspectCount}
            min={Math.max(MIN_SUSPECTS, total)}
            max={MAX_SUSPECTS}
            readOnly={!amHost}
            onChange={(n) => setRoomSettings({ suspectCount: n })}
            title="How many of the 40 suspect cards are in the game (every seated character is always in)"
          />
        </label>
        <label>
          Weapons
          <CountPicker
            value={weaponCount}
            min={MIN_WEAPONS}
            max={MAX_WEAPONS}
            readOnly={!amHost}
            onChange={(n) => setRoomSettings({ weaponCount: n })}
            title="How many of the 40 weapon cards are in the game"
          />
        </label>
        <label>
          House
          <WingsPicker
            wingsOff={wingsOff}
            readOnly={!amHost}
            onChange={(off) => setRoomSettings({ wingsOff: off })}
            title="Which wings of the house are in play — a closed wing's rooms leave the board and the deck"
          />
        </label>
        <label>
          Computers
          <DifficultyPicker
            value={botDifficulty}
            readOnly={!amHost}
            onChange={(d) => setRoomSettings({ botDifficulty: d })}
            title="Difficulty for every computer seat (click a seat to change just that one)"
          />
        </label>
        <label>
          Speed
          <SpeedPicker value={botSpeed} readOnly={!amHost} onChange={(s) => setRoomSettings({ botSpeed: s })} title="How quickly every computer acts" />
        </label>
        <span className="plobby__hostnote">{hostNote}</span>
      </div>

      <div className="lobby__body">
        <div className="plobby__seats">
          {lobby.slots.map((slot) => {
            const occ = slot.occupant;
            if (!occ) return null;
            const isMe = occ.id === myId;
            const isHostSeat = occ.id === lobby.hostId;
            const character = occ.suspectId ? getCard(occ.suspectId)?.title : undefined;
            if (occ.observer) {
              return (
                <div className={`pseat pseat--human pseat--watcher${isMe ? ' pseat--me' : ''}`} key={slot.index} title={`${occ.name} is watching`}>
                  <div className="pseat__num">👁</div>
                  <div className="pseat__thumb pseat__thumb--eye">👁</div>
                  <div className="pseat__text">
                    <div className="pseat__name">{occ.name}</div>
                    <div className="pseat__sub">
                      Watching
                      {isMe && (
                        <>
                          {' · '}
                          <button className="pseat__link" onClick={() => setObserver(false)} title="Take a seat and play">
                            play instead
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="pseat__tags">
                    {isHostSeat && <span className="tag tag--host">HOST</span>}
                    {isMe && <span className="tag tag--you">YOU</span>}
                    {!occ.connected && <span className="tag tag--off">OFFLINE</span>}
                  </div>
                </div>
              );
            }
            // Your own seat is one big button: hover dims the whole tile under a SWAP CHARACTER?
            // banner, and a click anywhere on it opens the character picker.
            return (
              <div
                className={`pseat${occ.isBot ? '' : ' pseat--human'}${isMe ? ' pseat--me pseat--swap' : ''}`}
                key={slot.index}
                title={occ.isBot ? `Seat ${slot.index + 1}: computer` : isMe ? 'Click to swap your character' : `Seat ${slot.index + 1}: ${occ.name}`}
                role={isMe ? 'button' : undefined}
                tabIndex={isMe ? 0 : undefined}
                onClick={isMe ? () => setPicking(true) : undefined}
                onKeyDown={
                  isMe
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setPicking(true);
                        }
                      }
                    : undefined
                }
              >
                <div className="pseat__num">{slot.index + 1}</div>
                <SuspectThumb suspectId={occ.suspectId} />
                <div className="pseat__text">
                  <div className="pseat__name">{occ.isBot ? (character ?? occ.name) : occ.name}</div>
                  <div className="pseat__sub">
                    {occ.isBot ? 'Computer' : (character ?? 'choosing…')}
                    {isMe && (
                      <>
                        {' · '}
                        <button
                          className="pseat__link"
                          onClick={(e) => {
                            e.stopPropagation();
                            setObserver(true);
                          }}
                          title="Give the seat to a computer and just watch"
                        >
                          watch instead
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="pseat__tags">
                  {isHostSeat && <span className="tag tag--host">HOST</span>}
                  {isMe && <span className="tag tag--you">YOU</span>}
                  {!occ.isBot && !occ.connected && <span className="tag tag--off">OFFLINE</span>}
                  {occ.isBot && (
                    <DifficultyPicker
                      compact
                      readOnly={!amHost}
                      value={occ.difficulty ?? botDifficulty}
                      onChange={(d) => setBotDifficulty(slot.index, d)}
                      title="This computer's difficulty"
                    />
                  )}
                </div>
                {isMe && (
                  <div className="pseat__swap" aria-hidden="true">
                    SWAP CHARACTER?
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <aside className="lobby__chat">
          <Chat
            messages={chat}
            onSend={sendChat}
            players={lobby.slots
              .filter((s) => s.occupant)
              .map((s) => ({ name: s.occupant!.name, color: suspectColor(s.occupant!.suspectId) }))}
          />
        </aside>
      </div>

      {error && <p className="lobby__error">{error}</p>}

      <footer className="lobby__foot">
        <button className="btn btn--danger" onClick={leave}>
          Exit
        </button>
        <div className="lobby__footinfo">
          {humans} {humans === 1 ? 'human' : 'humans'} · {cpus} {cpus === 1 ? 'computer' : 'computers'} · {total} seats
          {watchers > 0 && ` · ${watchers} watching`}
        </div>
        {isPublic ? (
          <div className="plobby__footclock">Starts in {fmtCountdown(remaining)}</div>
        ) : (
          <button className="btn btn--primary" disabled={!canStart} onClick={startGame} title={amHost ? '' : 'Only the host can start'}>
            Start Game
          </button>
        )}
      </footer>

      {amObserver && (
        <p className="plobby__watchnote">
          {isPublic ? "You're watching this one. The game starts for you too when the clock runs out." : "You're watching this one — you'll see the game without being dealt in."}
        </p>
      )}

      {picking && (
        <SuspectPicker
          takenByOthers={takenByOthers}
          heldByComputers={heldByComputers}
          mySuspectId={mySuspectId}
          onPick={pickSuspect}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
