import { CURB_W, H, SPACING, TRACK_W, W } from './config';
import { makeRng, type Rng } from './rng';
import { themeFor, type Theme } from './themes';
import { wrapAngle, type Vec } from './util';

export interface TrackPoint extends Vec {
  ang: number;  // direction of travel
  nx: number;   // unit normal (to the right of travel)
  ny: number;
  w: number;    // asphalt width here
}

export interface Oil extends Vec {
  i: number;    // centerline index the slick sits on
  r: number;
  seed: number; // shape seed for rendering
}

/** A run of centerline indices, wrapping around: from, from+1, …, from+len-1 (mod n). */
export interface IndexRange {
  from: number;
  len: number;
}

/** Where a figure-eight crosses itself: one branch goes over, the other under. */
export interface Bridge extends Vec {
  over: IndexRange;
  under: IndexRange;
}

export type Layout = 'loop' | 'figure8';

export interface Track {
  seed: number;
  layout: Layout;
  theme: Theme;
  pts: TrackPoint[];
  n: number;
  oils: Oil[];
  /** Distance from the centerline to the tyre wall, per point, on the +normal (right) side. */
  wallRight: number[];
  /** Same, on the -normal (left) side. */
  wallLeft: number[];
  bridge: Bridge | null;
}

export const MIN_W = TRACK_W * 0.72;
export const MAX_W = TRACK_W * 1.3;
const FIGURE8_CHANCE = 0.35;
/** Around a crossing, the two branches are allowed to be close to each other. */
const CROSS_ZONE = 160;
const MIN_CROSS_ANGLE = 0.96; // ~55°, so the bridge isn't absurdly long

/** How far the tyre walls sit from the centerline when nothing else is nearby. */
export const wallOffset = (p: { w: number }): number => p.w / 2 + CURB_W + 34;

export function inRange(i: number, r: IndexRange, n: number): boolean {
  return (((i - r.from) % n) + n) % n < r.len;
}

export function isOnBridge(track: Track, idx: number): boolean {
  return !!track.bridge && inRange(idx, track.bridge.over, track.n);
}

export function isUnderBridge(track: Track, idx: number): boolean {
  return !!track.bridge && inRange(idx, track.bridge.under, track.n);
}

// ---------- Geometry helpers ----------

type WPoint = Vec & { w: number };

interface Crossing extends Vec {
  i: number;
  j: number;
  angle: number; // acute angle between the two branches
}

function catmullRom(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

function splineLoop(ctrl: Vec[]): Vec[] {
  const n = ctrl.length, raw: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < 24; s++) raw.push(catmullRom(p0, p1, p2, p3, s / 24));
  }
  return raw;
}

/** Evenly space points along a closed polyline. */
function resample(raw: Vec[]): Vec[] {
  const out: Vec[] = [raw[0]];
  let carry = 0;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i], b = raw[(i + 1) % raw.length];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    let d = SPACING - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += SPACING;
    }
    carry = seg - (d - SPACING);
  }
  // Drop a trailing point that sits on top of the first one.
  const last = out[out.length - 1];
  if (Math.hypot(last.x - out[0].x, last.y - out[0].y) < SPACING * 0.5) out.pop();
  return out;
}

/** Smoothly varying width: a couple of slow waves, so there are wide and narrow stretches. */
function withWidths(pts: Vec[], rng: Rng): WPoint[] {
  const n = pts.length;
  const waves = [
    { k: rng.int(2, 4), a: rng.range(0.1, 0.2), ph: rng.range(0, Math.PI * 2) },
    { k: rng.int(5, 8), a: rng.range(0.03, 0.08), ph: rng.range(0, Math.PI * 2) },
  ];
  return pts.map((p, i) => {
    let f = 1;
    for (const wv of waves) f += wv.a * Math.sin((Math.PI * 2 * wv.k * i) / n + wv.ph);
    return { x: p.x, y: p.y, w: Math.min(MAX_W, Math.max(MIN_W, TRACK_W * f)) };
  });
}

