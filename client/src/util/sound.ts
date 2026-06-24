import diceUrl from '../../../assets/dice.mp3';

// Single shared <audio> element for the dice roll. Browsers only allow playback after the user has
// interacted with the page, which has always happened by the time anyone rolls (they clicked through
// the lobby), so play() generally succeeds; we swallow the promise rejection just in case.
const dice = typeof Audio !== 'undefined' ? new Audio(diceUrl) : null;
if (dice) dice.preload = 'auto';

export function playDiceRoll(): void {
  if (!dice) return;
  try {
    dice.currentTime = 0;
    void dice.play().catch(() => {});
  } catch {
    /* ignore */
  }
}
