import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import {
  cleanPin,
  emptyProfile,
  foldProfileGame,
  normalizeName,
  pinlessProfileId,
  type GameView,
  type PlayerProfile,
  type WinnerProfile,
} from 'shared';

// Long-term player profiles, keyed by name + optional PIN. Persisted as one JSON file next to the
// public stats (DATA_DIR). The PIN itself is never stored: a PIN-protected profile's id is an HMAC
// of the normalised name and PIN under a random per-installation salt, so neither the PIN nor the
// id can be recovered from the other. A name used without a PIN maps to the plain id `n:<name>`.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'profiles.json');

interface ProfileStore {
  salt: string;
  profiles: Record<string, PlayerProfile>;
}

let store: ProfileStore = load();

function load(): ProfileStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<ProfileStore>;
    if (typeof parsed.salt === 'string' && parsed.salt && parsed.profiles && typeof parsed.profiles === 'object') {
      return { salt: parsed.salt, profiles: parsed.profiles };
    }
  } catch {
    /* no file yet */
  }
  return { salt: randomBytes(32).toString('hex'), profiles: {} };
}

function save(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, FILE); // atomic swap so a crash mid-write never corrupts the file
  } catch (err) {
    console.error('[profiles] could not save:', (err as Error).message);
  }
}

// Unambiguous alphabet (no I/O/0/1) for the three-character public tag.
const TAG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** The public mark for a PIN-protected profile: three characters nobody can trace back to the PIN. */
function tagFor(id: string): string {
  const h = createHmac('sha256', store.salt).update(`tag\n${id}`).digest();
  return Array.from({ length: 3 }, (_, i) => TAG_ALPHABET[h[i] % TAG_ALPHABET.length]).join('');
}

export interface ProfileKey {
  id: string;
  tag: string;
  hasPin: boolean;
}

/** Resolve a typed name + PIN to a profile id. Blank names have no profile. The PIN is consumed
 *  here and never stored or echoed. */
export function profileKey(name: unknown, pin: unknown): ProfileKey | undefined {
  const norm = normalizeName(name);
  if (!norm) return undefined;
  const p = cleanPin(pin);
  if (!p) return { id: pinlessProfileId(norm), tag: '', hasPin: false };
  const digest = createHmac('sha256', store.salt).update(`${norm}\n${p}`).digest('hex').slice(0, 32);
  const id = `p:${digest}`;
  return { id, tag: tagFor(id), hasPin: true };
}

/** How the leaderboard should label a profile: its latest name and its tag. */
export function describeProfile(id: string, fallbackName: string): WinnerProfile {
  const p = store.profiles[id];
  return { id, name: p?.name ?? fallbackName, tag: p?.tag ?? (id.startsWith('p:') ? tagFor(id) : '') };
}

/** Look a profile up for its owner (by name + PIN). Never creates one. */
export function findProfile(name: unknown, pin: unknown): PlayerProfile | null {
  const key = profileKey(name, pin);
  if (!key) return null;
  return store.profiles[key.id] ?? null;
}

/** Fold a finished game into the profile behind `profileId`, creating it on first use. `name` is
 *  the spelling the player used this game (profiles remember the latest one). */
export function recordProfileGame(
  profileId: string,
  name: string,
  view: GameView,
  playerId: string,
  meta: { id: string; isPublic: boolean },
): void {
  const hasPin = profileId.startsWith('p:');
  const profile = (store.profiles[profileId] ??= emptyProfile(profileId, name.trim() || 'Player', hasPin ? tagFor(profileId) : '', hasPin));
  if (name.trim()) profile.name = name.trim();
  if (!foldProfileGame(profile, view, playerId, meta)) return;
  save();
}
