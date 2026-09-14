import { getCard, type AnyCard } from 'shared';
import { Card } from './Card';
import { CardBack } from './CardBack';
import { BASE_H, BASE_W, CARD_H, CARD_W, layoutFan, slotCentre } from '../util/fanLayout';
import { compareCards } from '../util/cardSort';
import './OpeningDeal.css';

/*
 * The shared machinery behind the card animations played over the map: the opening deal
 * (OpeningDeal) and a wrong accuser's cards being redistributed (Redeal).
 *
 *  - decks drawn as a short stack of backs with a count badge, and riffle-shuffled;
 *  - seats round the table just off the screen, clockwise from yours at the bottom, with cards
 *    flown straight off toward them (or in from them);
 *  - your own cards flown down, turned face up, and slid into the exact slot the hand fan is about
 *    to give them (or lifted out of the fan and turned face down);
 *  - a clock that runs a film's beats on a fixed schedule from a start time, so every screen stays
 *    on the same beat, and that still finishes on time if frames stop (a hidden tab).
 *
 * Motion is the Web Animations API on elements rendered up front. Styles live in OpeningDeal.css.
 */

export const DECK_LAYERS = 8; // cards drawn in a deck's stack; its count badge carries the real number
export const OTHER_POOL = 12; // flying backs for other players' cards, reused round-robin (≤ 6 in the air)
export const OTHER_FLIGHT = 380;
export const MINE_FLIGHT = 900;
export const RIFFLE_MS = 1050;

export type Point = { x: number; y: number };
export type Area = { W: number; H: number };

/** A deck card's width for an area W x H. Narrow enough that three decks side by side leave room for
 *  a riffle's halves to fan out between them. */
export function sceneCardWidth(W: number, H: number): number {
  return Math.max(44, Math.min(118, H * 0.15, W * 0.16));
}
export const cardHeight = (cw: number) => (cw * CARD_H) / CARD_W;

/** A stack's thickness: each card up the deck sits a hair up and to the left. */
export const layerBase = (L: number) => `translate(${-L * 0.6}px, ${-L * 1.1}px)`;

/** One card of a deck through a riffle: the bottom half is cut to the left and the top half to the
 *  right, bent back, then let go alternately from the bottom so the halves interleave, and squared. */
function riffleFrames(L: number, cw: number, ch: number): Keyframe[] {
  const half = DECK_LAYERS / 2;
  const side = L < half ? -1 : 1;
  const order = side < 0 ? L * 2 : (L - half) * 2 + 1;
  const back = 0.42 + (order / DECK_LAYERS) * 0.36;
  const dx = side * cw * 0.58;
  const lift = -ch * 0.05;
  const tf = (x: number, y: number, r: number) => `${layerBase(L)} translate(${x}px, ${y}px) rotate(${r}deg)`;
  return [
    { offset: 0, transform: tf(0, 0, 0), easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' },
    { offset: 0.2, transform: tf(dx, lift, side * 9) },
    { offset: back, transform: tf(dx * 0.9, lift, side * 4), easing: 'cubic-bezier(0.5, 0, 0.7, 0.4)' },
    { offset: back + 0.1, transform: tf(0, -3, 0), easing: 'ease-out' },
    { offset: 1, transform: tf(0, 0, 0) },
  ];
}

/** Where a ray from (x0, y0) along (dx, dy) has carried a card of size `m` fully past the area's edge. */
function offscreen(x0: number, y0: number, dx: number, dy: number, W: number, H: number, m: number): Point {
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (W + m - x0) / dx);
  if (dx < -1e-6) t = Math.min(t, (-m - x0) / dx);
  if (dy > 1e-6) t = Math.min(t, (H + m - y0) / dy);
  if (dy < -1e-6) t = Math.min(t, (-m - y0) / dy);
  return { x: x0 + dx * t, y: y0 + dy * t };
}

/** A card's transform, centred on (x, y): the flying cards are BASE_W wide, like a card in the fan. */
export const place = (x: number, y: number, rot: number, scale: number) =>
  `translate(${x - BASE_W / 2}px, ${y - BASE_H / 2}px) rotate(${rot}deg) scale(${scale})`;

