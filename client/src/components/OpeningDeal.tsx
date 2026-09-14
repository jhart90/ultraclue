import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CardBack } from './CardBack';
import { EnvelopeBody, EnvelopeDefs, EnvelopeFlap, EnvelopeFlapShadow, EnvelopeSeal, InkStamp, ENVELOPE_VIEWBOX } from './EnvelopeArt';
import { BASE_W, CARD_W } from '../util/fanLayout';
import {
  playCardDeal,
  playCardFlip,
  playCardSlide,
  playEnvelopeWhoosh,
  playPaperFlap,
  playSealPress,
  playShuffle,
  playStampThud,
} from '../util/sound';
import {
  DeckStack,
  FlyingBacks,
  FlyingFaces,
  MINE_FLIGHT,
  OTHER_POOL,
  cardHeight,
  deckCounter,
  fanSpot,
  flyOff,
  flyToHand,
  retire,
  riffle,
  runFilm,
  sceneCardWidth,
  seatAngle,
} from './dealKit';
import './OpeningDeal.css';

/**
 * The opening deal, played over the map on every screen as a game begins:
 *  1. three face-down decks — suspects, weapons, rooms — land and riffle-shuffle twice;
 *  2. the case envelope swoops in open, the top card of each deck drops inside, the flap closes,
 *     the wax seal presses down and CLASSIFIED is stamped across it;
 *  3. the envelope flies to its corner of the board, where the board's own envelope takes over;
 *  4. the decks merge into one and riffle again;
 *  5. the cards are dealt one at a time, round the table in seat order. Everyone else's cards fly
 *     straight off the edge of the screen toward where they sit; every card of yours flies down,
 *     turns face up, and slides into its place in your hand fan.
 *
 * The deal is replayed, not received: the server deals card k of its shuffled deck to seat k % n,
 * and each hand keeps that order (pinned by a test in shared/test/engine.test.ts), so hand sizes and
 * your own hand are all it takes. Times are fixed from the moment the game began on the server's
 * clock, so every screen is on the same beat and done before DEAL_ANIM_MS, when turn 1 may begin.
 * The decks, flights and clock are shared with the redistribution after an elimination (dealKit).
 */

/** Beats, in ms from the moment the game began. */
const T = {
  decks: 250,
  deckGap: 140,
  deckDrop: 500,
  riffles: [1000, 2250],
  riffleGap: 150,
  envIn: 3500,
  envInDur: 800,
  tuck: 4500,
  tuckGap: 350,
  tuckDur: 650,
  close: 6000,
  closeDur: 650,
  seal: 6700,
  sealDur: 420,
  stamp: 7300,
  stampDur: 340,
  envOut: 8100,
  envOutDur: 950,
  envFade: 450,
  merge: 9150,
  mergeDur: 650,
  riffle3: 9950,
  deal: 11_100,
  /** The whole deck goes out in this long, whatever its size (slower per card for a small deck). */
  dealWindow: 7_500,
  maxCadence: 160,
  fade: 19_300,
  fadeDur: 450,
};
/** When the film ends and the table is handed back: inside DEAL_ANIM_MS, so every screen has
 *  finished before the server lets turn 1 begin. */
export const DEAL_FILM_MS = 19_800;

const DECK_LABELS = ['Suspects', 'Weapons', 'Rooms'] as const;
/** The envelope's card slots (as in the accusation reveal): left edges and top, as shares of it. */
const SLOT_LEFT = [0.1016, 0.3828, 0.664];
const SLOT_TOP = 0.341;
const SLOT_W = 0.2344;
/** Where EnvelopeFlap prints its stamp, so the slammed-on copy lands exactly on it. */
const STAMP_BOX = { x: 185, y: 97, w: 270, h: 54 };
const VB = `0 0 ${ENVELOPE_VIEWBOX.w} ${ENVELOPE_VIEWBOX.h}`;
/** The board draws its envelope turned -12°; its bounding box is this many times the envelope's width. */
const BOARD_TILT = (12 * Math.PI) / 180;
const BOARD_SPREAD = Math.cos(BOARD_TILT) + (ENVELOPE_VIEWBOX.h / ENVELOPE_VIEWBOX.w) * Math.sin(BOARD_TILT);

