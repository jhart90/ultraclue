// Stress-test the room token packer: every room, crowded with pawns and weapons, must seat every
// token strictly inside its own tiles. Run with `npx -w client tsx scripts/packStress.ts [out.json]`.
import { writeFileSync } from 'node:fs';
import { BOARD, getCard } from 'shared';
import { packRoom, type Rect } from '../src/render/roomPacking';
import { TS, labelGeom, roomBounds, weaponAnchor } from '../src/render/roomLayout';

const PAWN_R = TS / 2 - 6;
const EDGE = 1.5;

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
  const b = roomBounds(room);
  const tiles = new Set(room.tiles.map((t) => `${t.x},${t.y}`));
  const inTile = (x: number, y: number) => tiles.has(`${Math.floor(x / TS)},${Math.floor(y / TS)}`);
  const reserved: Rect[] = [{ x: lg.cx - lg.w / 2 - 2, y: lg.cy - lg.h / 2 - 2, w: lg.w + 4, h: lg.h + 4 }];
  if (room.shortcutTile) reserved.push({ x: room.shortcutTile.x * TS, y: room.shortcutTile.y * TS, w: TS, h: TS });
  const wa = weaponAnchor(room, lg, reserved, PAWN_R);
  // the anchor itself must be on the room's floor, and (unless it had to go elsewhere) above the name
  const side = wa.y < lg.cy ? 'above' : wa.y > lg.cy ? 'below' : 'beside';
  if (!inTile(wa.x, wa.y)) {
    failures++;
    console.log(`${title.padEnd(16)} weapon anchor off the floor at ${wa.x.toFixed(0)},${wa.y.toFixed(0)}`);
  }
  for (const sc of scenarios) {
    const pk = packRoom({ tiles: room.tiles, ts: TS, reserved, pawns: sc.pawns, weapons: sc.weapons, rMax: PAWN_R, anchor: { x: lg.cx, y: lg.cy + lg.h / 2 + PAWN_R }, weaponAnchor: wa });
    const all = [...pk.pawnSlots, ...pk.weaponSlots];
    // every token's bounding square (plus the wall keep-out) must lie on room tiles
    const bad = all.filter((p) => {
      const rr = pk.r + EDGE - 0.01;
      return !(inTile(p.x - rr, p.y - rr) && inTile(p.x + rr, p.y - rr) && inTile(p.x - rr, p.y + rr) && inTile(p.x + rr, p.y + rr));
    });
    const distinct = new Set(all.map((p) => `${p.x},${p.y}`)).size;
    if (bad.length) failures++;
    const line = `${title.padEnd(16)} ${room.tiles.length.toString().padStart(2)} tiles  ${sc.pawns}p+${sc.weapons}w  r=${pk.r.toFixed(1)}  slots used=${distinct}/${all.length}  weapons ${side}${pk.overflow ? '  OVERFLOW' : ''}${bad.length ? `  OUTSIDE=${bad.length}` : ''}`;
    if (process.env.PACK_ALL || sc.pawns === 24 || sc.pawns === 40 || pk.overflow || bad.length) console.log(line);
    out[`${room.id}:${sc.pawns}:${sc.weapons}`] = { room: room.id, tiles: room.tiles, bounds: b, label: lg, weaponAnchor: wa, r: pk.r, pawns: pk.pawnSlots, weapons: pk.weaponSlots, overflow: pk.overflow };
  }
}
console.log(failures ? `\n${failures} scenario(s) placed a token outside its room` : '\nAll scenarios keep every token inside its room');
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out));
process.exit(failures ? 1 : 0);
