import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getCard } from 'shared';
import { Card } from './Card';
import { CardBack } from './CardBack';
import { BigStamp, EnvelopeBody, EnvelopeDefs, EnvelopeFlap, EnvelopeFlapShadow, EnvelopeSeal, ENVELOPE_VIEWBOX } from './EnvelopeArt';
import {
  playCardFlip,
  playCardSlide,
  playEnvelopeWhoosh,
  playPaperFlap,
  playSealFlick,
  playSealPress,
  playStampThud,
  playWaxCrack,
} from '../util/sound';
import './AccusationReveal.css';

/** Which cut of the reveal a viewer gets: the verdict, and whether the accusation was theirs. */
export type RevealVariant = 'correct' | 'accuser-wrong' | 'other-wrong';
type Trio = { suspectId: string; weaponId: string; roomId: string };

/** The beats below are storyboarded at full speed and played this many times slower. */
export const REVEAL_PACE = 2;

// Storyboard durations (ms at full speed). The CSS repeats them, scaled by `--pace`.
const D = { swoop: 800, settle: 150, pry: 350, fly: 400, flap: 700, rise: 500, riseGap: 130, flip: 600, flipGap: 500, stamp: 320, out: 550, fade: 500 };

type Step = { at: number; add?: string; remove?: string; flip?: number; sound?: () => void };

/**
 * The film, as a list of moments: each adds or removes a class on the overlay root (the CSS does the
 * moving), flips one card, or plays a cue. Everyone sees the same opening — the envelope swoops in,
 * the seal comes off, the flap opens, three face-down cards rise out — and the cut branches from
 * there: the cards turn over for the whole table on a correct accusation and for the accuser alone
 * on a wrong one; the verdict is stamped over the screen; a wrong accusation's envelope then packs
 * up and leaves, while a correct one fades to the end screen.
 */
function plan(variant: RevealVariant): { steps: Step[]; total: number } {
  const steps: Step[] = [];
  const add = (s: Step) => steps.push(s);
  add({ at: 0, add: 'p-swoop', sound: playEnvelopeWhoosh });
  const pryAt = D.swoop + D.settle;
  add({ at: pryAt, add: 'p-pry', sound: playWaxCrack });
  const flyAt = pryAt + D.pry;
  add({ at: flyAt, add: 'p-fly', sound: playSealFlick });
  const flapAt = flyAt + D.fly - 50;
  add({ at: flapAt, add: 'p-flap', sound: playPaperFlap });
  add({ at: flapAt + D.flap / 2, add: 'flap-open' }); // past vertical: the flap goes behind the cards
  const riseAt = flapAt + D.flap;
  for (let i = 0; i < 3; i++) add({ at: riseAt + i * D.riseGap, add: i === 0 ? 'p-rise' : undefined, sound: playCardSlide });
  const cardsUp = riseAt + D.rise + 2 * D.riseGap;

  const stamp = (at: number) => {
    add({ at, add: 'p-stamp' });
    add({ at: at + 160, sound: playStampThud }); // the slam lands a beat after it starts
  };
  let retreatAt: number | undefined;
  let total = 0;
  if (variant === 'other-wrong') {
    const stampAt = cardsUp + 340;
    stamp(stampAt);
    retreatAt = stampAt + D.stamp + 1330;
  } else {
    const firstFlip = cardsUp + 140;
    for (let i = 0; i < 3; i++) {
      const at = firstFlip + i * D.flipGap;
      add({ at, flip: i });
      add({ at: at + D.flip * 0.55, sound: playCardFlip }); // the face turns at the flip's midpoint
    }
    const flipsDone = firstFlip + 2 * D.flipGap + D.flip;
    const stampAt = flipsDone + 150;
    stamp(stampAt);
    if (variant === 'correct') {
      const fadeAt = stampAt + D.stamp + 1280;
      add({ at: fadeAt, add: 'p-fade' });
      total = fadeAt + D.fade;
    } else {
      retreatAt = stampAt + D.stamp + 780;
    }
  }
  if (retreatAt !== undefined) {
    // The stamp fades while the cards slide back, and is fully gone before the flap swings shut:
    // the flap carries its own CLASSIFIED stamp, and the two must never share the screen.
    add({ at: retreatAt, add: 'p-back', sound: playCardSlide });
    add({ at: retreatAt, add: 'p-unstamp' });
    add({ at: retreatAt + 700, add: 'p-close', sound: playPaperFlap });
    add({ at: retreatAt + 1050, remove: 'flap-open' }); // back past vertical: in front again
    add({ at: retreatAt + 1200, add: 'p-sealback' });
    add({ at: retreatAt + 1520, sound: playSealPress }); // pressed down at the end of its return
    add({ at: retreatAt + 1550, add: 'p-out', sound: playEnvelopeWhoosh });
    total = retreatAt + 1550 + D.out;
  }
  return { steps, total };
}

