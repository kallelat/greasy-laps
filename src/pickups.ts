import type { Car } from './car';
import { DT } from './config';
import { sound } from './sound';
import type { Track } from './track';
import { rand, roundRect, wrapAngle, type Vec } from './util';

export type Item = 'turbo' | 'oil';

interface Crate extends Vec {
  respawn: number; // seconds until it reappears (0 = available)
  phase: number;   // animation offset
}

/** An oil slick dropped by a car. `deck` = dropped on a bridge deck (only affects cars up there). */
export interface DroppedOil extends Vec {
  r: number;
  life: number;
  deck: boolean;
  shape: number[];
}

export const TURBO_TIME = 1.6;      // seconds
export const TURBO_POWER = 0.45;    // extra engine power while active
const CRATE_RESPAWN = 4;
const PICKUP_RADIUS = 20;
const DROPPED_OIL_LIFE = 12;
const MAX_DROPPED_OILS = 8;
/** Lap fractions where rows of crates sit. */
const CRATE_SPOTS = [0.3, 0.58, 0.82];

let crates: Crate[] = [];
export let droppedOils: DroppedOil[] = [];

/** Place crate rows on the track, clear of oil slicks and the bridge. */
export function resetPickups(track: Track): void {
  crates = [];
  droppedOils = [];
  const { pts, n } = track;
  const clear = (i: number) => {
    const p = pts[i];
    if (track.bridge && Math.hypot(p.x - track.bridge.x, p.y - track.bridge.y) < 200) return false;
    return !track.oils.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 70);
  };
  for (const frac of CRATE_SPOTS) {
    let i = Math.floor(frac * n);
    for (let t = 0; t < n / 6 && !clear(i); t++) i = (i + 3) % n;
    const p = pts[i];
    for (const side of [-1, 1]) {
      const off = side * p.w * 0.22;
      crates.push({ x: p.x + p.nx * off, y: p.y + p.ny * off, respawn: 0, phase: rand(0, Math.PI * 2) });
    }
  }
}

export function updatePickups(cars: Car[], track: Track, racing: boolean): void {
  for (const c of crates) {
    if (c.respawn > 0) { c.respawn = Math.max(0, c.respawn - DT); continue; }
    if (!racing) continue;
    for (const car of cars) {
      if (car.item || car.finished || car.onBridge) continue;
      if (Math.hypot(car.x - c.x, car.y - c.y) > PICKUP_RADIUS) continue;
      car.item = Math.random() < 0.5 ? 'turbo' : 'oil';
      car.itemTime = 0;
      car.itemRoll = 0.7;
      c.respawn = CRATE_RESPAWN;
      if (!car.silent) sound.pickup();
      break;
    }
  }

  for (const o of droppedOils) o.life -= DT;
  droppedOils = droppedOils.filter(o => o.life > 0);

  if (racing) for (const car of cars) if (car.controller === 'cpu') cpuUseItem(car, cars, track);
}

/** Fire the held item. Returns false if there was nothing to use. */
export function useItem(car: Car): boolean {
  if (!car.item || car.finished) return false;
  if (car.item === 'turbo') {
    car.turbo = TURBO_TIME;
    if (!car.silent) sound.whoosh();
  } else {
    const back = 26;
    droppedOils.push({
      x: car.x - Math.cos(car.h) * back,
      y: car.y - Math.sin(car.h) * back,
      r: 20,
      life: DROPPED_OIL_LIFE,
      deck: car.onBridge,
      shape: Array.from({ length: 14 }, () => rand(0.75, 1.2)),
    });
    if (droppedOils.length > MAX_DROPPED_OILS) droppedOils.shift();
    if (!car.silent) sound.splat();
  }
  car.item = null;
  return true;
}

/** CPU: turbo on a straight, oil when someone is right behind (or when it's been held too long). */
function cpuUseItem(car: Car, cars: Car[], track: Track): void {
  if (!car.item) return;
  car.itemTime += DT;
  const { pts, n } = track;
  if (car.item === 'turbo') {
    const straight = [15, 30, 45].every(k => Math.abs(wrapAngle(pts[(car.idx + k) % n].ang - pts[car.idx].ang)) < 0.25);
    if (straight && Math.hypot(car.vx, car.vy) > 180) useItem(car);
  } else {
    const chased = cars.some(o => o !== car && car.progress - o.progress > 4 && car.progress - o.progress < 35);
    if (chased || car.itemTime > 8) useItem(car);
  }
}

/** Crates that are currently on the track (lit up at night). */
export function activeCrates(): Vec[] {
  return crates.filter(c => c.respawn === 0);
}

export function droppedOilsAt(deck: boolean): DroppedOil[] {
  return droppedOils.filter(o => o.deck === deck);
}

/** Crates: spinning, bobbing "?" boxes. `t` is time in seconds. */
export function drawCrates(g: CanvasRenderingContext2D, t: number): void {
  for (const c of crates) {
    if (c.respawn > 0) continue;
    const bob = 1 + Math.sin(t * 4 + c.phase) * 0.08;
    g.save();
    g.translate(c.x, c.y);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(g, -7, -5, 16, 16, 3); g.fill();
    g.rotate(Math.sin(t * 1.5 + c.phase) * 0.35);
    g.scale(bob, bob);
    const grad = g.createLinearGradient(-8, -8, 8, 8);
    grad.addColorStop(0, '#ffe066');
    grad.addColorStop(1, '#f59f00');
    g.fillStyle = grad;
    roundRect(g, -8, -8, 16, 16, 3); g.fill();
    g.strokeStyle = '#a05a00';
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = '#5a3200';
    g.font = '900 12px "Trebuchet MS", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', 0, 1);
    g.restore();
  }
}

export function drawDroppedOils(g: CanvasRenderingContext2D, deck: boolean): void {
  for (const o of droppedOils) {
    if (o.deck !== deck) continue;
    g.globalAlpha = Math.min(1, o.life / 2) * 0.88;
    g.fillStyle = '#0b0b10';
    g.beginPath();
    o.shape.forEach((s, i) => {
      const a = (i / o.shape.length) * Math.PI * 2;
      const x = o.x + Math.cos(a) * o.r * s, y = o.y + Math.sin(a) * o.r * s;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(120,80,200,0.3)';
    g.beginPath(); g.arc(o.x - o.r * 0.25, o.y - o.r * 0.25, o.r * 0.4, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}
