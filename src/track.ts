import { CURB_W, H, SPACING, TRACK_W, W } from './config';
import { rand, wrapAngle, type Vec } from './util';

export interface TrackPoint extends Vec {
  ang: number;  // direction of travel
  nx: number;   // unit normal (to the right of travel)
  ny: number;
}

export interface Oil extends Vec {
  i: number;    // centerline index the slick sits on
  r: number;
  seed: number; // shape seed for rendering
}

export interface Track {
  pts: TrackPoint[];
  n: number;
  oils: Oil[];
  /** Distance from the centerline to the tyre wall, per point, on the +normal (right) side. */
  wallRight: number[];
  /** Same, on the -normal (left) side. */
  wallLeft: number[];
}

/** How far the tyre walls sit from the centerline when nothing else is nearby. */
export const WALL_OFFSET = TRACK_W / 2 + CURB_W + 34;

function catmullRom(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
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

function trackIsValid(pts: Vec[]): boolean {
  const n = pts.length;
  // Stay on screen (leave room for curbs).
  const m = TRACK_W / 2 + CURB_W + 20;
  for (const p of pts) if (p.x < m || p.x > W - m || p.y < m || p.y > H - m) return false;

  // No hairpins tighter than the track can handle.
  const k = 5;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - k + n) % n], b = pts[i], c = pts[(i + k) % n];
    const turn = Math.abs(wrapAngle(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)));
    const radius = (k * SPACING) / Math.max(turn, 1e-6);
    if (radius < TRACK_W * 0.7) return false;
  }

  // No section of track comes close to a different section.
  const minGap = TRACK_W + CURB_W * 2 + 18;
  const skip = Math.ceil((minGap * 2) / SPACING);
  for (let i = 0; i < n; i += 2) {
    for (let j = i + skip; j < n; j += 2) {
      if (n - (j - i) < skip) continue;
      const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
      if (dx * dx + dy * dy < minGap * minGap) return false;
    }
  }
  return true;
}

function randomLoop(): Vec[] | null {
  const n = 8 + Math.floor(Math.random() * 7);
  const ctrl: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.4, 0.4) * (Math.PI / n);
    const r = rand(0.3, 1);
    ctrl.push({ x: W / 2 + Math.cos(a) * 690 * r, y: H / 2 + Math.sin(a) * 370 * r });
  }
  const raw: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let s = 0; s < 24; s++) raw.push(catmullRom(p0, p1, p2, p3, s / 24));
  }
  const cand = resample(raw);
  return trackIsValid(cand) ? cand : null;
}

function ovalFallback(): Vec[] {
  const raw: Vec[] = [];
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * Math.PI * 2;
    raw.push({ x: W / 2 + Math.cos(a) * 620, y: H / 2 + Math.sin(a) * 320 });
  }
  return resample(raw);
}

/** Index of the straightest stretch, used as the start/finish line. */
function straightestIndex(pts: Vec[]): number {
  const n = pts.length;
  let bestI = 0, bestTurn = Infinity;
  for (let i = 0; i < n; i++) {
    let turn = 0;
    for (let k = -12; k < 12; k++) {
      const a = pts[(i + k + n) % n], b = pts[(i + k + 1 + n) % n], c = pts[(i + k + 2 + n) % n];
      turn += Math.abs(wrapAngle(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)));
    }
    if (turn < bestTurn) { bestTurn = turn; bestI = i; }
  }
  return bestI;
}

export function generateTrack(): Track {
  let raw: Vec[] | null = null;
  for (let tries = 0; tries < 600 && !raw; tries++) raw = randomLoop();
  if (!raw) raw = ovalFallback();
  if (Math.random() < 0.5) raw.reverse();

  const start = straightestIndex(raw);
  raw = raw.slice(start).concat(raw.slice(0, start));

  // Tangents & normals.
  const n = raw.length;
  const pts: TrackPoint[] = raw.map((p, i) => {
    const a = raw[(i - 1 + n) % n], b = raw[(i + 1) % n];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    return { x: p.x, y: p.y, ang, nx: -Math.sin(ang), ny: Math.cos(ang) };
  });

  // Oil slicks somewhere on the track, away from the start.
  const oils: Oil[] = [];
  const oilCount = 3 + Math.floor(Math.random() * 3);
  for (let t = 0; oils.length < oilCount && t < 100; t++) {
    const i = Math.floor(rand(0.12, 0.95) * n);
    if (oils.some(o => Math.abs(o.i - i) < 40)) continue;
    const off = rand(-TRACK_W * 0.28, TRACK_W * 0.28);
    oils.push({ i, x: pts[i].x + pts[i].nx * off, y: pts[i].y + pts[i].ny * off, r: rand(16, 24), seed: Math.random() * 1000 });
  }

  const [wallRight, wallLeft] = computeWalls(pts);
  return { pts, n, oils, wallRight, wallLeft };
}

/**
 * Place walls WALL_OFFSET from the centerline, pulled in wherever another part of the
 * track (or the inside of a tight bend) is closer. Each wall point must be at least as
 * far from every other centerline point as from its own, i.e. it never crosses the
 * perpendicular bisector — so walls end up halfway between close sections.
 */
function computeWalls(pts: TrackPoint[]): [number[], number[]] {
  const n = pts.length;
  const right = new Array<number>(n).fill(WALL_OFFSET);
  const left = new Array<number>(n).fill(WALL_OFFSET);
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
  const minOff = TRACK_W / 2 + CURB_W + 4;
  return [smoothWall(right, minOff), smoothWall(left, minOff)];
}

/** Min-filter then average, so walls stay clear of the track but don't zig-zag. */
function smoothWall(off: number[], minOff: number): number[] {
  const n = off.length, r = 3;
  const mins = off.map((_, i) => {
    let m = Infinity;
    for (let k = -r; k <= r; k++) m = Math.min(m, off[(i + k + n) % n]);
    return m;
  });
  return mins.map((_, i) => {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += mins[(i + k + n) % n];
    return Math.max(minOff, sum / (2 * r + 1));
  });
}
