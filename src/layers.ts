import { CURB_W, H, W } from './config';
import { makeRng, type Rng } from './rng';
import { wallOffset, type Track, type TrackPoint } from './track';
import type { Vec } from './util';

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d')!];
}

/** Pre-rendered static scenery: grass, track, decorations. */
export const [trackLayer, trackCtx] = makeCanvas();
/** The bridge deck of a figure-eight, drawn above cars on the lower road. */
export const [bridgeLayer, bridgeCtx] = makeCanvas();
/** Persistent skid marks drawn by the cars. */
export const [skidLayer, skidCtx] = makeCanvas();

/** Floodlight positions for night tracks (lit up by the renderer). */
export let floodlights: Vec[] = [];

export function clearSkids(): void {
  skidCtx.clearRect(0, 0, W, H);
}

// ---------- Band drawing ----------
// The road has a varying width, so instead of stroking a line we fill strips between two
// lateral offsets from the centerline, one quad per centerline segment.

type Offset = (p: TrackPoint) => number;

/** Add quads covering offsets a..b over `len` segments starting at `from` to the current path. */
function addBand(g: CanvasRenderingContext2D, pts: TrackPoint[], from: number, len: number, a: Offset, b: Offset): void {
  const n = pts.length;
  for (let k = 0; k < len; k++) {
    const p = pts[(from + k) % n], q = pts[(from + k + 1) % n];
    const c = [
      { x: p.x + p.nx * a(p), y: p.y + p.ny * a(p) },
      { x: q.x + q.nx * a(q), y: q.y + q.ny * a(q) },
      { x: q.x + q.nx * b(q), y: q.y + q.ny * b(q) },
      { x: p.x + p.nx * b(p), y: p.y + p.ny * b(p) },
    ];
    // Normalise winding so overlapping quads (e.g. at a crossing) never cancel out.
    let area = 0;
    for (let i = 0; i < 4; i++) area += c[i].x * c[(i + 1) % 4].y - c[(i + 1) % 4].x * c[i].y;
    if (area < 0) c.reverse();
    g.moveTo(c[0].x, c[0].y);
    g.lineTo(c[1].x, c[1].y);
    g.lineTo(c[2].x, c[2].y);
    g.lineTo(c[3].x, c[3].y);
    g.closePath();
  }
}

function fillBand(g: CanvasRenderingContext2D, pts: TrackPoint[], from: number, len: number, a: Offset, b: Offset, style: string): void {
  g.beginPath();
  addBand(g, pts, from, len, a, b);
  g.fillStyle = style;
  g.fill();
}

/** Dashed centre line over `len` segments starting at `from`. */
function centreLine(g: CanvasRenderingContext2D, pts: TrackPoint[], from: number, len: number): void {
  const n = pts.length;
  g.beginPath();
  g.moveTo(pts[from % n].x, pts[from % n].y);
  for (let k = 1; k <= len; k++) g.lineTo(pts[(from + k) % n].x, pts[(from + k) % n].y);
  g.setLineDash([18, 22]);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 2;
  g.stroke();
  g.setLineDash([]);
}

const half = (p: TrackPoint) => p.w / 2;
const neg = (f: Offset): Offset => p => -f(p);

// ---------- Scenery ----------

export function renderTrackLayer(track: Track): void {
  const g = trackCtx;
  const { pts, n, oils } = track;
  // Separate stream from generation, so decoration tweaks never change track layouts.
  const rng = makeRng(track.seed ^ 0x5bd1e995);

  const theme = track.theme;

  // Ground: colour, optional mowing stripes, noise.
  g.fillStyle = theme.ground;
  g.fillRect(0, 0, W, H);
  if (theme.stripes) {
    for (let x = 0; x < W; x += 80) {
      g.fillStyle = (x / 80) % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
      g.fillRect(x, 0, 80, H);
    }
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = theme.groundNoise[rng.next() < 0.5 ? 0 : 1];
    g.fillRect(rng.next() * W, rng.next() * H, 2, 2);
  }
  if (theme.name === 'desert') drawDunes(g, rng);

  drawDecor(g, track, rng);

  // Run-off shadow, curbs (red/white), asphalt.
  const curbOut: Offset = p => half(p) + CURB_W;
  fillBand(g, pts, 0, n, neg(p => curbOut(p) + 5), p => curbOut(p) + 5, 'rgba(0,0,0,0.25)');
  g.beginPath();
  addBand(g, pts, 0, n, half, curbOut);
  addBand(g, pts, 0, n, neg(curbOut), neg(half));
  g.fillStyle = '#eee';
  g.fill();
  g.beginPath();
  for (let k = 0; k < n; k += 4) { // red stripe every other ~12px
    addBand(g, pts, k, 2, half, curbOut);
    addBand(g, pts, k, 2, neg(curbOut), neg(half));
  }
  g.fillStyle = '#d32f2f';
  g.fill();
  fillBand(g, pts, 0, n, neg(half), half, theme.asphalt);

  // Asphalt texture.
  for (let i = 0; i < 2500; i++) {
    const p = pts[Math.floor(rng.next() * n)];
    const off = rng.range(-p.w / 2, p.w / 2);
    g.fillStyle = rng.next() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.07)';
    g.fillRect(p.x + p.nx * off + rng.range(-3, 3), p.y + p.ny * off + rng.range(-3, 3), 2, 2);
  }

  centreLine(g, pts, 0, n);
  drawStartLine(g, pts[0]);

  // Direction arrows painted on the grid.
  for (const k of [10, 22]) {
    const p = pts[k % n];
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.ang);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath(); g.moveTo(10, 0); g.lineTo(-6, -9); g.lineTo(-6, 9); g.closePath(); g.fill();
    g.restore();
  }

  drawTyreWalls(g, track);
  floodlights = theme.dark ? drawFloodlights(g, track) : [];

  // Oil slicks.
  for (const o of oils) {
    g.save();
    g.translate(o.x, o.y);
    const shape = makeRng(Math.floor(o.seed * 1000));
    g.fillStyle = 'rgba(10,10,14,0.85)';
    g.beginPath();
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = o.r * (0.75 + shape.next() * 0.45);
      if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.fill();
    const grad = g.createRadialGradient(-o.r * 0.3, -o.r * 0.3, 1, 0, 0, o.r);
    grad.addColorStop(0, 'rgba(120,80,200,0.35)');
    grad.addColorStop(0.5, 'rgba(40,160,180,0.15)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fill();
    g.restore();
  }

  renderBridgeLayer(track);
}

