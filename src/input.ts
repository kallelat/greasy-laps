export type Scheme = 'arrows' | 'wasd';

export interface Controls {
  throttle: number;
  brake: number;
  steer: number; // -1 left … 1 right
}

export const NO_INPUT: Readonly<Controls> = { throttle: 0, brake: 0, steer: 0 };

const CONTROLS: Record<Scheme, { up: string; down: string; left: string; right: string }> = {
  arrows: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
  wasd: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
};

const keys = new Set<string>();
const pressListeners: Array<(code: string) => void> = [];

/** Called once per physical key press (auto-repeat ignored). */
export function onKeyPress(fn: (code: string) => void): void {
  pressListeners.push(fn);
}

addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) for (const fn of pressListeners) fn(e.code);
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

export function readControls(scheme: Scheme): Controls {
  const c = CONTROLS[scheme];
  return {
    throttle: keys.has(c.up) ? 1 : 0,
    brake: keys.has(c.down) ? 1 : 0,
    steer: (keys.has(c.right) ? 1 : 0) - (keys.has(c.left) ? 1 : 0),
  };
}
