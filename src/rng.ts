/** Deterministic random numbers, so a track seed always rebuilds the same track. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [a, b). */
  range(a: number, b: number): number;
  /** Integer in [a, b] inclusive. */
  int(a: number, b: number): number;
}

/** mulberry32: tiny, fast and good enough for level generation. */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
  };
}

export const MAX_SEED = 999999;

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * MAX_SEED);
}

/** Parse a seed from a URL hash like "#482113"; null if it isn't one. */
export function parseSeed(hash: string): number | null {
  const m = /^#?(\d{1,6})$/.exec(hash.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_SEED ? n : null;
}
