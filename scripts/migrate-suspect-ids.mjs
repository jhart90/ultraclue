#!/usr/bin/env node
// ---------------------------------------------------------------------------------------------
// ONE-SHOT MIGRATION — DELETE THIS FILE ONCE IT HAS BEEN RUN EVERYWHERE.
//
// The six original characters were renamed and their card ids renamed with them. Persisted state
// (public-stats.json, profiles.json) is keyed by card id, so without this the all-time tallies and
// every archived game would point at ids that no longer exist: the Statistics screen would show six
// blank characters and six orphaned rows of history.
//
// Legacy ids appear in the data only as whole string values (e.g. `players[].suspectId`) and as
// whole object keys (e.g. `characterGames`, `stats.suspects`) — never inside a longer string — so a
// deep walk that rewrites both is exact. The walk is id-agnostic: it does not care which field it
// is in, so it covers the frozen GameView blobs in `recent[]` as well as the top-level aggregates.
//
// Safe to run twice: the second run finds nothing and writes nothing.
//
//   node scripts/migrate-suspect-ids.mjs --dry-run     # report only
//   node scripts/migrate-suspect-ids.mjs               # migrate, keeping .bak files
//   DATA_DIR=/mnt/data node scripts/migrate-suspect-ids.mjs
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const RENAMES = {
  'suspect-scarlet': 'suspect-valentine',
  'suspect-mustard': 'suspect-dijon',
  'suspect-peacock': 'suspect-blue',
  'suspect-plum': 'suspect-mulberry',
  'suspect-green': 'suspect-verdant',
  'suspect-orchid': 'suspect-bloom',
};

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILES = ['public-stats.json', 'profiles.json'];
const dryRun = process.argv.includes('--dry-run');

/** Per-id tally of what was rewritten, so the run can be checked against a pre-flight count. */
const counts = Object.fromEntries(Object.keys(RENAMES).map((k) => [k, 0]));
let merged = 0;
let conflicts = 0;

/**
 * Rewrite every legacy id in `node`, returning the replacement. Strings are matched whole; object
 * keys are renamed in place. Where a game finished after the rename but before this ran, a tally
 * can hold both the legacy key and its new twin — those are summed, never clobbered.
 */
function migrate(node) {
  if (Array.isArray(node)) return node.map(migrate);

  if (node && typeof node === 'object') {
    // Two passes so key order cannot decide the outcome: copy everything that keeps its name, then
    // fold the renamed entries in on top. A single pass would let `{legacy: 5, new: 3}` overwrite
    // the folded 8 with 3 when the legacy key happens to come first.
    const out = {};
    const renamed = [];
    for (const [key, value] of Object.entries(node)) {
      if (RENAMES[key]) {
        counts[key]++;
        renamed.push([RENAMES[key], migrate(value)]);
      } else {
        out[key] = migrate(value);
      }
    }
    for (const [key, value] of renamed) {
      if (!(key in out)) {
        out[key] = value;
      } else if (typeof out[key] === 'number' && typeof value === 'number') {
        out[key] += value; // both halves of a split tally
        merged++;
      } else {
        conflicts++; // non-numeric collision: the post-rename value is the live one, so it wins
        console.warn(`  ! non-numeric collision on "${key}" — kept the post-rename value`);
      }
    }
    return out;
  }

  if (typeof node === 'string' && RENAMES[node]) {
    counts[node]++;
    return RENAMES[node];
  }
  return node;
}

let touched = 0;
let missing = 0;

for (const name of FILES) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) {
    console.log(`- ${name}: not present, skipping`);
    missing++;
    continue;
  }

  const before = Object.fromEntries(Object.entries(counts));
  const raw = fs.readFileSync(file, 'utf8');
  const migrated = migrate(JSON.parse(raw));
  const found = Object.keys(RENAMES).reduce((n, k) => n + (counts[k] - before[k]), 0);

  if (found === 0) {
    console.log(`- ${name}: already migrated (0 legacy ids)`);
    continue;
  }

  const detail = Object.entries(RENAMES)
    .filter(([legacy]) => counts[legacy] - before[legacy] > 0)
    .map(([legacy, next]) => `${next} +${counts[legacy] - before[legacy]}`)
    .join(', ');
  console.log(`- ${name}: ${found} legacy ids -> ${detail}`);

  if (dryRun) continue;

  // Back up, then swap atomically — the same tmp+rename the server uses, so a crash mid-write
  // can never leave a half-written stats file behind.
  fs.copyFileSync(file, `${file}.pre-rename.bak`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(migrated));
  fs.renameSync(tmp, file);
  touched++;
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (dryRun) {
  console.log(`\nDry run: ${total} ids would be rewritten. Nothing was written.`);
} else {
  console.log(
    touched
      ? `\nRewrote ${total} ids across ${touched} file(s). Backups saved as *.pre-rename.bak`
      : `\nNothing to do — every file is already migrated.`,
  );
}
if (merged) console.log(`Summed ${merged} split tallies (games played after the rename, before this ran).`);
if (conflicts) console.log(`${conflicts} non-numeric collision(s) — review the warnings above.`);
if (missing === FILES.length) console.log(`No data files found in ${DATA_DIR} — is DATA_DIR set correctly?`);