export interface OpeningDealProps {
  /** Local Date.now() at which the game began (the server's start, corrected for clock skew). */
  startAt: number;
  /** Every dealt player in seat order (the order the server deals in) and how many cards they got. */
  seats: { id: string; handCount: number }[];
  /** The viewer's seat, or null for an observer (no card comes to the bottom of the screen). */
  myId: string | null;
  /** The viewer's hand in deal order. */
  yourHand: string[];
  /** Cards in the suspect, weapon and room decks before the envelope takes one of each. */
  deckSizes: [number, number, number];
  /** The overlay's envelope has reached the board: show the board's own. */
  onEnvelopePlaced: () => void;
  /** Your `count`-th card has landed in the fan: show that many. */
  onDealtToMe: (count: number) => void;
  onDone: () => void;
}

interface Geo {
  W: number;
  H: number;
  /** A deck card's size. */
  cw: number;
  ch: number;
  deckX: number[];
  deckY: number;
  env: { x: number; y: number; w: number; h: number };
  /** Where the merged deck deals from. */
  dealX: number;
  dealY: number;
}

/** Lay the scene out in an area W x H: the decks in a row near the top with the envelope below them,
 *  sized so the envelope's card slots are exactly one deck card wide. */
function sceneGeometry(W: number, H: number): Geo {
  const cw = sceneCardWidth(W, H);
  const ch = cardHeight(cw);
  const envW = cw / SLOT_W;
  const envH = (envW * ENVELOPE_VIEWBOX.h) / ENVELOPE_VIEWBOX.w;
  const top = H * 0.08 + 18; // room above the decks for their labels
  // Well apart, so a riffle's halves (each fanning out over half a card) never reach a neighbour.
  const spacing = Math.min(cw * 2.4, (W * 0.92 - cw) / 2);
  return {
    W,
    H,
    cw,
    ch,
    deckX: [-1, 0, 1].map((i) => W / 2 + i * spacing),
    deckY: top + ch / 2,
    env: { x: W / 2 - envW / 2, y: top + ch + H * 0.05, w: envW, h: envH },
    dealX: W / 2,
    dealY: H * 0.42,
  };
}

/** The board's envelope in the overlay's coordinates, or null when it isn't on screen (a closed wing
 *  leaves no corner for it, or the map has been panned away from it). */
function boardEnvelopeSlot(box: DOMRect): { x: number; y: number; w: number } | null {
  const el = document.querySelector('.game__board [data-board-envelope]');
  const area = document.querySelector('.game__board')?.getBoundingClientRect();
  if (!el || !area) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 8) return null;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  if (cx < area.left || cx > area.right || cy < area.top || cy > area.bottom) return null;
  return { x: cx - box.left, y: cy - box.top, w: r.width / BOARD_SPREAD };
}

