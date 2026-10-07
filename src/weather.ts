import { CURB_W, H, W } from './config';
import { floodlights } from './layers';
import { puffSprite } from './particles';
import type { Puddle, Track, Weather } from './track';
import { rand } from './util';


interface Streak { x: number; y: number; speed: number; len: number }
interface Flake { x: number; y: number; r: number; speed: number; phase: number }
interface Ripple { x: number; y: number; t: number }
interface Tumbleweed { x: number; y: number; vx: number; rot: number; r: number; bounce: number }
interface FogBank { x: number; y: number; r: number; vx: number; vy: number }

const RAIN_WIND = 0.28; // radians from vertical

let weather: Weather = 'clear';
let streaks: Streak[] = [];
let flakes: Flake[] = [];
let ripples: Ripple[] = [];
let tumbleweeds: Tumbleweed[] = [];
let fog: FogBank[] = [];
let nextTumbleweed = 0;
let puddles: Puddle[] = [];

export function initWeather(track: Track): void {
  weather = track.weather;
  puddles = track.puddles;
  streaks = weather === 'rain'
    ? Array.from({ length: 260 }, () => ({ x: rand(-100, W), y: rand(-H, H), speed: rand(900, 1300), len: rand(12, 24) }))
    : [];
  flakes = weather === 'snowfall'
    ? Array.from({ length: 240 }, () => {
      const depth = rand(0.4, 1);
      return { x: rand(0, W), y: rand(0, H), r: 1 + depth * 2.2, speed: 25 + depth * 70, phase: rand(0, 6) };
    })
    : [];
  fog = weather === 'fog'
    ? Array.from({ length: 10 }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(170, 280), vx: rand(6, 16), vy: rand(-4, 4) }))
    : [];
  ripples = [];
  tumbleweeds = [];
  nextTumbleweed = rand(2, 5);
}

export function inPuddle(x: number, y: number): boolean {
  for (const p of puddles) {
    const dx = x - p.x, dy = y - p.y;
    const c = Math.cos(-p.ang), s = Math.sin(-p.ang);
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    if ((lx / p.rx) ** 2 + (ly / p.ry) ** 2 < 1) return true;
  }
  return false;
}

export function updateWeather(dt: number, t: number): void {
  for (const s of streaks) {
    s.y += s.speed * dt;
    s.x += Math.tan(RAIN_WIND) * s.speed * dt;
    if (s.y > H) { s.y = rand(-60, -10); s.x = rand(-200, W); }
  }
  if (weather === 'rain') {
    for (let k = 0; k < 2; k++) ripples.push({ x: rand(0, W), y: rand(0, H), t: 0 });
    for (const p of puddles) if (Math.random() < 0.25) ripples.push({ x: p.x + rand(-p.rx, p.rx) * 0.7, y: p.y + rand(-p.ry, p.ry) * 0.7, t: 0 });
  }
  for (const r of ripples) r.t += dt;
  ripples = ripples.filter(r => r.t < 0.45);

  for (const f of flakes) {
    f.y += f.speed * dt;
    f.x += Math.sin(t * 0.9 + f.phase) * 18 * dt + 10 * dt;
    if (f.y > H + 5) { f.y = -5; f.x = rand(0, W); }
    if (f.x > W + 5) f.x = -5;
  }

  if (weather === 'heat') {
    nextTumbleweed -= dt;
    if (nextTumbleweed <= 0) {
      nextTumbleweed = rand(5, 11);
      const fromLeft = Math.random() < 0.5;
      tumbleweeds.push({ x: fromLeft ? -30 : W + 30, y: rand(80, H - 80), vx: (fromLeft ? 1 : -1) * rand(90, 160), rot: 0, r: rand(10, 15), bounce: rand(0, 6) });
    }
    for (const w of tumbleweeds) {
      w.x += w.vx * dt;
      w.rot += (w.vx / w.r) * dt;
      w.bounce += dt * 5;
    }
    tumbleweeds = tumbleweeds.filter(w => w.x > -60 && w.x < W + 60);
  }

  for (const b of fog) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x - b.r > W) b.x = -b.r;
  }
}

