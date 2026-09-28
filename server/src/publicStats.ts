import fs from 'node:fs';
import path from 'node:path';
import {
  backfillPublicStats,
  emptyPublicStats,
  foldPublicGame,
  publicStatsListing,
  type GameView,
  type PublicStats,
  type PublicStatsListing,
  type WinnerProfile,
} from 'shared';

// Persistent history of the public table: all-time aggregates plus the last 50 games, kept in a
// JSON file so it survives restarts. DATA_DIR overrides where it lives (mount a volume there in
// production); it defaults to ./data next to the server's working directory.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'public-stats.json');

let stats: PublicStats = load();
let listing: PublicStatsListing | undefined; // built on first ask, dropped when a game is recorded

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
export function recordPublicGame(view: GameView, id: string, winner?: WinnerProfile): void {
  if (stats.recent.some((g) => g.id === id)) return; // already recorded
  foldPublicGame(stats, view, id, winner);
  listing = undefined;
  save();
}

/** The Statistics screen's payload: everything but the archived games' views. */
export function getPublicStats(): PublicStatsListing {
  return (listing ??= publicStatsListing(stats));
}

/** One archived game's details-screen view, fetched when its tile is opened. */
export function getPublicGameView(id: unknown): GameView | null {
  return stats.recent.find((g) => g.id === id)?.view ?? null;
}
