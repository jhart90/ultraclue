import dice1 from '../../../assets/sounds/dice_1.mp3';
import dice2 from '../../../assets/sounds/dice_2.mp3';
import dice3 from '../../../assets/sounds/dice_3.mp3';
import diceMany from '../../../assets/sounds/dice_many.mp3';

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

export function playDiceRoll(): void {
  if (!soundEnabled() || typeof Audio === 'undefined') return;
  try {
    const audio = new Audio(CLIPS[Math.floor(Math.random() * CLIPS.length)]);
    audio.volume = 0.6;
    void audio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

// A soft "card slides out of the fan" whisper for the hand: a 50ms burst of band-passed noise,
// synthesised on the spot so there's no clip to download. Played on every hover change, so it is
// kept quiet and short.
let audioCtx: AudioContext | null = null;

export function playCardHover(): void {
  if (!soundEnabled() || typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const ctx = audioCtx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
  } catch {
    /* ignore */
  }
}
