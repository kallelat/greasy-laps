import { Car, CAR_DEFS, collideCars } from './car';
import { resetCamera, updateCamera } from './camera';
import { DT, LAPS } from './config';
import { banner, celebrate, resetFx, setFxEnabled, slowmo, updateFx } from './fx';
import { clearSkids, renderTrackLayer } from './layers';
import { clearParticles, updateParticles } from './particles';
import { resetPickups, updatePickups, useItem } from './pickups';
import { exciteCrowd, initScenery, updateScenery } from './scenery';
import { randomSeed } from './rng';
import { CPU_SKILL, cycleDifficulty, settings, toggleCatchUp } from './settings';
import { resetShake, updateShake } from './shake';
import { copyTrackLink, setUrlSeed } from './share';
import { sound } from './sound';
import { generateTrack, type Track } from './track';
import { clamp } from './util';
import { initWeather, updateWeather } from './weather';

export type GameState = 'menu' | 'countdown' | 'race' | 'finished';
export type Mode = 1 | 2; // 1 = vs CPU, 2 = two players

/** Respawn keys per car slot. In vs-CPU mode the human can use either set. */
export const RESPAWN_KEYS: readonly (readonly string[])[] = [
  ['ShiftRight', 'Enter', 'NumpadEnter'],
  ['ShiftLeft', 'KeyQ'],
];

/** Use-item keys per car slot. In vs-CPU mode the human can use either set (or Space). */
export const FIRE_KEYS: readonly (readonly string[])[] = [
  ['Slash', 'Period'],
  ['KeyE'],
];

/** Max extra engine power for the trailing car, reached when it is this far behind. */
const CATCH_UP_MAX = 0.16;
const CATCH_UP_FULL_GAP = 0.3; // fraction of a lap

export class Game {
  state: GameState = 'menu';
  mode: Mode = 2;
  track: Track;
  cars: Car[] = [];
  clock = 0;               // seconds since race start (negative during countdown)
  winner: Car | null = null;
  /** Short message shown at the bottom of the screen, e.g. "Link copied". */
  toast: { text: string; time: number } | null = null;
  private lastBeep: number | null = null;
  private lapsSeen = [0, 0];
  private photoFinishDone = false;

  constructor(seed: number = randomSeed()) {
    this.track = this.newTrack(seed);
    this.startDemo();
  }

  private newTrack(seed: number = randomSeed()): Track {
    const track = generateTrack(seed);
    renderTrackLayer(track);
    clearSkids();
    setUrlSeed(seed);
    this.track = track;
    return track;
  }

  /** Switch to a specific track (e.g. a shared link) and go back to the menu. */
  loadTrack(seed: number): void {
    if (seed === this.track.seed) return;
    this.newTrack(seed);
    this.toMenu();
  }

  /** The human-driven car a key set belongs to (in vs-CPU mode, every key set drives Red). */
  private humanCar(slot: number): Car | undefined {
    return this.mode === 1 ? this.cars[0] : this.cars[slot];
  }

  private showToast(text: string): void {
    this.toast = { text, time: 2.5 };
  }

  private async copyLink(): Promise<void> {
    const ok = await copyTrackLink(this.track.seed);
    this.showToast(ok ? `Link to track #${this.track.seed} copied` : `Share this track with code #${this.track.seed}`);
  }

  private resetScene(): void {
    sound.stopCarVoices();
    clearSkids();
    clearParticles();
    resetShake();
    resetPickups(this.track);
    resetFx();
    resetCamera();
    initWeather(this.track);
    initScenery(this.track);
    this.lapsSeen = [0, 0];
    this.photoFinishDone = false;
  }

  /** Per-frame (real-time) updates for effects that shouldn't slow down in slow motion. */
  frame(dt: number, t: number): void {
    updateFx(dt);
    updateWeather(dt, t);
    updateScenery(dt, this.cars);
    const active = this.state === 'race' || this.state === 'countdown';
    updateCamera(dt, this.cars, this.state === 'finished' ? this.winner : null, active);
    for (const c of this.cars) {
      c.lapPop = Math.max(0, c.lapPop - dt);
      c.itemRoll = Math.max(0, c.itemRoll - dt);
    }
    if (this.toast && (this.toast.time -= dt) <= 0) this.toast = null;
  }

  /** Banners and crowd hype when someone starts a new lap. */
  private announceLaps(): void {
    this.cars.forEach((c, i) => {
      if (c.laps === this.lapsSeen[i]) return;
      this.lapsSeen[i] = c.laps;
      c.lapPop = 0.7;
      exciteCrowd(0.7);
      if (c.finished) return;
      const text = c.laps === LAPS - 1 ? `${c.def.name}: FINAL LAP!` : `${c.def.name}: LAP ${c.laps + 1}/${LAPS}`;
      banner(text, c.def.color);
    });
  }

