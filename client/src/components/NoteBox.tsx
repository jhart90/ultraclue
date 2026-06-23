import { memo } from 'react';

// A single Detective-Notes cell. Clicking cycles through 14 fill states, in the order specified:
// 0 blank, 1 full, 2-5 diagonal halves (UR, LR, LL, UL), 6-9 straight halves (top, right, bottom,
// left), 10-13 quarters (UL, UR, LR, LL), then back to blank.
export const NOTE_STATES = 14;

const MARK = 'var(--note-mark, #e9dfc4)';

function Shape({ state }: { state: number }) {
  switch (state) {
    case 1:
      return <rect x="0" y="0" width="20" height="20" fill={MARK} />;
    case 2: // half upper-right
      return <polygon points="0,0 20,0 20,20" fill={MARK} />;
    case 3: // half lower-right
      return <polygon points="20,0 20,20 0,20" fill={MARK} />;
    case 4: // half lower-left
      return <polygon points="0,0 0,20 20,20" fill={MARK} />;
    case 5: // half upper-left
      return <polygon points="0,0 20,0 0,20" fill={MARK} />;
    case 6: // top half
      return <rect x="0" y="0" width="20" height="10" fill={MARK} />;
    case 7: // right half
      return <rect x="10" y="0" width="10" height="20" fill={MARK} />;
    case 8: // bottom half
      return <rect x="0" y="10" width="20" height="10" fill={MARK} />;
    case 9: // left half
      return <rect x="0" y="0" width="10" height="20" fill={MARK} />;
    case 10: // quarter upper-left
      return <rect x="0" y="0" width="10" height="10" fill={MARK} />;
    case 11: // quarter upper-right
      return <rect x="10" y="0" width="10" height="10" fill={MARK} />;
    case 12: // quarter lower-right
      return <rect x="10" y="10" width="10" height="10" fill={MARK} />;
    case 13: // quarter lower-left
      return <rect x="0" y="10" width="10" height="10" fill={MARK} />;
    default:
      return null;
  }
}

export const NoteBox = memo(function NoteBox({
  state,
  onClick,
}: {
  state: number;
  onClick: () => void;
}) {
  return (
    <button className="notebox" onClick={onClick} aria-label={`note mark state ${state}`}>
      <svg viewBox="0 0 20 20" width="100%" height="100%">
        <Shape state={state} />
      </svg>
    </button>
  );
});
