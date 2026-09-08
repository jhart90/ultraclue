#!/usr/bin/env node
// ---------------------------------------------------------------------------------------------
// ONE-SHOT MIGRATION — DELETE THIS FILE ONCE IT HAS BEEN RUN EVERYWHERE.
//
// The six original characters were renamed and their card ids renamed with them. Persisted state
// is keyed by card id AND stores each computer player's character name as literal text, so without
// this the Statistics screen shows six blank characters, raw `suspect-<id>` strings where an
// envelope should read, and the old names still spelled out in the archive.
//
// Two things this rewrites:
//   * card ids   — as whole string values (`players[].suspectId`) and as object keys
//                  (`characterGames`, `stats.suspects`, `profiles[].characters`)
//   * displayed names — stored as text in `recent[].winnerName`, `view.players[].name` and
//                  `view.stats.participants[].name`; replaced anywhere they occur inside a string
//
// Where it looks, in order: $DATA_DIR, ./data, ./server/data — every one that exists. The server
// resolves its own directory as `process.env.DATA_DIR || <cwd>/data`, and `npm start` runs it as a
// workspace script, so its cwd is ./server and its default is ./server/data — NOT the ./data you
// get when running a script from the repo root. Checking all three means the migration cannot miss
// the volume because it was launched from a different directory than the server.
//
// Safe to run twice: the second run finds nothing and writes nothing.
//
//   node scripts/migrate-suspect-ids.mjs --dry-run     # report only
//   node scripts/migrate-suspect-ids.mjs               # migrate, keeping .bak files
// ---------------------------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const RENAMES = {
  // card ids
  'suspect-scarlet': 'suspect-valentine',
  'suspect-mustard': 'suspect-dijon',
  'suspect-peacock': 'suspect-blue',
  'suspect-plum': 'suspect-mulberry',
  'suspect-green': 'suspect-verdant',
  'suspect-orchid': 'suspect-bloom',
  // names as they were displayed and stored
  'Miss Scarlet': 'Ruby Valentine',
  'Miss Scarlett': 'Ruby Valentine', // both spellings appeared over the years
  'Colonel Mustard': 'Colonel Dijon',
  'Mrs. Peacock': 'Beatrice Blue',
  'Professor Plum': 'Professor Mulberry',
  'Mr. Green': 'Reverend Verdant',
  'Dr. Orchid': 'Botanist Bloom',
  'Dr Orchid': 'Botanist Bloom', // the period was dropped in a few places
};

// Matched anywhere inside a string, not just as a whole value, so a name spelled out in a stored
// sentence is caught too. Longest first so no token is eaten by a shorter one overlapping it, and
// each is followed by a guard so a longer identifier that merely starts with one is left alone:
// `suspect-scarletish` and `Miss Scarletson` are not this character.
const TOKENS = Object.keys(RENAMES).sort((a, b) => b.length - a.length);
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const guard = (t) => (t.startsWith('suspect-') ? '(?![a-z0-9-])' : '(?![A-Za-z])');
const PATTERN = new RegExp(TOKENS.map((t) => `${esc(t)}${guard(t)}`).join('|'), 'g');

const FILES = ['public-stats.json', 'profiles.json'];
const dryRun = process.argv.includes('--dry-run');

const counts = Object.fromEntries(TOKENS.map((k) => [k, 0]));
let merged = 0;
let conflicts = 0;

/**
 * Where to migrate. An explicit DATA_DIR means exactly that directory and nothing else — the same
 * way the server reads it. Only when it is unset do we fall back to trying both conventional spots,
 * because `npm start` launches the server as a workspace script from ./server while this script is
 * launched from the repo root, so the two disagree about what `<cwd>/data` means.
 */
function dataDirs() {
  if (process.env.DATA_DIR) return fs.existsSync(process.env.DATA_DIR) ? [process.env.DATA_DIR] : [];
  const seen = new Map();
  for (const dir of ['data', path.join('server', 'data')]) {
    if (!fs.existsSync(dir)) continue;
    const key = fs.realpathSync(dir);
    if (!seen.has(key)) seen.set(key, dir);
  }
  return [...seen.values()];
}

const rewrite = (s) => s.replace(PATTERN, (m) => (counts[m]++, RENAMES[m]));

/**
 * Rewrite every legacy id and name in `node`. Object keys are renamed in place; where a game
 * finished after the rename but before this ran, a tally can hold both the legacy key and its new
 * twin, so those are summed rather than one silently winning.
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
      const nextKey = RENAMES[key];
      if (nextKey) {
        counts[key]++;
        renamed.push([nextKey, migrate(value)]);
      } else {
        out[key] = migrate(value);
      }
    }
    for (const [key, value] of renamed) {
      if (!(key in out)) {
        out[key] = value;
      } else if (typeof out[key] === 'number' && typeof value === 'number') {
        out[key] += value;
        merged++;
      } else {
        conflicts++; // the post-rename value is the live one, so it wins
        console.warn(`  ! non-numeric collision on "${key}" — kept the post-rename value`);
      }
    }
    return out;
  }

  return typeof node === 'string' ? rewrite(node) : node;
}

const dirs = dataDirs();
if (dirs.length === 0) {
  console.log(`No data directory found (looked for $DATA_DIR, ./data, ./server/data from ${process.cwd()}).`);
  process.exit(0);
}
console.log(`Data directories: ${dirs.join(', ')}`);

let touched = 0;

for (const dir of dirs) {
  for (const name of FILES) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;

    const before = { ...counts };
    const migrated = migrate(JSON.parse(fs.readFileSync(file, 'utf8')));
    const found = TOKENS.reduce((n, k) => n + (counts[k] - before[k]), 0);

    if (found === 0) {
      console.log(`- ${file}: already migrated`);
      continue;
    }

    const detail = TOKENS.filter((t) => counts[t] - before[t] > 0)
      .map((t) => `${RENAMES[t]} +${counts[t] - before[t]}`)
      .join(', ');
    console.log(`- ${file}: ${found} replacements -> ${detail}`);

    if (dryRun) continue;

    // Back up, then swap atomically — the same tmp+rename the server uses, so a crash mid-write
    // can never leave a half-written stats file behind.
    fs.copyFileSync(file, `${file}.pre-rename.bak`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(migrated));
    fs.renameSync(tmp, file);
    touched++;
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
if (dryRun) console.log(`\nDry run: ${total} replacements would be made. Nothing was written.`);
else if (touched) console.log(`\nRewrote ${total} references across ${touched} file(s). Backups saved as *.pre-rename.bak`);
else console.log(`\nNothing to do — every file is already migrated.`);
if (merged) console.log(`Summed ${merged} split tallies (games played after the rename, before this ran).`);
if (conflicts) console.log(`${conflicts} non-numeric collision(s) — review the warnings above.`);
