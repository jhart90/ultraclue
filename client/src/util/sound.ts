import dice1 from '../../../assets/sounds/dice_1.mp3';
import dice2 from '../../../assets/sounds/dice_2.mp3';
import dice3 from '../../../assets/sounds/dice_3.mp3';
import diceMany from '../../../assets/sounds/dice_many.mp3';
import envelopeWhoosh from '../../../assets/sounds/envelope_whoosh.mp3';
import stampThud from '../../../assets/sounds/stamp_thud.mp3';

// The four dice rattles from Roll67; one is picked at random for every roll so a long game
// doesn't play the identical clip a hundred times. Browsers only allow playback after the user has
// interacted with the page, which has always happened by the time anyone rolls (they clicked
// through the lobby), so play() generally succeeds; we swallow the rejection just in case.
const CLIPS = [dice1, dice2, dice3, diceMany];

const SOUND_KEY = 'ultraclue-sound';

/** Whether this browser wants game sounds (default on). */
export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

function playClip(src: string, volume: number): void {
  if (!soundEnabled() || typeof Audio === 'undefined') return;
  try {
    const audio = new Audio(src);
    audio.volume = volume;
    void audio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

export function playDiceRoll(): void {
  playClip(CLIPS[Math.floor(Math.random() * CLIPS.length)], 0.6);
}

// The accusation reveal's two big cues are clips (rendered by scripts in the repo's history, easy to
// swap for recordings): the case envelope swooping on or off screen, and the verdict stamp landing.
export function playEnvelopeWhoosh(): void {
  playClip(envelopeWhoosh, 0.55);
}
export function playStampThud(): void {
  playClip(stampThud, 0.85);
}

// ---- synthesised cues: short bursts of shaped noise and a few thumps, made on the spot so there
// is nothing to download. Quiet and brief, since some play many times a game. ----
let audioCtx: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (!soundEnabled() || typeof window === 'undefined') return null;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx ??= new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** A gain that rises to `peak` over `attack` seconds and dies away by `dur`. */
function envelope(c: AudioContext, at: number, peak: number, attack: number, dur: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(c.destination);
  return g;
}

/** White noise through one biquad filter (optionally gliding its frequency), shaped by an envelope. */
function burst(
  c: AudioContext,
  at: number,
  dur: number,
  filter: { type: BiquadFilterType; freq: number; q?: number; to?: number },
  peak: number,
  attack = 0.004,
): void {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = filter.type;
  f.frequency.setValueAtTime(filter.freq, at);
  if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, at + dur);
  if (filter.q) f.Q.value = filter.q;
  src.connect(f).connect(envelope(c, at, peak, attack, dur));
  src.start(at);
}

/** A sine (or other) tone sliding from f0 to f1 as it dies away. */
function thump(c: AudioContext, at: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType = 'sine'): void {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  o.connect(envelope(c, at, peak, 0.005, dur));
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** A soft "card slides out of the fan" whisper for the hand. Played on every hover change. */
export function playCardHover(): void {
  const c = ctx();
  if (!c) return;
  try {
    burst(c, c.currentTime, 0.05, { type: 'bandpass', freq: 2600, q: 0.9 }, 0.07);
  } catch {
    /* ignore */
  }
}

/** The wax seal cracking free of the paper. */
export function playWaxCrack(): void {
  const c = ctx();
  if (!c) return;
  try {
    const t = c.currentTime;
    [0, 0.05, 0.11].forEach((o, i) => burst(c, t + o, 0.03, { type: 'highpass', freq: 1800 + i * 600 }, 0.35));
    thump(c, t, 140, 60, 0.16, 0.25);
  } catch {
    /* ignore */
  }
}

/** The loosened seal flicked away. */
export function playSealFlick(): void {
  const c = ctx();
  if (!c) return;
  try {
    burst(c, c.currentTime, 0.08, { type: 'bandpass', freq: 3200, q: 2 }, 0.18, 0.01);
  } catch {
    /* ignore */
  }
}

/** The flap swinging open or shut: a breath of paper. */
export function playPaperFlap(): void {
  const c = ctx();
  if (!c) return;
  try {
    burst(c, c.currentTime, 0.3, { type: 'lowpass', freq: 1400, to: 400 }, 0.2, 0.05);
  } catch {
    /* ignore */
  }
}

/** A card sliding out of (or back into) the envelope. */
export function playCardSlide(): void {
  const c = ctx();
  if (!c) return;
  try {
    burst(c, c.currentTime, 0.09, { type: 'bandpass', freq: 2600, q: 0.9 }, 0.12, 0.02);
  } catch {
    /* ignore */
  }
}

/** A card turning over: the snap of its face landing. */
export function playCardFlip(): void {
  const c = ctx();
  if (!c) return;
  try {
    const t = c.currentTime;
    burst(c, t, 0.025, { type: 'highpass', freq: 2500 }, 0.3, 0.003);
    thump(c, t, 220, 120, 0.08, 0.12, 'triangle');
  } catch {
    /* ignore */
  }
}

/** The seal pressed back onto the closed flap. */
export function playSealPress(): void {
  const c = ctx();
  if (!c) return;
  try {
    const t = c.currentTime;
    thump(c, t, 150, 70, 0.14, 0.3);
    burst(c, t, 0.05, { type: 'lowpass', freq: 1200 }, 0.15);
  } catch {
    /* ignore */
  }
}

/** A deck riffled: a ripple of card edges catching, quickening, then the deck squared up. */
export function playShuffle(): void {
  const c = ctx();
  if (!c) return;
  try {
    const t = c.currentTime;
    const ticks = 14;
    for (let i = 0; i < ticks; i++) {
      const at = t + 0.42 * Math.pow(i / ticks, 0.8);
      burst(c, at, 0.018, { type: 'bandpass', freq: 2900 + Math.random() * 1400, q: 1.4 }, 0.05 + Math.random() * 0.03, 0.002);
    }
    burst(c, t + 0.46, 0.07, { type: 'lowpass', freq: 1600 }, 0.09, 0.005);
  } catch {
    /* ignore */
  }
}

/** One card snapped off the deck in the opening deal. Tiny and quiet — it plays over a hundred
 *  times in a few seconds — and pitched alternately so the run doesn't drone. */
let dealTick = false;
export function playCardDeal(): void {
  if (typeof document !== 'undefined' && document.hidden) return;
  const c = ctx();
  if (!c) return;
  try {
    dealTick = !dealTick;
    burst(c, c.currentTime, 0.035, { type: 'bandpass', freq: dealTick ? 3400 : 2700, q: 1.1 }, 0.045, 0.002);
  } catch {
    /* ignore */
  }
}
