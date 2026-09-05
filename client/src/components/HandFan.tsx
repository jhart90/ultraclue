import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getCard, type AnyCard } from 'shared';
import { Card } from './Card';
import { openCardZoom } from './CardZoom';
import { compareCards } from '../util/cardSort';
import { playCardHover } from '../util/sound';
import './HandFan.css';

// The player's hand as a fan of real card faces along the bottom of the screen, Hearthstone-style:
// the cards sit on a shallow arc, overlapping, with only their top half above the screen edge.
// Sweeping the mouse along the band raises whichever card is under it, straight and full size,
// over the board; its neighbours slide apart to make room. Clicking the raised card opens the
// shared zoom viewer. Touch taps once to raise and again to zoom; the arrow keys walk the fan.
//
// The hovered card is found from the pointer's X against the *resting* slot positions (the exposed
// strip of each card), never from which element is under the pointer. That is what lets the mouse
// pan smoothly from card to card: the enlarged card never steals the hover from its neighbours.

const CARD_W = 200; // the Card component's authored size
const CARD_H = 306;
const BASE_W = 150; // a resting card's width
const BASE_H = (BASE_W * CARD_H) / CARD_W;
const VISIBLE = 0.5; // share of a resting card kept above the screen bottom
const MAX_STEP = 0.72; // widest exposed strip per card (as a share of its width) before they spread out
const RAISED_MAX_W = 300;
const RAISE_LIFT = 10; // gap between a raised card's bottom edge and the screen bottom

interface Slot {
  x: number; // left edge of the unrotated card, in band coordinates
  y: number; // top edge
  rot: number; // degrees, about the card's bottom centre
}

interface Layout {
  slots: Slot[];
  step: number;
  startX: number;
  total: number;
}

/** Resting positions for `n` cards across a band `w` wide and `h` tall. */
function layoutFan(n: number, w: number, h: number): Layout {
  if (n === 0) return { slots: [], step: 0, startX: 0, total: 0 };
  const step = n > 1 ? Math.min(BASE_W * MAX_STEP, Math.max(1, (w - BASE_W) / (n - 1))) : 0;
  const total = BASE_W + step * (n - 1);
  const startX = (w - total) / 2;
  const centre = (n - 1) / 2;
  // Tilt grows with the hand but never beyond ±11° at the ends; the arc sags a little at the ends.
  const perCard = n > 1 ? Math.min(2.5, 22 / (n - 1)) : 0;
  const sag = Math.min(18, 1.4 * n);
  const restTop = h - BASE_H * VISIBLE;
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const t = centre > 0 ? (i - centre) / centre : 0;
    slots.push({ x: startX + step * i, y: restTop + sag * t * t, rot: (i - centre) * perCard });
  }
  return { slots, step, startX, total };
}

/** How far each card slides sideways to clear the raised card at `h`, by index (positive = right). */
function pushOffsets(lay: Layout, n: number, h: number, raisedW: number, w: number): number[] {
  const out = new Array<number>(n).fill(0);
  const want = Math.max(0, (raisedW - lay.step) / 2 + 8);
  // Left side: the raised card's left neighbours move left. Spare margin lets them all shift as one;
  // beyond that they bunch up toward the edge, most near the raised card, so the end stays put.
  const left = h;
  if (left > 0) {
    const room = Math.max(0, lay.startX);
    const p = Math.min(want, room + lay.step * left * 0.6);
    const u = Math.min(p, room);
    const rem = p - u;
    for (let j = 0; j < h; j++) out[j] = -(u + (rem * (j + 1)) / left);
  }
  const right = n - 1 - h;
  if (right > 0) {
    const room = Math.max(0, w - (lay.startX + lay.total));
    const p = Math.min(want, room + lay.step * right * 0.6);
    const u = Math.min(p, room);
    const rem = p - u;
    for (let j = h + 1; j < n; j++) out[j] = u + (rem * (n - j)) / right;
  }
  return out;
}

