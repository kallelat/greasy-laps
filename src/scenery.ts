import type { Car } from './car';
import { CURB_W, H, W } from './config';
import { decor, floodlights } from './layers';
import { makeRng } from './rng';
import type { Track } from './track';
import { clamp, roundRect, type Vec } from './util';

/**
 * Animated scenery: trees swaying in the wind, a grandstand crowd that cheers when
 * cars go past, marshal flags, and the rainbow shimmer on oil slicks.
 */

interface Fan { dx: number; dy: number; shirt: string; hair: string; phase: number }
interface Stand extends Vec { ang: number; len: number; depth: number; fans: Fan[] }

const STAND_LEN = 150, STAND_DEPTH = 36;
const SHIRTS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#fb8c00', '#8e24aa', '#ffffff', '#00acc1'];
const HAIR = ['#3e2723', '#212121', '#795548', '#f9a825', '#bf360c'];

let stand: Stand | null = null;
let flags: (Vec & { phase: number })[] = [];
let cheer = 0;        // 0..1, how excited the crowd is
let excitement = 0;   // extra hype from lap/finish events, decays

/** True if a rectangle of points sits clear of every stretch of road. */
function clearOfRoad(track: Track, points: Vec[], margin: number): boolean {
  return points.every(q => q.x > 10 && q.x < W - 10 && q.y > 10 && q.y < H - 10 &&
    track.pts.every(p => Math.hypot(p.x - q.x, p.y - q.y) > p.w / 2 + CURB_W + margin));
}

export function initScenery(track: Track): void {
  const { pts, n } = track;
  const rng = makeRng(track.seed ^ 0x3c6ef372);
  cheer = excitement = 0;

  // Grandstand alongside the start straight, on whichever side has room.
  stand = null;
  search: for (let k = 4; k < 50; k += 3) {
    for (const side of [1, -1]) {
      const p = pts[k % n];
      const off = (side > 0 ? track.wallRight[k % n] : track.wallLeft[k % n]) + 14 + STAND_DEPTH / 2;
      const cx = p.x + p.nx * side * off, cy = p.y + p.ny * side * off;
      const ux = Math.cos(p.ang), uy = Math.sin(p.ang);
      const corners = [-1, 1].flatMap(a => [-1, 1].map(b => ({
        x: cx + ux * a * STAND_LEN / 2 + p.nx * b * STAND_DEPTH / 2,
        y: cy + uy * a * STAND_LEN / 2 + p.ny * b * STAND_DEPTH / 2,
      })));
      if (!clearOfRoad(track, [...corners, { x: cx, y: cy }], 14)) continue;
      if (floodlights.some(l => Math.hypot(l.x - cx, l.y - cy) < STAND_LEN / 2 + 10)) continue;
      const fans: Fan[] = [];
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 15; col++) {
          if (rng.next() < 0.12) continue; // empty seats
          fans.push({
            dx: -STAND_LEN / 2 + 9 + col * ((STAND_LEN - 18) / 14),
            dy: -STAND_DEPTH / 2 + 8 + row * 10,
            shirt: SHIRTS[rng.int(0, SHIRTS.length - 1)],
            hair: HAIR[rng.int(0, HAIR.length - 1)],
            phase: rng.range(0, Math.PI * 2),
          });
        }
      }
      // Face the crowd towards the track: rows nearest the road are "front".
      stand = { x: cx, y: cy, ang: side > 0 ? p.ang : p.ang + Math.PI, len: STAND_LEN, depth: STAND_DEPTH, fans };
      break search;
    }
  }

  // Marshal posts with flags, spaced around the lap.
  flags = [];
  for (let k = 0; k < 5; k++) {
    const i = Math.floor(((k + 0.15) / 5) * n);
    const p = pts[i], side = k % 2 ? -1 : 1;
    const off = (side > 0 ? track.wallRight[i] : track.wallLeft[i]) + 12;
    const q = { x: p.x + p.nx * side * off, y: p.y + p.ny * side * off };
    if (!clearOfRoad(track, [q], 6)) continue;
    if (floodlights.some(l => Math.hypot(l.x - q.x, l.y - q.y) < 40)) continue;
    if (stand && Math.hypot(stand.x - q.x, stand.y - q.y) < STAND_LEN / 2 + 20) continue;
    flags.push({ ...q, phase: rng.range(0, 6) });
  }
}

/** Fire the crowd up (lap completions, the finish). */
export function exciteCrowd(amount: number): void {
  excitement = Math.max(excitement, amount);
}

export function updateScenery(dt: number, cars: Car[]): void {
  excitement = Math.max(0, excitement - dt * 0.25);
  let target = excitement;
  if (stand) {
    for (const c of cars) {
      const d = Math.hypot(c.x - stand.x, c.y - stand.y);
      target = Math.max(target, clamp(1 - (d - 60) / 220, 0, 1) * clamp(Math.hypot(c.vx, c.vy) / 250, 0.3, 1));
    }
  }
  cheer += (target - cheer) * (1 - Math.exp(-dt * (target > cheer ? 8 : 1.5)));
}

/** Gusty wind shared by trees and flags. */
function wind(t: number): number {
  return 0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1);
}

