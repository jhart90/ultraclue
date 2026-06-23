import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BOARD, coordKey, getCard, type Coord, type PlayerView, type RoomLayout, type SectionTheme } from 'shared';
import { resolveOverride } from '../render/overrides';
import './Board.css';

interface LastMove {
  playerId: string;
  path: Coord[];
}

const TS = 26;
const BW = BOARD.width * TS;
const BH = BOARD.height * TS;
const MIN_SCALE = 0.45;
const MAX_SCALE = 3;

const cx = (c: Coord) => c.x * TS + TS / 2;
const cy = (c: Coord) => c.y * TS + TS / 2;

// Tile -> room lookup, so reachable room tiles can be collapsed into one big space.
const ROOM_AT = new Map<string, string>();
for (const room of Object.values(BOARD.rooms)) for (const t of room.tiles) ROOM_AT.set(coordKey(t), room.id);

function Pawn({ px, py, color, r = TS / 2 - 5, eliminated }: { px: number; py: number; color: string; r?: number; eliminated?: boolean }) {
  return (
    <g opacity={eliminated ? 0.3 : 1}>
      <ellipse cx={px} cy={py + 5} rx={r} ry={2.5} fill="rgba(0,0,0,0.45)" />
      <circle cx={px} cy={py - 1} r={r} fill={color} stroke="#0f0d18" strokeWidth="1.5" />
      <circle cx={px - 2} cy={py - 3} r={Math.max(1.5, r * 0.28)} fill="rgba(255,255,255,0.6)" />
    </g>
  );
}

function suspectColor(suspectId?: string): string {
  if (!suspectId) return '#888';
  const c = getCard(suspectId);
  return c && c.type === 'suspect' ? c.color : '#888';
}

// Per-theme palette: section background, path stone, room floor base.
const THEME: Record<SectionTheme, { bg: string; bg2: string; path: string; floor: string; title: string }> = {
  grounds: { bg: '#2d5530', bg2: '#27492a', path: '#8a7f63', floor: '#3a4d35', title: 'rgba(20,40,20,0.85)' },
  'ground-floor': { bg: '#332720', bg2: '#2b2019', path: '#6f5d44', floor: '#43342a', title: 'rgba(35,22,12,0.85)' },
  'upper-floor': { bg: '#322c3f', bg2: '#2a2435', path: '#5e5570', floor: '#3c3550', title: 'rgba(28,20,40,0.85)' },
  basement: { bg: '#1b1925', bg2: '#15131e', path: '#4a4658', floor: '#272336', title: 'rgba(10,8,16,0.85)' },
};

// A representative glyph for every room.
const EMOJI: Record<string, string> = {
  'room-theatre': '🎭', 'room-library': '📚', 'room-walk-in-closet': '🧥', 'room-billiard': '🎱',
  'room-ballroom': '💃', 'room-kitchen': '🍳', 'room-dining': '🍽️', 'room-lounge': '🛋️',
  'room-study': '📖', 'room-wine-cellar': '🍷', 'room-music': '🎹', 'room-gallery': '🖼️',
  'room-gymnasium': '🏋️', 'room-boat-house': '🚤', 'room-chapel': '⛪', 'room-boudoir': '💄',
  'room-smoking': '🚬', 'room-trophy': '🏆', 'room-rose-garden': '🌹', 'room-pantry': '🥫',
  'room-armory': '⚔️', 'room-solarium': '☀️', 'room-parlour': '🫖', 'room-workshop': '🔧',
  'room-cemetery': '🪦', 'room-laboratory': '⚗️', 'room-boiler': '♨️', 'room-drawing': '✏️',
  'room-planetarium': '🪐', 'room-veranda': '🪑', 'room-den': '🦊', 'room-hedge-maze': '🌿',
  'room-stables': '🐴', 'room-clock-tower': '🕰️', 'room-master-suite': '🛏️', 'room-greenhouse': '🪴',
  'room-gazebo': '⛲', 'room-bunker': '🪖', 'room-sauna': '🧖', 'room-courtyard': '⛲',
};

function roomBounds(room: RoomLayout) {
  const xs = room.tiles.map((t) => t.x);
  const ys = room.tiles.map((t) => t.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX * TS, y: minY * TS, w: (Math.max(...xs) - minX + 1) * TS, h: (Math.max(...ys) - minY + 1) * TS, minX, minY };
}

/** SVG path tracing only the outer edges of a room's tiles, so an L-shaped room gets a clean
 *  border that follows its real footprint instead of a bounding rectangle. */
