import { useEffect, useState } from 'react';
import {
  getCard,
  MIN_PLAYERS,
  PUBLIC_MIN_PLAYERS,
  PUBLIC_MAX_PLAYERS,
  DEFAULT_BOT_DIFFICULTY,
  DEFAULT_BOT_SPEED,
  MAX_WEAPONS,
  type Slot,
  type SlotStatus,
} from 'shared';
import { DifficultyPicker, SpeedPicker } from '../components/DifficultyPicker';
import { WingsPicker, WeaponCountPicker } from '../components/HousePicker';
import { useStore } from '../store';
import { Chat } from '../components/Chat';
import { SuspectPicker } from '../components/SuspectPicker';
import { SuspectThumb } from '../components/SuspectThumb';
import './Lobby.css';

// One lobby for both kinds of table. The frame is the same either way — header, settings strip, a
// dense grid of slim seat rows (thumbnail, name, character), chat column, footer — and only the
// bits that genuinely differ change:
//   public   a countdown clock (the game starts itself), a table-size setting, every seat filled by
//            a computer until a human takes it;
//   private  the room code and share link, eight seats the host opens, closes or gives to a
//            computer, and a Start button.

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

const TABLE_SIZES = Array.from({ length: PUBLIC_MAX_PLAYERS - PUBLIC_MIN_PLAYERS + 1 }, (_, i) => PUBLIC_MIN_PLAYERS + i);
const SEAT_STATES: { status: SlotStatus; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'closed', label: 'Closed' },
  { status: 'bot', label: 'Bot' },
];

export function Lobby() {
  const lobby = useStore((s) => s.lobby);
  const myId = useStore((s) => s.myId);
  const chat = useStore((s) => s.chat);
  const error = useStore((s) => s.error);
  const serverOffset = useStore((s) => s.serverOffset);
  const setSlot = useStore((s) => s.setSlot);
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
  // Observers watch but aren't dealt in, so only the rest count toward the minimum to start.
  const playerCount = humans + cpus;
  const canStart = amHost && playerCount >= MIN_PLAYERS;
  const botDifficulty = lobby.settings?.botDifficulty ?? DEFAULT_BOT_DIFFICULTY;
  const botSpeed = lobby.settings?.botSpeed ?? DEFAULT_BOT_SPEED;
  const wingsOff = lobby.settings?.wingsOff ?? [];
  const weaponCount = lobby.settings?.weaponCount ?? MAX_WEAPONS;
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
      ? 'You are the host. Open seats for friends, give the rest to computers, and press Start when ready.'
      : 'Waiting for the host to start the game.';
  const hostNote = amHost
    ? isPublic
      ? 'You are the host — you set the table size, the computers, which wings of the house are open and how many weapons are in play.'
      : 'You are the host — you set the computers, which wings of the house are open and how many weapons are in play.'
    : host
      ? `${host.name} is the host and sets ${isPublic ? 'the table size, ' : ''}the computers, the wings in play and the weapon count.`
      : 'The first human to join becomes the host.';

  /** An unfilled private seat: what it is (open / closed), and the host's controls to change it. */
  const emptySeat = (slot: Slot) => {
    const hostCtrls = amHost && slot.index !== 0;
    return (
      <div className={`pseat pseat--empty pseat--${slot.status}`} key={slot.index} title={`Seat ${slot.index + 1}: ${slot.status}`}>
        <div className="pseat__num">{slot.index + 1}</div>
        <div className="pseat__text">
          <div className="pseat__name pseat__name--empty">{slot.status === 'closed' ? 'Closed' : 'Open'}</div>
        </div>
        {hostCtrls && (
          <span className="pseat__ctrls" role="radiogroup" title="Open the seat, close it, or give it to a computer">
            {SEAT_STATES.map(({ status, label }) => (
              <button
                key={status}
                type="button"
                role="radio"
                aria-checked={slot.status === status}
                className={`pseat__ctrl pseat__ctrl--${status}${slot.status === status ? ' pseat__ctrl--on' : ''}`}
                onClick={() => setSlot(slot.index, status)}
              >
                {label}
              </button>
            ))}
          </span>
        )}
      </div>
    );
  };

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
        {isPublic && (
          <label>
            Total players
            {amHost ? (
              <select value={total} onChange={(e) => setRoomSettings({ totalPlayers: Number(e.target.value) })}>
                {TABLE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            ) : (
              <strong>{total}</strong>
            )}
          </label>
        )}
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
          Weapons
          <WeaponCountPicker value={weaponCount} readOnly={!amHost} onChange={(n) => setRoomSettings({ weaponCount: n })} title="How many of the 40 weapons are in the game" />
        </label>
        <span className="plobby__hostnote">{hostNote}</span>
      </div>

      <div className="lobby__body">
        <div className="plobby__seats">
          {lobby.slots.map((slot) => {
            const occ = slot.occupant;
            if (!occ) return isPublic ? null : emptySeat(slot);
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
                    {!isPublic && amHost && occ.isBot && (
                      <>
                        {' · '}
                        <button className="pseat__link" onClick={() => setSlot(slot.index, 'open')} title="Remove this computer and open the seat">
                          boot
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
          {humans} {humans === 1 ? 'human' : 'humans'} · {cpus} {cpus === 1 ? 'computer' : 'computers'}
          {isPublic ? ` · ${total} seats` : ''}
          {watchers > 0 && ` · ${watchers} watching`}
          {!isPublic && amHost && playerCount < MIN_PLAYERS && ` · need ${MIN_PLAYERS - playerCount} more to start`}
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
