import { clamp } from './util';

const MAX_SHAKE = 14; // px

let amount = 0;

/** Kick the camera; `force` is 0..1 and stacks with any shake already running. */
export function addShake(force: number): void {
  amount = clamp(amount + force * 10, 0, MAX_SHAKE);
}

export function resetShake(): void {
  amount = 0;
}

export function updateShake(dt: number): void {
  amount *= Math.exp(-9 * dt);
  if (amount < 0.05) amount = 0;
}

export function shakeOffset(): { x: number; y: number } {
  return { x: (Math.random() * 2 - 1) * amount, y: (Math.random() * 2 - 1) * amount };
}