function roomOutline(tiles: Coord[]): string {
  const inRoom = new Set(tiles.map(coordKey));
  const has = (x: number, y: number) => inRoom.has(`${x},${y}`);
  const segs: string[] = [];
  for (const tl of tiles) {
    const x0 = tl.x * TS, y0 = tl.y * TS, x1 = (tl.x + 1) * TS, y1 = (tl.y + 1) * TS;
    if (!has(tl.x, tl.y - 1)) segs.push(`M${x0} ${y0}L${x1} ${y0}`);
    if (!has(tl.x, tl.y + 1)) segs.push(`M${x0} ${y1}L${x1} ${y1}`);
    if (!has(tl.x - 1, tl.y)) segs.push(`M${x0} ${y0}L${x0} ${y1}`);
    if (!has(tl.x + 1, tl.y)) segs.push(`M${x1} ${y0}L${x1} ${y1}`);
  }
  return segs.join('');
}

type TipFn = (t: { x: number; y: number; text: string } | null) => void;

function Staircase({ at, label, onTip }: { at: Coord; label?: string; onTip?: TipFn }) {
  const x = at.x * TS;
  const y = at.y * TS;
  const steps = [0, 1, 2, 3];
  const hover =
    label && onTip
      ? {
          style: { cursor: 'help' as const },
          onMouseEnter: (e: React.MouseEvent) => onTip({ x: e.clientX, y: e.clientY, text: label }),
          onMouseMove: (e: React.MouseEvent) => onTip({ x: e.clientX, y: e.clientY, text: label }),
          onMouseLeave: () => onTip(null),
        }
      : {};
  return (
    <g transform={`translate(${x + 3} ${y + 3})`} {...hover}>
      <rect width={TS - 6} height={TS - 6} rx="2" fill="#0c0a14" stroke="#e7c66a" strokeWidth="1" />
      {steps.map((s) => (
        <rect key={s} x={1.5 + s * 1.4} y={1.5 + s * ((TS - 9) / steps.length)} width={TS - 9 - s * 2.8} height={(TS - 9) / steps.length - 0.8} fill={`hsl(44 55% ${60 - s * 11}%)`} />
      ))}
    </g>
  );
}

/** A room entrance: a wooden door indoors, or an iron gate out on the grounds. */
function Door({ rt, dt, gate }: { rt: Coord; dt: Coord; gate: boolean }) {
  const cxm = ((rt.x + dt.x) / 2) * TS + TS / 2;
  const cym = ((rt.y + dt.y) / 2) * TS + TS / 2;
  const vertWall = rt.x !== dt.x; // door sits on a vertical wall
  const lng = TS * 0.66;
  const thk = 6;
  const w = vertWall ? thk : lng;
  const h = vertWall ? lng : thk;
  const bars = [0.28, 0.5, 0.72].map((f) =>
    vertWall ? (
      <line key={f} x1={cxm - w / 2} y1={cym - h / 2 + f * h} x2={cxm + w / 2} y2={cym - h / 2 + f * h} stroke="#aab0b6" strokeWidth="0.7" />
    ) : (
      <line key={f} x1={cxm - w / 2 + f * w} y1={cym - h / 2} x2={cxm - w / 2 + f * w} y2={cym + h / 2} stroke="#aab0b6" strokeWidth="0.7" />
    ),
  );
  if (gate) {
    return (
      <g>
        <rect x={cxm - w / 2} y={cym - h / 2} width={w} height={h} rx="1" fill="#33333b" stroke="#71757c" strokeWidth="1" />
        {bars}
      </g>
    );
  }
  return (
    <g>
      <rect x={cxm - w / 2} y={cym - h / 2} width={w} height={h} rx="1.5" fill="#7a5230" stroke="#3a2616" strokeWidth="1" />
      <rect x={cxm - w / 2 + 1.2} y={cym - h / 2 + 1.2} width={w - 2.4} height={h - 2.4} rx="1" fill="none" stroke="#9c6b40" strokeWidth="0.6" />
      <circle cx={vertWall ? cxm + w / 4 : cxm + w / 4} cy={vertWall ? cym + h / 4 : cym + h / 4} r="1" fill="#e7c66a" />
    </g>
  );
}