/** World-space weather on the ground: raindrop ripples, tumbleweeds. */
export function drawWeatherGround(g: CanvasRenderingContext2D): void {
  g.lineWidth = 1;
  for (const r of ripples) {
    const k = r.t / 0.45;
    g.strokeStyle = `rgba(200,220,255,${0.35 * (1 - k)})`;
    g.beginPath(); g.ellipse(r.x, r.y, 1 + k * 7, (1 + k * 7) * 0.6, 0, 0, Math.PI * 2); g.stroke();
  }
  for (const w of tumbleweeds) {
    const y = w.y - Math.abs(Math.sin(w.bounce)) * 10;
    g.fillStyle = 'rgba(90,60,20,0.25)';
    g.beginPath(); g.ellipse(w.x + 3, w.y + 4, w.r, w.r * 0.6, 0, 0, Math.PI * 2); g.fill();
    g.save();
    g.translate(w.x, y);
    g.rotate(w.rot);
    g.strokeStyle = '#8a6a3a';
    g.lineWidth = 1.3;
    for (let k = 0; k < 7; k++) {
      g.beginPath();
      g.ellipse(0, 0, w.r, w.r * 0.45, (k / 7) * Math.PI, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }
}

/** World-space atmosphere drawn over the darkness at night: floodlight haze, light shafts, fog. */
export function drawWeatherAir(g: CanvasRenderingContext2D, t: number, track: Track): void {
  if (weather !== 'fog') return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const [i, l] of floodlights.entries()) {
    const flicker = 0.9 + Math.sin(t * 13 + i * 7) * 0.05 + Math.sin(t * 31 + i) * 0.03;
    const halo = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, 120);
    halo.addColorStop(0, `rgba(255,240,200,${0.22 * flicker})`);
    halo.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(l.x, l.y, 120, 0, Math.PI * 2); g.fill();

    // A shaft of light aimed at the nearest bit of track.
    let near = track.pts[0], best = Infinity;
    for (const p of track.pts) {
      const d = (p.x - l.x) ** 2 + (p.y - l.y) ** 2;
      if (d < best) { best = d; near = p; }
    }
    const ang = Math.atan2(near.y - l.y, near.x - l.x);
    const reach = Math.sqrt(best) + near.w / 2 + CURB_W + 40;
    const shaft = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, reach);
    shaft.addColorStop(0, `rgba(255,245,215,${0.12 * flicker})`);
    shaft.addColorStop(1, 'rgba(255,245,215,0)');
    g.fillStyle = shaft;
    g.beginPath();
    g.moveTo(l.x, l.y);
    g.arc(l.x, l.y, reach, ang - 0.5, ang + 0.5);
    g.closePath();
    g.fill();
  }
  g.restore();

  g.globalAlpha = 0.09;
  const sprite = puffSprite('#c6d2e4');
  for (const b of fog) g.drawImage(sprite, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
  g.globalAlpha = 1;
}

/** Screen-space weather: rain streaks, snowflakes, desert heat shimmer. */
export function drawWeatherScreen(g: CanvasRenderingContext2D, t: number): void {
  if (weather === 'rain') {
    g.fillStyle = 'rgba(20,30,55,0.16)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(190,210,240,0.35)';
    g.lineWidth = 1.2;
    g.beginPath();
    const dx = Math.tan(RAIN_WIND);
    for (const s of streaks) {
      g.moveTo(s.x, s.y);
      g.lineTo(s.x - dx * s.len, s.y - s.len);
    }
    g.stroke();
  } else if (weather === 'snowfall') {
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const f of flakes) {
      g.beginPath(); g.arc(f.x, f.y, f.r, 0, Math.PI * 2); g.fill();
    }
  } else if (weather === 'heat') {
    // Shimmer: shift thin horizontal slices of the finished frame sideways.
    const slice = 6;
    for (let y = 0; y < H; y += slice) {
      const off = Math.sin(y * 0.045 + t * 5) * 1.1 + Math.sin(y * 0.11 - t * 3) * 0.5;
      g.drawImage(g.canvas, 0, y, W, slice, off, y, W, slice);
    }
    const haze = g.createLinearGradient(0, 0, 0, H);
    haze.addColorStop(0, 'rgba(255,220,150,0.10)');
    haze.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = haze;
    g.fillRect(0, 0, W, H);
  }
}
