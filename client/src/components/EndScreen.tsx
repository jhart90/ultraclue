import { useEffect, useState } from 'react';
import { getCard, summarizeStats, PUBLIC_ROOM_CODE, type GameView, type Ranked } from 'shared';
import { Card } from './Card';
import { contrastInk } from '../render/colorUtils';
import './EndScreen.css';

const EMOJI: Record<string, string> = {
  travelled: '👣',
  rooms: '🚪',
  suggestions: '🔍',
  reveals: '🃏',
  suspect: '🕵️',
  weapon: '🗡️',
  room: '🏛️',
};

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
  const mins = Math.max(1, Math.round((endedAt - startedAt) / 60000));
  return `${date}, ${t(start)} to ${t(new Date(endedAt))} (${mins} min)`;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** An honour tile: who led a category (ties share it) and by how much. */
function Honour({ view, icon, title, leaders, unit }: { view: GameView; icon: string; title: string; leaders: Ranked[]; unit: string }) {
  if (!leaders.length) return null;
  const n = leaders[0].count;
  return (
    <div className="end__honour">
      <div className="end__honouricon">{icon}</div>
      <div className="end__honourbody">
        <div className="end__honourtitle">{title}</div>
        <div className="end__honourwho">
          {leaders.map((l) => (
            <Name key={l.id} view={view} id={l.id} />
          ))}
        </div>
        <div className="end__honourcount">
          {n} {unit}
          {n === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

/** The most-named cards of one kind, top first. */
function TopCards({ icon, title, items }: { icon: string; title: string; items: Ranked[] }) {
  return (
    <div className="end__top">
      <div className="end__toptitle">
        <span>{icon}</span> {title}
      </div>
      {items.length === 0 ? (
        <div className="end__topnone">Nobody was named</div>
      ) : (
        <ol className="end__toplist">
          {items.map((it, i) => (
            <li key={it.id} className={i === 0 ? 'end__topitem end__topitem--lead' : 'end__topitem'}>
              <span className="end__topname">{getCard(it.id)?.title ?? it.id}</span>
              <span className="end__topcount">×{it.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The end-of-game details screen, shown to every player and observer once a game concludes:
 * congratulations for the winner, the envelope, the game's statistics and a per-player table.
 * Public games also show the countdown until the next lobby forms.
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
  const winColor = winner ? suspectColor(game, winner.id) : '#c8a24a';

  // Public games: live countdown to the next lobby (server clock, skew-corrected).
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!game.resetsAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [game.resetsAt]);
  const remaining = game.resetsAt ? game.resetsAt - (now + serverOffset) : undefined;

  return (
    <div className="sp__backdrop">
      <div className="end" role="dialog" aria-label="Game over">
        <div className="end__banner" style={{ background: winColor, color: contrastInk(winColor) }}>
          <div className="end__confetti" aria-hidden>
            🎉
          </div>
          <div className="end__headline">{won ? 'You solved the case!' : `${winner?.name ?? 'Someone'} wins!`}</div>
          <div className="end__sub">
            {winner && winner.name !== getCard(winner.suspectId)?.title ? `${winner.name} played ${getCard(winner.suspectId)?.title ?? 'a suspect'}. ` : ''}
            {solved ? 'A correct accusation closes the case.' : 'The last detective standing takes the case by default.'}
          </div>
        </div>

        <div className="end__body">
          <section className="end__section end__section--envelope">
            <div className="end__sectiontitle">The CLASSIFIED envelope contained</div>
            <div className="end__cards">
              {env &&
                [env.suspectId, env.weaponId, env.roomId].map((id) => {
                  const card = getCard(id);
                  return card ? <Card key={id} card={card} /> : null;
                })}
            </div>
          </section>

          {summary && (
            <>
              <section className="end__section">
                <div className="end__sectiontitle">The investigation in numbers</div>
                <div className="end__numbers">
                  <div className="end__number">
                    <div className="end__numberval">{summary.turnsPlayed}</div>
                    <div className="end__numberlbl">turns played</div>
                  </div>
                  <div className="end__number">
                    <div className="end__numberval">{summary.rounds}</div>
                    <div className="end__numberlbl">full rounds</div>
                  </div>
                  <div className="end__number">
                    <div className="end__numberval">{summary.suggestionCount}</div>
                    <div className="end__numberlbl">suggestions made</div>
                  </div>
                  <div className="end__number">
                    <div className="end__numberval">{summary.rows.reduce((n, r) => n + r.accusations, 0)}</div>
                    <div className="end__numberlbl">accusations</div>
                  </div>
                </div>
              </section>

              <section className="end__section">
                <div className="end__sectiontitle">Most suspected</div>
                <div className="end__tops">
                  <TopCards icon={EMOJI.suspect} title="Suspects" items={summary.topSuspects} />
                  <TopCards icon={EMOJI.weapon} title="Weapons" items={summary.topWeapons} />
                  <TopCards icon={EMOJI.room} title="Rooms" items={summary.topRooms} />
                </div>
              </section>

              <section className="end__section">
                <div className="end__sectiontitle">Honours</div>
                <div className="end__honours">
                  <Honour view={game} icon={EMOJI.travelled} title="Most travelled" leaders={summary.mostTravelled} unit="tile" />
                  <Honour view={game} icon={EMOJI.rooms} title="Most rooms visited" leaders={summary.mostRoomsVisited} unit="room" />
                  <Honour view={game} icon={EMOJI.suggestions} title="Most suggestions" leaders={summary.mostSuggestions} unit="suggestion" />
                  <Honour view={game} icon={EMOJI.reveals} title="Most cards shown" leaders={summary.mostReveals} unit="card" />
                </div>
              </section>

              <section className="end__section">
                <div className="end__sectiontitle">Every detective</div>
                <div className="end__tablewrap">
                  <table className="end__table">
                    <thead>
                      <tr>
                        <th>Detective</th>
                        <th>Turns</th>
                        <th>Tiles</th>
                        <th>Rooms</th>
                        <th>Suggested</th>
                        <th>Shown</th>
                        <th>Accused</th>
                        <th>Suspected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.rows.map((r) => {
                        const p = game.players.find((x) => x.id === r.playerId);
                        return (
                          <tr key={r.playerId} className={r.playerId === game.winnerId ? 'end__row end__row--winner' : 'end__row'}>
                            <td className="end__cellname">
                              <Name view={game} id={r.playerId} />
                              {p?.eliminated && r.playerId !== game.winnerId && <span className="end__out">out</span>}
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
        </div>

        {game.stats && (
          <div className="end__about">
            {game.stats.startedAt && (
              <div className="end__aboutrow">
                <span className="end__aboutlbl">Played</span>
                <span>{when(game.stats.startedAt, game.stats.endedAt)}</span>
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
          </div>
        )}

        <div className="end__footer">
          {isPublic && remaining !== undefined && !closeLabel ? (
            <div className="end__countdown">
              Next public game forms in <strong>{mmss(remaining)}</strong>
            </div>
          ) : (
            <div className="end__countdown end__countdown--quiet">Thanks for playing ULTRA CLUE!</div>
          )}
          <button className="btn btn--primary" onClick={onLeave}>
            {closeLabel ?? (isPublic ? 'Leave the table' : 'Back to Title')}
          </button>
        </div>
      </div>
    </div>
  );
}
