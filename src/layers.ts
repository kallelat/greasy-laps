import { CURB_W, H, TRACK_W, W } from './config';
import type { Track, TrackPoint } from './track';
import { rand } from './util';

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d')!];
}

/** Pre-rendered static scenery: grass, track, decorations. */
export const [trackLayer, trackCtx] = makeCanvas();
/** Persistent skid marks drawn by the cars. */
export const [skidLayer, skidCtx] = makeCanvas();

export function clearSkids(): void {
  skidCtx.clearRect(0, 0, W, H);
}

function tracePath(g: CanvasRenderingContext2D, pts: TrackPoint[]): void {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
}

export function renderTrackLayer(track: Track): void {
  const g = trackCtx;
  const { pts, n, oils } = track;

  // Grass with mowing stripes and noise.
  g.fillStyle = '#3f8f3a';
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 80) {
    g.fillStyle = (x / 80) % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
    g.fillRect(x, 0, 80, H);
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(20,60,20,0.25)' : 'rgba(140,200,110,0.18)';
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }

  // A few trees and bushes off the track for flavour.
  for (let t = 0; t < 40; t++) {
    const x = rand(20, W - 20), y = rand(20, H - 20);
    let near = false;
    for (let i = 0; i < n; i += 3) {
      if (Math.hypot(pts[i].x - x, pts[i].y - y) < TRACK_W / 2 + 50) { near = true; break; }
    }
    if (near) continue;
    const r = rand(10, 20);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.arc(x + 4, y + 5, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2b6b2a';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3c8a36';
    g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.55, 0, Math.PI * 2); g.fill();
  }

  g.lineJoin = 'round';
  g.lineCap = 'round';

  // Run-off shadow, curbs (red/white), asphalt.
  tracePath(g, pts);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = TRACK_W + CURB_W * 2 + 10;
  g.stroke();

  g.strokeStyle = '#eee';
  g.lineWidth = TRACK_W + CURB_W * 2;
  g.stroke();
  g.setLineDash([14, 14]);
  g.lineCap = 'butt';
  g.strokeStyle = '#d32f2f';
  g.stroke();
  g.setLineDash([]);
  g.lineCap = 'round';

  g.strokeStyle = '#555a60';
  g.lineWidth = TRACK_W;
  g.stroke();

  // Asphalt texture.
  for (let i = 0; i < 2500; i++) {
    const p = pts[Math.floor(Math.random() * n)];
    const off = rand(-TRACK_W / 2, TRACK_W / 2);
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.07)';
    g.fillRect(p.x + p.nx * off + rand(-3, 3), p.y + p.ny * off + rand(-3, 3), 2, 2);
  }

  // Dashed centre line.
  tracePath(g, pts);
  g.setLineDash([18, 22]);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 2;
  g.stroke();
  g.setLineDash([]);

  // Chequered start/finish line.
  const s = pts[0];
  g.save();
  g.translate(s.x, s.y);
  g.rotate(s.ang);
  const cell = 8;
  const rows = Math.ceil(TRACK_W / cell);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      g.fillStyle = (r + c) % 2 ? '#111' : '#fff';
      g.fillRect(-cell + c * cell, -TRACK_W / 2 + r * cell, cell, Math.min(cell, TRACK_W / 2 - (-TRACK_W / 2 + r * cell)));
    }
  }
  g.restore();

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

  // Oil slicks.
  for (const o of oils) {
    g.save();
    g.translate(o.x, o.y);
    let seed = o.seed;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    g.fillStyle = 'rgba(10,10,14,0.85)';
    g.beginPath();
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = o.r * (0.75 + rnd() * 0.45);
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
}