export function OpeningDeal(props: OpeningDealProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  // The film is built once; callbacks are read through this so a parent re-render can't go stale.
  const live = useRef(props);
  live.current = props;
  const mySeatAtMount = props.myId ? props.seats.findIndex((s) => s.id === props.myId) : -1;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el) setGeo(sceneGeometry(el.clientWidth, el.clientHeight));
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!geo || !root) return;
    const p = live.current;
    const { W, H, cw, ch, env } = geo;
    const area = { W, H };

    return runFilm(
      p.startAt,
      DEAL_FILM_MS,
      (film) => {
        const { play, at, step, cue } = film;
        const all = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
        const one = (sel: string) => root.querySelector<HTMLElement>(sel);
        const decks = all('[data-deck]');
        const deckLabels = decks.map((d) => d.querySelector<HTMLElement>('[data-label]'));
        const counters = decks.map(deckCounter);
        const envEl = one('[data-env]');
        const envIn = one('[data-envin]');
        const tucks = all('[data-tuck]');
        const flap = one('[data-flap]');
        const flapShadow = one('[data-flapshadow]');
        const seal = one('[data-seal]');
        const slam = one('[data-slam]');
        const dim = one('[data-dim]');
        const others = all('[data-other]');
        const mine = all('[data-mine]');

        // ---- the table darkens, the three decks land and shuffle ----
        at(0, () => play(dim, [{ opacity: 0 }, { opacity: 1 }], 500, { easing: 'ease-out' }));
        decks.forEach((d, i) =>
          at(T.decks + i * T.deckGap, (late) => {
            play(
              d,
              [
                { opacity: 0, transform: 'translate(0px, -46px) scale(1.08)' },
                { opacity: 1, transform: 'translate(0px, 0px) scale(1)' },
              ],
              T.deckDrop,
              { easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
            );
            cue(late, playCardSlide);
          }),
        );
        for (const start of T.riffles) {
          decks.forEach((d, i) =>
            at(start + i * T.riffleGap, (late) => {
              riffle(film, d, cw);
              cue(late, playShuffle);
            }),
          );
        }

        // ---- the envelope arrives open and takes the top card of each deck ----
        let envSwoop: Animation | undefined;
        at(T.envIn, (late) => {
          envSwoop = play(
            envEl,
            [
              { opacity: 0, transform: 'translate(-110%, -90%) rotate(-24deg) scale(0.3)' },
              { offset: 0.12, opacity: 1 },
              { offset: 0.78, opacity: 1, transform: 'translate(1.5%, 1%) rotate(2deg) scale(1.03)' },
              { opacity: 1, transform: 'translate(0%, 0%) rotate(0deg) scale(1)' },
            ],
            T.envInDur,
            { easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)' },
          );
          cue(late, playEnvelopeWhoosh);
        });
        // Landed, the envelope must stop being a layer of its own (an animation holding its opacity and
        // transform makes it one), so its pieces stack with the decks: the open flap under the decks, the
        // card dropping in over them, and the pocket's front over that card.
        at(T.envIn + T.envInDur, () => {
          envSwoop?.cancel();
          if (envEl) envEl.style.opacity = '1';
        });
        tucks.forEach((el, i) =>
          at(T.tuck + i * T.tuckGap, (late) => {
            // From the top of its deck, up and over, and down through the mouth into its slot.
            const sx = geo.deckX[i] - cw / 2 - (env.x + env.w * SLOT_LEFT[i]);
            const sy = geo.deckY - ch / 2 - (env.y + env.h * SLOT_TOP);
            play(
              el,
              [
                { transform: `translate(${sx}px, ${sy}px) rotate(0deg)`, visibility: 'visible', easing: 'cubic-bezier(0.3, 0.6, 0.5, 1)' },
                { offset: 0.38, transform: `translate(${sx * 0.45}px, ${sy - ch * 0.3}px) rotate(${(1 - i) * 7}deg)`, visibility: 'visible', easing: 'cubic-bezier(0.55, 0, 0.75, 0.5)' },
                { transform: 'translate(0px, 0px) rotate(0deg)', visibility: 'visible' },
              ],
              T.tuckDur,
            );
            cue(late, playCardSlide);
          }),
        );

        // ---- closed, sealed, stamped ----
        at(T.close, (late) => {
          // The perspective rides in the flap's own transform: one on a parent would make a layer again.
          const hinge = `perspective(${env.w * 2}px)`;
          play(flap, [{ transform: `${hinge} rotateX(176deg)` }, { transform: `${hinge} rotateX(0deg)` }], T.closeDur, { easing: 'ease-in-out' });
          play(flapShadow, [{ opacity: 0 }, { opacity: 1 }], 300, { delay: T.closeDur * 0.55 });
          cue(late, playPaperFlap);
        });
        // Back past vertical the flap is in front of the cards again, showing its outside.
        at(T.close + T.closeDur / 2, () => envEl?.classList.remove('flap-open'));
        at(T.seal, () =>
          play(
            seal,
            [
              { opacity: 0, transform: 'translateY(-60%) scale(1.8)', easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)' },
              { offset: 0.6, opacity: 1, transform: 'translateY(0%) scale(0.92)' },
              { offset: 0.8, opacity: 1, transform: 'translateY(0%) scale(1.05)' },
              { opacity: 1, transform: 'translateY(0%) scale(1)' },
            ],
            T.sealDur,
          ),
        );
        at(T.seal + T.sealDur * 0.6, (late) => cue(late, playSealPress));
        at(T.stamp, () =>
          play(
            slam,
            [
              { opacity: 0, transform: 'scale(2.4)', easing: 'cubic-bezier(0.55, 0, 0.9, 0.45)' },
              { offset: 0.6, opacity: 1, transform: 'scale(0.95)' },
              { offset: 0.8, opacity: 1, transform: 'scale(1.03)' },
              { opacity: 1, transform: 'scale(1)' },
            ],
            T.stampDur,
          ),
        );
        at(T.stamp + T.stampDur * 0.55, (late) => {
          cue(late, playStampThud);
          play(
            envIn,
            [
              { transform: 'translate(0px, 0px)' },
              { offset: 0.2, transform: 'translate(-4px, 3px)' },
              { offset: 0.4, transform: 'translate(4px, -3px)' },
              { offset: 0.6, transform: 'translate(-3px, 2px)' },
              { offset: 0.8, transform: 'translate(2px, -1px)' },
              { transform: 'translate(0px, 0px)' },
            ],
            260,
            { fill: 'none' },
          );
        });
        // The flap's own printed stamp (the same one the board shows) takes over from the slammed copy.
        at(T.stamp + T.stampDur + 250, () => {
          envEl?.classList.add('stamped');
          play(slam, [{ opacity: 0 }, { opacity: 0 }], 1);
        });

        // ---- to the board ----
        at(T.envOut, (late) => {
          const box = root.getBoundingClientRect();
          const from = { x: env.x + env.w / 2, y: env.y + env.h / 2 };
          const slot = boardEnvelopeSlot(box);
          if (envEl) envEl.style.zIndex = '30'; // sealed now, it flies over the decks
          cue(late, playEnvelopeWhoosh);
          if (slot) {
            const dx = slot.x - from.x;
            const dy = slot.y - from.y;
            const s = slot.w / env.w;
            play(
              envEl,
              [
                { opacity: 1, transform: 'translate(0px, 0px) rotate(0deg) scale(1)', easing: 'cubic-bezier(0.45, 0, 0.25, 1)' },
                { offset: 0.3, opacity: 1, transform: `translate(${dx * 0.12}px, ${dy * 0.12 - env.h * 0.12}px) rotate(3deg) scale(${1 - (1 - s) * 0.25})`, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
                { opacity: 1, transform: `translate(${dx}px, ${dy}px) rotate(-12deg) scale(${s})` },
              ],
              T.envOutDur,
            );
          } else {
            // No corner on screen for it: off the top-left edge instead.
            play(
              envEl,
              [
                { opacity: 1, transform: 'translate(0px, 0px) rotate(0deg) scale(1)', easing: 'cubic-bezier(0.6, 0, 0.9, 0.4)' },
                { offset: 0.8, opacity: 1 },
                { opacity: 0, transform: `translate(${-(from.x + env.w)}px, ${-(from.y + env.h)}px) rotate(-30deg) scale(0.35)` },
              ],
              T.envOutDur,
            );
          }
        });
        step({
          at: T.envOut + T.envOutDur,
          state: () => live.current.onEnvelopePlaced(),
          // The board's envelope fades in beneath as this one fades out.
          run: () => play(envEl, [{ opacity: 1 }, { opacity: 0 }], T.envFade),
        });

        // ---- one deck ----
        at(T.merge, (late) => {
          decks.forEach((d, i) =>
            play(
              d,
              [
                { opacity: 1, transform: 'translate(0px, 0px) scale(1)' },
                { opacity: 1, transform: `translate(${geo.dealX - geo.deckX[i]}px, ${geo.dealY - geo.deckY}px) scale(1)` },
              ],
              T.mergeDur,
              { easing: 'cubic-bezier(0.5, 0, 0.25, 1)' },
            ),
          );
          deckLabels.forEach((l) => play(l, [{ opacity: 1 }, { opacity: 0 }], 250));
          cue(late, playCardSlide);
        });
        at(T.merge + T.mergeDur, () => {
          decks[0].style.visibility = 'hidden';
          decks[2].style.visibility = 'hidden';
        });
        at(T.riffle3, (late) => {
          riffle(film, decks[1], cw);
          cue(late, playShuffle);
        });

        // ---- the deal ----
        const n = p.seats.length;
        const mySeat = p.myId ? p.seats.findIndex((s) => s.id === p.myId) : -1;
        const total = p.seats.reduce((sum, s) => sum + s.handCount, 0);
        const cadence = total > 0 ? Math.min(T.maxCadence, T.dealWindow / total) : 0;
        const deckScale = cw / BASE_W;
        const from = { x: geo.dealX, y: geo.dealY };

        for (let k = 0; k < total; k++) {
          const seat = k % n;
          const t = T.deal + k * cadence;
          if (seat === mySeat) {
            const i = Math.floor(k / n);
            const el = mine[i];
            const card = p.yourHand[i];
            if (!el || !card) continue;
            at(t, (late) => {
              flyToHand(film, el, from, fanSpot(root, p.yourHand.slice(0, i + 1), card), area, deckScale);
              cue(late, playCardDeal);
            });
            at(t + MINE_FLIGHT * 0.46, (late) => cue(late, playCardFlip));
            step({ at: t + MINE_FLIGHT, state: () => live.current.onDealtToMe(i + 1), run: () => retire(el) });
          } else {
            const el = others[k % others.length];
            at(t, (late) => {
              flyOff(film, el, from, seatAngle(seat, mySeat, n), area, ch, deckScale, ((k * 37) % 31) - 15);
              cue(late, playCardDeal);
            });
          }
        }
        at(T.fade, () => play(dim, [{ opacity: 1 }, { opacity: 0 }], T.fadeDur, { easing: 'ease-in' }));

        // ---- the counts on the decks, kept in step with the clock ----
        return (e: number) => {
          if (e < T.merge + T.mergeDur) {
            for (let i = 0; i < 3; i++) counters[i](p.deckSizes[i] - (e >= T.tuck + i * T.tuckGap ? 1 : 0));
            return;
          }
          const dealt = e < T.deal || total === 0 ? 0 : Math.min(total, Math.floor((e - T.deal) / cadence) + 1);
          counters[1](total - dealt);
        };
      },
      () => live.current.onDone(),
    );
  }, [geo]);

  const zoomTo = (w: number) => ({ zoom: w / CARD_W });
  return (
    <div className="odeal" ref={rootRef} aria-hidden="true">
      <div className="odeal__dim" data-dim="" />
      {geo && (
        <>
          {DECK_LABELS.map((label, i) => (
            <DeckStack key={label} x={geo.deckX[i]} y={geo.deckY} cw={geo.cw} label={label} count={props.deckSizes[i]} />
          ))}

          <div
            className="odeal__env flap-open"
            data-env=""
            style={{ left: geo.env.x, top: geo.env.y, width: geo.env.w, height: geo.env.h }}
          >
            <div className="odeal__envin" data-envin="">
              <div className="odeal__l odeal__tucks">
                {SLOT_LEFT.map((left, i) => (
                  <div key={i} className="odeal__tuck" data-tuck="" style={{ left: geo.env.w * left, top: geo.env.h * SLOT_TOP, width: geo.cw }}>
                    <div style={zoomTo(geo.cw)}>
                      <CardBack />
                    </div>
                  </div>
                ))}
              </div>
              <svg className="odeal__l odeal__body" viewBox={VB} xmlns="http://www.w3.org/2000/svg">
                <EnvelopeDefs idPrefix="odeal" />
                <EnvelopeBody idPrefix="odeal" mouth />
              </svg>
              <svg className="odeal__l odeal__flapshadow" data-flapshadow="" viewBox={VB} xmlns="http://www.w3.org/2000/svg">
                <EnvelopeFlapShadow idPrefix="odeal" />
              </svg>
              <div className="odeal__l odeal__flap" data-flap="" style={{ transform: `perspective(${geo.env.w * 2}px) rotateX(176deg)` }}>
                <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg">
                  <EnvelopeFlap idPrefix="odeal" stamp="CLASSIFIED" />
                </svg>
              </div>
              <svg className="odeal__l odeal__seal" data-seal="" viewBox={VB} xmlns="http://www.w3.org/2000/svg">
                <EnvelopeSeal idPrefix="odeal" />
              </svg>
              <svg className="odeal__l odeal__slam" data-slam="" viewBox={VB} xmlns="http://www.w3.org/2000/svg">
                <InkStamp idPrefix="odeal" text="CLASSIFIED" box={STAMP_BOX} />
              </svg>
            </div>
          </div>

          <FlyingBacks count={OTHER_POOL} name="other" />
          <FlyingFaces cardIds={mySeatAtMount >= 0 ? props.yourHand : []} name="mine" />
        </>
      )}
    </div>
  );
}
