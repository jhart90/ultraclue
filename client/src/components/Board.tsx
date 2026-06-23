import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BOARD, coordKey, getCard, type Coord, type PlayerView, type RoomLayout, type SectionTheme } from 'shared';
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
  'room-smoking': '🚬', 'room-trophy': '🏆', 'room-orchard': '🍎', 'room-pantry': '🥫',
  'room-armory': '⚔️', 'room-solarium': '☀️', 'room-parlour': '🫖', 'room-workshop': '🔧',
  'room-cemetery': '🪦', 'room-laboratory': '⚗️', 'room-boiler': '♨️', 'room-drawing': '✏️',
  'room-planetarium': '🪐', 'room-veranda': '🪑', 'room-den': '🦊', 'room-hedge-maze': '🌿',
  'room-stables': '🐴', 'room-clock-tower': '🕰️', 'room-master-suite': '🛏️', 'room-greenhouse': '🪴',
  'room-gazebo': '⛲', 'room-bathhouse': '🛁', 'room-sauna': '🧖', 'room-courtyard': '⛲',
};

function roomBounds(room: RoomLayout) {
  const xs = room.tiles.map((t) => t.x);
  const ys = room.tiles.map((t) => t.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX * TS, y: minY * TS, w: (Math.max(...xs) - minX + 1) * TS, h: (Math.max(...ys) - minY + 1) * TS, minX, minY };
}

function Staircase({ at }: { at: Coord }) {
  const x = at.x * TS;
  const y = at.y * TS;
  const steps = [0, 1, 2, 3];
  return (
    <g transform={`translate(${x + 3} ${y + 3})`}>
      <rect width={TS - 6} height={TS - 6} rx="2" fill="#0c0a14" stroke="#e7c66a" strokeWidth="1" />
      {steps.map((s) => (
        <rect key={s} x={1.5 + s * 1.4} y={1.5 + s * ((TS - 9) / steps.length)} width={TS - 9 - s * 2.8} height={(TS - 9) / steps.length - 0.8} fill={`hsl(44 55% ${60 - s * 11}%)`} />
      ))}
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
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

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

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset?.move) return; // clicking a move target, not panning
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; // capture locally — the setView updater runs at commit time, by which
    if (!d) return; //          point a pointerup may have nulled drag.current.
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView((v) => ({ ...v, tx: d.tx + dx, ty: d.ty + dy }));
  };
  const onPointerUp = () => (drag.current = null);

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

          {/* water decal for the Grounds (lake by the boat house) */}
          {(() => {
            const g = BOARD.sections.find((s) => s.theme === 'grounds')!;
            const y0 = (g.origin.y + g.height - 6) * TS;
            return <path d={`M0 ${y0} Q ${4 * TS} ${y0 - 18} ${8 * TS} ${y0 + 6} L ${8 * TS} ${(g.origin.y + g.height) * TS} L 0 ${(g.origin.y + g.height) * TS} Z`} fill="#1f6f93" opacity="0.85" />;
          })()}

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

          {/* stairs between floors */}
          {BOARD.stairs.flatMap((s, i) => [<Staircase key={`st${i}a`} at={s.a} />, <Staircase key={`st${i}b`} at={s.b} />])}

          {/* rooms */}
          {Object.values(BOARD.rooms).map((room) => {
            const b = roomBounds(room);
            const theme = BOARD.sections.find((s) => s.id === room.sectionId)?.theme ?? 'ground-floor';
            const t = THEME[theme];
            const title = getCard(room.id)?.title ?? room.id;
            return (
              <g key={room.id}>
                {/* one cohesive room space (no internal grid) with a soft inset */}
                <rect x={b.x + 1} y={b.y + 1} width={b.w - 2} height={b.h - 2} rx="5" fill={t.floor} stroke="#e7c66a" strokeWidth="2" />
                <rect x={b.x + 4} y={b.y + 4} width={b.w - 8} height={b.h - 8} rx="4" fill="none" stroke="rgba(231,198,106,0.2)" strokeWidth="1" />
                {room.entrances.map((e, i) => {
                  const mx = (e.roomTile.x + e.doorTile.x) / 2;
                  const my = (e.roomTile.y + e.doorTile.y) / 2;
                  return <rect key={i} x={mx * TS + 7} y={my * TS + 7} width={TS - 14} height={TS - 14} rx="2" fill="#e7c66a" />;
                })}
                <text x={b.x + b.w / 2} y={b.y + b.h / 2 - 2} textAnchor="middle" fontSize={Math.min(22, b.h * 0.45)} style={{ pointerEvents: 'none' }}>
                  {EMOJI[room.id] ?? '🚪'}
                </text>
                <text x={b.x + b.w / 2} y={b.y + b.h - 5} textAnchor="middle" fontFamily="Georgia, serif" fontSize="8.5" fill="#f3ecdb" style={{ pointerEvents: 'none' }}>
                  {title}
                </text>
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
          {BOARD.shortcuts.flatMap((sc) => [<Staircase key={`${sc.id}a`} at={sc.a} />, <Staircase key={`${sc.id}b`} at={sc.b} />])}

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
    </div>
  );
}
