import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getCard, SUSPECTS, WEAPONS, ROOMS, type ArchivedPublicGame, type PublicStats } from 'shared';
import { useStore } from '../store';
import { Wordmark } from '../components/Wordmark';
import { EndScreen } from '../components/EndScreen';
import { contrastInk } from '../render/colorUtils';
import './StatsScreen.css';

const suspectColor = (id?: string) => {
  const c = id ? getCard(id) : undefined;
  return c && c.type === 'suspect' ? c.color : '#6b6480';
};

function fmtDate(ms?: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtDuration(a?: number, b?: number): string {
  if (!a || !b) return '';
  const mins = Math.max(1, Math.round((b - a) / 60000));
  return `${mins} min`;
}
const n = (v: number) => v.toLocaleString();
const avg = (num: number, den: number, digits = 1) => (den ? (num / den).toFixed(digits) : '–');

/** One finished game in the history list. */
function GameTile({ g, onOpen }: { g: ArchivedPublicGame; onOpen: () => void }) {
  const color = suspectColor(g.winnerSuspectId);
  const env = g.envelope;
  const trio = env ? [env.suspectId, env.weaponId, env.roomId].map((id) => getCard(id)?.title ?? id).join(' · ') : '';
  const character = g.winnerSuspectId ? getCard(g.winnerSuspectId)?.title : undefined;
  return (
    <button className="stile" onClick={onOpen} style={{ borderLeftColor: color }}>
      <div className="stile__top">
        <span className="stile__winner" style={{ background: color, color: contrastInk(color) }}>
          {g.winnerName}
        </span>
        <span className="stile__how">
          {character && character !== g.winnerName ? `as ${character} · ` : ''}
          {g.solved ? 'solved the case' : 'last detective standing'}
          {g.winnerIsBot ? ' · computer' : ''}
        </span>
        <span className="stile__when">{fmtDate(g.endedAt)}</span>
      </div>
      <div className="stile__meta">
        <span>{g.humans} human{g.humans === 1 ? '' : 's'}</span>
        <span>{g.computers} computer{g.computers === 1 ? '' : 's'}</span>
        {g.observers > 0 && <span>{g.observers} watching</span>}
        <span>
          {g.turns} turn{g.turns === 1 ? '' : 's'}
        </span>
        <span>
          {g.rounds} round{g.rounds === 1 ? '' : 's'}
        </span>
        {fmtDuration(g.startedAt, g.endedAt) && <span>{fmtDuration(g.startedAt, g.endedAt)}</span>}
      </div>
      {trio && <div className="stile__env">Envelope: {trio}</div>}
    </button>
  );
}

/** A ranked list with a bar per row; `all` supplies the full set so zero-count entries still show.
 *  `per` divides each count by that character's entry in another tally (a per-game rate). */
function Ranking({
  title,
  tally,
  all,
  top,
  human,
  per,
  note,
}: {
  title: string;
  tally: Record<string, number>;
  all?: { id: string; title: string }[];
  top?: number;
  human?: boolean;
  per?: Record<string, number>;
  note?: string;
}) {
  const rows = useMemo(() => {
    const value = (id: string) => {
      const raw = tally[id] ?? 0;
      if (!per) return raw;
      const den = per[id] ?? 0;
      return den ? raw / den : 0;
    };
    const base = all ? all.map((c) => ({ id: c.id, label: c.title, count: value(c.id) })) : Object.entries(tally).map(([id]) => ({ id, label: id, count: value(id) }));
    base.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return top ? base.slice(0, top) : base;
  }, [tally, all, top, per]);
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  const show = (v: number) => (per ? (Number.isInteger(v) ? v.toFixed(1) : v.toFixed(2).replace(/0$/, '')) : n(v));
  return (
    <section className="stats__section">
      <h3 className="stats__h3">{title}</h3>
      {note && <div className="stats__note">{note}</div>}
      {rows.length === 0 ? (
        <div className="stats__none">{human ? 'No human has won a public game yet.' : 'Nothing recorded yet.'}</div>
      ) : (
        <ol className="rank">
          {rows.map((r, i) => (
            <li key={r.id} className={`rank__row${r.count === 0 ? ' rank__row--zero' : ''}`}>
              <span className="rank__pos">{i + 1}</span>
              <span className="rank__label">
                {!human && getCard(r.id)?.type === 'suspect' && <span className="rank__dot" style={{ background: suspectColor(r.id) }} />}
                {r.label}
              </span>
              <span className="rank__bar">
                <span className="rank__fill" style={{ width: max ? `${(r.count / max) * 100}%` : 0 }} />
              </span>
              <span className="rank__count">{show(r.count)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** "Statistics" from the title: the last 50 public games, each re-opening its details screen, and
 *  the all-time numbers across every public game ever played. */
export function StatsScreen() {
  const goto = useStore((s) => s.goto);
  const fetchPublicStats = useStore((s) => s.fetchPublicStats);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ArchivedPublicGame | null>(null);
  // The history pane shows 3½ tiles by default (measured from the first tile), scrolling for the rest.
  const listRef = useRef<HTMLDivElement>(null);
  const [listMax, setListMax] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = () => {
      const el = listRef.current;
      const first = el?.firstElementChild as HTMLElement | null;
      if (!el || !first) return;
      const gap = parseFloat(getComputedStyle(el).rowGap || '0') || 0;
      setListMax(first.offsetHeight * 3.5 + gap * 3);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [stats]);
  const gamesForAll = useMemo(() => Object.fromEntries(SUSPECTS.map((c) => [c.id, stats?.totalGames ?? 0])), [stats?.totalGames]);

  useEffect(() => {
    let alive = true;
    fetchPublicStats()
      .then((s) => alive && setStats(s))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [fetchPublicStats]);

  return (
    <div className="stats">
      <header className="stats__head">
        <button className="stats__back" onClick={() => goto('title')}>
          ← Back
        </button>
        <Wordmark size="md" />
        <div className="stats__sub">Public Game Statistics</div>
      </header>

      {error && <div className="stats__none">Could not load statistics: {error}</div>}
      {!stats && !error && <div className="stats__none">Loading…</div>}

      {stats && (
        <>
          <section className="stats__section">
            <h2 className="stats__h2">
              Last {stats.recent.length || ''} public game{stats.recent.length === 1 ? '' : 's'}
            </h2>
            {stats.recent.length === 0 ? (
              <div className="stats__none">No public game has finished yet. The first one will appear here.</div>
            ) : (
              <div className="stats__list" ref={listRef} style={listMax ? { maxHeight: listMax } : undefined}>
                {stats.recent.map((g) => (
                  <GameTile key={g.id} g={g} onOpen={() => setOpen(g)} />
                ))}
              </div>
            )}
          </section>

          <h2 className="stats__h2">All public games ever played</h2>
          <div className="stats__numbers">
            <div className="stats__number">
              <div className="stats__val">{n(stats.totalGames)}</div>
              <div className="stats__lbl">games played</div>
            </div>
            <div className="stats__number">
              <div className="stats__val">{n(stats.solvedGames)}</div>
              <div className="stats__lbl">solved by accusation</div>
            </div>
            <div className="stats__number">
              <div className="stats__val">{n(stats.totalTiles)}</div>
              <div className="stats__lbl">tiles ever moved</div>
            </div>
            <div className="stats__number">
              <div className="stats__val">{n(stats.totalTurns)}</div>
              <div className="stats__lbl">turns ever played</div>
            </div>
            <div className="stats__number">
              <div className="stats__val">{avg(stats.totalTurns, stats.totalGames)}</div>
              <div className="stats__lbl">avg turns per game</div>
            </div>
            <div className="stats__number">
              <div className="stats__val">{avg(stats.turnsInSolvedGames, stats.solvedGames)}</div>
              <div className="stats__lbl">avg turns per solve</div>
            </div>
            <div className="stats__number">
              <div className="stats__val">{n(stats.totalSuggestions)}</div>
              <div className="stats__lbl">suggestions made</div>
            </div>
            <div className="stats__number">
              <div className="stats__val">{avg(stats.totalSuggestions, stats.totalGames)}</div>
              <div className="stats__lbl">avg suggestions per game</div>
            </div>
          </div>

          <div className="stats__grid">
            <Ranking title="Top human winners" tally={stats.humanWins} top={10} human />
            <Ranking title="Characters by wins" tally={stats.characterWins} all={SUSPECTS} />
          </div>

          <h2 className="stats__h2">Crime Statistics</h2>
          <div className="stats__grid stats__grid--3">
            <Ranking title="Top Murderers" tally={stats.murderers} all={SUSPECTS} />
            <Ranking title="Top Murder Weapons" tally={stats.weapons} all={WEAPONS} />
            <Ranking title="Top Crime Scenes" tally={stats.rooms} all={ROOMS} />
          </div>

          <h2 className="stats__h2">Character Statistics</h2>
          <div className="stats__grid stats__grid--4">
            <Ranking title="Total tiles moved" tally={stats.characterTiles} all={SUSPECTS} />
            <Ranking title="Tiles moved per game" tally={stats.characterTiles} per={stats.characterGames} all={SUSPECTS} note="per game the character was dealt into" />
            <Ranking title="Total times suspected" tally={stats.characterSuspected} all={SUSPECTS} />
            <Ranking title="Times suspected per game" tally={stats.characterSuspected} per={gamesForAll} all={SUSPECTS} note="per public game played" />
            <Ranking title="Total accusations" tally={stats.characterAccusations} all={SUSPECTS} />
            <Ranking title="Accusations per game" tally={stats.characterAccusations} per={stats.characterGames} all={SUSPECTS} note="per game the character was dealt into" />
            <Ranking title="Total correct accusations" tally={stats.characterCorrect} all={SUSPECTS} />
            <Ranking title="Correct accusations per game" tally={stats.characterCorrect} per={stats.characterGames} all={SUSPECTS} note="per game the character was dealt into" />
          </div>
        </>
      )}

      {open && <EndScreen game={open.view} myId="" serverOffset={0} closeLabel="Close" onLeave={() => setOpen(null)} />}
    </div>
  );
}
