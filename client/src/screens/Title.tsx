import { useState } from 'react';
import { PIN_LENGTH, PIN_RE } from 'shared';
import { useStore, initialJoinCode, savedName } from '../store';
import { Wordmark } from '../components/Wordmark';
import { TitleCards } from '../components/TitleCards';
import { TitleEnvelope } from '../components/TitleEnvelope';
import { TitleDice } from '../components/TitleDice';
import './Title.css';

type Mode = 'menu' | 'start' | 'join' | 'public';

const TAGLINES = [
  "It's not impossible to solve. Statistically speaking.",
  'Eliminate suspects. Eliminate weapons. Eliminate rooms. Eliminate your entire weekend.',
  'More clues than any reasonable person would ever ask for.',
  '40 suspects. 40 weapons. 40 rooms. 64,000 possible murder scenarios. We may have overdone it.',
  'A preposterously large mystery to solve.',
  "A mystery so large you probably don't want to solve it.",
  "The world's most unnecessarily complicated whodunit.",
  'Finally, a board game that asks: "What if Clue had absolutely no self-control?"',
  "If you finish a game before sunrise, you're probably cheating.",
  "Because solving one murder wasn't nearly enough paperwork.",
];

/** A PIN is either blank (no profile protection) or exactly four letters/digits. */
export const pinOk = (pin: string) => pin === '' || PIN_RE.test(pin);

/** The optional profile PIN, NBA Jam style: four letters or digits, masked as you type, never shown
 *  to anyone else. Same name + same PIN = same long-term record. */
export function PinField({ pin, setPin, autoFocus }: { pin: string; setPin: (p: string) => void; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <label className="title__pinlabel">
      <span className="title__pinhead">
        PIN <span className="title__optional">optional</span>
      </span>
      <span className="title__pinrow">
        <input
          className="title__pin"
          type={show ? 'text' : 'password'}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={PIN_LENGTH}
          value={pin}
          autoFocus={autoFocus}
          onChange={(e) => setPin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          placeholder="••••"
          aria-label="Optional 4-character PIN"
        />
        <button type="button" className="title__pineye" onClick={() => setShow((v) => !v)} title={show ? 'Hide PIN' : 'Show PIN'} aria-label={show ? 'Hide PIN' : 'Show PIN'}>
          {show ? '🙈' : '👁'}
        </button>
      </span>
      <span className="title__pinhint">
        Four letters or digits. Your name + PIN together are your player profile, so two “Jack”s keep separate records. Nobody else ever sees it.
      </span>
    </label>
  );
}

export function Title() {
  const connected = useStore((s) => s.connected);
  const error = useStore((s) => s.error);
  const createGame = useStore((s) => s.createGame);
  const joinGame = useStore((s) => s.joinGame);
  const joinPublic = useStore((s) => s.joinPublic);
  const loadGame = useStore((s) => s.loadGame);
  const savedMeta = useStore((s) => s.savedMeta);
  const goto = useStore((s) => s.goto);

  const [mode, setMode] = useState<Mode>(initialJoinCode ? 'join' : 'menu');
  const [name, setName] = useState(() => savedName());
  const [pin, setPin] = useState('');
  const [code, setCode] = useState(initialJoinCode ?? '');
  const [watchOnly, setWatchOnly] = useState(false);
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);

  const canSubmit = connected && name.trim().length > 0 && pinOk(pin);

  const nameField = (
    <label>
      Your name
      <input autoFocus value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jack" />
    </label>
  );

  return (
    <div className="title">
      <TitleEnvelope />
      <TitleCards />
      <Wordmark size="lg" className="title__h1" />
      <TitleDice />
      <p className="title__tag">“{tagline}”</p>

      {!connected && <p className="title__status">Connecting to the server…</p>}

      {mode === 'menu' && (
        <div className="title__menu">
          <button className="btn btn--primary title__start" disabled={!connected} onClick={() => setMode('public')}>
            Join Public Game
          </button>
          <button className="btn title__join" disabled={!connected} onClick={() => setMode('join')}>
            Join Private Game
          </button>
          <button className="btn title__public" disabled={!connected} onClick={() => setMode('start')}>
            Start Game
          </button>
          {savedMeta && (
            <button className="btn" disabled={!connected} onClick={loadGame} title={`Round ${savedMeta.round} · ${savedMeta.players} players`}>
              Load Game{savedMeta.round ? ` · round ${savedMeta.round}` : ''}
            </button>
          )}
          <button className="btn btn--ghost" onClick={() => goto('gallery')}>
            Browse the Cards
          </button>
          <button className="btn btn--ghost" onClick={() => goto('stats')}>
            Statistics
          </button>
          <button className="btn btn--ghost" onClick={() => goto('profile')}>
            Player Profile
          </button>
        </div>
      )}

      {mode === 'start' && (
        <form
          className="title__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) createGame(name, pin);
          }}
        >
          {nameField}
          <PinField pin={pin} setPin={setPin} />
          <div className="title__row">
            <button type="button" className="btn btn--ghost" onClick={() => setMode('menu')}>
              Back
            </button>
            <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
              Create Lobby
            </button>
          </div>
        </form>
      )}

      {mode === 'public' && (
        <form
          className="title__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) joinPublic(name, watchOnly, pin);
          }}
        >
          <p className="title__publichint">
            One big table, open to everyone. Every seat is a computer until a human takes it, and the game
            starts itself when the clock runs out — or jump into a game already in progress.
          </p>
          {nameField}
          <PinField pin={pin} setPin={setPin} />
          <label className="title__check">
            <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} />
            Just watch — join as an observer
          </label>
          <div className="title__row">
            <button type="button" className="btn btn--ghost" onClick={() => setMode('menu')}>
              Back
            </button>
            <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
              {watchOnly ? 'Watch the Public Game' : 'Join Public Lobby'}
            </button>
          </div>
        </form>
      )}

      {mode === 'join' && (
        <form
          className="title__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && code.trim().length === 4) joinGame(code, name, pin);
          }}
        >
          {nameField}
          <PinField pin={pin} setPin={setPin} />
          <label>
            Room code
            <input
              value={code}
              maxLength={4}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="ABCD"
              className="title__code"
            />
          </label>
          <div className="title__row">
            <button type="button" className="btn btn--ghost" onClick={() => setMode('menu')}>
              Back
            </button>
            <button type="submit" className="btn btn--primary" disabled={!canSubmit || code.trim().length !== 4}>
              Join Lobby
            </button>
          </div>
        </form>
      )}

      {error && <p className="title__error">{error}</p>}
    </div>
  );
}
