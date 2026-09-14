import { useEffect, useRef, useState } from 'react';
import {
  getCard,
  summarizeStats,
  summarizeAccusations,
  BOT_PERSONAS,
  PUBLIC_ROOM_CODE,
  type AccusationLine,
  type GameView,
  type Ranked,
} from 'shared';
import { Card } from './Card';
import { CardName } from './CardName';
import { ordinal } from './ChatCard';
import { contrastInk } from '../render/colorUtils';
import './EndScreen.css';

function suspectColor(view: GameView, playerId: string): string {
  const p = view.players.find((x) => x.id === playerId);
  const c = p ? getCard(p.suspectId) : undefined;
  return c && c.type === 'suspect' ? c.color : '#888';
}

/** A player's name in their character's colour. */
function Name({ view, id }: { view: GameView; id: string }) {
  const p = view.players.find((x) => x.id === id);
  const color = suspectColor(view, id);
  return (
    <span className="end__name" style={{ background: color, color: contrastInk(color) }}>
      {p?.name ?? 'Someone'}
    </span>
  );
}

function when(startedAt?: number, endedAt?: number): string {
  if (!startedAt) return '';
  const start = new Date(startedAt);
  const date = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!endedAt) return `${date}, ${t(start)}`;
  return `${date}, ${t(start)} to ${t(new Date(endedAt))}`;
}

function minutes(startedAt?: number, endedAt?: number): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  return Math.max(1, Math.round((endedAt - startedAt) / 60000));
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** One big number with a caption. */
function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="end__figure">
      <div className="end__figureval">{value}</div>
      <div className="end__figurelbl">{label}</div>
    </div>
  );
}

