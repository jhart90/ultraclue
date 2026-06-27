import { getCard } from 'shared';
import { useStore } from '../store';
import './SeatPicker.css';

function suspectColor(suspectId?: string): string {
  if (!suspectId) return '#555';
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? c.color : '#555';
}

/** Shown when you join a game that's already in progress (e.g. a reloaded save): pick which seated
 *  player to take over. Any seat currently run by a bot is up for grabs. */
export function SeatPicker() {
  const seatPick = useStore((s) => s.seatPick);
  const takeSeat = useStore((s) => s.takeSeat);
  const joinAsObserver = useStore((s) => s.joinAsObserver);
  const goto = useStore((s) => s.goto);
  if (!seatPick) return null;

  const available = seatPick.slots.filter((s) => s.occupant && s.occupant.isBot && !s.occupant.observer);

  return (
    <div className="seatpick__backdrop">
      <div className="seatpick">
        <h2 className="seatpick__title">Join game · {seatPick.code}</h2>
        <p className="seatpick__hint">This game is already in progress — choose a player to take over.</p>
        <div className="seatpick__list">
          {available.length === 0 && <div className="seatpick__empty">No seats are open to take over right now.</div>}
          {available.map((slot) => {
            const occ = slot.occupant!;
            const character = (occ.suspectId && getCard(occ.suspectId)?.title) || 'A detective';
            const showName = !!occ.name && occ.name !== character;
            return (
              <button key={slot.index} className="seatpick__seat" onClick={() => takeSeat(slot.index)}>
                <span className="seatpick__sw" style={{ background: suspectColor(occ.suspectId) }} />
                <span className="seatpick__name">
                  {showName ? occ.name : character}
                  {showName && <span className="seatpick__char"> · {character}</span>}
                </span>
                <span className="seatpick__tag">Take over</span>
              </button>
            );
          })}
        </div>
        <button className="seatpick__observe" onClick={() => joinAsObserver()}>
          👁 Join as observer
          <span className="seatpick__observehint">Watch the game without playing</span>
        </button>
        <button
          className="btn btn--ghost"
          onClick={() => {
            useStore.setState({ seatPick: undefined });
            goto('title');
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