  /** Neck and neck in the last few metres: slow everything down. */
  private checkPhotoFinish(): void {
    if (this.photoFinishDone || this.cars.length < 2) return;
    const goal = LAPS * this.track.n;
    const [a, b] = [...this.cars].sort((x, y) => y.progress - x.progress);
    if (goal - a.progress < 30 && a.progress - b.progress < 25) {
      this.photoFinishDone = true;
      slowmo(1.6);
    }
  }

  startRace(mode: Mode): void {
    this.mode = mode;
    this.resetScene();
    this.cars = [
      new Car(CAR_DEFS[0], 0, mode === 1 ? 'arrows+wasd' : 'arrows', this.track),
      new Car(CAR_DEFS[1], 1, mode === 1 ? 'cpu' : 'wasd', this.track),
    ];
    this.cars[1].skill = CPU_SKILL[settings.difficulty];
    setFxEnabled(true);
    this.clock = -3;
    this.lastBeep = null;
    this.winner = null;
    this.state = 'countdown';
  }

  /** Two silent CPU cars race behind the menu as an attract mode. */
  private startDemo(): void {
    this.resetScene();
    this.cars = [
      new Car(CAR_DEFS[0], 0, 'cpu', this.track, true),
      new Car(CAR_DEFS[1], 1, 'cpu', this.track, true),
    ];
    setFxEnabled(false);
    this.clock = 0;
  }

  private toMenu(): void {
    this.state = 'menu';
    this.startDemo();
  }

  handleKey(code: string): void {
    if (code === 'KeyM') { sound.muted = !sound.muted; return; }
    if (this.state === 'menu') {
      if (code === 'Digit1' || code === 'Numpad1') this.startRace(1);
      else if (code === 'Digit2' || code === 'Numpad2') this.startRace(2);
      else if (code === 'KeyN') { this.newTrack(); this.startDemo(); }
      else if (code === 'KeyD') cycleDifficulty();
      else if (code === 'KeyC') toggleCatchUp();
      else if (code === 'KeyL') void this.copyLink();
    } else if (this.state === 'race') {
      if (code === 'Escape') { this.toMenu(); return; }
      const respawnSlot = RESPAWN_KEYS.findIndex(keys => keys.includes(code));
      if (respawnSlot >= 0) this.humanCar(respawnSlot)?.respawn();
      const fireSlot = FIRE_KEYS.findIndex(keys => keys.includes(code));
      if (fireSlot >= 0) { const car = this.humanCar(fireSlot); if (car) useItem(car); }
      else if (code === 'Space' && this.mode === 1) useItem(this.cars[0]);
    } else if (this.state === 'finished') {
      if (code === 'Enter' || code === 'Space') this.startRace(this.mode);
      else if (code === 'KeyN') { this.newTrack(); this.startRace(this.mode); }
      else if (code === 'Escape') this.toMenu();
      else if (code === 'KeyL') void this.copyLink();
    } else if (code === 'Escape') {
      this.toMenu();
    }
  }

  step(): void {
    if (this.state !== 'finished') this.clock += DT;
    if (this.state === 'countdown') {
      const sec = Math.ceil(-this.clock);
      if (sec !== this.lastBeep && sec > 0) { sound.beep(440, 0.18); this.lastBeep = sec; }
      if (this.clock >= 0) {
        this.state = 'race';
        sound.beep(880, 0.35);
        for (const c of this.cars) c.lapStart = 0;
      }
    }

    const racing = this.state === 'race' || this.state === 'menu';
    if (this.state === 'menu' && this.cars.some(c => c.finished)) this.startDemo();
    this.applyCatchUp();
    for (const c of this.cars) c.update(this.clock, racing);
    if (this.cars.length === 2) collideCars(this.cars[0], this.cars[1]);
    updatePickups(this.cars, this.track, racing);
    updateParticles(DT);
    updateShake(DT);

    if (this.state === 'race') {
      this.announceLaps();
      this.checkPhotoFinish();
      const done = this.cars.filter(c => c.finished).sort((a, b) => a.finishTime - b.finishTime);
      if (done.length) {
        this.winner = done[0];
        this.state = 'finished';
        celebrate(this.winner.def.color);
        exciteCrowd(1);
        sound.beep(660, 0.15);
        setTimeout(() => sound.beep(880, 0.15), 150);
        setTimeout(() => sound.beep(1320, 0.4), 300);
      }
    }
  }

  /** Give the trailing car a little extra power so races stay close. */
  private applyCatchUp(): void {
    const enabled = this.state === 'race' && settings.catchUp;
    const lead = Math.max(...this.cars.map(c => c.progress));
    for (const c of this.cars) {
      const gap = (lead - c.progress) / this.track.n;
      c.boost = enabled && !c.finished ? clamp(gap / CATCH_UP_FULL_GAP, 0, 1) * CATCH_UP_MAX : 0;
    }
  }
}