/** The most-named cards of one kind, top first. */
function TopCards({ title, items }: { title: string; items: Ranked[] }) {
  return (
    <div className="end__top">
      <div className="end__toptitle">{title}</div>
      {items.length === 0 ? (
        <div className="end__topnone">Nobody was named</div>
      ) : (
        <ol className="end__toplist">
          {items.map((it, i) => (
            <li key={it.id} className={i === 0 ? 'end__topitem end__topitem--lead' : 'end__topitem'}>
              <span className="end__topname">
                <CardName id={it.id} />
              </span>
              <span className="end__topcount">×{it.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** One end of an honour: who led (ties share it) and their number. */
function HonourRow({ view, label, leaders, unit }: { view: GameView; label: string; leaders: Ranked[]; unit: string }) {
  if (!leaders.length) return null;
  return (
    <div className="hon__row">
      <span className="hon__label">{label}</span>
      <span className="hon__who">
        {leaders.map((l) => (
          <Name key={l.id} view={view} id={l.id} />
        ))}
      </span>
      <span className="hon__count">{plural(leaders[0].count, unit)}</span>
    </div>
  );
}

/** An honour tile: the leaders at both ends of one number. */
function Honour({
  view,
  icon,
  title,
  unit,
  most,
  least,
}: {
  view: GameView;
  icon: string;
  title: string;
  unit: string;
  most: Ranked[];
  least: Ranked[];
}) {
  if (!most.length && !least.length) return null;
  return (
    <div className="hon">
      <div className="hon__head">
        <span className="hon__icon" aria-hidden>
          {icon}
        </span>
        <span className="hon__title">{title}</span>
      </div>
      <HonourRow view={view} label="Most" leaders={most} unit={unit} />
      <HonourRow view={view} label="Least" leaders={least} unit={unit} />
    </div>
  );
}

function Verdict({ line }: { line: AccusationLine }) {
  if (line.kind === 'accused') {
    return (
      <div className="acc__verdictcell">
        {line.correct ? (
          <span className="acc__verdict acc__verdict--right">Solved the case</span>
        ) : (
          <span className="acc__verdict acc__verdict--wrong">Accused wrongly</span>
        )}
        {line.playerTurn && line.overallTurn ? (
          <span className="acc__when">
            {ordinal(line.playerTurn)} turn individually, {ordinal(line.overallTurn)} turn overall
          </span>
        ) : null}
      </div>
    );
  }
  if (line.kind === 'would') return <span className="acc__verdict acc__verdict--would">Would have accused</span>;
  return <span className="acc__verdict acc__verdict--none">Never accused</span>;
}

/** The three cards of an accusation or guess, each marked against the envelope. */
function GuessCards({ line }: { line: AccusationLine }) {
  const g = line.guess;
  const hits = line.hits;
  if (!g || !hits) return <span className="acc__nocards">No cards were named</span>;
  const ids = [g.suspectId, g.weaponId, g.roomId];
  const combos = g.combos;
  const note =
    combos !== undefined
      ? combos <= 1
        ? 'was certain'
        : `${combos.toLocaleString()} combinations still open`
      : undefined;
  return (
    <div className="acc__cards">
      {ids.map((id, i) => (
        <span key={id} className={hits[i] ? 'acc__card acc__card--hit' : 'acc__card acc__card--miss'} title={hits[i] ? 'In the envelope' : 'Not in the envelope'}>
          <span className="acc__mark" aria-hidden>
            {hits[i] ? '✓' : '✗'}
          </span>
          <CardName id={id} />
        </span>
      ))}
      <span className={`acc__score acc__score--${line.matches ?? 0}`}>
        {line.matches} of 3 right
        {note ? <span className="acc__note"> · {note}</span> : null}
      </span>
    </div>
  );
}

/**
 * The end-of-game details screen, shown to every player and observer once a game concludes, and
 * re-opened from the Statistics screen for any archived public game. One scrolling pane, top to
 * bottom: the verdict, the envelope, who accused what (and what every computer would have
 * accused), the numbers, and the small print. Public games also count down to the next lobby.
 */
export function EndScreen({
  game,
  myId,
  serverOffset,
  onLeave,
  closeLabel,
}: {
  game: GameView;
  myId: string;
  serverOffset: number;
  onLeave: () => void;
  /** Overrides the footer button's label (the history viewer uses "Close"). */
  closeLabel?: string;
}) {
  const winner = game.players.find((p) => p.id === game.winnerId);
  const won = game.winnerId === myId;
  const env = game.envelope;
  const isPublic = game.code === PUBLIC_ROOM_CODE;
  const solved = game.announcement?.kind === 'accusation' && game.announcement.correct && game.announcement.byId === game.winnerId;
  const summary = summarizeStats(game);
  const accusations = summarizeAccusations(game);
  // Games archived before accusations were recorded have nothing to say here.
  const anyGuess = accusations.some((l) => l.guess);
  const neverAccused = accusations.filter((l) => l.kind === 'none');
  const winColor = winner ? suspectColor(game, winner.id) : '#c8a24a';
  const personaOf = (id: string) => {
    const p = game.players.find((x) => x.id === id);
    return p?.isBot && p.persona ? BOT_PERSONAS[p.persona] : undefined;
  };
  // The computers' personalities: secret all game, revealed here (the view only carries them
  // once the game has ended).
  const unmasked = game.players.filter((p) => p.isBot && p.persona && BOT_PERSONAS[p.persona]);
  const mins = minutes(game.stats?.startedAt, game.stats?.endedAt);
  const accusationCount = summary ? summary.rows.reduce((n, r) => n + r.accusations, 0) : 0;

  // Public games: live countdown to the next lobby (server clock, skew-corrected).
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!game.resetsAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [game.resetsAt]);
  const remaining = isPublic && !closeLabel && game.resetsAt ? game.resetsAt - (now + serverOffset) : undefined;

  // "Download PDF": rasterise the panel (html2canvas) and lay the image across A4 pages (jsPDF).
  // Both libraries load on demand so they never weigh on the game bundle. While capturing, the
  // panel drops its scroll cap and hides the footer so the whole report is in the picture.
  const panelRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const downloadPdf = async () => {
    const el = panelRef.current;
    if (!el || saving) return;
    setSaving(true);
    el.classList.add('end--capture');
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#181426', useCORS: true, logging: false });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const margin = 24;
      const pageW = pdf.internal.pageSize.getWidth() - margin * 2;
      const pageH = pdf.internal.pageSize.getHeight() - margin * 2;
      const ratio = pageW / canvas.width; // pt per canvas px
      const sliceH = Math.floor(pageH / ratio); // canvas px that fit on one page
      for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
        const h = Math.min(sliceH, canvas.height - y);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = h;
        slice.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (page > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, pageW, h * ratio);
      }
      const stamp = new Date(game.stats?.endedAt ?? Date.now()).toISOString().slice(0, 10);
      pdf.save(`40-alibis-${game.code}-${stamp}.pdf`);
    } catch (err) {
      console.error('PDF export failed', err);
    } finally {
      el.classList.remove('end--capture');
      setSaving(false);
    }
  };

  const leaveLabel = closeLabel ?? (isPublic ? 'Leave the table' : 'Back to Title');

  return (
    <div className="sp__backdrop">
      <div className="end" role="dialog" aria-label="Game over" ref={panelRef}>
        <header className="end__banner" style={{ background: winColor, color: contrastInk(winColor) }}>
          <button className="end__close" onClick={onLeave} title={leaveLabel} aria-label={leaveLabel} style={{ color: contrastInk(winColor) }}>
            ✕
          </button>
          <div className="end__confetti" aria-hidden>
            🎉
          </div>
          <div className="end__headline">{won ? 'You solved the case!' : `${winner?.name ?? 'Someone'} wins!`}</div>
          <div className="end__sub">
            {winner && winner.name !== getCard(winner.suspectId)?.title ? `${winner.name} played ${getCard(winner.suspectId)?.title ?? 'a suspect'}. ` : ''}
            {solved ? 'A correct accusation closes the case.' : 'The last detective standing takes the case by default.'}
          </div>
          {remaining !== undefined && (
            <div className="end__countdownpill">
              Next public game forms in <strong>{mmss(remaining)}</strong>
            </div>
          )}
        </header>

        <div className="end__body">
          <section className="end__section end__section--envelope">
            <h2 className="end__sectiontitle">The envelope</h2>
            <div className="end__cards">
              {env &&
                [env.suspectId, env.weaponId, env.roomId].map((id) => {
                  const card = getCard(id);
                  return card ? <Card key={id} card={card} /> : null;
                })}
            </div>
          </section>

          {anyGuess && (
            <section className="end__section">
              <h2 className="end__sectiontitle">The accusations</h2>
              <p className="end__sectionsub">
                Every accusation made, and what each computer that never accused would have named on what it knew before the final suggestion and the closing accusation.
              </p>
              <ol className="acc__list">
                {accusations
                  .filter((l) => l.kind !== 'none')
                  .map((line) => {
                    const persona = personaOf(line.playerId);
                    return (
                      <li key={line.playerId} className={`acc acc--${line.kind}${line.correct ? ' acc--right' : ''}`}>
                        <div className="acc__who">
                          <Name view={game} id={line.playerId} />
                          {persona && <span className="acc__persona">{persona.title}</span>}
                        </div>
                        <Verdict line={line} />
                        <GuessCards line={line} />
                      </li>
                    );
                  })}
              </ol>
              {neverAccused.length > 0 && (
                <p className="acc__never">
                  Never accused:{' '}
                  {neverAccused.map((l) => (
                    <Name key={l.playerId} view={game} id={l.playerId} />
                  ))}
                </p>
              )}
            </section>
          )}

          {summary && (
            <>
              <section className="end__section">
                <h2 className="end__sectiontitle">The investigation in numbers</h2>
                <div className="end__figures">
                  <Figure value={summary.turnsPlayed} label="turns played" />
                  <Figure value={summary.rounds} label="full rounds" />
                  <Figure value={summary.suggestionCount} label="suggestions" />
                  <Figure value={accusationCount} label={accusationCount === 1 ? 'accusation' : 'accusations'} />
                  {mins !== undefined && <Figure value={mins} label={mins === 1 ? 'minute' : 'minutes'} />}
                </div>
              </section>

              <section className="end__section">
                <h2 className="end__sectiontitle">Most suspected</h2>
                <div className="end__tops">
                  <TopCards title="Suspects" items={summary.topSuspects} />
                  <TopCards title="Weapons" items={summary.topWeapons} />
                  <TopCards title="Rooms" items={summary.topRooms} />
                </div>
              </section>

              <section className="end__section">
                <h2 className="end__sectiontitle">Honours</h2>
                <div className="end__honours">
                  <Honour view={game} icon="👣" title="Tiles walked" unit="tile" most={summary.mostTravelled} least={summary.leastTravelled} />
                  <Honour view={game} icon="🚪" title="Rooms visited" unit="room" most={summary.mostRoomsVisited} least={summary.leastRoomsVisited} />
                  <Honour view={game} icon="🔍" title="Times suspected" unit="time" most={summary.mostSuspected} least={summary.leastSuspected} />
                  <Honour view={game} icon="🃏" title="Cards shown" unit="card" most={summary.mostReveals} least={summary.leastReveals} />
                </div>
              </section>

              <section className="end__section">
                <h2 className="end__sectiontitle">Every detective</h2>
                <div className="end__tablewrap">
                  <table className="end__table">
                    <colgroup>
                      <col className="end__col--name" />
                      {Array.from({ length: 7 }, (_, i) => (
                        <col key={i} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Detective</th>
                        <th scope="col">Turns taken</th>
                        <th scope="col">Tiles walked</th>
                        <th scope="col">Rooms visited</th>
                        <th scope="col">Sugges&shy;tions made</th>
                        <th scope="col">Cards shown</th>
                        <th scope="col">Accusa&shy;tions made</th>
                        <th scope="col">Times suspected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.rows.map((r) => {
                        const p = game.players.find((x) => x.id === r.playerId);
                        const isWinner = r.playerId === game.winnerId;
                        return (
                          <tr key={r.playerId} className={isWinner ? 'end__row end__row--winner' : 'end__row'}>
                            <td className="end__cellname">
                              <Name view={game} id={r.playerId} />
                              {isWinner && <span className="end__tag end__tag--won">won</span>}
                              {p?.eliminated && !isWinner && <span className="end__tag end__tag--out">out</span>}
                            </td>
                            <td>{r.turns}</td>
                            <td>{r.tiles}</td>
                            <td>{r.rooms}</td>
                            <td>{r.suggestions}</td>
                            <td>{r.reveals}</td>
                            <td>{r.accusations}</td>
                            <td>{r.timesSuspected}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {unmasked.length > 0 && (
            <section className="end__section">
              <h2 className="end__sectiontitle">The computers, unmasked</h2>
              <p className="end__sectionsub">Every computer played the whole game with a secret personality.</p>
              <ul className="end__personas">
                {unmasked.map((p) => {
                  const persona = BOT_PERSONAS[p.persona!];
                  return (
                    <li key={p.id} className="end__persona">
                      <div className="end__personawho">
                        <Name view={game} id={p.id} />
                        <span className="end__personatitle">{persona.title}</span>
                      </div>
                      <div className="end__personablurb">{persona.blurb}</div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {game.stats && (
            <section className="end__about">
              {game.stats.startedAt && (
                <div className="end__aboutrow">
                  <span className="end__aboutlbl">Played</span>
                  <span>
                    {when(game.stats.startedAt, game.stats.endedAt)}
                    {mins !== undefined ? ` (${plural(mins, 'minute')})` : ''}
                  </span>
                </div>
              )}
              {(['human', 'computer', 'observer'] as const).map((kind) => {
                const list = (game.stats?.participants ?? []).filter((p) => p.kind === kind);
                if (!list.length) return null;
                const label = kind === 'human' ? 'Detectives' : kind === 'computer' ? 'Computers' : 'Observers';
                const endedAt = game.stats?.endedAt ?? Infinity;
                return (
                  <div key={kind} className="end__aboutrow">
                    <span className="end__aboutlbl">{label}</span>
                    <span>
                      {list.map((p, i) => {
                        const played = p.suspectId && kind !== 'observer' ? getCard(p.suspectId)?.title : undefined;
                        return (
                          <span key={i} className="end__aboutwho">
                            {p.name}
                            {played && played !== p.name ? ` (${played})` : ''}
                            {p.leftAt && p.leftAt < endedAt ? ' [left early]' : ''}
                            {i < list.length - 1 ? ', ' : ''}
                          </span>
                        );
                      })}
                    </span>
                  </div>
                );
              })}
            </section>
          )}
        </div>

        <footer className="end__footer">
          {remaining !== undefined ? (
            <div className="end__countdown">
              Next public game forms in <strong>{mmss(remaining)}</strong>
            </div>
          ) : (
            <div className="end__countdown end__countdown--quiet">Thanks for playing 40 ALIBIS!</div>
          )}
          <div className="end__actions">
            <button className="btn end__pdf" onClick={downloadPdf} disabled={saving} title="Save this report as a PDF">
              {saving ? 'Preparing PDF…' : '⬇ Download PDF'}
            </button>
            <button className="btn btn--primary" onClick={onLeave}>
              {leaveLabel}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
