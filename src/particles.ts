import { rand, type Vec } from './util';

interface Particle extends Vec {
  kind: 'dust' | 'spark';
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  r: number;
}

const particles: Particle[] = [];

export function spawnParticle(p: Vec, color: string): void {
  particles.push({ kind: 'dust', x: p.x, y: p.y, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.5, max: 0.5, color, r: rand(2, 4) });
}

/** Burst of sparks at `p`, inheriting some of `base` velocity. `force` is 0..1. */
export function spawnSparks(p: Vec, base: Vec, force: number): void {
  const count = Math.round(6 + force * 26);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(80, 200 + force * 300);
    const life = rand(0.18, 0.45);
    particles.push({
      kind: 'spark', x: p.x, y: p.y,
      vx: base.x * 0.5 + Math.cos(a) * s,
      vy: base.y * 0.5 + Math.sin(a) * s,
      life, max: life, color: '', r: 0,
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
    if (p.kind === 'spark') {
      const drag = Math.exp(-4 * dt);
      p.vx *= drag;
      p.vy *= drag;
    } else {
      p.r += dt * 6;
    }
  }
}

export function drawParticles(g: CanvasRenderingContext2D): void {
  for (const p of particles) {
    if (p.kind !== 'dust') continue;
    g.globalAlpha = (p.life / p.max) * 0.5;
    g.fillStyle = p.color;
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

/** Sparks are drawn above the cars as glowing streaks. */
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
