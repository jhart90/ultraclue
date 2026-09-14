import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BASE_W } from '../util/fanLayout';
import { playCardDeal, playCardFlip, playCardSlide, playShuffle } from '../util/sound';
import {
  DeckStack,
  FlyingBacks,
  FlyingFaces,
  MINE_FLIGHT,
  OTHER_POOL,
  cardHeight,
  deckCounter,
  fanSpot,
  flyFromHand,
  flyIn,
  flyOff,
  flyToHand,
  retire,
  riffle,
  runFilm,
  sceneCardWidth,
  seatAngle,
} from './dealKit';

/**
 * A wrong accuser's cards redistributed, played over the map on every screen once the envelope
 * reveal is over:
 *  1. their cards gather into one face-down deck in the middle of the table — flying in from their
 *     seat off the edge of the screen, or, when they are yours, lifting out of your hand fan and
 *     turning face down;
 *  2. the deck is riffle-shuffled twice;
 *  3. it is dealt out one card at a time, round-robin over the players still in: everyone else's
 *     cards fly off toward their seats, and each card of yours turns face up and slots into your fan.
 *
 * Like the opening deal it replays rather than receives: the server records who got each card of the
 * shuffled hand (GameState.redeal), and a screen knows only its own new cards, which it finds by
 * comparing its hand before and after. Built on dealKit.
 */

/** Beats, in ms from the start. */
const T = {
  gather: 250,
  /** The gathering takes this long whatever the hand's size (card to card, at most maxGatherGap). */
  gatherWindow: 1500,
  maxGatherGap: 90,
  gatherFlight: 480,
  handFlight: 700,
  riffles: [2400, 3550],
  deal: 4800,
  /** The deck goes out in this long whatever its size (card to card, at most maxCadence). */
  dealWindow: 3600,
  maxCadence: 160,
  fade: 9100,
  fadeDur: 450,
};
/** The film's length. The server holds the table for REDEAL_ANIM_MS after the reveal; this is inside it. */
export const REDEAL_FILM_MS = 9_600;
/** Flying backs for the gathering, reused round-robin. */
const GATHER_POOL = 16;

export interface RedealProps {
  /** Local Date.now() at which the film starts (this screen's envelope reveal has finished). */
  startAt: number;
  /** Every player in seat order, the eliminated one included, so seats stay where they were. */
  seats: { id: string }[];
  /** The viewer's seat, or null for an observer. */
  myId: string | null;
  /** The eliminated player, and what to call their deck. */
  fromId: string;
  fromName: string;
  /** Who gets each card, in the order the cards are dealt. */
  recipients: string[];
  /** The cards you already held and keep. */
  baseHand: string[];
  /** The cards coming to you, in the order they are dealt to you. */
  newCards: string[];
  /** When the cards being redistributed are yours: your hand, to lift out of the fan. Else empty. */
  gatherHand: string[];
  /** Your cards have left the fan: stop showing them there. */
  onGathered: () => void;
  /** Your `count`-th new card has landed in the fan. */
  onDealtToMe: (count: number) => void;
  onDone: () => void;
}