/** Trees, snowy pines or cacti and rocks, kept clear of the track and its walls. */
function drawDecor(g: CanvasRenderingContext2D, track: Track, rng: Rng): void {
  const { pts, n } = track;
  for (let t = 0; t < 40; t++) {
    const x = rng.range(20, W - 20), y = rng.range(20, H - 20);
    const r = rng.range(10, 20);
    const variant = rng.next();
    let near = false;
    for (let i = 0; i < n; i += 3) {
      if (Math.hypot(pts[i].x - x, pts[i].y - y) < wallOffset(pts[i]) + 26) { near = true; break; }
    }
    if (near) continue;
    if (track.theme.decor === 'pines') drawPine(g, x, y, r);
    else if (track.theme.decor === 'cacti' && variant < 0.55) drawCactus(g, x, y, r);
    else if (track.theme.decor === 'cacti') drawRock(g, x, y, r * 0.8);
    else drawTree(g, x, y, r);
  }
}

function drawTree(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath(); g.arc(x + 4, y + 5, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b6b2a';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#3c8a36';
  g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, Math.PI * 2); g.fill();
}

/** Top-down pine: a dark star of branches with snow on top. */
function drawPine(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const star = (rad: number, dx: number, dy: number) => {
    g.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, rr = k % 2 ? rad * 0.6 : rad;
      if (k) g.lineTo(x + dx + Math.cos(a) * rr, y + dy + Math.sin(a) * rr);
      else g.moveTo(x + dx + Math.cos(a) * rr, y + dy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  };
  g.fillStyle = 'rgba(60,80,110,0.25)'; star(r, 4, 5);
  g.fillStyle = '#1f4a33'; star(r, 0, 0);
  g.fillStyle = '#2d6446'; star(r * 0.6, 0, 0);
  g.fillStyle = 'rgba(255,255,255,0.85)'; star(r * 0.35, -1, -1);
}

function drawCactus(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(90,60,20,0.3)';
  g.lineWidth = r * 0.55;
  g.beginPath(); g.moveTo(x + 4 - r * 0.7, y + 5); g.lineTo(x + 4 + r * 0.7, y + 5); g.stroke();
  g.strokeStyle = '#4c8a3c';
  g.beginPath(); g.moveTo(x - r * 0.7, y); g.lineTo(x + r * 0.7, y); g.stroke();
  g.beginPath(); g.moveTo(x - r * 0.3, y); g.lineTo(x - r * 0.3, y - r * 0.6); g.stroke();
  g.beginPath(); g.moveTo(x + r * 0.35, y); g.lineTo(x + r * 0.35, y + r * 0.55); g.stroke();
  g.fillStyle = '#6fb35a';
  g.beginPath(); g.arc(x, y, r * 0.2, 0, Math.PI * 2); g.fill();
}

function drawRock(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = 'rgba(90,60,20,0.3)';
  g.beginPath(); g.ellipse(x + 4, y + 4, r, r * 0.75, 0.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9b8466';
  g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#b8a283';
  g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.2, r * 0.5, r * 0.35, 0.4, 0, Math.PI * 2); g.fill();
}

/** Soft wind-blown ripples in the sand. */
function drawDunes(g: CanvasRenderingContext2D, rng: Rng): void {
  g.strokeStyle = 'rgba(160,120,60,0.18)';
  g.lineWidth = 3;
  for (let i = 0; i < 70; i++) {
    const x = rng.range(-50, W), y = rng.range(0, H), len = rng.range(60, 160);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len / 2, y - rng.range(6, 14), x + len, y);
    g.stroke();
  }
}

