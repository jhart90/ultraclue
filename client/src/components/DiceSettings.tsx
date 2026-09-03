import { useState } from 'react';
import { contrastPips, type DiceStyle } from 'shared';
import './DiceOverlay.css';

// Swatches ported from Roll67: starburst brights plus white and near-black.
const DICE_PALETTE = ['#ff3d57', '#ff8a00', '#ffe234', '#2fe04a', '#00e5d0', '#0aa8ff', '#b444ff', '#ff4fa3', '#ffffff', '#14171d'];
const PIP_PALETTE = ['#111111', '#ffffff', '#ffe08a', '#ff6b6b', '#7ee89a', '#6cd2c8'];
const AUTO_KEY = 'ultraclue-dice-auto';

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Pick the body and pip colours everyone sees when your dice roll. "Auto" pips are black or white,
 *  whichever reads better on the body colour. */
export function DiceSettings({
  current,
  onChange,
  title = 'Your dice',
}: {
  current: DiceStyle;
  onChange: (color: string, pips: string) => void;
  /** Section heading; the two preview dice sit at its right-hand end. */
  title?: string;
}) {
  const [auto, setAuto] = useState(readAuto);
  const apply = (color: string, pips: string, autoNext: boolean) => {
    setAuto(autoNext);
    try {
      localStorage.setItem(AUTO_KEY, autoNext ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    onChange(color, autoNext ? contrastPips(color) : pips);
  };
  const body = current.color.toLowerCase();
  const pips = current.pips.toLowerCase();

  return (
    <div className="dicepick">
      <div className="game__settinghead2 dicepick__head">
        <span>{title}</span>
        <span className="dicepick__preview" title="How your dice look">
          {[1, 2].map((n) => (
            <span key={n} className="dicepick__die" style={{ background: body }}>
              <span className="dicepick__pip" style={{ background: pips }} />
            </span>
          ))}
        </span>
      </div>
      {/* Each row is a fixed label plus a wrapping box of swatches, so on a narrow panel the
          swatches wrap under themselves instead of dangling under the label. */}
      <div className="dicepick__row">
        <span className="dicepick__label">Dice</span>
        <span className="dicepick__swatches">
          {DICE_PALETTE.map((c) => (
            <button
              key={c}
              className={`dicepick__swatch${body === c ? ' dicepick__swatch--on' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => apply(c, pips, auto)}
            />
          ))}
          <input type="color" className="dicepick__custom" value={body} title="Custom colour" onChange={(e) => apply(e.target.value, pips, auto)} />
        </span>
      </div>
      <div className="dicepick__row">
        <span className="dicepick__label">Pips</span>
        <span className="dicepick__swatches">
          <button
            className={`dicepick__auto${auto ? ' dicepick__auto--on' : ''}`}
            title="Black or white, whichever reads best on your dice"
            onClick={() => apply(body, pips, true)}
          >
            auto
          </button>
          {PIP_PALETTE.map((c) => (
            <button
              key={c}
              className={`dicepick__swatch${!auto && pips === c ? ' dicepick__swatch--on' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => apply(body, c, false)}
            />
          ))}
          <input type="color" className="dicepick__custom" value={pips} title="Custom pip colour" onChange={(e) => apply(body, e.target.value, false)} />
        </span>
      </div>
    </div>
  );
}
