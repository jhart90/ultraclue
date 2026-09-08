import { memo, type CSSProperties } from 'react';

// A single Detective-Notes cell. Clicking cycles through 15 fill states, in the order specified:
// 0 blank, 1 full, 2 X, 3-6 diagonal halves (UR, LR, LL, UL), 7-10 straight halves (top, right,
// bottom, left), 11-14 quarters (UL, UR, LR, LL), then back to blank.
export const NOTE_STATES = 15;

const MARK = 'var(--note-mark, #e9dfc4)';

function Shape({ state }: { state: number }) {
  switch (state) {
    case 1:
      return <rect x="0" y="0" width="20" height="20" fill={MARK} />;
    case 2: // X
      return (
        <g stroke={MARK} strokeWidth="3.4" strokeLinecap="round">
          <line x1="3.5" y1="3.5" x2="16.5" y2="16.5" />
          <line x1="16.5" y1="3.5" x2="3.5" y2="16.5" />
        </g>
      );
    case 3: // half upper-right
      return <polygon points="0,0 20,0 20,20" fill={MARK} />;
    case 4: // half lower-right
      return <polygon points="20,0 20,20 0,20" fill={MARK} />;
    case 5: // half lower-left
      return <polygon points="0,0 0,20 20,20" fill={MARK} />;
    case 6: // half upper-left
      return <polygon points="0,0 20,0 0,20" fill={MARK} />;
    case 7: // top half
      return <rect x="0" y="0" width="20" height="10" fill={MARK} />;
    case 8: // right half
      return <rect x="10" y="0" width="10" height="20" fill={MARK} />;
    case 9: // bottom half
      return <rect x="0" y="10" width="20" height="10" fill={MARK} />;
    case 10: // left half
      return <rect x="0" y="0" width="10" height="20" fill={MARK} />;
    case 11: // quarter upper-left
      return <rect x="0" y="0" width="10" height="10" fill={MARK} />;
    case 12: // quarter upper-right
      return <rect x="10" y="0" width="10" height="10" fill={MARK} />;
    case 13: // quarter lower-right
      return <rect x="10" y="10" width="10" height="10" fill={MARK} />;
    case 14: // quarter lower-left
      return <rect x="0" y="10" width="10" height="10" fill={MARK} />;
    default:
      return null;
  }
}

// The cell is memoised and its callbacks take (cardId, col), so the sheet can hand every cell the
// same two stable functions — a click then re-renders only the one cell whose state changed, which
// matters on a 40-seat table (3 × 40 × 40 = 4,800 cells).
export const NoteBox = memo(function NoteBox({
  state,
  cardId,
  col,
  onCycle,
  onReset,
  style,
}: {
  state: number;
  cardId: string;
  col: number;
  /** Left-click advances the mark to its next state. */
  onCycle: (cardId: string, col: number) => void;
  /** Right-click clears the cell back to blank (next left-click fills it again). */
  onReset: (cardId: string, col: number) => void;
  /** Per-column look (tint, mark colour) — one shared object per column, never per cell. */
  style?: CSSProperties;
}) {
  return (
    <button
      className="notebox"
      style={style}
      onClick={() => onCycle(cardId, col)}
      onContextMenu={(e) => {
        e.preventDefault();
        onReset(cardId, col);
      }}
      aria-label={`note mark state ${state}`}
    >
      <svg viewBox="0 0 20 20" width="100%" height="100%">
        <Shape state={state} />
      </svg>
    </button>
  );
});
