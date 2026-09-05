import { useState } from 'react';
import { getCard, SUSPECTS, WEAPONS, ROOMS, profileLabel, type PlayerProfile, type ProfileGame } from 'shared';
import { useStore, savedName } from '../store';
import { Wordmark } from '../components/Wordmark';
import { Ranking } from '../components/Ranking';
import { CardName } from '../components/CardName';
import { contrastInk } from '../render/colorUtils';
import { PinField, pinOk } from './Title';
import './StatsScreen.css';
import './ProfileScreen.css';

const n = (v: number) => v.toLocaleString();
const avg = (num: number, den: number, digits = 1) => (den ? (num / den).toFixed(digits) : '–');
const pct = (num: number, den: number) => (den ? `${Math.round((num / den) * 100)}%` : '–');
const suspectColor = (id?: string) => {
  const c = id ? getCard(id) : undefined;
  return c && c.type === 'suspect' ? c.color : '#6b6480';
};
function fmtDate(ms?: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const RESULT_LABEL: Record<ProfileGame['result'], string> = { won: 'Won', eliminated: 'Eliminated', lost: 'Lost' };

/** One of the profile's five most recent games. */
function RecentGame({ g }: { g: ProfileGame }) {
  const color = suspectColor(g.suspectId);
  return (
    <li className={`pgame pgame--${g.result}`} style={{ borderLeftColor: color }}>
      <div className="pgame__top">
        <span className={`pgame__result pgame__result--${g.result}`}>
          {RESULT_LABEL[g.result]}
          {g.result === 'won' ? (g.solved ? ' · solved the case' : ' · last detective standing') : ''}
        </span>
        <span className="pgame__as" style={{ background: color, color: contrastInk(color) }}>
          <CardName id={g.suspectId} />
        </span>
        <span className="pgame__when">{fmtDate(g.endedAt)}</span>
      </div>
      <div className="pgame__meta">
        <span>{g.isPublic ? 'public game' : 'private game'}</span>
        <span>
          {g.players} player{g.players === 1 ? '' : 's'} ({g.humans} human{g.humans === 1 ? '' : 's'})
        </span>
        {g.result !== 'won' && <span>won by {g.winnerName}</span>}
        <span>
          {g.turns} turn{g.turns === 1 ? '' : 's'}
        </span>
        <span>
          {g.tiles} tile{g.tiles === 1 ? '' : 's'}
        </span>
        <span>
          {g.suggestions} suggestion{g.suggestions === 1 ? '' : 's'}
        </span>
        <span>
          {g.accusations} accusation{g.accusations === 1 ? '' : 's'}
        </span>
      </div>
    </li>
  );
}

/** The record behind a profile: headline numbers, favourite characters, what they tend to suspect,
 *  and the last five games. */
function ProfileDetails({ p }: { p: PlayerProfile }) {
  const incorrect = Math.max(0, p.accusations - p.accusationsCorrect);
  return (
    <>
      <div className="profile__card">
        <div className="profile__name">
          {profileLabel(p.name, p.tag, true)}
          {p.hasPin ? <span className="profile__lock" title="Protected by a PIN">🔒</span> : <span className="profile__nopin">no PIN</span>}
        </div>
        <div className="profile__since">
          {p.hasPin
            ? `Your mark on the leaderboards is “#${p.tag}” — it appears beside your name whenever another player shares it.`
            : 'Played without a PIN: anyone who types this name without a PIN shares this record. Add a PIN next time to keep one of your own.'}
          {p.lastPlayedAt ? ` Last game ${fmtDate(p.lastPlayedAt)}.` : ''}
        </div>
      </div>

      <div className="stats__numbers">
        <div className="stats__number">
          <div className="stats__val">{n(p.games)}</div>
          <div className="stats__lbl">games played</div>
        </div>
        <div className="stats__number">
          <div className="stats__val">{n(p.wins)}</div>
          <div className="stats__lbl">wins</div>
        </div>
        <div className="stats__number">
          <div className="stats__val">{pct(p.wins, p.games)}</div>
          <div className="stats__lbl">win rate</div>
        </div>
        <div className="stats__number">
          <div className="stats__val">{n(p.solves)}</div>
          <div className="stats__lbl">cases solved by accusation</div>
        </div>
        <div className="stats__number">
          <div className="stats__val">{n(p.tiles)}</div>
          <div className="stats__lbl">total tiles traveled</div>
        </div>
        <div className="stats__number">
          <div className="stats__val">{avg(p.tiles, p.games)}</div>
          <div className="stats__lbl">avg tiles per game</div>
        </div>
        <div className="stats__number">
          <div className="stats__val">{n(p.suggestions)}</div>
          <div className="stats__lbl">total suggestions</div>
        </div>
        <div className="stats__number">
          <div className="stats__val">{avg(p.suggestions, p.games)}</div>
          <div className="stats__lbl">avg suggestions per game</div>
        </div>
        <div className="stats__number">
          <div className="stats__val">{n(p.accusations)}</div>
          <div className="stats__lbl">total accusations</div>
        </div>
        <div className="stats__number">
          <div className="stats__val profile__good">{n(p.accusationsCorrect)}</div>
          <div className="stats__lbl">correct accusations</div>
        </div>
        <div className="stats__number">
          <div className="stats__val profile__bad">{n(incorrect)}</div>
          <div className="stats__lbl">incorrect accusations</div>
        </div>
        <div className="stats__number">
          <div className="stats__val">{n(p.eliminations)}</div>
          <div className="stats__lbl">times eliminated</div>
        </div>
      </div>

      <h2 className="stats__h2">Recent games</h2>
      <section className="stats__section">
        {p.recent.length === 0 ? (
          <div className="stats__none">No finished games yet.</div>
        ) : (
          <ol className="pgames">
            {p.recent.map((g) => (
              <RecentGame key={g.id} g={g} />
            ))}
          </ol>
        )}
      </section>

      <h2 className="stats__h2">Favourites</h2>
      <div className="stats__grid stats__grid--4">
        <Ranking title="Characters most played" tally={p.characters} all={SUSPECTS.filter((s) => p.characters[s.id])} top={10} note="games played as each character" emptyText="No games yet." />
        <Ranking title="Characters most suspected" tally={p.suspectedSuspects} all={SUSPECTS.filter((s) => p.suspectedSuspects[s.id])} top={10} note="named in your suggestions" emptyText="No suggestions yet." />
        <Ranking title="Weapons most suspected" tally={p.suspectedWeapons} all={WEAPONS.filter((w) => p.suspectedWeapons[w.id])} top={10} note="named in your suggestions" emptyText="No suggestions yet." />
        <Ranking title="Rooms most suspected" tally={p.suspectedRooms} all={ROOMS.filter((r) => p.suspectedRooms[r.id])} top={10} note="named in your suggestions" emptyText="No suggestions yet." />
      </div>
    </>
  );
}

/** "Player Profile" from the title: type the name (and PIN, if you use one) you play under to see
 *  your long-term record. The PIN is sent once to look the profile up and never displayed. */
export function ProfileScreen() {
  const goto = useStore((s) => s.goto);
  const connected = useStore((s) => s.connected);
  const fetchProfile = useStore((s) => s.fetchProfile);
  const [name, setName] = useState(() => savedName());
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; profile: PlayerProfile | null } | null>(null);

  const canLookUp = connected && name.trim().length > 0 && pinOk(pin) && !busy;

  const lookUp = async () => {
    if (!canLookUp) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await fetchProfile(name, pin);
      setResult({ name: name.trim(), profile });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stats profile">
      <header className="stats__head">
        <button className="stats__back" onClick={() => goto('title')}>
          ← Back
        </button>
        <Wordmark size="md" />
        <div className="stats__sub">Player Profile</div>
      </header>

      <form
        className="title__form profile__form"
        onSubmit={(e) => {
          e.preventDefault();
          void lookUp();
        }}
      >
        <p className="title__publichint">
          Your record follows your name — and your PIN, if you play with one. Enter both exactly as you do when you join a game.
        </p>
        <label>
          Your name
          <input autoFocus value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jack" />
        </label>
        <PinField pin={pin} setPin={setPin} />
        <div className="title__row">
          <span />
          <button type="submit" className="btn btn--primary" disabled={!canLookUp}>
            {busy ? 'Looking up…' : 'Show my profile'}
          </button>
        </div>
      </form>

      {!connected && <p className="stats__none">Connecting to the server…</p>}
      {error && <div className="title__error">Could not load the profile: {error}</div>}

      {result && !result.profile && (
        <div className="stats__none profile__empty">
          No finished games yet for “{result.name}”{pin ? ' with that PIN' : ''}. Play a game to the end (public or private) and it will
          appear here.
        </div>
      )}
      {result?.profile && <ProfileDetails p={result.profile} />}
    </div>
  );
}
