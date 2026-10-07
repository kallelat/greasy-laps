import { rand, type Vec } from './util';

/**
 * World-space particles.
 * - dust:   small puffs kicked up off-road
 * - smoke:  big soft tyre-smoke / powder / sand clouds that grow and drift
 * - spark:  glowing streaks from impacts
 * - drop:   oil or water droplets that fly out and settle
 * - debris: spinning bits of tyre wall and bodywork
 */
type Kind = 'dust' | 'smoke' | 'spark' | 'drop' | 'debris';

interface Particle extends Vec {
  kind: Kind;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  r: number;
  grow: number;   // radius growth per second
  drag: number;   // velocity decay per second
  rot: number;
  vr: number;
  alpha: number;  // peak opacity
}

const particles: Particle[] = [];
const MAX_PARTICLES = 1400;

function add(p: Partial<Particle> & Vec & { kind: Kind; life: number; color: string }): void {
  if (particles.length >= MAX_PARTICLES) particles.shift();
  particles.push({ vx: 0, vy: 0, max: p.life, r: 2, grow: 0, drag: 0, rot: 0, vr: 0, alpha: 1, ...p });
}

export function spawnParticle(p: Vec, color: string): void {
  add({ kind: 'dust', x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.5, color, r: rand(2, 4), grow: 6, alpha: 0.5 });
}

/** A soft cloud puff. `base` is the car's velocity; smoke keeps a little of it. */
export function spawnSmoke(p: Vec, color: string, base: Vec, size = 1, alpha = 0.32): void {
  add({
    kind: 'smoke', x: p.x + rand(-3, 3), y: p.y + rand(-3, 3),
    vx: base.x * 0.18 + rand(-15, 15), vy: base.y * 0.18 + rand(-15, 15),
    life: rand(0.9, 1.5) * size, color, r: rand(4, 7) * size, grow: rand(16, 26) * size, drag: 1.6, alpha,
  });
}

/** Burst of sparks at `p`, inheriting some of `base` velocity. `force` is 0..1. */
export function spawnSparks(p: Vec, base: Vec, force: number): void {
  const count = Math.round(6 + force * 26);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(80, 200 + force * 300);
    add({
      kind: 'spark', x: p.x, y: p.y,
      vx: base.x * 0.5 + Math.cos(a) * s, vy: base.y * 0.5 + Math.sin(a) * s,
      life: rand(0.18, 0.45), color: '', drag: 4,
    });
  }
}

/** Droplets splashing outwards (oil, water, snow). */
export function spawnDrops(p: Vec, count: number, color: string, speed = 140, base: Vec = { x: 0, y: 0 }): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(speed * 0.3, speed);
    add({
      kind: 'drop', x: p.x, y: p.y,
      vx: base.x * 0.3 + Math.cos(a) * s, vy: base.y * 0.3 + Math.sin(a) * s,
      life: rand(0.3, 0.6), color, r: rand(1.2, 2.6), drag: 5, alpha: 0.9,
    });
  }
}

/** Chunks flying off in a crash. */
export function spawnDebris(p: Vec, base: Vec, force: number, colors: string[]): void {
  const count = Math.round(3 + force * 10);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(60, 120 + force * 260);
    add({
      kind: 'debris', x: p.x, y: p.y,
      vx: base.x * 0.4 + Math.cos(a) * s, vy: base.y * 0.4 + Math.sin(a) * s,
      life: rand(0.8, 1.6), color: colors[i % colors.length], r: rand(2, 4.5), drag: 2.8,
      rot: rand(0, Math.PI), vr: rand(-14, 14),
    });
  }
}

export function clearParticles(): void {
  particles.length = 0;
}

export function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.drag) {
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.vr *= d;
    }
    p.r += p.grow * dt;
    p.rot += p.vr * dt;
  }
}

// Soft round sprites, one per colour, so smoke doesn't need a gradient per particle per frame.
const puffCache = new Map<string, HTMLCanvasElement>();
export function puffSprite(color: string): HTMLCanvasElement {
  let c = puffCache.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    // Solid colour, then cut it down to a soft round falloff.
    g.fillStyle = color;
    g.fillRect(0, 0, 64, 64);
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.45, 'rgba(0,0,0,0.6)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 64, 64);
    puffCache.set(color, c);
  }
  return c;
}

/** Ground-level particles: dust, droplets, debris (drawn under the cars). */
export function drawParticles(g: CanvasRenderingContext2D): void {
  for (const p of particles) {
    const t = p.life / p.max;
    if (p.kind === 'dust' || p.kind === 'drop') {
      g.globalAlpha = t * p.alpha;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    } else if (p.kind === 'debris') {
      g.globalAlpha = Math.min(1, t * 2);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.color;
      g.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
      g.restore();
    }
  }
  g.globalAlpha = 1;
}

/** Smoke clouds, drawn above the cars so they roll over them. */
export function drawSmoke(g: CanvasRenderingContext2D): void {
  for (const p of particles) {
    if (p.kind !== 'smoke') continue;
    const t = p.life / p.max;
    // Fade in quickly, then out slowly.
    g.globalAlpha = p.alpha * Math.min(1, (1 - t) * 6) * t;
    g.drawImage(puffSprite(p.color), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  }
  g.globalAlpha = 1;
}

/** Sparks are drawn above everything else in the world as glowing streaks. */
export function drawSparks(g: CanvasRenderingContext2D): void {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  for (const p of particles) {
    if (p.kind !== 'spark') continue;
    const t = p.life / p.max; // 1 → 0 as it cools from white-yellow to red
    g.strokeStyle = `rgba(255,${Math.round(120 + 135 * t)},${Math.round(40 + 160 * t * t)},${0.35 + 0.65 * t})`;
    g.lineWidth = 1 + t * 1.5;
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
    g.stroke();
  }
  g.restore();
}