/** How long a viewer's cut runs, in real ms — what the Game screen holds the next turn for. */
export function revealTotalMs(variant: RevealVariant): number {
  return plan(variant).total * REVEAL_PACE;
}

const VB = `0 0 ${ENVELOPE_VIEWBOX.w} ${ENVELOPE_VIEWBOX.h}`;

/**
 * The accusation reveal: the board's CLASSIFIED envelope, opened centre-screen. Fixed over the map
 * area (never the chat), above the hand fan and pop-ups, below the folders and the card zoom.
 * `trio` is the envelope, for the cuts that turn the cards over; without it the cards stay backs.
 * Keyed by the parent on the announcement, so a new accusation starts a fresh reveal.
 */
export function AccusationReveal({ variant, trio, onDone }: { variant: RevealVariant; trio?: Trio; onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [twoLine, setTwoLine] = useState(false);
  const faces = variant !== 'other-wrong' && trio ? [trio.suspectId, trio.weaponId, trio.roomId].map((id) => getCard(id)) : null;

  // Size the scene to the area: the envelope is two-thirds of the width (92% on a phone-width map),
  // capped so the standing cards clear the top. Each card is 23.4% of the envelope wide; `Card`
  // draws at 200px, so a zoom factor scales it — text and all — to that width.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const narrow = w < 600;
      const envW = Math.min(w * (narrow ? 0.92 : 0.666), h * 0.9);
      el.style.setProperty('--env-w', `${envW}px`);
      el.style.setProperty('--area-w', `${w}px`);
      el.style.setProperty('--card-zoom', `${(envW * 0.2344) / 200}`);
      setTwoLine(narrow);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const { steps, total } = plan(variant);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const apply = (s: Step) => {
      if (s.add) el.classList.add(s.add);
      if (s.remove) el.classList.remove(s.remove);
      if (s.flip !== undefined) el.querySelector(`[data-card="${s.flip}"]`)?.classList.add('is-flipped');
    };
    if (reduced) {
      // Straight to the finished picture — open envelope, cards, verdict — and hold it for a beat.
      const stampAt = steps.find((s) => s.add === 'p-stamp')?.at ?? 0;
      steps.filter((s) => s.at <= stampAt).forEach(apply);
      timers.push(setTimeout(onDone, 3000));
    } else {
      for (const s of steps) {
        timers.push(
          setTimeout(() => {
            apply(s);
            s.sound?.();
          }, s.at * REVEAL_PACE),
        );
      }
      timers.push(setTimeout(onDone, total * REVEAL_PACE));
    }
    return () => timers.forEach(clearTimeout);
    // One run per reveal: the parent keys this component on the announcement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stamp =
    variant === 'correct'
      ? { lines: ['CORRECT'], color: '#1f9d55' }
      : { lines: twoLine ? ['INCORRECT', 'ACCUSATION'] : ['INCORRECT ACCUSATION'], color: '#d3131f' };
  // BigStamp's viewBox width follows its longest line; scale by it so every stamp's letters match.
  const stampVbW = Math.max(440, Math.min(1000, Math.max(...stamp.lines.map((l) => l.length)) * 50));

  return (
    <div className="accrev" ref={rootRef} aria-hidden="true">
      <div className="accrev__scene">
        <div className="accrev__env">
          <div className="accrev__l accrev__cards">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`accrev__slot accrev__slot-${i + 1}`}>
                <div className="accrev__flipper" data-card={i}>
                  <div className="accrev__face accrev__face--back">
                    <CardBack />
                  </div>
                  {faces?.[i] && (
                    <div className="accrev__face accrev__face--front">
                      <Card card={faces[i]!} zoomable={false} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <svg className="accrev__l accrev__body" viewBox={VB} xmlns="http://www.w3.org/2000/svg">
            <EnvelopeDefs idPrefix="accrev" />
            <EnvelopeBody idPrefix="accrev" mouth />
          </svg>
          <svg className="accrev__l accrev__flapshadow" viewBox={VB} xmlns="http://www.w3.org/2000/svg">
            <EnvelopeFlapShadow idPrefix="accrev" />
          </svg>
          <div className="accrev__l accrev__flap">
            <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg">
              <EnvelopeFlap idPrefix="accrev" stamp="CLASSIFIED" />
            </svg>
          </div>
          <svg className="accrev__l accrev__seal" viewBox={VB} xmlns="http://www.w3.org/2000/svg">
            <EnvelopeSeal idPrefix="accrev" />
          </svg>
        </div>
      </div>
      <div className="accrev__stamp" style={{ width: `calc(var(--area-w) * 0.8 * ${stampVbW / 1000})` }}>
        <div className="accrev__stampin">
          <BigStamp idPrefix="accrev" lines={stamp.lines} color={stamp.color} />
        </div>
      </div>
    </div>
  );
}
