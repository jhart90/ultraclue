import { useState } from 'react';
import { useStore } from '../store';
import { Wordmark } from '../components/Wordmark';
import './Title.css';

type Mode = 'menu' | 'start' | 'join';

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

export function Title() {
  const connected = useStore((s) => s.connected);
  const error = useStore((s) => s.error);
  const createGame = useStore((s) => s.createGame);
  const joinGame = useStore((s) => s.joinGame);
  const goto = useStore((s) => s.goto);

  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);

  const canSubmit = connected && name.trim().length > 0;

  return (
    <div className="title">
      <Wordmark size="lg" className="title__h1" />
      <p className="title__tag">{tagline}</p>

      {!connected && <p className="title__status">Connecting to the server…</p>}

      {mode === 'menu' && (
        <div className="title__menu">
          <button className="btn btn--primary" disabled={!connected} onClick={() => setMode('start')}>
            Start Game
          </button>
          <button className="btn" disabled={!connected} onClick={() => setMode('join')}>
            Join Game
          </button>
          <button className="btn btn--ghost" onClick={() => goto('gallery')}>
            Browse the Cards
          </button>
        </div>
      )}

      {mode === 'start' && (
        <form
          className="title__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) createGame(name);
          }}
        >
          <label>
            Your name
            <input autoFocus value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex" />
          </label>
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

      {mode === 'join' && (
        <form
          className="title__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && code.trim().length === 4) joinGame(code, name);
          }}
        >
          <label>
            Your name
            <input autoFocus value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex" />
          </label>
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
