import fs from 'node:fs';
import path from 'node:path';
import { backfillPublicStats, emptyPublicStats, foldPublicGame, type GameView, type PublicStats } from 'shared';

// Persistent history of the public table: all-time aggregates plus the last 50 games, kept in a
// JSON file so it survives restarts. DATA_DIR overrides where it lives (mount a volume there in
// production); it defaults to ./data next to the server's working directory.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'public-stats.json');

let stats: PublicStats = load();

function load(): PublicStats {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PublicStats>;
    // tolerate older files missing newer fields, rebuilding what the archive can still supply
    const stats: PublicStats = { ...emptyPublicStats(), ...parsed, recent: Array.isArray(parsed.recent) ? parsed.recent : [] };
    if (backfillPublicStats(stats, parsed)) console.log('[public-stats] backfilled suggestion tallies from the archive');
    return stats;
  } catch {
    return emptyPublicStats();
  }
}

function save(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(stats));
    fs.renameSync(tmp, FILE); // atomic swap so a crash mid-write never corrupts the file
  } catch (err) {
    console.error('[public-stats] could not save:', (err as Error).message);
  }
}

/** Fold a finished public game into the history and persist it. */
export function recordPublicGame(view: GameView, id: string): void {
  if (stats.recent.some((g) => g.id === id)) return; // already recorded
  foldPublicGame(stats, view, id);
  save();
}

export function getPublicStats(): PublicStats {
  return stats;
}
