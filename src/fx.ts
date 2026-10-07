import { H, W } from './config';
import { spawnDebris, spawnSparks } from './particles';
import { addShake } from './shake';
import { sound } from './sound';
import { clamp, rand, type Vec } from './util';

/**
 * Game-feel effects that live outside the physics: impact flashes, slow motion,
 * lap banners and the finish celebration. Updated in real time, so slow motion
 * doesn't slow the confetti down.
 */

interface Banner {
  text: string;
  color: string;
  t: number;      // seconds since shown
  dur: number;
}

interface Bit {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  color: string;
  size: number;
  rot: number; vr: number;
  kind: 'confetti' | 'spark';
}

interface Rocket {
  x: number; y: number; vy: number;
  burstY: number;
  color: string;
}

const SLOWMO_SCALE = 0.22;
const SLOWMO_COOLDOWN = 5;
const CONFETTI_COLORS = ['#ffd54f', '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc', '#ffffff'];

let enabled = true;        // off for the silent attract-mode demo
let slowmoLeft = 0;
let slowmoLen = 0;
let slowmoCooldown = 0;
let flash = 0;
let banners: Banner[] = [];
let bits: Bit[] = [];
let rockets: Rocket[] = [];
let celebrateLeft = 0;
let celebrateColor = '#ffd54f';
let nextRocket = 0;

export function setFxEnabled(on: boolean): void {
  enabled = on;
}

export function resetFx(): void {
  slowmoLeft = slowmoCooldown = flash = celebrateLeft = 0;
  banners = [];
  bits = [];
  rockets = [];
}

/** Current simulation speed (1 = normal). */
export function timeScale(): number {
  if (slowmoLeft <= 0) return 1;
  // Ease back to full speed over the last 30% of the slow-mo.
  const t = slowmoLeft / slowmoLen;
  return t > 0.3 ? SLOWMO_SCALE : SLOWMO_SCALE + (1 - SLOWMO_SCALE) * (1 - t / 0.3);
}

/** Drop into slow motion for `seconds` of real time (ignored during the cooldown). */
export function slowmo(seconds: number): void {
  if (!enabled || slowmoCooldown > 0 || slowmoLeft > 0) return;
  slowmoLeft = slowmoLen = seconds;
  slowmoCooldown = SLOWMO_COOLDOWN;
}

/**
 * A crash. Shakes the screen, throws sparks and debris, flashes on hard hits and
 * goes slow-mo for really big ones. `force` is 0..1.
 */
export function impact(force: number, at: Vec, base: Vec, debrisColors: string[]): void {
  addShake(force * (enabled ? 1 : 0));
  if (force > 0.12) spawnSparks(at, base, force);
  if (force > 0.3) spawnDebris(at, base, force, debrisColors);
  if (!enabled) return;
  if (force > 0.55) flash = Math.max(flash, force * 0.35);
  if (force > 0.82) slowmo(0.7);
}

export function banner(text: string, color: string, dur = 1.6): void {
  if (!enabled) return;
  banners.push({ text, color, t: 0, dur });
}

/** Confetti and fireworks in the winner's colour. */
export function celebrate(color: string): void {
  celebrateColor = color;
  celebrateLeft = 5;
  nextRocket = 0;
  for (let i = 0; i < 160; i++) {
    const left = i % 2 === 0;
    bits.push({
      kind: 'confetti',
      x: left ? -10 : W + 10, y: rand(H * 0.1, H * 0.5),
      vx: (left ? 1 : -1) * rand(200, 650), vy: rand(-420, -60),
      life: rand(3, 5), max: 5,
      color: i % 3 === 0 ? color : CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: rand(5, 10), rot: rand(0, 6), vr: rand(-10, 10),
    });
  }
  sound.cheer();
}

export function updateFx(dt: number): void {
  if (slowmoLeft > 0) slowmoLeft = Math.max(0, slowmoLeft - dt);
  slowmoCooldown = Math.max(0, slowmoCooldown - dt);
  flash = Math.max(0, flash - dt * 2.5);

  for (const b of banners) b.t += dt;
  banners = banners.filter(b => b.t < b.dur);

  if (celebrateLeft > 0) {
    celebrateLeft -= dt;
    nextRocket -= dt;
    if (nextRocket <= 0) {
      nextRocket = rand(0.25, 0.55);
      rockets.push({
        x: rand(W * 0.15, W * 0.85), y: H + 10, vy: rand(-900, -700),
        burstY: rand(H * 0.12, H * 0.4),
        color: Math.random() < 0.5 ? celebrateColor : CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      });
    }
  }

  for (const r of rockets) {
    r.y += r.vy * dt;
    if (r.y <= r.burstY) {
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2, s = rand(120, 300);
        bits.push({ kind: 'spark', x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.8, 1.4), max: 1.4, color: r.color, size: 2.5, rot: 0, vr: 0 });
      }
      sound.pop();
      r.y = -1000; // spent
    }
  }
  rockets = rockets.filter(r => r.y > -500);

  for (const b of bits) {
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.kind === 'confetti') {
      b.vx *= Math.exp(-1.6 * dt);
      b.vy = b.vy * Math.exp(-1.2 * dt) + 260 * dt;
      b.vx += Math.sin(b.life * 5 + b.rot) * 30 * dt * 10;
    } else {
      b.vx *= Math.exp(-1.8 * dt);
      b.vy = b.vy * Math.exp(-1.8 * dt) + 120 * dt;
    }
    b.rot += b.vr * dt;
  }
  bits = bits.filter(b => b.life > 0 && b.y < H + 40);
}

/** Screen-space overlays: impact flash, banners, confetti, fireworks. */
export function drawScreenFx(g: CanvasRenderingContext2D): void {
  if (flash > 0) {
    g.fillStyle = `rgba(255,255,255,${flash})`;
    g.fillRect(0, 0, W, H);
  }

  for (const r of rockets) {
    g.fillStyle = '#fff6c0';
    g.fillRect(r.x - 1.5, r.y, 3, 10);
  }
  g.save();
  for (const b of bits) {
    const t = clamp(b.life / b.max, 0, 1);
    if (b.kind === 'spark') {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = t;
      g.fillStyle = b.color;
      g.beginPath(); g.arc(b.x, b.y, b.size * (0.5 + t), 0, Math.PI * 2); g.fill();
    } else {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = Math.min(1, b.life);
      g.translate(b.x, b.y);
      g.rotate(b.rot);
      // Flip the width with rotation so confetti appears to tumble.
      g.fillStyle = b.color;
      g.fillRect(-b.size / 2, (-b.size / 4) * Math.cos(b.rot * 2), b.size, (b.size / 2) * Math.cos(b.rot * 2));
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  g.restore();

  // Banners sweep in from the left, hold, then sweep out to the right.
  banners.forEach((b, i) => {
    const p = b.t / b.dur;
    const ease = (x: number) => 1 - (1 - x) ** 3;
    const x = p < 0.2 ? -W / 2 + (W) * ease(p / 0.2) : p > 0.8 ? W / 2 + W * ((p - 0.8) / 0.2) ** 2 : W / 2;
    const y = H * 0.3 + i * 70;
    g.save();
    g.translate(x, y);
    g.transform(1, 0, -0.25, 1, 0, 0); // slanted
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(-260, -32, 520, 64);
    g.fillStyle = b.color;
    g.fillRect(-260, -32, 10, 64);
    g.fillRect(250, -32, 10, 64);
    g.restore();
    g.font = '900 40px "Trebuchet MS", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(b.text, x, y + 2);
    g.fillStyle = b.color;
    g.fillText(b.text, x, y + 2);
  });
}
