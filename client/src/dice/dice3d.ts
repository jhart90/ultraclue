// Software-3D d6 dice, ported from Roll67 (client/src/table/dice3d.ts) and trimmed to the cube.
// Real cube geometry tumbled with quaternions and painted onto a 2D canvas with flat shading —
// no WebGL. Each die flies in from off-screen with a decaying spin that ends EXACTLY on the
// orientation showing the rolled face, bouncing on the "table" (screen plane) as it settles.

// ---------- tiny vector / quaternion math ----------

type Vec3 = { x: number; y: number; z: number };
type Quat = { w: number; x: number; y: number; z: number };

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: Vec3, s: number) => v3(a.x * s, a.y * s, a.z * s);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: Vec3) => {
  const l = len(a) || 1;
  return scale(a, 1 / l);
};

const qIdent: Quat = { w: 1, x: 0, y: 0, z: 0 };

function qAxisAngle(axis: Vec3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  const a = norm(axis);
  return { w: Math.cos(h), x: a.x * s, y: a.y * s, z: a.z * s };
}

function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function qRotate(q: Quat, p: Vec3): Vec3 {
  const u = v3(q.x, q.y, q.z);
  const t = scale(cross(u, p), 2);
  return add(add(p, scale(t, q.w)), cross(u, t));
}

/** The rotation carrying unit vector `a` onto unit vector `b`. */
function qBetween(a: Vec3, b: Vec3): Quat {
  const c = dot(a, b);
  if (c > 0.9999) return qIdent;
  if (c < -0.9999) {
    const axis = Math.abs(a.x) < 0.9 ? cross(a, v3(1, 0, 0)) : cross(a, v3(0, 1, 0));
    return qAxisAngle(axis, Math.PI);
  }
  return qAxisAngle(cross(a, b), Math.acos(Math.max(-1, Math.min(1, c))));
}

// ---------- cube geometry ----------

interface Face {
  verts: Vec3[];
  value: number;
  normal: Vec3;
  center: Vec3;
  u: Vec3; // pip-grid right, in the face plane
  v: Vec3; // pip-grid down, in the face plane
}

function makeFace(verts: Vec3[], value: number): Face {
  const center = scale(verts.reduce(add, v3(0, 0, 0)), 1 / verts.length);
  let n = v3(0, 0, 0);
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    n = add(n, v3((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)));
  }
  let normal = norm(n);
  let ordered = verts;
  if (dot(normal, center) < 0) {
    ordered = [...verts].reverse();
    normal = scale(normal, -1);
  }
  // Centre-to-edge-midpoint basis, so a settled square sits flat on an edge rather than a corner.
  const uRaw = sub(scale(add(ordered[0], ordered[1]), 0.5), center);
  const u = norm(sub(uRaw, scale(normal, dot(uRaw, normal))));
  const v = norm(cross(normal, u));
  return { verts: ordered, value, normal, center, u, v };
}

const CUBE: Face[] = (() => {
  const s = 1 / Math.sqrt(3);
  const c = (x: number, y: number, z: number) => v3(x * s, y * s, z * s);
  const raw: Vec3[][] = [
    [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)],
    [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1)],
    [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)],
    [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)],
    [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
    [c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1)],
  ];
  return raw.map((verts, i) => makeFace(verts, i + 1));
})();

/** Orientation that presents the value's face to the camera, pips upright. */
function targetOrientation(value: number): Quat {
  const face = CUBE[(Math.max(1, value) - 1) % 6];
  const q1 = qBetween(face.normal, v3(0, 0, 1));
  const u2 = qRotate(q1, face.u);
  const angle = Math.atan2(u2.y, u2.x);
  return qMul(qAxisAngle(v3(0, 0, 1), -angle), q1);
}

// ---------- colours ----------

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function shade(rgb: Rgb, k: number): string {
  return `rgb(${Math.round(rgb[0] * k)}, ${Math.round(rgb[1] * k)}, ${Math.round(rgb[2] * k)})`;
}

// ---------- simulation ----------

export interface DieSim {
  value: number;
  rgb: Rgb;
  pipColor: string;
  size: number;
  start: { x: number; y: number };
  target: { x: number; y: number };
  delay: number;
  dur: number;
  qTarget: Quat;
  spinAxis: Vec3;
  spinTotal: number;
  bounceH: number;
  /** Wall-bounce: the point on a wall this die caroms off on its way to `target`. */
  via?: { x: number; y: number };
  viaAt?: number;
}

