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
