import './TitleEnvelope.css';

/** A large, dimensional manila envelope that runs diagonally off the upper-right corner of the title
 *  screen (behind everything, upper-left of the logo). Drawn as a shaded SVG — paper gradient + grain,
 *  a closed flap casting a soft shadow, and a wax seal — to read as a real envelope. Swap in a photo
 *  by dropping an image and replacing this SVG if a true photograph is preferred. */
export function TitleEnvelope() {
  return (
    <div className="title__envelope" aria-hidden="true">
      <svg viewBox="0 0 640 440" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="env-paper" x1="0" y1="0" x2="0.15" y2="1">
            <stop offset="0" stopColor="#f6eed8" />
            <stop offset="0.55" stopColor="#e9ddc0" />
            <stop offset="1" stopColor="#d8c8a4" />
          </linearGradient>
          <linearGradient id="env-flap" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f2e8cd" />
            <stop offset="1" stopColor="#d2c19c" />
          </linearGradient>
          <radialGradient id="env-wax" cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor="#c0303a" />
            <stop offset="0.6" stopColor="#9a1f2b" />
            <stop offset="1" stopColor="#6e121c" />
          </radialGradient>
          {/* fine paper grain */}
          <filter id="env-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" stitchTiles="stitch" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" />
          </filter>
          {/* soft cast shadow under the flap edges */}
          <filter id="env-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <clipPath id="env-clip">
            <rect x="18" y="60" width="604" height="340" rx="12" />
          </clipPath>
        </defs>

        {/* envelope body */}
        <rect x="18" y="60" width="604" height="340" rx="12" fill="url(#env-paper)" stroke="#b9a578" strokeWidth="2" />
        {/* grain overlay, clipped to the body */}
        <rect x="18" y="60" width="604" height="340" rx="12" filter="url(#env-grain)" opacity="0.5" clipPath="url(#env-clip)" />
        {/* bottom flap seams (faint) */}
        <path d="M18 400 L320 250 L622 400" fill="none" stroke="rgba(120,98,52,0.35)" strokeWidth="2" />
        {/* soft shadow the closed flap casts onto the body */}
        <path d="M40 66 L320 268 L600 66" fill="none" stroke="rgba(70,52,22,0.4)" strokeWidth="8" filter="url(#env-soft)" />
        {/* closed top flap (apex at centre) */}
        <path d="M18 60 L622 60 L320 252 Z" fill="url(#env-flap)" stroke="#bda878" strokeWidth="2" strokeLinejoin="round" />
        {/* highlight along the flap fold */}
        <path d="M18 60 L622 60" fill="none" stroke="rgba(255,250,232,0.6)" strokeWidth="2" />

        {/* wax seal at the flap tip */}
        <g>
          <ellipse cx="320" cy="256" rx="42" ry="40" fill="rgba(0,0,0,0.28)" filter="url(#env-soft)" />
          <circle cx="320" cy="250" r="40" fill="url(#env-wax)" stroke="#5e0f18" strokeWidth="1.5" />
          <circle cx="320" cy="250" r="33" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
          <path
            d="M320 230 L334 250 L320 270 L306 250 Z"
            fill="rgba(60,8,14,0.55)"
            stroke="rgba(255,200,200,0.18)"
            strokeWidth="1"
          />
        </g>
      </svg>
    </div>
  );
}