/** Light poles just outside the walls, evenly spaced around the lap. */
function drawFloodlights(g: CanvasRenderingContext2D, track: Track): Vec[] {
  const { pts, n } = track;
  const lights: Vec[] = [];
  const count = 7;
  for (let k = 0; k < count; k++) {
    const i = Math.floor(((k + 0.5) / count) * n);
    const p = pts[i], side = k % 2 ? 1 : -1;
    const off = (side > 0 ? track.wallRight[i] : track.wallLeft[i]) + 14;
    const q = { x: p.x + p.nx * side * off, y: p.y + p.ny * side * off };
    // Don't plant a pole on another stretch of road.
    if (pts.some(o => Math.hypot(o.x - q.x, o.y - q.y) < o.w / 2 + CURB_W + 6)) continue;
    lights.push(q);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath(); g.arc(q.x + 3, q.y + 4, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9aa3ad';
    g.beginPath(); g.arc(q.x, q.y, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff8d0';
    g.beginPath(); g.arc(q.x, q.y, 2.5, 0, Math.PI * 2); g.fill();
  }
  return lights;
}

function drawStartLine(g: CanvasRenderingContext2D, s: TrackPoint): void {
  g.save();
  g.translate(s.x, s.y);
  g.rotate(s.ang);
  const cell = 8;
  const top = -s.w / 2;
  for (let y = top; y < s.w / 2; y += cell) {
    const r = Math.round((y - top) / cell);
    for (let c = 0; c < 2; c++) {
      g.fillStyle = (r + c) % 2 ? '#111' : '#fff';
      g.fillRect(-cell + c * cell, y, cell, Math.min(cell, s.w / 2 - y));
    }
  }
  g.restore();
}

/** Concrete bridge deck with railings and a drop shadow onto the road below. */
function renderBridgeLayer(track: Track): void {
  const g = bridgeCtx;
  g.clearRect(0, 0, W, H);
  if (!track.bridge) return;
  const { pts } = track;
  const { from, len } = track.bridge.over;
  const segs = len - 1;
  const rail: Offset = p => half(p) + 7;

  g.save();
  g.translate(8, 11);
  fillBand(g, pts, from, segs, neg(rail), rail, 'rgba(0,0,0,0.4)');
  g.restore();

  fillBand(g, pts, from, segs, neg(rail), rail, '#8f959c');
  g.beginPath();
  addBand(g, pts, from, segs, p => half(p) + 3.5, rail);
  addBand(g, pts, from, segs, neg(rail), p => -half(p) - 3.5);
  g.fillStyle = '#c3c8cd';
  g.fill();
  fillBand(g, pts, from, segs, neg(half), half, '#5c6168');
  centreLine(g, pts, from, segs);

  // Expansion joints where the deck meets the road.
  g.strokeStyle = 'rgba(20,20,20,0.6)';
  g.lineWidth = 2;
  for (const i of [from, from + segs]) {
    const p = pts[i % pts.length], r = rail(p);
    g.beginPath();
    g.moveTo(p.x - p.nx * r, p.y - p.ny * r);
    g.lineTo(p.x + p.nx * r, p.y + p.ny * r);
    g.stroke();
  }
}

const TYRE_R = 6;
const TYRE_SPACING = 11.5;

/** Stacks of tyres along both walls, painted in alternating red/white groups. */
function drawTyreWalls(g: CanvasRenderingContext2D, track: Track): void {
  const { pts, n } = track;
  const tyres: { x: number; y: number; paint: string }[] = [];

  for (const [side, offs] of [[1, track.wallRight], [-1, track.wallLeft]] as const) {
    let travelled = TYRE_SPACING, count = 0;
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i <= n; i++) {
      const p = pts[i % n], off = offs[i % n];
      const q = { x: p.x + p.nx * side * off, y: p.y + p.ny * side * off };
      if (prev) travelled += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
      if (travelled < TYRE_SPACING) continue;
      travelled = 0;
      // Skip tyres that would sit closer to some other stretch of road than to their own.
      let intrudes = false;
      for (let j = 0; j < n; j += 2) {
        if (Math.hypot(pts[j].x - q.x, pts[j].y - q.y) < off - 3) { intrudes = true; break; }
      }
      if (intrudes || q.x < 0 || q.x > W || q.y < 0 || q.y > H) continue;
      tyres.push({ ...q, paint: Math.floor(count++ / 3) % 2 ? '#e8e8e8' : '#d32f2f' });
    }
  }

  g.fillStyle = 'rgba(0,0,0,0.3)';
  for (const t of tyres) { g.beginPath(); g.arc(t.x + 2, t.y + 3, TYRE_R, 0, Math.PI * 2); g.fill(); }
  for (const t of tyres) {
    g.fillStyle = '#1d1d1f';
    g.beginPath(); g.arc(t.x, t.y, TYRE_R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = t.paint;
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(t.x, t.y, TYRE_R - 1.8, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#060606';
    g.beginPath(); g.arc(t.x, t.y, 2.2, 0, Math.PI * 2); g.fill();
  }
}
