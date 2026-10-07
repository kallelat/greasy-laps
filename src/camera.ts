import type { Car } from './car';
import { H, W } from './config';
import { clamp } from './util';

/**
 * A gentle camera: the whole track stays (almost) visible, but it leans towards the
 * cars, zooms in a touch when they're battling side by side, and closes in on the
 * winner at the finish.
 */
const cam = { x: W / 2, y: H / 2, zoom: 1 };

const BATTLE_ZOOM = 0.08;   // extra zoom when the cars are close together
const LEAN = 0.3;           // how far the view drifts towards the cars
const WINNER_ZOOM = 1.7;

export function resetCamera(): void {
  cam.x = W / 2;
  cam.y = H / 2;
  cam.zoom = 1;
}

export function updateCamera(dt: number, cars: Car[], focus: Car | null, active: boolean): void {
  let tx = W / 2, ty = H / 2, tz = 1;
  if (focus) {
    tx = focus.x;
    ty = focus.y;
    tz = WINNER_ZOOM;
  } else if (active && cars.length) {
    const cx = cars.reduce((s, c) => s + c.x, 0) / cars.length;
    const cy = cars.reduce((s, c) => s + c.y, 0) / cars.length;
    const spread = cars.length > 1 ? Math.hypot(cars[0].x - cars[1].x, cars[0].y - cars[1].y) : 0;
    tz = 1 + BATTLE_ZOOM * clamp(1 - spread / 500, 0, 1);
    tx = W / 2 + (cx - W / 2) * LEAN;
    ty = H / 2 + (cy - H / 2) * LEAN;
  }
  const k = 1 - Math.exp(-dt * (focus ? 2 : 1.5));
  cam.zoom += (tz - cam.zoom) * k;
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * k;
  // Never show past the edge of the world.
  const hw = W / (2 * cam.zoom), hh = H / (2 * cam.zoom);
  cam.x = clamp(cam.x, hw, W - hw);
  cam.y = clamp(cam.y, hh, H - hh);
}

/** Where a world point currently appears on screen. */
export function worldToScreen(p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x - cam.x) * cam.zoom + W / 2, y: (p.y - cam.y) * cam.zoom + H / 2 };
}

export function applyCamera(g: CanvasRenderingContext2D): void {
  g.translate(W / 2, H / 2);
  g.scale(cam.zoom, cam.zoom);
  g.translate(-cam.x, -cam.y);
}
