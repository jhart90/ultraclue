// Stress-test the room token packer: every room, crowded with pawns and weapons, must seat every
// token strictly inside its own tiles. Run with `npx -w client tsx scripts/packStress.ts [out.json]`.
import { writeFileSync } from 'node:fs';
import { BOARD, getCard } from 'shared';
import { packRoom, type Rect } from '../src/render/roomPacking';

const TS = 26;
const PAWN_R = TS / 2 - 6;
const EDGE = 1.5;

function labelGeom(room: (typeof BOARD.rooms)[string], title: string) {
  const xs = room.tiles.map((t) => t.x);
  const ys = room.tiles.map((t) => t.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const b = { x: minX * TS, y: minY * TS, w: (Math.max(...xs) - minX + 1) * TS, h: (Math.max(...ys) - minY + 1) * TS };
  const isRect = room.tiles.length === (b.w / TS) * (b.h / TS);
  const cx = isRect ? b.x + b.w / 2 : room.label.x * TS + TS / 2;
  const cy = isRect ? b.y + b.h / 2 : room.label.y * TS + TS / 2;
  const fs = Math.max(6.5, Math.min(11, (b.w - 12) / (title.length * 0.62)));
  const w = Math.min(b.w - 4, title.length * fs * 0.6 + 12);
  const h = fs + 7;
  return { b, cx, cy, w, h };
}

const scenarios = [
  { pawns: 3, weapons: 1 },
  { pawns: 12, weapons: 3 },
  { pawns: 24, weapons: 3 },
  { pawns: 40, weapons: 6 },
];
const out: Record<string, unknown> = {};
let failures = 0;
for (const room of Object.values(BOARD.rooms)) {
  const title = getCard(room.id)?.title ?? room.id;
  const lg = labelGeom(room, title);
  const tiles = new Set(room.tiles.map((t) => `${t.x},${t.y}`));
  const inTile = (x: number, y: number) => tiles.has(`${Math.floor(x / TS)},${Math.floor(y / TS)}`);
  const reserved: Rect[] = [{ x: lg.cx - lg.w / 2 - 2, y: lg.cy - lg.h / 2 - 16, w: lg.w + 4, h: lg.h + 18 }];
  if (room.shortcutTile) reserved.push({ x: room.shortcutTile.x * TS, y: room.shortcutTile.y * TS, w: TS, h: TS });
  for (const sc of scenarios) {
    const pk = packRoom({ tiles: room.tiles, ts: TS, reserved, pawns: sc.pawns, weapons: sc.weapons, rMax: PAWN_R, anchor: { x: lg.cx, y: lg.cy + lg.h / 2 + PAWN_R }, top: { x: lg.b.x + lg.b.w / 2, y: lg.b.y } });
    const all = [...pk.pawnSlots, ...pk.weaponSlots];
    // every token's bounding square (plus the wall keep-out) must lie on room tiles
    const bad = all.filter((p) => {
      const rr = pk.r + EDGE - 0.01;
      return !(inTile(p.x - rr, p.y - rr) && inTile(p.x + rr, p.y - rr) && inTile(p.x - rr, p.y + rr) && inTile(p.x + rr, p.y + rr));
    });
    const distinct = new Set(all.map((p) => `${p.x},${p.y}`)).size;
    if (bad.length) failures++;
    const line = `${title.padEnd(16)} ${room.tiles.length.toString().padStart(2)} tiles  ${sc.pawns}p+${sc.weapons}w  r=${pk.r.toFixed(1)}  slots used=${distinct}/${all.length}${pk.overflow ? '  OVERFLOW' : ''}${bad.length ? `  OUTSIDE=${bad.length}` : ''}`;
    if (process.env.PACK_ALL || sc.pawns === 24 || sc.pawns === 40 || pk.overflow || bad.length) console.log(line);
    out[`${room.id}:${sc.pawns}:${sc.weapons}`] = { room: room.id, tiles: room.tiles, label: lg, r: pk.r, pawns: pk.pawnSlots, weapons: pk.weaponSlots, overflow: pk.overflow };
  }
}
console.log(failures ? `\n${failures} scenario(s) placed a token outside its room` : '\nAll scenarios keep every token inside its room');
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out));
process.exit(failures ? 1 : 0);