/** The direction of a seat from the middle of the table, in radians clockwise from straight down.
 *  Seats run clockwise round the table in seat order from yours at the bottom; an observer, who has
 *  no seat, sits between two players instead. */
export function seatAngle(seat: number, mySeat: number, n: number): number {
  const j = mySeat >= 0 ? (seat - mySeat + n) % n : seat + 0.5;
  return (2 * Math.PI * j) / n;
}

/** The point just past the area's edge, seen from `from`, in the direction of a seat. */
function seatPoint(from: Point, theta: number, area: Area, margin: number): Point {
  return offscreen(from.x, from.y, -Math.sin(theta), Math.cos(theta), area.W, area.H, margin);
}

/** Where a card rests in the hand fan, in `root`'s coordinates, and the fan's top edge. */
export interface FanSpot extends Point {
  rot: number;
  top: number;
}

/** Where `cardId` rests in the hand fan once the fan holds `held` (which includes it), sorted the way
 *  the fan sorts. Null without a fan (the classic shelf) or if the card isn't in `held`. */
export function fanSpot(root: HTMLElement, held: string[], cardId: string): FanSpot | null {
  const box = root.getBoundingClientRect();
  const band = document.querySelector('[data-hand-fan]')?.getBoundingClientRect();
  if (!band || band.width < BASE_W) return null;
  const cards = held
    .map((id) => getCard(id))
    .filter((c): c is AnyCard => !!c)
    .sort(compareCards);
  const idx = cards.findIndex((c) => c.id === cardId);
  if (idx < 0) return null;
  const slot = layoutFan(cards.length, band.width, band.height).slots[idx];
  const c = slotCentre(slot);
  return { x: band.left - box.left + c.x, y: band.top - box.top + c.y, rot: slot.rot, top: band.top - box.top };
}

/** A beat: `run` does the motion and sound (told when it is running late, to keep quiet); `state`
 *  tells the screen something, and runs even if the film is cut short. */
export type Step = { at: number; run?: (late: boolean) => void; state?: () => void };

export interface Film {
  /** Animate an element (held at its last frame unless told otherwise); cancelled with the film. */
  play(el: Element | null | undefined, frames: Keyframe[], duration: number, opts?: KeyframeAnimationOptions): Animation | undefined;
  /** Do something `t` ms into the film. */
  at(t: number, run: (late: boolean) => void): void;
  step(s: Step): void;
  /** Play a sound, unless the beat is running late. */
  cue(late: boolean, sound: () => void): void;
}

/**
 * Build a film's beats with `build`, then run them from `startAt` (local Date.now ms; may be in the
 * past or the future) until `length` ms in, and call `onDone`. `build` may return a function called
 * on every frame with the elapsed time, for anything kept in step with the clock (deck counts).
 * Returns the cleanup, which stops the clock and cancels every animation.
 */
export function runFilm(startAt: number, length: number, build: (film: Film) => ((elapsed: number) => void) | void, onDone: () => void): () => void {
  const running: Animation[] = [];
  const steps: Step[] = [];
  const film: Film = {
    play(el, frames, duration, opts = {}) {
      if (!el) return undefined;
      const anim = el.animate(frames, { duration, fill: 'forwards', ...opts });
      running.push(anim);
      return anim;
    },
    at(t, run) {
      steps.push({ at: t, run });
    },
    step(s) {
      steps.push(s);
    },
    cue(late, sound) {
      if (!late) sound();
    },
  };
  const onFrame = build(film);
  steps.sort((a, b) => a.at - b.at);

  const t0 = performance.now() - (Date.now() - startAt);
  let next = 0;
  let frame = 0;
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(frame);
    for (; next < steps.length; next++) steps[next].state?.();
    onDone();
  };
  const tick = () => {
    const e = performance.now() - t0;
    while (next < steps.length && steps[next].at <= e) {
      const s = steps[next++];
      s.run?.(e - s.at > 300);
      s.state?.();
    }
    if (typeof onFrame === 'function') onFrame(e);
    if (e >= length) finish();
    else frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  // Frames stop in a hidden tab; the film still has to end on time.
  const guard = setTimeout(finish, Math.max(0, startAt + length + 500 - Date.now()));
  return () => {
    over = true;
    cancelAnimationFrame(frame);
    clearTimeout(guard);
    running.forEach((a) => a.cancel());
  };
}