/** Stand, flags and tree canopies (their shadows are on the static track layer). */
export function drawScenery(g: CanvasRenderingContext2D, t: number, chequered: boolean): void {
  const w = wind(t);

  for (const d of decor) {
    const sway = Math.sin(t * 1.6 + d.phase) * 1.6 * w + w * 1.2;
    const x = d.x + sway, y = d.y + sway * 0.4;
    if (d.kind === 'tree') {
      g.fillStyle = '#2b6b2a';
      g.beginPath(); g.arc(x, y, d.r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3c8a36';
      g.beginPath(); g.arc(x - d.r * 0.3, y - d.r * 0.3, d.r * 0.55, 0, Math.PI * 2); g.fill();
    } else {
      const star = (rad: number, color: string, dx = 0, dy = 0) => {
        g.fillStyle = color;
        g.beginPath();
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 + sway * 0.03, rr = k % 2 ? rad * 0.6 : rad;
          const px = x + dx + Math.cos(a) * rr, py = y + dy + Math.sin(a) * rr;
          if (k) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
      };
      star(d.r, '#1f4a33');
      star(d.r * 0.6, '#2d6446');
      star(d.r * 0.35, 'rgba(255,255,255,0.85)', -1, -1);
    }
  }

  if (stand) drawStand(g, stand, t);

  for (const f of flags) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(f.x + 2, f.y + 3, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ddd';
    g.beginPath(); g.arc(f.x, f.y, 2.5, 0, Math.PI * 2); g.fill();
    // Flag cloth: a waving strip blown downwind.
    const segs = 6, len = 18, hgt = 11, dir = 0.5 + Math.sin(t * 0.3) * 0.2;
    g.save();
    g.translate(f.x, f.y);
    g.rotate(dir);
    for (let s = 0; s < segs; s++) {
      const x0 = (s / segs) * len, x1 = ((s + 1) / segs) * len;
      const y0 = Math.sin(t * 9 * w + f.phase - s * 0.9) * 2.5 * (s / segs);
      const y1 = Math.sin(t * 9 * w + f.phase - (s + 1) * 0.9) * 2.5 * ((s + 1) / segs);
      if (chequered) {
        for (let r = 0; r < 2; r++) {
          g.fillStyle = (s + r) % 2 ? '#111' : '#fff';
          g.beginPath();
          g.moveTo(x0, y0 - hgt / 2 + r * hgt / 2); g.lineTo(x1, y1 - hgt / 2 + r * hgt / 2);
          g.lineTo(x1, y1 + r * hgt / 2); g.lineTo(x0, y0 + r * hgt / 2);
          g.closePath(); g.fill();
        }
      } else {
        g.fillStyle = s % 2 ? '#ffd600' : '#ffe033';
        g.beginPath();
        g.moveTo(x0, y0 - hgt / 2); g.lineTo(x1, y1 - hgt / 2); g.lineTo(x1, y1 + hgt / 2); g.lineTo(x0, y0 + hgt / 2);
        g.closePath(); g.fill();
      }
    }
    g.restore();
  }
}

function drawStand(g: CanvasRenderingContext2D, s: Stand, t: number): void {
  g.save();
  g.translate(s.x, s.y);
  g.rotate(s.ang);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(g, -s.len / 2 + 5, -s.depth / 2 + 6, s.len, s.depth, 4); g.fill();
  g.fillStyle = '#7d8590';
  roundRect(g, -s.len / 2, -s.depth / 2, s.len, s.depth, 4); g.fill();
  // Tiered benches.
  for (let r = 0; r < 3; r++) {
    g.fillStyle = r % 2 ? '#959daa' : '#8a929e';
    g.fillRect(-s.len / 2 + 4, -s.depth / 2 + 3 + r * 10, s.len - 8, 9);
  }
  // Striped roof edge along the back.
  for (let k = 0; k < 10; k++) {
    g.fillStyle = k % 2 ? '#fff' : '#d32f2f';
    g.fillRect(-s.len / 2 + (k * s.len) / 10, s.depth / 2 - 4, s.len / 10, 6);
  }
  for (const f of s.fans) {
    const jump = Math.max(0, Math.sin(t * 13 + f.phase)) * cheer;
    const idle = Math.sin(t * 2 + f.phase) * 0.4;
    const scale = 1 + jump * 0.35;
    const y = f.dy - jump * 2 + idle;
    g.fillStyle = f.shirt;
    g.beginPath(); g.arc(f.dx, y, 3.4 * scale, 0, Math.PI * 2); g.fill();
    if (jump > 0.3) {
      // Arms in the air.
      g.strokeStyle = f.shirt;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(f.dx - 2, y); g.lineTo(f.dx - 4.5, y - 4 * scale);
      g.moveTo(f.dx + 2, y); g.lineTo(f.dx + 4.5, y - 4 * scale);
      g.stroke();
    }
    g.fillStyle = f.hair;
    g.beginPath(); g.arc(f.dx, y, 1.9 * scale, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

/** Moving rainbow sheen on oil, so slicks read as wet. */
export function drawOilShimmer(g: CanvasRenderingContext2D, t: number, oils: (Vec & { r: number; seed?: number })[]): void {
  g.save();
  g.globalCompositeOperation = 'screen';
  for (const [i, o] of oils.entries()) {
    const seed = o.seed ?? i * 13.7;
    const hue = (t * 50 + seed * 97) % 360;
    for (let k = 0; k < 2; k++) {
      const a = t * (0.7 + k * 0.4) + seed + k * 2;
      const cx = o.x + Math.cos(a) * o.r * 0.35, cy = o.y + Math.sin(a) * o.r * 0.35;
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, o.r * 0.7);
      grad.addColorStop(0, `hsla(${(hue + k * 140) % 360},90%,60%,0.32)`);
      grad.addColorStop(1, `hsla(${(hue + k * 140) % 360},90%,60%,0)`);
      g.fillStyle = grad;
      g.beginPath(); g.arc(o.x, o.y, o.r * 0.85, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}