export function Redeal(props: RedealProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<{ W: number; H: number } | null>(null);
  // The film is built once; callbacks are read through this so a parent re-render can't go stale.
  const live = useRef(props);
  live.current = props;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el) setArea({ W: el.clientWidth, H: el.clientHeight });
  }, []);

  const cw = area ? sceneCardWidth(area.W, area.H) : 0;
  const centre = area ? { x: area.W / 2, y: area.H * 0.42 } : { x: 0, y: 0 };

  useEffect(() => {
    const root = rootRef.current;
    if (!area || !root) return;
    const p = live.current;
    const ch = cardHeight(cw);
    const deckScale = cw / BASE_W;
    const n = p.seats.length;
    const mySeat = p.myId ? p.seats.findIndex((s) => s.id === p.myId) : -1;
    const fromSeat = p.seats.findIndex((s) => s.id === p.fromId);
    const total = p.recipients.length;
    const fromMe = p.gatherHand.length > 0;

    return runFilm(
      p.startAt,
      REDEAL_FILM_MS,
      (film) => {
        const { play, at, step, cue } = film;
        const all = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
        const dim = root.querySelector<HTMLElement>('[data-dim]');
        const deck = root.querySelector<HTMLElement>('[data-deck]');
        if (!deck) return;
        const label = deck.querySelector<HTMLElement>('[data-label]');
        const setCount = deckCounter(deck);
        const gathering = all('[data-gather]');
        const others = all('[data-other]');
        const mine = all('[data-mine]');

        at(0, () => play(dim, [{ opacity: 0 }, { opacity: 1 }], 400, { easing: 'ease-out' }));

        // ---- the cards gather into one deck ----
        const gatherCount = fromMe ? p.gatherHand.length : total;
        const gap = gatherCount > 1 ? Math.min(T.maxGatherGap, T.gatherWindow / (gatherCount - 1)) : 0;
        const flight = fromMe ? T.handFlight : T.gatherFlight;
        const landedBy = (e: number) =>
          gatherCount === 0 || e < T.gather + flight ? 0 : gap === 0 ? gatherCount : Math.min(gatherCount, Math.floor((e - T.gather - flight) / gap) + 1);
        at(T.gather, () => {
          deck.style.opacity = '1';
        });
        if (fromMe) {
          // Every card is set on its slot at once (face up, where the fan had it) and the fan lets go
          // of them in the same moment; each then lifts out in turn.
          step({
            at: T.gather,
            run: (late) => {
              p.gatherHand.forEach((id, k) => {
                const el = gathering[k];
                const spot = el && fanSpot(root, p.gatherHand, id);
                if (el && spot) flyFromHand(film, el, spot, centre, deckScale, T.handFlight, k * gap);
                else if (el) flyIn(film, el, centre, 0, area, ch, deckScale, 0, T.handFlight);
              });
              cue(late, playCardSlide);
            },
            state: () => live.current.onGathered(),
          });
          p.gatherHand.forEach((_, k) => {
            const el = gathering[k];
            if (el) at(T.gather + k * gap + T.handFlight, () => retire(el, 0));
          });
        } else {
          const theta = fromSeat >= 0 ? seatAngle(fromSeat, mySeat, n) : 0;
          for (let k = 0; k < total; k++) {
            const el = gathering[k % gathering.length];
            if (!el) break;
            at(T.gather + k * gap, (late) => {
              flyIn(film, el, centre, theta, area, ch, deckScale, ((k * 29) % 25) - 12, T.gatherFlight);
              cue(late, playCardDeal);
            });
          }
        }

        // ---- shuffled ----
        for (const start of T.riffles) {
          at(start, (late) => {
            riffle(film, deck, cw);
            cue(late, playShuffle);
          });
        }

        // ---- dealt round the players still in ----
        at(T.deal, () => play(label, [{ opacity: 1 }, { opacity: 0 }], 250));
        const cadence = total > 0 ? Math.min(T.maxCadence, T.dealWindow / total) : 0;
        let mineDealt = 0;
        p.recipients.forEach((id, k) => {
          const seat = p.seats.findIndex((s) => s.id === id);
          const t = T.deal + k * cadence;
          if (mySeat >= 0 && seat === mySeat) {
            const i = mineDealt++;
            const el = mine[i];
            const card = p.newCards[i];
            if (!el || !card) return;
            at(t, (late) => {
              flyToHand(film, el, centre, fanSpot(root, [...p.baseHand, ...p.newCards.slice(0, i + 1)], card), area, deckScale);
              cue(late, playCardDeal);
            });
            at(t + MINE_FLIGHT * 0.46, (late) => cue(late, playCardFlip));
            step({ at: t + MINE_FLIGHT, state: () => live.current.onDealtToMe(i + 1), run: () => retire(el) });
          } else {
            const el = others[k % others.length];
            if (!el) return;
            at(t, (late) => {
              flyOff(film, el, centre, seatAngle(Math.max(0, seat), mySeat, n), area, ch, deckScale, ((k * 37) % 31) - 15);
              cue(late, playCardDeal);
            });
          }
        });
        at(T.fade, () => play(dim, [{ opacity: 1 }, { opacity: 0 }], T.fadeDur, { easing: 'ease-in' }));

        // The deck's count: climbing as the cards gather, falling as they are dealt.
        return (e: number) => {
          if (e < T.deal) setCount(landedBy(e));
          else setCount(total - (cadence > 0 ? Math.min(total, Math.floor((e - T.deal) / cadence) + 1) : total));
        };
      },
      () => live.current.onDone(),
    );
    // One film per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area]);

  return (
    <div className="odeal" ref={rootRef} aria-hidden="true">
      <div className="odeal__dim" data-dim="" />
      {area && (
        <>
          <DeckStack x={centre.x} y={centre.y} cw={cw} label={`${props.fromName}'s cards`} count={0} />
          {props.gatherHand.length > 0 ? (
            <FlyingFaces cardIds={props.gatherHand} name="gather" />
          ) : (
            <FlyingBacks count={Math.min(GATHER_POOL, props.recipients.length)} name="gather" />
          )}
          <FlyingBacks count={OTHER_POOL} name="other" />
          <FlyingFaces cardIds={props.newCards} name="mine" />
        </>
      )}
    </div>
  );
}