/** Riffle-shuffle a deck (a DeckStack element). */
export function riffle(film: Film, deck: HTMLElement, cw: number): void {
  const ch = cardHeight(cw);
  deck.querySelectorAll('[data-layer]').forEach((el, L) => film.play(el, riffleFrames(L, cw, ch), RIFFLE_MS));
}

/** Keeps a deck's count badge and stack height in step with how many cards it holds. An empty deck
 *  is hidden. Writes only when the number changes. */
export function deckCounter(deck: HTMLElement): (count: number) => void {
  const layers = Array.from(deck.querySelectorAll<HTMLElement>('[data-layer]'));
  const badge = deck.querySelector<HTMLElement>('[data-count]');
  let last = -1;
  return (count) => {
    const n = Math.max(0, count);
    if (n === last) return;
    last = n;
    if (badge) badge.textContent = String(n);
    const shown = Math.min(DECK_LAYERS, n);
    layers.forEach((el, L) => (el.style.visibility = L < shown ? '' : 'hidden'));
    deck.style.visibility = n === 0 ? 'hidden' : '';
  };
}

/** Someone else's card: from `from`, straight off the edge toward their seat. */
export function flyOff(film: Film, el: HTMLElement, from: Point, theta: number, area: Area, margin: number, scale: number, spin: number): void {
  const end = seatPoint(from, theta, area, margin);
  film.play(
    el,
    [
      { transform: place(from.x, from.y, 0, scale), visibility: 'visible' },
      { transform: place(end.x, end.y, (theta * 180) / Math.PI + spin, scale), visibility: 'visible' },
    ],
    OTHER_FLIGHT,
    { easing: 'cubic-bezier(0.3, 0.15, 0.65, 1)', fill: 'none' },
  );
}

/** A card coming in from a seat off the edge, landing squared on `to`. */
export function flyIn(film: Film, el: HTMLElement, to: Point, theta: number, area: Area, margin: number, scale: number, spin: number, duration: number): void {
  const start = seatPoint(to, theta, area, margin);
  film.play(
    el,
    [
      { transform: place(start.x, start.y, (theta * 180) / Math.PI + spin, scale), visibility: 'visible' },
      { transform: place(to.x, to.y, 0, scale), visibility: 'visible' },
    ],
    duration,
    { easing: 'cubic-bezier(0.25, 0.6, 0.35, 1)', fill: 'none' },
  );
}

/** Your card: from `from` down toward you, over onto its face, and into its slot in the fan (or, with
 *  no fan to go to, off the bottom). The element is a FlyingFaces card. */
