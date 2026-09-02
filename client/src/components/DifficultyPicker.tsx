import { BOT_DIFFICULTIES, BOT_DIFFICULTY_BLURB, BOT_DIFFICULTY_LABEL, type BotDifficulty } from 'shared';
import './DifficultyPicker.css';

/** Easy / Medium / Hard as a segmented control. `readOnly` renders just the current value (for
 *  non-hosts); `compact` is the small per-seat version. */
export function DifficultyPicker({
  value,
  onChange,
  readOnly = false,
  compact = false,
  title,
}: {
  value: BotDifficulty;
  onChange?: (d: BotDifficulty) => void;
  readOnly?: boolean;
  compact?: boolean;
  title?: string;
}) {
  if (readOnly) {
    return (
      <span className={`diff diff--ro diff--${value}${compact ? ' diff--compact' : ''}`} title={BOT_DIFFICULTY_BLURB[value]}>
        {BOT_DIFFICULTY_LABEL[value]}
      </span>
    );
  }
  return (
    <span className={`diff${compact ? ' diff--compact' : ''}`} role="radiogroup" title={title}>
      {BOT_DIFFICULTIES.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={d === value}
          className={`diff__opt diff__opt--${d}${d === value ? ' diff__opt--on' : ''}`}
          title={BOT_DIFFICULTY_BLURB[d]}
          onClick={(e) => {
            e.stopPropagation();
            if (d !== value) onChange?.(d);
          }}
        >
          {compact ? BOT_DIFFICULTY_LABEL[d].slice(0, 1) : BOT_DIFFICULTY_LABEL[d]}
        </button>
      ))}
    </span>
  );
}