/** The one place a figure-eight crosses itself, if it does. */
function findCrossing(pts: Vec[]): Crossing | null {
  const n = pts.length, minSep = Math.floor(n / 5);
  let best = Infinity, bi = -1, bj = -1;
  for (let i = 0; i < n; i++) {
    for (let j = i + minSep; j < n; j++) {
      if (n - (j - i) < minSep) continue;
      const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2;
      if (d < best) { best = d; bi = i; bj = j; }
    }
  }
  if (bi < 0 || best > (SPACING * 1.5) ** 2) return null;
  const dir = (k: number) => {
    const a = pts[(k - 1 + n) % n], b = pts[(k + 1) % n];
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const diff = Math.abs(wrapAngle(dir(bi) - dir(bj)));
  return {
    i: bi, j: bj,
    x: (pts[bi].x + pts[bj].x) / 2, y: (pts[bi].y + pts[bj].y) / 2,
    angle: Math.min(diff, Math.PI - diff),
  };
}

function trackIsValid(pts: WPoint[], crossing: Crossing | null): boolean {
  const n = pts.length;
  // Stay on screen (leave room for curbs).
  for (const p of pts) {
    const m = p.w / 2 + CURB_W + 20;
    if (p.x < m || p.x > W - m || p.y < m || p.y > H - m) return false;
  }

  // No hairpins tighter than the track can handle.
  const k = 5;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - k + n) % n], b = pts[i], c = pts[(i + k) % n];
    const turn = Math.abs(wrapAngle(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)));
    const radius = (k * SPACING) / Math.max(turn, 1e-6);
    if (radius < Math.max(TRACK_W * 0.7, b.w / 2 + CURB_W + 4)) return false;
  }

  // No section of track comes close to a different section (except right at a crossing).
  const nearCross = (p: Vec) => !!crossing && Math.hypot(p.x - crossing.x, p.y - crossing.y) < CROSS_ZONE;
  const skip = Math.ceil(((MAX_W + CURB_W * 2 + 18) * 2) / SPACING);
  for (let i = 0; i < n; i += 2) {
    for (let j = i + skip; j < n; j += 2) {
      if (n - (j - i) < skip) continue;
      const a = pts[i], b = pts[j];
      const gap = a.w / 2 + b.w / 2 + CURB_W * 2 + 18;
      const dx = a.x - b.x, dy = a.y - b.y;
      if (dx * dx + dy * dy < gap * gap && !(nearCross(a) && nearCross(b))) return false;
    }
  }
  return true;
}

// ---------- Layouts ----------

/** A wobbly loop around the screen centre. */
function randomLoop(rng: Rng): WPoint[] | null {
  const m = rng.int(8, 14);
  const ctrl: Vec[] = [];
  for (let i = 0; i < m; i++) {
    const a = (i / m) * Math.PI * 2 + rng.range(-0.4, 0.4) * (Math.PI / m);
    const r = rng.range(0.3, 1);
    ctrl.push({ x: W / 2 + Math.cos(a) * 690 * r, y: H / 2 + Math.sin(a) * 370 * r });
  }
  const pts = withWidths(resample(splineLoop(ctrl)), rng);
  return trackIsValid(pts, null) ? pts : null;
}

/** A wobbly figure-eight (lemniscate of Gerono) that crosses itself once. */
function randomFigure8(rng: Rng): { pts: WPoint[]; crossing: Crossing } | null {
  const m = rng.int(7, 10) * 2;
  const ax = rng.range(560, 680), ay = rng.range(520, 680);
  const cx = W / 2 + rng.range(-40, 40), cy = H / 2 + rng.range(-15, 15);
  const ctrl: Vec[] = [];
  for (let k = 0; k < m; k++) {
    const t = (k / m) * Math.PI * 2 + rng.range(-0.25, 0.25) * (Math.PI / m);
    const r = rng.range(0.82, 1.06);
    ctrl.push({ x: cx + Math.cos(t) * ax * r, y: cy + Math.sin(t) * Math.cos(t) * ay * r });
  }
  const raw = resample(splineLoop(ctrl));
  const crossing = findCrossing(raw);
  if (!crossing || crossing.angle < MIN_CROSS_ANGLE) return null;
  const pts = withWidths(raw, rng);
  return trackIsValid(pts, crossing) ? { pts, crossing } : null;
}

function ovalFallback(): WPoint[] {
  const raw: Vec[] = [];
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * Math.PI * 2;
    raw.push({ x: W / 2 + Math.cos(a) * 620, y: H / 2 + Math.sin(a) * 320 });
  }
  return resample(raw).map(p => ({ ...p, w: TRACK_W }));
}

/** Index of the straightest stretch (away from any crossing), used as the start/finish line. */
function straightestIndex(pts: Vec[], avoid: Vec | null): number {
  const n = pts.length;
  let bestI = 0, bestTurn = Infinity;
  for (let i = 0; i < n; i++) {
    if (avoid && Math.hypot(pts[i].x - avoid.x, pts[i].y - avoid.y) < CROSS_ZONE + 60) continue;
    let turn = 0;
    for (let k = -12; k < 12; k++) {
      const a = pts[(i + k + n) % n], b = pts[(i + k + 1 + n) % n], c = pts[(i + k + 2 + n) % n];
      turn += Math.abs(wrapAngle(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)));
    }
    if (turn < bestTurn) { bestTurn = turn; bestI = i; }
  }
  return bestI;
}

// ---------- Public entry point ----------