export function flyToHand(film: Film, el: HTMLElement, from: Point, target: FanSpot | null, area: Area, fromScale: number): void {
  const { W, H } = area;
  const hoverX = target ? Math.max(W * 0.12, Math.min(W * 0.88, target.x)) : W / 2;
  const hoverY = (target ? target.top : H) - BASE_H * 0.72;
  film.play(
    el,
    [
      { offset: 0, transform: place(from.x, from.y, 0, fromScale), opacity: 1, visibility: 'visible', easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
      { offset: 0.3, transform: place(hoverX, hoverY, 0, 1.12), opacity: 1, visibility: 'visible' },
      { offset: 0.64, transform: place(hoverX, hoverY - 10, 0, 1.18), opacity: 1, visibility: 'visible', easing: 'cubic-bezier(0.5, 0, 0.3, 1)' },
      target
        ? { offset: 1, transform: place(target.x, target.y, target.rot, 1), opacity: 1, visibility: 'visible' }
        : { offset: 1, transform: place(W / 2, H + BASE_H, 0, 1), opacity: 0, visibility: 'visible' },
    ],
    MINE_FLIGHT,
  );
  film.play(
    el.firstElementChild,
    [
      { offset: 0, transform: 'rotateY(0deg)' },
      { offset: 0.3, transform: 'rotateY(0deg)', easing: 'cubic-bezier(0.45, 0, 0.35, 1)' },
      { offset: 0.62, transform: 'rotateY(180deg)' },
      { offset: 1, transform: 'rotateY(180deg)' },
    ],
    MINE_FLIGHT,
  );
}

/** One of your own cards leaving your fan: it sits face up on its slot until `delay`, lifts out,
 *  turns face down, and lands squared on `to` (held there until retired). A FlyingFaces card. */
export function flyFromHand(film: Film, el: HTMLElement, spot: FanSpot, to: Point, toScale: number, duration: number, delay: number): void {
  film.play(
    el,
    [
      { offset: 0, transform: place(spot.x, spot.y, spot.rot, 1), visibility: 'visible', easing: 'cubic-bezier(0.3, 0, 0.4, 1)' },
      { offset: 0.35, transform: place(spot.x, spot.top - BASE_H * 0.5, 0, 1.08), visibility: 'visible', easing: 'cubic-bezier(0.45, 0, 0.3, 1)' },
      { offset: 1, transform: place(to.x, to.y, 0, toScale), visibility: 'visible' },
    ],
    duration,
    { delay, fill: 'both' },
  );
  film.play(
    el.firstElementChild,
    [
      { offset: 0, transform: 'rotateY(180deg)' },
      { offset: 0.3, transform: 'rotateY(180deg)', easing: 'cubic-bezier(0.45, 0, 0.35, 1)' },
      { offset: 0.65, transform: 'rotateY(0deg)' },
      { offset: 1, transform: 'rotateY(0deg)' },
    ],
    duration,
    { delay, fill: 'both' },
  );
}

/** Drop a flying copy once whatever takes its place (the fan, a deck) has painted. */
export function retire(el: HTMLElement, frames = 2): void {
  const drop = () => el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  if (frames <= 0) drop();
  else requestAnimationFrame(() => (frames > 1 ? requestAnimationFrame(drop) : drop()));
}

const zoomTo = (w: number) => ({ zoom: w / CARD_W });

/** A deck: a short stack of backs centred on (x, y), a label above and a count badge. Hidden until
 *  animated in (OpeningDeal) or shown (Redeal); keep its count with deckCounter. */
export function DeckStack({ x, y, cw, label, count }: { x: number; y: number; cw: number; label?: string; count: number }) {
  const ch = cardHeight(cw);
  return (
    <div className="odeal__deck" data-deck="" style={{ left: x - cw / 2, top: y - ch / 2, width: cw, height: ch }}>
      {Array.from({ length: DECK_LAYERS }, (_, L) => (
        <div key={L} className="odeal__layer" data-layer="" style={{ transform: layerBase(L) }}>
          <div style={zoomTo(cw)}>
            <CardBack />
          </div>
        </div>
      ))}
      {label && (
        <div className="odeal__label" data-label="">
          {label}
        </div>
      )}
      <div className="odeal__count" data-count="">
        {count}
      </div>
    </div>
  );
}

/** `count` hidden card backs to fly, marked `data-<name>`. */
export function FlyingBacks({ count, name }: { count: number; name: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="odeal__card" {...{ [`data-${name}`]: '' }}>
          <div style={zoomTo(BASE_W)}>
            <CardBack />
          </div>
        </div>
      ))}
    </>
  );
}

/** A hidden card for each id that can turn over: back showing at rotateY(0), face at 180. Marked
 *  `data-<name>`, in the order given. */
export function FlyingFaces({ cardIds, name }: { cardIds: string[]; name: string }) {
  return (
    <>
      {cardIds.map((id, i) => {
        const card = getCard(id);
        return (
          <div key={`${id}-${i}`} className="odeal__card odeal__card--mine" {...{ [`data-${name}`]: '' }}>
            <div className="odeal__flip">
              <div className="odeal__face">
                <div style={zoomTo(BASE_W)}>
                  <CardBack />
                </div>
              </div>
              <div className="odeal__face odeal__face--front">
                <div style={zoomTo(BASE_W)}>{card && <Card card={card} zoomable={false} />}</div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
