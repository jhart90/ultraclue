import { EnvelopeArt, ENVELOPE_VIEWBOX } from './EnvelopeArt';
import './TitleEnvelope.css';

/** A large, dimensional manila envelope that runs diagonally off the upper-right corner of the title
 *  screen (behind everything, upper-left of the logo). The drawing itself lives in EnvelopeArt so the
 *  board can show the same envelope. Swap in a photo by dropping an image and replacing the SVG if a
 *  true photograph is preferred. */
export function TitleEnvelope() {
  return (
    <div className="title__envelope" aria-hidden="true">
      <svg viewBox={`0 0 ${ENVELOPE_VIEWBOX.w} ${ENVELOPE_VIEWBOX.h}`} xmlns="http://www.w3.org/2000/svg">
        <EnvelopeArt />
      </svg>
    </div>
  );
}
