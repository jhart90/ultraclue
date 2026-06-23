import { useState } from 'react';
import { getCard, MIN_PLAYERS, type Slot, type SlotStatus } from 'shared';
import { useStore } from '../store';
import { Chat } from '../components/Chat';
import { SuspectPicker } from '../components/SuspectPicker';
import './Lobby.css';

function suspectColor(suspectId?: string): string {
  if (!suspectId) return '#555';
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? c.color : '#555';
}

export function Lobby() {
  const lobby = useStore((s) => s.lobby);
  const myId = useStore((s) => s.myId);
  const chat = useStore((s) => s.chat);
  const error = useStore((s) => s.error);
  const setSlot = useStore((s) => s.setSlot);
  const pickSuspect = useStore((s) => s.pickSuspect);
  const sendChat = useStore((s) => s.sendChat);
  const startGame = useStore((s) => s.startGame);
  const leave = useStore((s) => s.leave);

  const [picking, setPicking] = useState(false);

  if (!lobby) return null;

  const amHost = lobby.hostId === myId;
  const mySlot = lobby.slots.find((s) => s.occupant?.id === myId);
  const mySuspectId = mySlot?.occupant?.suspectId;
  const occupantCount = lobby.slots.filter((s) => s.occupant).length;
  const canStart = amHost && occupantCount >= MIN_PLAYERS;

  const takenByOthers = new Set(
    lobby.slots
      .filter((s) => s.occupant && s.occupant.id !== myId && s.occupant.suspectId)
      .map((s) => s.occupant!.suspectId as string),
  );

  const statusBtn = (slot: Slot, status: SlotStatus, label: string) => (
    <button
      className={`seat__ctrl${slot.status === status && !(status === 'open' && slot.occupant) ? ' seat__ctrl--on' : ''}`}
      onClick={() => setSlot(slot.index, status)}
    >
      {label}
    </button>
  );

  return (
    <div className="lobby">
      <header className="lobby__head">
        <div>
          <h1>Game Lobby</h1>
          <p className="lobby__hint">
            {amHost
              ? 'You are the host. Set seats and press Start when ready.'
              : 'Waiting for the host to start the game.'}
          </p>
        </div>
        <div className="lobby__code">
          <span>Room Code</span>
          <strong>{lobby.code}</strong>
        </div>
      </header>

      <div className="lobby__body">
        <div className="lobby__seats">
          {lobby.slots.map((slot) => {
            const occ = slot.occupant;
            const isMe = occ?.id === myId;
            const isHostSeat = occ?.id === lobby.hostId;
            return (
              <div className={`seat${occ ? ' seat--filled' : ''}`} key={slot.index}>
                <div className="seat__num">Seat {slot.index + 1}</div>

                {occ ? (
                  <>
                    <div className="seat__who">
                      <span className="seat__swatch" style={{ background: suspectColor(occ.suspectId) }} />
                      <span className="seat__name">{occ.name}</span>
                    </div>
                    <div className="seat__tags">
                      {isHostSeat && <span className="tag tag--host">HOST</span>}
                      {occ.isBot && <span className="tag tag--bot">BOT</span>}
                      {isMe && <span className="tag tag--you">YOU</span>}
                      {!occ.connected && <span className="tag tag--off">OFFLINE</span>}
                    </div>
                    <div className="seat__char">
                      {occ.suspectId ? getCard(occ.suspectId)?.title : <em>choosing…</em>}
                    </div>
                    {isMe && (
                      <button className="seat__pick" onClick={() => setPicking(true)}>
                        {mySuspectId ? 'Change character' : 'Choose character'}
                      </button>
                    )}
                  </>
                ) : (
                  <div className={`seat__empty seat__empty--${slot.status}`}>
                    {slot.status === 'open' ? 'OPEN' : 'CLOSED'}
                  </div>
                )}

                {amHost && !(occ && !occ.isBot) && slot.index !== 0 && (
                  <div className="seat__ctrls">
                    {statusBtn(slot, 'open', 'Open')}
                    {statusBtn(slot, 'closed', 'Closed')}
                    {statusBtn(slot, 'bot', 'Bot')}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <aside className="lobby__chat">
          <Chat messages={chat} onSend={sendChat} />
        </aside>
      </div>

      {error && <p className="lobby__error">{error}</p>}

      <footer className="lobby__foot">
        <button className="btn btn--danger" onClick={leave}>
          Exit
        </button>
        <div className="lobby__footinfo">
          {occupantCount} {occupantCount === 1 ? 'player' : 'players'} seated
          {amHost && occupantCount < MIN_PLAYERS && ` · need ${MIN_PLAYERS - occupantCount} more to start`}
        </div>
        <button className="btn btn--primary" disabled={!canStart} onClick={startGame} title={amHost ? '' : 'Only the host can start'}>
          Start Game
        </button>
      </footer>

      {picking && (
        <SuspectPicker
          takenByOthers={takenByOthers}
          mySuspectId={mySuspectId}
          onPick={pickSuspect}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
