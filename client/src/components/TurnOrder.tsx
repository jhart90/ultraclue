import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getCard, BOT_DIFFICULTY_LABEL, type PlayerView } from 'shared';
import { SuspectThumb } from './SuspectThumb';
import { layoutStrip } from './turnOrderLayout';
import '../screens/Lobby.css';
import './TurnOrder.css';

function suspectColor(suspectId?: string): string {
  const c = suspectId ? getCard(suspectId) : undefined;
  return c && c.type === 'suspect' ? c.color : '#555';
}

function PlayerChip({ p, activeId, myId }: { p: PlayerView; activeId: string; myId: string }) {
  return (
    <div className={`po${p.id === activeId ? ' po--active' : ''}${p.eliminated ? ' po--out' : ''}`}>
      <span className="po__sw" style={{ background: suspectColor(p.suspectId) }} />
      <span className="po__name">
        {p.name}
        {p.id === myId ? ' (you)' : ''}
      </span>
      {getCard(p.suspectId)?.title !== p.name && <span className="po__char">{getCard(p.suspectId)?.title}</span>}
      {p.id === activeId && <span className="po__tag">to move</span>}
    </div>
  );
}

function MoreChip({ hidden, active, onClick }: { hidden: number; active: boolean; onClick?: () => void }) {
  return (
    <button className={`po po--more${active ? ' po--active' : ''}`} onClick={onClick} title="See every player">
      …and {hidden} more
      {active && <span className="po__tag">to move</span>}
    </button>
  );
}

/** Chip sizes read off the hidden measuring copy of the strip. */
interface Measured {
  containerWidth: number;
  gap: number;
  /** Each player's chip, in turn order. */
  chips: number[];
  /** "…and N more" for N = 1..players-1 (index N-1). */
  more: number[];
  /** "…and N more" with its "to move" tag, at the widest N. */
  moreActive: number;
}

const near = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 0.01);

/**
 * The strip of player chips above the board, in turn order. It never grows past two rows: once the
 * chips would wrap onto a third, the strip ends with an "…and N more" chip that opens the full
 * roster. Every chip is rendered once more, unrotated, in an invisible measuring copy that depends
 * only on the props; its sizes feed a pure flex-wrap emulation (turnOrderLayout.ts) that picks the
 * rotation and the cut. Nothing measured depends on the result, so the layout always settles.
 * useLayoutEffect keeps the measuring pass invisible (it re-renders before paint).
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
  const measureRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const n = players.length;

  const measure = useCallback(() => {
    const el = ref.current;
    const box = measureRef.current;
    if (!el || !box) return;
    const rects = (Array.from(box.children) as HTMLElement[]).map((c) => c.getBoundingClientRect());
    const count = Math.floor(rects.length / 2); // players, then n-1 "more" chips, then the tagged one
    const next: Measured = {
      containerWidth: el.getBoundingClientRect().width,
      gap: rects.length > 1 ? rects[1].left - rects[0].right : 0,
      chips: rects.slice(0, count).map((r) => r.width),
      more: rects.slice(count, 2 * count - 1).map((r) => r.width),
      moreActive: rects[rects.length - 1]?.width ?? 0,
    };
    setMeasured((prev) =>
      prev &&
      near([prev.containerWidth, prev.gap, prev.moreActive], [next.containerWidth, next.gap, next.moreActive]) &&
      near(prev.chips, next.chips) &&
      near(prev.more, next.more)
        ? prev
        : next,
    );
  }, []);

  // Re-read after every commit (the measuring copy only changes with the props, so this settles in
  // one pass), and whenever the strip is resized or the chips reflow without a render (fonts).
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (ref.current) ro.observe(ref.current);
    if (measureRef.current) ro.observe(measureRef.current);
    return () => ro.disconnect();
  }, [measure]);

  // The strip cycles through the table in turn order: once the player to move has passed the
  // centre of the upper row (the first few turns of the game), the window rotates so that whoever
  // is up always sits in that centre spot, with the rest following in order.
  const activeIdx = Math.max(0, players.findIndex((p) => p.id === activeId));
  const { start, visible } = useMemo(() => {
    if (!measured || measured.chips.length !== n) return { start: 0, visible: n };
    return layoutStrip({
      widths: measured.chips,
      activeIdx,
      containerWidth: measured.containerWidth,
      gap: measured.gap,
      moreWidth: (hidden, activeHidden) => (activeHidden ? measured.moreActive : measured.more[hidden - 1] ?? measured.moreActive),
    });
  }, [measured, n, activeIdx]);

  const ordered = players.map((_, i) => players[(start + i) % n]);
  const shown = ordered.slice(0, visible);
  const hidden = n - shown.length;
  const activeHidden = hidden > 0 && ordered.slice(visible).some((p) => p.id === activeId);

  return (
    <div className="game__turnorder" ref={ref}>
      {shown.map((p) => (
        <PlayerChip key={p.id} p={p} activeId={activeId} myId={myId} />
      ))}
      {hidden > 0 && <MoreChip hidden={hidden} active={activeHidden} onClick={onOpenRoster} />}
      <div className="po-measure" aria-hidden="true">
        <div className="po-measure__row" ref={measureRef}>
          {players.map((p) => (
            <PlayerChip key={p.id} p={p} activeId={activeId} myId={myId} />
          ))}
          {players.slice(1).map((_, i) => (
            <MoreChip key={`more${i + 1}`} hidden={i + 1} active={false} />
          ))}
          <MoreChip hidden={Math.max(1, n - 1)} active />
        </div>
      </div>
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
