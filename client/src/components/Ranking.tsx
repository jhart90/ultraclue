import { useMemo } from 'react';
import { getCard, profileLabel, type HumanWinner } from 'shared';
import { CardName } from './CardName';

const suspectColor = (id?: string) => {
  const c = id ? getCard(id) : undefined;
  return c && c.type === 'suspect' ? c.color : '#6b6480';
};
const n = (v: number) => v.toLocaleString();

/** A ranked list with a bar per row; `all` supplies the full set so zero-count entries still show.
 *  `per` divides each count by that character's entry in another tally (a per-game rate).
 *  `human` rows are people (labelled by `all`), not cards. Shared by the Statistics and Player
 *  Profile screens. */
export function Ranking({
  title,
  tally,
  all,
  top,
  human,
  per,
  note,
  emptyText,
}: {
  title: string;
  tally: Record<string, number>;
  all?: { id: string; title: string }[];
  top?: number;
  human?: boolean;
  per?: Record<string, number>;
  note?: string;
  emptyText?: string;
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
        <div className="stats__none">{emptyText ?? (human ? 'No human has won a public game yet.' : 'Nothing recorded yet.')}</div>
      ) : (
        <ol className="rank">
          {rows.map((r, i) => (
            <li key={r.id} className={`rank__row${r.count === 0 ? ' rank__row--zero' : ''}`}>
              <span className="rank__pos">{i + 1}</span>
              <span className="rank__label">
                {!human && getCard(r.id)?.type === 'suspect' && <span className="rank__dot" style={{ background: suspectColor(r.id) }} />}
                {!human && getCard(r.id) ? <CardName id={r.id} /> : r.label}
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

/** Turn the profile-keyed winners tally into Ranking inputs. Names that appear more than once get
 *  their profile mark appended ("Jack #K7Q") so the two players can be told apart; a PIN-less
 *  profile has no mark and shows plainly. Falls back to the legacy by-name tally for stats files
 *  saved before profiles existed and not yet backfilled. */
export function humanWinnerRows(
  winners: Record<string, HumanWinner>,
  legacy: Record<string, number>,
): { tally: Record<string, number>; all: { id: string; title: string }[] } {
  const entries = Object.entries(winners);
  if (entries.length === 0) {
    return { tally: legacy, all: Object.keys(legacy).map((name) => ({ id: name, title: name })) };
  }
  const seen: Record<string, number> = {};
  for (const [, w] of entries) seen[w.name.toLowerCase()] = (seen[w.name.toLowerCase()] ?? 0) + 1;
  const tally: Record<string, number> = {};
  const all = entries.map(([id, w]) => {
    tally[id] = w.wins;
    return { id, title: profileLabel(w.name, w.tag, seen[w.name.toLowerCase()] > 1) };
  });
  return { tally, all };
}