/** The walls dice carom off. */
export interface PlayBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const WAVE_STAGGER_MS = 110;
/** Model size of one die at the default scale; `buildSims` multiplies it by the viewer's setting. */
export const DIE_SIZE = 41;

/** Scatter landing spots around the middle of the play area, no two dice touching. */
function scatterTargets(n: number, b: PlayBounds): Array<{ x: number; y: number }> {
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  const cx = b.left + w / 2;
  const cy = b.top + h / 2;
  const minGap = 92;
  const needed = Math.sqrt(n) * minGap * 1.6;
  const spreadX = Math.min(Math.max(needed, minGap), w * 0.8) / 2;
  const spreadY = Math.min(Math.max(needed, minGap), h * 0.62) / 2;
  const placed: Array<{ x: number; y: number }> = [];
  const nearest = (p: { x: number; y: number }) =>
    placed.reduce((m, q) => Math.min(m, Math.hypot(p.x - q.x, p.y - q.y)), Infinity);
  for (let i = 0; i < n; i++) {
    let best = { x: cx, y: cy };
    let bestGap = -1;
    for (let attempt = 0; attempt < 60; attempt++) {
      const p = { x: cx + (Math.random() * 2 - 1) * spreadX, y: cy + (Math.random() * 2 - 1) * spreadY };
      const gap = nearest(p);
      if (gap >= minGap) {
        best = p;
        bestGap = gap;
        break;
      }
      if (gap > bestGap) {
        best = p;
        bestGap = gap;
      }
    }
    placed.push(best);
  }
  return placed;
}

/** Pick the wall this die caroms off, and where on it (only walls it's already heading toward). */
function pickWallBounce(
  start: { x: number; y: number },
  target: { x: number; y: number },
  b: PlayBounds,
  halfDie: number,
): { via: { x: number; y: number }; viaAt: number } | null {
  const lerp = (a: number, z: number, t: number) => a + (z - a) * t;
  const along = () => 0.55 + Math.random() * 0.35;
  const walls = [
    start.x < target.x
      ? { x: b.right - halfDie, y: lerp(start.y, target.y, along()) }
      : { x: b.left + halfDie, y: lerp(start.y, target.y, along()) },
    { x: lerp(start.x, target.x, along()), y: b.top + halfDie },
    { x: lerp(start.x, target.x, along()), y: b.bottom - halfDie },
  ].filter((p) => p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom);
  if (walls.length === 0) return null;
  const via = walls[Math.floor(Math.random() * walls.length)];
  const legA = Math.hypot(via.x - start.x, via.y - start.y);
  const legB = Math.hypot(target.x - via.x, target.y - via.y);
  if (legA + legB <= 0) return null;
  return { via, viaAt: Math.max(0.18, Math.min(0.82, legA / (legA + legB))) };
}

/** Plan a throw of `values` (each 1..6) that lands inside `bounds` on a canvas `w`×`h` px. */
export function buildSims(values: number[], w: number, h: number, color: string, pipColor: string, bounds?: PlayBounds, bouncePct = 45, scale = 1): DieSim[] {
  const b = bounds ?? { left: 0, right: w, top: 0, bottom: h };
  const bounceChance = Math.max(0, Math.min(100, bouncePct)) / 100;
  const dieSize = DIE_SIZE * scale;
  const targets = scatterTargets(values.length, b);
  const cx = b.left + (b.right - b.left) / 2;
  const rgb = hexToRgb(color);
  let waveDelay = 0;
  return values.map((value, i) => {
    const target = targets[i];
    const fromLeft = target.x < cx ? Math.random() < 0.8 : Math.random() < 0.2;
    const start = { x: fromLeft ? -80 : w + 80, y: target.y + 120 + Math.random() * 160 };
    const dur = 1450 + Math.random() * 250;
    const delay = (waveDelay += i === 0 ? 0 : WAVE_STAGGER_MS);
    const wall = Math.random() < bounceChance ? pickWallBounce(start, target, b, dieSize / 2) : null;
    return {
      value,
      rgb,
      pipColor,
      size: dieSize,
      start,
      target,
      ...(wall ? { via: wall.via, viaAt: wall.viaAt } : {}),
      delay,
      dur,
      qTarget: targetOrientation(value),
      spinAxis: norm(v3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)),
      spinTotal: Math.PI * 2 * (2.2 + Math.random() * 1.6) * (fromLeft ? 1 : -1),
      bounceH: 170 + Math.random() * 90,
    };
  });
}

/** ms (from the throw) at which the last die has landed. */
export function simsSettleTime(sims: DieSim[]): number {
  return Math.max(...sims.map((s) => s.delay + s.dur));
}