/** Build the track for `seed`. The same seed always gives the same track. */
export function generateTrack(seed: number): Track {
  const rng = makeRng(seed);
  let raw: WPoint[] | null = null;
  let crossing: Crossing | null = null;

  if (rng.next() < FIGURE8_CHANCE) {
    for (let tries = 0; tries < 300 && !raw; tries++) {
      const f8 = randomFigure8(rng);
      if (f8) { raw = f8.pts; crossing = f8.crossing; }
    }
  }
  for (let tries = 0; tries < 600 && !raw; tries++) raw = randomLoop(rng);
  if (!raw) raw = ovalFallback();
  if (rng.next() < 0.5) raw.reverse();

  const start = straightestIndex(raw, crossing);
  raw = raw.slice(start).concat(raw.slice(0, start));

  // Tangents & normals.
  const n = raw.length;
  const pts: TrackPoint[] = raw.map((p, i, all) => {
    const a = all[(i - 1 + n) % n], b = all[(i + 1) % n];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    return { x: p.x, y: p.y, w: p.w, ang, nx: -Math.sin(ang), ny: Math.cos(ang) };
  });

  // Indices moved when we reversed and rotated, so locate the crossing again.
  crossing = crossing ? findCrossing(pts) : null;
  const bridge = crossing ? makeBridge(pts, crossing, rng) : null;

  // Oil slicks somewhere on the track, away from the start and the bridge.
  const oils: Oil[] = [];
  const oilCount = rng.int(3, 5);
  for (let t = 0; oils.length < oilCount && t < 100; t++) {
    const i = Math.floor(rng.range(0.12, 0.95) * n);
    if (oils.some(o => Math.abs(o.i - i) < 40)) continue;
    if (crossing && Math.hypot(pts[i].x - crossing.x, pts[i].y - crossing.y) < CROSS_ZONE + 10) continue;
    const off = rng.range(-0.28, 0.28) * pts[i].w;
    oils.push({ i, x: pts[i].x + pts[i].nx * off, y: pts[i].y + pts[i].ny * off, r: rng.range(16, 24), seed: rng.next() * 1000 });
  }

  const [wallRight, wallLeft] = computeWalls(pts);
  return { seed, layout: bridge ? 'figure8' : 'loop', theme: themeFor(seed), pts, n, oils, wallRight, wallLeft, bridge };
}

/** Pick which branch goes over, and how much of each branch the bridge spans. */
function makeBridge(pts: TrackPoint[], c: Crossing, rng: Rng): Bridge {
  const n = pts.length;
  const [overC, underC] = rng.next() < 0.5 ? [c.i, c.j] : [c.j, c.i];
  const sin = Math.sin(c.angle);
  // Long enough to clear the other road (plus its curbs) at this crossing angle.
  const half = (other: TrackPoint) => Math.ceil(((other.w / 2 + CURB_W + 22) / sin + 8) / SPACING);
  const overHalf = half(pts[underC]), underHalf = half(pts[overC]);
  return {
    x: c.x, y: c.y,
    over: { from: (overC - overHalf + n) % n, len: overHalf * 2 + 1 },
    under: { from: (underC - underHalf + n) % n, len: underHalf * 2 + 1 },
  };
}

/**
 * Place walls `wallOffset` from the centerline, pulled in wherever another part of the
 * track (or the inside of a tight bend) is closer. Each wall point must be at least as
 * far from every other centerline point as from its own, i.e. it never crosses the
 * perpendicular bisector — so walls end up halfway between close sections. Around a
 * crossing this squeezes the walls in to the road edge, which works as bridge railings.
 */
function computeWalls(pts: TrackPoint[]): [number[], number[]] {
  const n = pts.length;
  const right = pts.map(wallOffset);
  const left = pts.map(wallOffset);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = pts[j].x - p.x, dy = pts[j].y - p.y;
      const along = dx * p.nx + dy * p.ny;
      const d2 = dx * dx + dy * dy;
      if (along > 1e-3) right[i] = Math.min(right[i], d2 / (2 * along));
      else if (along < -1e-3) left[i] = Math.min(left[i], d2 / (-2 * along));
    }
  }
  const minOff = pts.map(p => p.w / 2 + CURB_W + 4);
  return [smoothWall(right, minOff), smoothWall(left, minOff)];
}

/** Min-filter then average, so walls stay clear of the track but don't zig-zag. */
function smoothWall(off: number[], minOff: number[]): number[] {
  const n = off.length, r = 3;
  const mins = off.map((_, i) => {
    let m = Infinity;
    for (let k = -r; k <= r; k++) m = Math.min(m, off[(i + k + n) % n]);
    return m;
  });
  return mins.map((_, i) => {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += mins[(i + k + n) % n];
    return Math.max(minOff[i], sum / (2 * r + 1));
  });
}
