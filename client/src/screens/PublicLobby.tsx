import { useEffect, useState } from 'react';
import { getCard, PUBLIC_MIN_PLAYERS, PUBLIC_MAX_PLAYERS, DEFAULT_BOT_DIFFICULTY } from 'shared';
import { DifficultyPicker } from '../components/DifficultyPicker';
import { useStore } from '../store';
import { Chat } from '../components/Chat';
import { SuspectPicker } from '../components/SuspectPicker';
import { SuspectThumb } from '../components/SuspectThumb';
import './Lobby.css';
import './PublicLobby.css';

// The public table: up to 40 seats, so each seat is a slim one-line card (thumbnail, name,
// character) instead of the private lobby's tall portrait cards. There are no seat controls —
// every seat is a computer until a human takes it — and no Start button: the clock starts the game.

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

const TABLE_SIZES = Array.from({ length: PUBLIC_MAX_PLAYERS - PUBLIC_MIN_PLAYERS + 1 }, (_, i) => PUBLIC_MIN_PLAYERS + i);

export function PublicLobby() {
  const lobby = useStore((s) => s.lobby);
  const myId = useStore((s) => s.myId);
  const chat = useStore((s) => s.chat);
  const error = useStore((s) => s.error);
  const serverOffset = useStore((s) => s.serverOffset);
  const pickSuspect = useStore((s) => s.pickSuspect);
  const sendChat = useStore((s) => s.sendChat);
  const setRoomSettings = useStore((s) => s.setRoomSettings);
  const setBotDifficulty = useStore((s) => s.setBotDifficulty);
  const leave = useStore((s) => s.leave);

  const [picking, setPicking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  if (!lobby) return null;

  const amHost = lobby.hostId === myId;
  const host = lobby.slots.find((s) => s.occupant?.id === lobby.hostId)?.occupant;
  const mySlot = lobby.slots.find((s) => s.occupant?.id === myId);
  const mySuspectId = mySlot?.occupant?.suspectId;
  const total = lobby.settings?.totalPlayers ?? lobby.slots.length;
  const humans = lobby.slots.filter((s) => s.occupant && !s.occupant.isBot).length;
  const cpus = lobby.slots.filter((s) => s.occupant?.isBot).length;
  const botDifficulty = lobby.settings?.botDifficulty ?? DEFAULT_BOT_DIFFICULTY;
  // The server's clock drives the start; correct for our own clock's skew so everyone agrees.
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

  return (
    <div className="lobby plobby">
      <header className="lobby__head">
        <div>
          <h1>Public Lobby</h1>
          <p className="lobby__hint">
            Every seat is a computer until a human takes it. When the clock runs out the game begins with
            whoever is here.
          </p>
        </div>
        <div className={`plobby__clock${soon ? ' plobby__clock--soon' : ''}`}>
          <span>Game starts in</span>
          <strong>{fmtCountdown(remaining)}</strong>
        </div>
      </header>

      <div className="plobby__settings">
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
        <label>
          Computers
          <DifficultyPicker
            value={botDifficulty}
            readOnly={!amHost}
            onChange={(d) => setRoomSettings({ botDifficulty: d })}
            title="Difficulty for every computer seat (click a seat to change just that one)"
          />
        </label>
        <span className="plobby__hostnote">
          {amHost
            ? 'You are the host — you set the table size and how well the computers play.'
            : host
              ? `${host.name} is the host and sets the table size and computer difficulty.`
              : 'The first human to join becomes the host.'}
        </span>
      </div>

      <div className="lobby__body">
        <div className="plobby__seats">
          {lobby.slots.map((slot) => {
            const occ = slot.occupant;
            if (!occ) return null;
            const isMe = occ.id === myId;
            const isHostSeat = occ.id === lobby.hostId;
            const character = occ.suspectId ? getCard(occ.suspectId)?.title : undefined;
            return (
              <div
                className={`pseat${occ.isBot ? '' : ' pseat--human'}${isMe ? ' pseat--me' : ''}`}
                key={slot.index}
                title={occ.isBot ? `Seat ${slot.index + 1}: computer` : `Seat ${slot.index + 1}: ${occ.name}`}
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
                        <button className="pseat__link" onClick={() => setPicking(true)} title="Change character">
                          change
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
        </div>
        <div className="plobby__footclock">Starts in {fmtCountdown(remaining)}</div>
      </footer>

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
