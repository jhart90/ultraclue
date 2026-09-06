import { useLayoutEffect, useRef, useState } from 'react';
import { getCard, BOT_DIFFICULTY_LABEL, type PlayerView } from 'shared';
import { SuspectThumb } from './SuspectThumb';
import '../screens/Lobby.css';
import './TurnOrder.css';

function suspectColor(suspectId?: string): string {
  const c = suspectId ? getCard(suspectId) : undefined;
  return c && c.type === 'suspect' ? c.color : '#555';
}

/**
 * The strip of player chips above the board, in turn order. It never grows past two rows: once the
 * chips would wrap onto a third, the strip ends with an "…and N more" chip that opens the full
 * roster. The cut is found by measuring — chips are rendered, their row (offsetTop) inspected, and
 * the visible count trimmed until the trailing chip sits on row two. useLayoutEffect keeps that
 * trimming invisible (it re-renders before paint).
 */
export function TurnOrder({
  players,
  activeId,
  myId,
  onOpenRoster,
}: {
  players: PlayerView[];
  activeId: string;
  myId: string;
  onOpenRoster: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(players.length);
  const [width, setWidth] = useState(0);
  // How many chips the upper row holds (measured), so the player to move can be kept at its centre.
  const [perRow, setPerRow] = useState(0);

  // The strip cycles through the table in turn order: once the player to move has passed the
  // centre of the upper row (the first few turns of the game), the window rotates so that whoever
  // is up always sits in that centre spot, with the rest following in order.
  const n = players.length;
  const activeIdx = Math.max(0, players.findIndex((p) => p.id === activeId));
  const centre = Math.floor(perRow / 2);
  const start = n && activeIdx > centre ? (activeIdx - centre) % n : 0;
  const ordered = players.map((_, i) => players[(start + i) % n]);

  // Reset to "show everyone" whenever the roster, the rotation or the available width changes,
  // then re-measure.
  useLayoutEffect(() => {
    setVisible(players.length);
  }, [players.length, width, start]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chips = Array.from(el.children) as HTMLElement[];
    if (!chips.length) return;
    const rows = [...new Set(chips.map((c) => c.offsetTop))].sort((a, b) => a - b);
    const row1 = chips.filter((c) => c.offsetTop === rows[0] && !c.classList.contains('po--more')).length;
    if (row1 !== perRow) setPerRow(row1);
    if (rows.length <= 2) return; // everything fits (or the "more" chip already sits on row two)
    const row3 = rows[2];
    const fitting = chips.filter((c) => c.offsetTop < row3).length;
    const hasMore = visible < players.length;
    // Keep one fewer than what fits so the "…and N more" chip has room on row two.
    setVisible(Math.max(1, hasMore ? Math.min(visible - 1, fitting - 1) : fitting - 1));
  }, [visible, players, width, perRow]);

  const shown = ordered.slice(0, visible);
  const hidden = players.length - shown.length;
  const activeHidden = hidden > 0 && ordered.slice(visible).some((p) => p.id === activeId);

  return (
    <div className="game__turnorder" ref={ref}>
      {shown.map((p) => (
        <div key={p.id} className={`po${p.id === activeId ? ' po--active' : ''}${p.eliminated ? ' po--out' : ''}`}>
          <span className="po__sw" style={{ background: suspectColor(p.suspectId) }} />
          <span className="po__name">
            {p.name}
            {p.id === myId ? ' (you)' : ''}
          </span>
          {getCard(p.suspectId)?.title !== p.name && <span className="po__char">{getCard(p.suspectId)?.title}</span>}
          {p.id === activeId && <span className="po__tag">to move</span>}
        </div>
      ))}
      {hidden > 0 && (
        <button
          className={`po po--more${activeHidden ? ' po--active' : ''}`}
          onClick={onOpenRoster}
          title="See every player"
        >
          …and {hidden} more
          {activeHidden && <span className="po__tag">to move</span>}
        </button>
      )}
    </div>
  );
}

/** The full player list, laid out like the lobby's seat rows, for tables too big for the strip. */
export function PlayerRoster({
  players,
  activeId,
  myId,
  hostId,
  onClose,
}: {
  players: PlayerView[];
  activeId: string;
  myId: string;
  hostId?: string;
  onClose: () => void;
}) {
  const humans = players.filter((p) => !p.isBot).length;
  return (
    <div className="roster__backdrop" onClick={onClose}>
      <div className="roster" onClick={(e) => e.stopPropagation()}>
        <div className="roster__head">
          <h2>Players</h2>
          <span className="roster__count">
            {players.length} at the table · {humans} {humans === 1 ? 'human' : 'humans'} · {players.length - humans} computers
          </span>
          <button className="roster__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="roster__list">
          {players.map((p, i) => {
            const character = getCard(p.suspectId)?.title;
            const isMe = p.id === myId;
            return (
              <div
                key={p.id}
                className={`pseat${p.isBot ? '' : ' pseat--human'}${isMe ? ' pseat--me' : ''}${p.id === activeId ? ' pseat--active' : ''}${p.eliminated ? ' pseat--out' : ''}`}
              >
                <div className="pseat__num">{i + 1}</div>
                <SuspectThumb suspectId={p.suspectId} />
                <div className="pseat__text">
                  <div className="pseat__name">{p.name}</div>
                  <div className="pseat__sub">
                    {p.isBot ? `Computer · ${BOT_DIFFICULTY_LABEL[p.difficulty ?? 'medium']}` : character}
                    {isMe && ' · you'}
                  </div>
                </div>
                <div className="pseat__tags">
                  {p.id === activeId && <span className="tag tag--host">TO MOVE</span>}
                  {p.id === hostId && <span className="tag tag--you">HOST</span>}
                  {p.eliminated && <span className="tag tag--off">OUT</span>}
                  {!p.isBot && !p.connected && <span className="tag tag--off">OFFLINE</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
