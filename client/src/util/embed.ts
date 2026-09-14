// Is this page running inside the itch.io wrapper (itch/index.html)? The wrapper loads the site in
// an iframe as `?embed=itch`. store.ts strips the query string when it consumes a `?join=` code, so
// read the flag once at load and keep it for the session. Failing that, a framed page whose referrer
// is itch's game host counts too.

const KEY = 'ultraclue-embed';

function detect(): boolean {
  if (new URLSearchParams(window.location.search).get('embed') === 'itch') {
    try {
      sessionStorage.setItem(KEY, 'itch');
    } catch {
      /* storage blocked in the frame: the URL flag still covers this load */
    }
    return true;
  }
  try {
    if (sessionStorage.getItem(KEY) === 'itch') return true;
  } catch {
    /* ignore */
  }
  const framed = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true; // cross-origin parent
    }
  })();
  return framed && /(^|\.)itch\.(zone|io)$/.test(referrerHost());
}

function referrerHost(): string {
  try {
    return new URL(document.referrer).hostname;
  } catch {
    return '';
  }
}

/** True when the game is embedded on an itch.io page, where pop-up windows are unreliable. */
export const onItch = detect();