// ---------- rendering ----------

const LIGHT = norm(v3(0.35, -0.55, 0.75));

const PIP_LAYOUT: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
const PIP_SPACING = 8;
const PIP_RADIUS = 3.6;
const FACE_TEXT_SIZE = 0.62; // pip grid scale relative to model units

function drawPips(ctx: CanvasRenderingContext2D, value: number, color: string): void {
  ctx.fillStyle = color;
  for (const [px, py] of PIP_LAYOUT[value] ?? []) {
    ctx.beginPath();
    ctx.arc(px * PIP_SPACING, py * PIP_SPACING, PIP_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDie(ctx: CanvasRenderingContext2D, sim: DieSim, tMs: number): void {
  if (tMs < sim.delay - 1) return;
  const te = Math.max(0, Math.min(1, (tMs - sim.delay) / sim.dur));
  const ease = easeOutCubic(te);
  let x: number;
  let y: number;
  if (sim.via && sim.viaAt !== undefined) {
    const k = sim.viaAt;
    if (ease <= k) {
      const u = ease / k;
      x = sim.start.x + (sim.via.x - sim.start.x) * u;
      y = sim.start.y + (sim.via.y - sim.start.y) * u;
    } else {
      const u = (ease - k) / (1 - k);
      x = sim.via.x + (sim.target.x - sim.via.x) * u;
      y = sim.via.y + (sim.target.y - sim.via.y) * u;
    }
  } else {
    x = sim.start.x + (sim.target.x - sim.start.x) * ease;
    y = sim.start.y + (sim.target.y - sim.start.y) * ease;
  }
  const height = te >= 1 ? 0 : sim.bounceH * Math.abs(Math.cos(te * Math.PI * 2.3)) * Math.pow(1 - te, 1.6);
  const q = qMul(sim.qTarget, qAxisAngle(sim.spinAxis, sim.spinTotal * (1 - ease)));

  // Landing pop: a brief scale pulse right as the die settles.
  const sinceSettle = tMs - (sim.delay + sim.dur);
  const pop = sinceSettle > 0 && sinceSettle < 260 ? 1 + 0.14 * Math.sin((sinceSettle / 260) * Math.PI) : 1;
  const size = sim.size * pop;

  // Ground shadow, tied to the table position (not the airborne die).
  const shrink = Math.max(0.35, 1 - height / 320);
  ctx.fillStyle = `rgba(0, 0, 0, ${0.32 * shrink})`;
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.66, size * 0.85 * shrink, size * 0.32 * shrink, 0, 0, Math.PI * 2);
  ctx.fill();

  const cx = x;
  const cy = y - height * 0.85;

  const faces = CUBE.map((f) => {
    const normal = qRotate(q, f.normal);
    if (normal.z <= 0.02) return null;
    const pts = f.verts.map((p) => {
      const r = qRotate(q, p);
      const persp = 1 + r.z * 0.16;
      return { x: cx + r.x * size * persp, y: cy + r.y * size * persp, z: r.z };
    });
    return { f, normal, pts, depth: pts.reduce((s, p) => s + p.z, 0) / pts.length };
  })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((a, b) => a.depth - b.depth);

  for (const { f, normal, pts } of faces) {
    const lambert = 0.52 + 0.48 * Math.max(0, dot(normal, LIGHT));
    ctx.fillStyle = shade(sim.rgb, lambert);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (normal.z > 0.3) {
      // Paint the pips in the face plane via an affine transform of the face's (u, v) basis.
      const c3 = qRotate(q, f.center);
      const persp = 1 + c3.z * 0.16;
      const c2 = { x: cx + c3.x * size * persp, y: cy + c3.y * size * persp };
      const u3 = qRotate(q, f.u);
      const v3r = qRotate(q, f.v);
      const k = (FACE_TEXT_SIZE * size) / 24;
      ctx.save();
      ctx.transform(u3.x * k, u3.y * k, v3r.x * k, v3r.y * k, c2.x, c2.y); // post-multiply: keeps DPR scale
      drawPips(ctx, f.value, sim.pipColor);
      ctx.restore();
    }
  }
}

/** Draw one animation frame; returns true while anything is still moving. */
export function drawFrame(ctx: CanvasRenderingContext2D, sims: DieSim[], tMs: number, w: number, h: number): boolean {
  ctx.clearRect(0, 0, w, h);
  for (const sim of sims) drawDie(ctx, sim, tMs);
  return tMs < simsSettleTime(sims) + 400;
}