export function Board({
  players,
  reachable,
  lastMove,
  weaponLocations,
  canMove,
  onMoveTo,
}: {
  players: PlayerView[];
  reachable?: Coord[];
  lastMove?: LastMove;
  weaponLocations?: Record<string, string>;
  canMove?: boolean;
  onMoveTo?: (tile: Coord) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 0.8, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view; // always the latest committed view, for use inside gesture handlers
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  // Active touch/mouse pointers on the board, for two-finger pinch-to-zoom (iOS Safari et al.).
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number } | null>(null);

  // Walk-animation: when a new path arrives, step the moving pawn through it at 0.3s / tile.
  const [anim, setAnim] = useState<{ playerId: string; tile: Coord } | null>(null);
  const animSig = useRef<string>('');
  useEffect(() => {
    if (!lastMove || lastMove.path.length < 2) {
      setAnim(null);
      return;
    }
    const sig = `${lastMove.playerId}:${lastMove.path.map(coordKey).join('>')}`;
    if (sig === animSig.current) return;
    animSig.current = sig;
    let i = 0;
    setAnim({ playerId: lastMove.playerId, tile: lastMove.path[0] });
    const timer = setInterval(() => {
      i += 1;
      if (i >= lastMove.path.length) {
        clearInterval(timer);
        setAnim(null);
        return;
      }
      setAnim({ playerId: lastMove.playerId, tile: lastMove.path[i] });
    }, 300);
    return () => clearInterval(timer);
  }, [lastMove]);

  const reachSet = new Set((reachable ?? []).map(coordKey));

  // Fit-to-width on first mount.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const scale = Math.min(1.1, (el.clientWidth - 16) / BW);
    setView({ scale, tx: (el.clientWidth - BW * scale) / 2, ty: 8 });
  }, []);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setView((v) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
    });
  }, []);

  // Wheel zoom (non-passive so we can preventDefault).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // iOS Safari fires non-standard gesture* events for pinch and will zoom the whole page unless we
  // suppress them; we handle pinch ourselves via pointer events.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const prevent = (e: Event) => e.preventDefault();
    const evs = ['gesturestart', 'gesturechange', 'gestureend'];
    evs.forEach((n) => el.addEventListener(n, prevent as EventListener, { passive: false }));
    return () => evs.forEach((n) => el.removeEventListener(n, prevent as EventListener));
  }, []);

  // Up/Down arrow keys zoom toward centre.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const el = viewportRef.current;
      if (!el) return;
      zoomAt(e.key === 'ArrowUp' ? 1.12 : 1 / 1.12, el.clientWidth / 2, el.clientHeight / 2);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomAt]);

  const startDragFrom = (x: number, y: number) => {
    drag.current = { x, y, tx: viewRef.current.tx, ty: viewRef.current.ty, moved: false };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset?.move) return; // clicking a move target, not panning
    try {
      viewportRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone — safe to ignore */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      // second finger down -> start a pinch and stop panning
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      drag.current = null;
    } else {
      startDragFrom(e.clientX, e.clientY);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two-finger pinch: zoom by the change in finger distance, centred on their midpoint.
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0 && dist > 0) {
        const rect = viewportRef.current?.getBoundingClientRect();
        zoomAt(dist / pinch.current.dist, (a.x + b.x) / 2 - (rect?.left ?? 0), (a.y + b.y) / 2 - (rect?.top ?? 0));
      }
      pinch.current.dist = dist;
      return;
    }

    const d = drag.current; // capture locally — the setView updater runs at commit time, by which
    if (!d) return; //          point a pointerup may have nulled drag.current.
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
    } else if (pointers.current.size === 1) {
      // a finger lifted after a pinch — resume panning from the one that remains, no jump
      const [p] = [...pointers.current.values()];
      startDragFrom(p.x, p.y);
    }
  };

  return (
    <div
      className="bv"
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div className="bv__stage" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
        <svg width={BW} height={BH} className="bv__svg" role="img" aria-label="Mansion board">
          {/* section panels */}
          {BOARD.sections.map((s) => {
            const t = THEME[s.theme];
            return (
              <g key={s.id}>
                <rect x={s.origin.x * TS} y={s.origin.y * TS} width={s.width * TS} height={s.height * TS} rx="6" fill={t.bg} />
                <rect x={s.origin.x * TS} y={s.origin.y * TS} width={s.width * TS} height={s.height * TS} rx="6" fill="none" stroke={t.bg2} strokeWidth="3" />
                <g>
                  <rect x={s.origin.x * TS + 6} y={s.origin.y * TS + 5} width={132} height={20} rx="4" fill={t.title} stroke="#e7c66a" strokeWidth="1" />
                  <text x={s.origin.x * TS + 12} y={s.origin.y * TS + 19} fontFamily="Georgia, serif" fontSize="12" fill="#e7c66a" letterSpacing="1.5">
                    {s.title.toUpperCase()}
                  </text>
                </g>
              </g>
            );
          })}

          {/* shortcut link lines */}
          <g stroke="#e7c66a" strokeWidth="1.5" strokeDasharray="3 5" opacity="0.22">
            {BOARD.shortcuts.map((sc) => (
              <line key={sc.id} x1={cx(sc.a)} y1={cy(sc.a)} x2={cx(sc.b)} y2={cy(sc.b)} />
            ))}
          </g>

          {/* path cells */}
          {BOARD.cells.filter((c) => c.type === 'path').map((c) => {
            const t = THEME[(BOARD.sections.find((s) => s.id === c.sectionId)?.theme) ?? 'ground-floor'];
            return <rect key={`p${c.x}-${c.y}`} x={c.x * TS} y={c.y * TS} width={TS} height={TS} fill={t.path} stroke="rgba(0,0,0,0.18)" strokeWidth="0.5" />;
          })}

          {/* elevators — one per indoor floor */}
          {BOARD.elevators.map((e) => {
            const xs = e.cells.map((c) => c.x);
            const ys = e.cells.map((c) => c.y);
            const x = Math.min(...xs) * TS;
            const y = Math.min(...ys) * TS;
            const w = (Math.max(...xs) - Math.min(...xs) + 1) * TS;
            const h = (Math.max(...ys) - Math.min(...ys) + 1) * TS;
            return (
              <g key={e.floor}>
                <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} rx="3" fill="#3a3f48" stroke="#aab0b6" strokeWidth="2" />
                <line x1={x + w / 2} y1={y + 4} x2={x + w / 2} y2={y + h - 4} stroke="#6a7078" strokeWidth="1.5" />
                <text x={x + w / 2} y={y + h / 2 + 6} textAnchor="middle" fontSize="16">
                  🛗
                </text>
              </g>
            );
          })}

          {/* cellar stairs: Grounds <-> Basement link */}
          <g>
            <line
              x1={cx(BOARD.cellarLink.a)}
              y1={cy(BOARD.cellarLink.a)}
              x2={cx(BOARD.cellarLink.b)}
              y2={cy(BOARD.cellarLink.b)}
              stroke="#9aa0a6"
              strokeWidth="1.5"
              strokeDasharray="2 4"
              opacity="0.3"
            />
            <Staircase at={BOARD.cellarLink.a} label="Cellar stairs — down to the Basement" onTip={setTip} />
            <Staircase at={BOARD.cellarLink.b} label="Cellar stairs — up to the Grounds" onTip={setTip} />
          </g>

          {/* rooms */}
          {Object.values(BOARD.rooms).map((room) => {
            const b = roomBounds(room);
            const theme = BOARD.sections.find((s) => s.id === room.sectionId)?.theme ?? 'ground-floor';
            const t = THEME[theme];
            const title = getCard(room.id)?.title ?? room.id;
            const art = resolveOverride(room.id, 'room', title);
            const gate = theme === 'grounds' && room.id !== 'room-walk-in-closet';
            // A room whose tiles fill its whole bounding box is a plain rectangle; otherwise it has
            // a notch and must be drawn from its actual tiles so the L-shape shows.
            const isRect = room.tiles.length === (b.w / TS) * (b.h / TS);
            // name bubble: centred for rectangles, on the label tile for L-shapes
            const cxr = isRect ? b.x + b.w / 2 : room.label.x * TS + TS / 2;
            const cyr = isRect ? b.y + b.h / 2 : room.label.y * TS + TS / 2;
            const fs = Math.max(6.5, Math.min(11, (b.w - 12) / (title.length * 0.62)));
            const bubbleW = Math.min(b.w - 4, title.length * fs * 0.6 + 12);
            const bubbleH = fs + 7;
            const glyph = [...room.tiles].sort((p, q) => p.y - q.y || p.x - q.x)[0];
            return (
              <g key={room.id}>
                {isRect ? (
                  <>
                    {/* one cohesive room space (no internal grid) with a soft inset */}
                    <rect x={b.x + 1} y={b.y + 1} width={b.w - 2} height={b.h - 2} rx="5" fill={t.floor} stroke="#e7c66a" strokeWidth="2" />
                    {/* override art (if supplied) fills the room, clipped to its rounded bounds; a soft
                        scrim keeps the white name bubble and glyph legible over busy images */}
                    {art && (
                      <>
                        <clipPath id={`roomclip-${room.id}`}>
                          <rect x={b.x + 2} y={b.y + 2} width={b.w - 4} height={b.h - 4} rx="4" />
                        </clipPath>
                        <image
                          href={art}
                          x={b.x + 2}
                          y={b.y + 2}
                          width={b.w - 4}
                          height={b.h - 4}
                          preserveAspectRatio="xMidYMid slice"
                          clipPath={`url(#roomclip-${room.id})`}
                          style={{ pointerEvents: 'none' }}
                        />
                        <rect x={b.x + 2} y={b.y + 2} width={b.w - 4} height={b.h - 4} rx="4" fill="rgba(10,7,16,0.32)" clipPath={`url(#roomclip-${room.id})`} style={{ pointerEvents: 'none' }} />
                      </>
                    )}
                    <rect x={b.x + 4} y={b.y + 4} width={b.w - 8} height={b.h - 8} rx="4" fill="none" stroke="rgba(231,198,106,0.2)" strokeWidth="1" />
                  </>
                ) : (
                  <>
                    {/* notched room: fill each tile, then trace just the outer edge */}
                    {room.tiles.map((tl) => (
                      <rect key={`${tl.x}-${tl.y}`} x={tl.x * TS - 0.3} y={tl.y * TS - 0.3} width={TS + 0.6} height={TS + 0.6} fill={t.floor} />
                    ))}
                    <path d={roomOutline(room.tiles)} fill="none" stroke="#e7c66a" strokeWidth="2" strokeLinejoin="round" />
                  </>
                )}
                {/* small thematic glyph, tucked into the room's top-left tile */}
                <text x={glyph.x * TS + 11} y={glyph.y * TS + 15} textAnchor="middle" fontSize="11" style={{ pointerEvents: 'none' }}>
                  {EMOJI[room.id] ?? ''}
                </text>
                {room.entrances.map((e, i) => (
                  <Door key={i} rt={e.roomTile} dt={e.doorTile} gate={gate} />
                ))}
                {/* room name, in a white bubble */}
                <g style={{ pointerEvents: 'none' }}>
                  <rect x={cxr - bubbleW / 2} y={cyr - bubbleH / 2} width={bubbleW} height={bubbleH} rx={bubbleH / 2} fill="#f4efe1" stroke="#2a2018" strokeWidth="1" />
                  <text x={cxr} y={cyr + fs * 0.36} textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize={fs} fill="#1a120a">
                    {title}
                  </text>
                </g>
              </g>
            );
          })}

          {/* weapon tokens, grouped by their current room (a suggestion summons them) */}
          {weaponLocations &&
            (() => {
              const byRoom = new Map<string, string[]>();
              for (const [wid, rid] of Object.entries(weaponLocations)) {
                const arr = byRoom.get(rid) ?? [];
                arr.push(wid);
                byRoom.set(rid, arr);
              }
              return [...byRoom.entries()].flatMap(([rid, wids]) => {
                const room = BOARD.rooms[rid];
                if (!room) return [];
                const b = roomBounds(room);
                const n = wids.length;
                const r = 6.5;
                const spacing = Math.min(2 * r + 1, (b.w - 12) / Math.max(n, 1));
                return wids.map((wid, i) => (
                  <circle
                    key={wid}
                    cx={b.x + b.w / 2 + (i - (n - 1) / 2) * spacing}
                    cy={b.y + 13}
                    r={r}
                    fill="url(#pewter)"
                    stroke="#4b4e54"
                  />
                ));
              });
            })()}

          {/* secret-passage staircases */}
          {BOARD.shortcuts.flatMap((sc) => {
            const aLabel =
              sc.kind === 'room' ? `Secret passage to the ${getCard(sc.bRoomId!)?.title ?? 'unknown'}` : 'Secret passage';
            const bLabel =
              sc.kind === 'room' ? `Secret passage to the ${getCard(sc.aRoomId!)?.title ?? 'unknown'}` : 'Secret passage';
            return [
              <Staircase key={`${sc.id}a`} at={sc.a} label={aLabel} onTip={setTip} />,
              <Staircase key={`${sc.id}b`} at={sc.b} label={bLabel} onTip={setTip} />,
            ];
          })}

          {/* envelope */}
          <rect x={BOARD.envelope.x * TS + 1} y={BOARD.envelope.y * TS + 1} width={TS - 2} height={TS - 2} rx="2" fill="#7a1f2b" stroke="#e7c66a" />
          <text x={cx(BOARD.envelope)} y={cy(BOARD.envelope) + 4} textAnchor="middle" fontSize="12">✉</text>

          {/* start homes (faint) */}
          {BOARD.starts.map((s) => (
            <circle key={s.suspectId} cx={cx(s.tile)} cy={cy(s.tile)} r={TS / 2 - 3} fill="none" stroke={suspectColor(s.suspectId)} strokeWidth="1.5" opacity="0.25" />
          ))}

          {/* darken out-of-range squares; highlight reachable path cells individually and each
              reachable room as ONE large clickable space */}
          {canMove &&
            reachSet.size > 0 &&
            (() => {
              const reachRooms = new Map<string, Coord>(); // roomId -> a valid destination tile
              const reachPaths: Coord[] = [];
              for (const t of reachable ?? []) {
                const rid = ROOM_AT.get(coordKey(t));
                if (rid) {
                  if (!reachRooms.has(rid)) reachRooms.set(rid, t);
                } else {
                  reachPaths.push(t);
                }
              }
              return (
                <>
                  <rect x={0} y={0} width={BW} height={BH} fill="rgba(8,6,14,0.55)" />
                  {reachPaths.map((t) => (
                    <rect
                      key={`mv${t.x}-${t.y}`}
                      data-move="1"
                      x={t.x * TS + 1}
                      y={t.y * TS + 1}
                      width={TS - 2}
                      height={TS - 2}
                      rx={3}
                      fill="rgba(231,198,106,0.28)"
                      stroke="#e7c66a"
                      strokeWidth="1.5"
                      style={{ cursor: 'pointer' }}
                      onClick={() => onMoveTo?.(t)}
                    />
                  ))}
                  {[...reachRooms.entries()].map(([rid, dest]) => {
                    const b = roomBounds(BOARD.rooms[rid]);
                    return (
                      <rect
                        key={`mvr${rid}`}
                        data-move="1"
                        x={b.x + 1}
                        y={b.y + 1}
                        width={b.w - 2}
                        height={b.h - 2}
                        rx={5}
                        fill="rgba(231,198,106,0.30)"
                        stroke="#e7c66a"
                        strokeWidth="2.5"
                        style={{ cursor: 'pointer' }}
                        onClick={() => onMoveTo?.(dest)}
                      />
                    );
                  })}
                </>
              );
            })()}

          {/* player pawns: those inside a room cluster together in that one space; others sit on
              their tile (and walk along the path while animating) */}
          {(() => {
            const inRoom = new Map<string, PlayerView[]>();
            const free: PlayerView[] = [];
            for (const p of players) {
              const animating = anim?.playerId === p.id;
              if (p.inRoomId && BOARD.rooms[p.inRoomId] && !animating) {
                const arr = inRoom.get(p.inRoomId) ?? [];
                arr.push(p);
                inRoom.set(p.inRoomId, arr);
              } else {
                free.push(p);
              }
            }
            return (
              <>
                {free.map((p) => {
                  const tile = anim?.playerId === p.id ? anim.tile : p.position;
                  return <Pawn key={p.id} px={cx(tile)} py={cy(tile)} color={suspectColor(p.suspectId)} eliminated={p.eliminated} />;
                })}
                {[...inRoom.entries()].flatMap(([rid, occ]) => {
                  const b = roomBounds(BOARD.rooms[rid]);
                  const n = occ.length;
                  const r = TS / 2 - 6;
                  const spacing = Math.min(TS - 1, (b.w - 14) / Math.max(n, 1));
                  return occ.map((p, i) => (
                    <Pawn
                      key={p.id}
                      px={b.x + b.w / 2 + (i - (n - 1) / 2) * spacing}
                      py={b.y + b.h * 0.62}
                      r={r}
                      color={suspectColor(p.suspectId)}
                      eliminated={p.eliminated}
                    />
                  ));
                })}
              </>
            );
          })()}

          <defs>
            <radialGradient id="pewter" cx="38%" cy="32%" r="75%">
              <stop offset="0" stopColor="#eef0f2" />
              <stop offset="0.6" stopColor="#a9adb3" />
              <stop offset="1" stopColor="#5e6166" />
            </radialGradient>
          </defs>
        </svg>
      </div>
      <div className="bv__hint">scroll or ↑/↓ to zoom · drag to pan</div>
      {tip && (
        <div className="bv__tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
