export type Difficulty = 'easy' | 'normal' | 'hard';

export interface CpuSkill {
  power: number;   // engine power multiplier (also scales top speed)
  corner: number;  // how fast it dares to take corners
  wobble: number;  // how far it drifts off the racing line, as a fraction of track width
}

export const CPU_SKILL: Record<Difficulty, CpuSkill> = {
  easy: { power: 0.88, corner: 0.85, wobble: 0.26 },
  normal: { power: 1, corner: 1, wobble: 0.18 },
  hard: { power: 1.06, corner: 1.1, wobble: 0.1 },
};

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

export interface Settings {
  difficulty: Difficulty;
  catchUp: boolean;
}

const KEY = 'greasy-laps-settings';

function load(): Settings {
  const defaults: Settings = { difficulty: 'normal', catchUp: true };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      difficulty: DIFFICULTIES.includes(saved.difficulty as Difficulty) ? saved.difficulty as Difficulty : defaults.difficulty,
      catchUp: typeof saved.catchUp === 'boolean' ? saved.catchUp : defaults.catchUp,
    };
  } catch {
    return defaults;
  }
}

/** Remembered per browser; storage failures (private mode etc.) just mean defaults. */
export const settings: Settings = load();

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* not persisted */ }
}

export function cycleDifficulty(): void {
  settings.difficulty = DIFFICULTIES[(DIFFICULTIES.indexOf(settings.difficulty) + 1) % DIFFICULTIES.length];
  save();
}

export function toggleCatchUp(): void {
  settings.catchUp = !settings.catchUp;
  save();
}