export function HandFan({ cardIds }: { cardIds: string[] }) {
  const cards = useMemo(
    () =>
      cardIds
        .map((id) => getCard(id))
        .filter((c): c is AnyCard => !!c)
        .sort(compareCards),
    [cardIds],
  );
  const n = cards.length;

  const bandRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, vh: typeof window === 'undefined' ? 800 : window.innerHeight });
  const [raised, setRaised] = useState<number | null>(null);
  const lastPointer = useRef<string>('mouse');
  const lastTick = useRef(0);
  // Cards seen so far, so only newly dealt ones play the deal-in animation (and stagger by arrival).
  const seen = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const el = bandRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight, vh: window.innerHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // A card that left the hand (the hand was redistributed) can't stay raised.
  useEffect(() => {
    if (raised !== null && raised >= n) setRaised(null);
  }, [n, raised]);

  // Touch: a tap anywhere else lowers the raised card.
  useEffect(() => {
    if (raised === null) return;
    const onDown = (e: PointerEvent) => {
      if (bandRef.current && !bandRef.current.contains(e.target as Node)) setRaised(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [raised]);

  const lay = useMemo(() => layoutFan(n, size.w, size.h), [n, size.w, size.h]);
  // The raised card is as large as the screen height allows, up to a comfortable cap.
  const raisedW = Math.max(BASE_W, Math.min(RAISED_MAX_W, Math.floor((size.vh * 0.56 * CARD_W) / CARD_H), Math.floor(size.w * 0.6) || RAISED_MAX_W));
  const raisedH = (raisedW * CARD_H) / CARD_W;
  const push = useMemo(
    () => (raised === null ? null : pushOffsets(lay, n, raised, raisedW, size.w)),
    [lay, n, raised, raisedW, size.w],
  );

  /** Which resting slot is under band-relative x, or null when off the fan. */
  const indexAt = useCallback(
    (x: number): number | null => {
      if (n === 0 || x < lay.startX || x > lay.startX + lay.total) return null;
      if (n === 1) return 0;
      return Math.max(0, Math.min(n - 1, Math.floor((x - lay.startX) / lay.step)));
    },
    [n, lay],
  );

  const raise = useCallback(
    (i: number | null) => {
      setRaised((prev) => {
        if (prev === i) return prev;
        if (i !== null) {
          const now = performance.now();
          if (now - lastTick.current > 45) {
            lastTick.current = now;
            playCardHover();
          }
        }
        return i;
      });
    },
    [],
  );

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    lastPointer.current = e.pointerType;
    const el = bandRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Above the band the pointer is on the raised card itself (the only part of the fan that
    // reaches up there): keep it raised so it can be clicked.
    if (e.clientY < r.top) return;
    if (e.pointerType === 'touch' && e.buttons === 0) return;
    raise(indexAt(e.clientX - r.left));
  };

  const onPointerLeave = () => {
    if (lastPointer.current !== 'touch') raise(null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    lastPointer.current = e.pointerType;
    if (e.pointerType !== 'touch') return;
    const el = bandRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (e.clientY < r.top) {
      // tapped the raised card itself
      if (raised !== null) openCardZoom(cards, raised);
      return;
    }
    const i = indexAt(e.clientX - r.left);
    if (i === null) raise(null);
    else if (i === raised) openCardZoom(cards, i);
    else raise(i);
  };

  const onClick = () => {
    if (lastPointer.current === 'touch') return; // taps are handled on pointerdown
    if (raised !== null) openCardZoom(cards, raised);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      raise(raised === null ? (d < 0 ? n - 1 : 0) : (raised + d + n) % n);
    } else if ((e.key === 'Enter' || e.key === ' ') && raised !== null) {
      openCardZoom(cards, raised);
    } else if (e.key === 'Escape' && raised !== null) {
      raise(null);
    } else return;
    e.preventDefault();
  };

  // Newly dealt cards animate in from below, staggered in hand order.
  let fresh = 0;
  const entry = cards.map((c) => {
    if (seen.current.has(c.id)) return null;
    return fresh++;
  });
  useEffect(() => {
    cards.forEach((c) => seen.current.set(c.id, 1));
  });

  const raisedCard = raised !== null ? cards[raised] : undefined;
  const raisedSlot = raised !== null ? lay.slots[raised] : undefined;
  let raiseStyle: React.CSSProperties | undefined;
  if (raisedCard && raisedSlot) {
    const cx = raisedSlot.x + BASE_W / 2;
    const rx = Math.max(4, Math.min(size.w - raisedW - 4, cx - raisedW / 2));
    const ry = size.h - RAISE_LIFT - raisedH;
    // The lift animates from the slot: same bottom-centre origin, so scale + rotation line up.
    const dx = cx - (rx + raisedW / 2);
    const dy = raisedSlot.y + BASE_H - (ry + raisedH);
    raiseStyle = {
      left: rx,
      top: ry,
      width: raisedW,
      height: raisedH,
      ['--from' as string]: `translate(${dx}px, ${dy}px) rotate(${raisedSlot.rot}deg) scale(${BASE_W / raisedW})`,
    };
  }

  return (
    <div
      ref={bandRef}
      className="fan"
      role="listbox"
      aria-label={`Your hand, ${n} cards`}
      tabIndex={0}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (lastPointer.current !== 'touch') raise(null);
      }}
    >
      <div className="fan__label">
        Your hand · {n} {n === 1 ? 'card' : 'cards'}
      </div>
      {size.w > 0 &&
        cards.map((card, i) => {
          const s = lay.slots[i];
          const dx = push ? push[i] : 0;
          const e = entry[i];
          return (
            <div
              key={card.id}
              className={`fan__slot${raised === i ? ' fan__slot--raised' : ''}`}
              role="option"
              aria-selected={raised === i}
              style={{
                transform: `translate(${s.x + dx}px, ${s.y}px) rotate(${s.rot}deg)`,
                zIndex: i + 1,
              }}
            >
              <div
                className={`fan__body${e !== null ? ' fan__body--deal' : ''}`}
                style={{ zoom: BASE_W / CARD_W, animationDelay: e !== null ? `${e * 28}ms` : undefined }}
              >
                <Card card={card} zoomable={false} />
              </div>
            </div>
          );
        })}
      {raisedCard && raiseStyle && (
        <div key={raisedCard.id} className="fan__raise" style={raiseStyle} title={`${raisedCard.title} — click to enlarge`}>
          <div className="fan__body" style={{ zoom: raisedW / CARD_W }}>
            <Card card={raisedCard} zoomable={false} />
          </div>
        </div>
      )}
    </div>
  );
}
