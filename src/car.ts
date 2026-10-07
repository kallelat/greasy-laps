import { CURB_W, DT, H, LAPS, W } from './config';
import { NO_INPUT, readControls, type Controls } from './input';
import { skidCtx } from './layers';
import { impact as fxImpact } from './fx';
import { spawnDrops, spawnParticle, spawnSmoke, spawnSparks } from './particles';
import { droppedOilsAt, TURBO_POWER, type Item } from './pickups';
import { CPU_SKILL, type CpuSkill } from './settings';
import { sound, type CarVoice } from './sound';
import { isOnBridge, isUnderBridge, type Track } from './track';
import { clamp, rand, roundRect, wrapAngle, type Vec } from './util';
import { inPuddle } from './weather';

export type Controller = 'arrows' | 'wasd' | 'arrows+wasd' | 'cpu';

export interface CarDef {
  name: string;
  color: string;
  dark: string;
}

export const CAR_DEFS: readonly CarDef[] = [
  { name: 'RED', color: '#e53935', dark: '#9e1f1c' },
  { name: 'BLUE', color: '#1e88e5', dark: '#0d4f8f' },
];

const CAR_RADIUS = 14;
/** How close the car's centre can get to a tyre wall. */
const WALL_CLEARANCE = 12;
const GHOST_TIME = 1.5;       // seconds without car-to-car collisions after a respawn
const RESPAWN_COOLDOWN = 2;

export class Car {
  x: number;
  y: number;
  h: number;               // heading (radians)
  vx = 0;
  vy = 0;
  av = 0;                  // spin from collisions
  idx: number;             // nearest centerline index
  progress: number;        // centerline points travelled (lap = track.n)
  dist = 0;                // distance from centerline
  laps = 0;
  lapStart = 0;
  lapTimes: number[] = [];
  best: number | null = null;
  finished = false;
  finishTime = 0;
  oilTimer = 0;
  onTrack = true;
  slip = 0;
  /** Catch-up bonus for the trailing car, 0..~0.12, set by the game each step. */
  boost = 0;
  /** CPU driving skill; only used when controller is 'cpu'. */
  skill: CpuSkill = CPU_SKILL.normal;
  /** > 0 right after a respawn: the car is see-through and can't be hit. */
  ghost = 0;
  /** Item picked up from a crate, waiting to be used. */
  item: Item | null = null;
  /** Seconds the current item has been held (the CPU uses it to decide when to fire). */
  itemTime = 0;
  /** > 0 while a turbo is burning. */
  turbo = 0;
  /** UI animation timers (real seconds): lap-time pop and item "slot machine" roll. */
  lapPop = 0;
  itemRoll = 0;
  /** Body roll, -1..1, leaning with the slide (visual only). */
  roll = 0;
  /** Squash-and-stretch spring after impacts (visual only). */
  private squash = 0;
  private squashV = 0;
  /** Seconds spent driving backwards along the track. */
  private wrongWayTime = 0;
  /** Seconds spent (nearly) stationary during a race. */
  private stuckTime = 0;
  private respawnCooldown = 0;

  private wheels: [Vec, Vec] | null = null;
  private voice: CarVoice | null;
  private inOil = false;
  private cpuOffset = 0;   // fraction of the track width
  private cpuTimer = 0;
  private stuckTimer = 0;

  constructor(
    readonly def: CarDef,
    slot: number,
    readonly controller: Controller,
    private readonly track: Track,
    readonly silent = false,
  ) {
    const { pts, n } = track;
    const back = 6;
    const i = (n - back) % n;
    const side = slot === 0 ? -1 : 1;
    this.x = pts[i].x + pts[i].nx * side * pts[i].w * 0.22;
    this.y = pts[i].y + pts[i].ny * side * pts[i].w * 0.22;
    this.h = pts[i].ang;
    this.idx = i;
    this.progress = -back;
    this.voice = silent ? null : sound.carVoice();
  }

  private input(): Controls {
    if (this.controller === 'cpu') return this.cpuInput();
    if (this.controller === 'arrows+wasd') {
      const a = readControls('arrows'), b = readControls('wasd');
      return {
        throttle: Math.max(a.throttle, b.throttle),
        brake: Math.max(a.brake, b.brake),
        steer: clamp(a.steer + b.steer, -1, 1),
      };
    }
    return readControls(this.controller);
  }

  private cpuInput(): Controls {
    const { pts, n } = this.track;
    const speed = Math.hypot(this.vx, this.vy);
    this.cpuTimer -= DT;
    if (this.cpuTimer <= 0) {
      this.cpuTimer = rand(0.5, 1.5);
      this.cpuOffset = rand(-this.skill.wobble, this.skill.wobble);
    }
    const look = Math.round(10 + speed / 14);
    const t = pts[(this.idx + look) % n];
    const tx = t.x + t.nx * this.cpuOffset * t.w, ty = t.y + t.ny * this.cpuOffset * t.w;
    const want = Math.atan2(ty - this.y, tx - this.x);
    const diff = wrapAngle(want - this.h);

    // Look further ahead to judge upcoming corner sharpness.
    const far = pts[(this.idx + look + 25) % n];
    const corner = Math.abs(wrapAngle(far.ang - pts[this.idx].ang));

    // Reverse out if stuck facing the wrong way.
    if (speed < 25 && Math.abs(diff) > 1.6) this.stuckTimer += DT;
    else this.stuckTimer = Math.max(0, this.stuckTimer - DT);
    if (this.stuckTimer > 0.6) return { throttle: 0, brake: 1, steer: -Math.sign(diff) };

    let throttle = 1, brake = 0;
    // A trailing CPU (catch-up boost) also dares to corner a little faster.
    const limit = (360 - corner * 140) * this.skill.corner * this.track.theme.cpuCorner * (1 + this.boost);
    if (speed > limit) { throttle = 0; if (speed > limit + 40) brake = 1; }
    if (Math.abs(diff) > 0.9 && speed > 150) throttle = 0;
    return { throttle, brake, steer: clamp(diff * 3, -1, 1) };
  }

  update(now: number, racing: boolean): void {
    const ctl: Controls = racing && !this.finished ? this.input() : { ...NO_INPUT };
    if (this.finished) ctl.brake = 0.4;

    // Surface checks.
    this.locate();
    const touches = (o: { x: number; y: number; r: number }) => (this.x - o.x) ** 2 + (this.y - o.y) ** 2 < o.r * o.r;
    const inOil = (!this.onBridge && this.track.oils.some(touches)) || droppedOilsAt(this.onBridge).some(touches);
    if (inOil) {
      if (!this.inOil) {
        if (!this.silent) sound.splat();
        spawnDrops(this, 12, '#16121e', 130, { x: this.vx, y: this.vy });
      }
      this.oilTimer = 0.9;
    }
    this.inOil = inOil;
    this.oilTimer = Math.max(0, this.oilTimer - DT);
    const oily = this.oilTimer > 0;

    const fx = Math.cos(this.h), fy = Math.sin(this.h);
    const rx = -fy, ry = fx;
    let vf = this.vx * fx + this.vy * fy;
    let vl = this.vx * rx + this.vy * ry;

    const onGrass = !this.onTrack;
    const power = (this.controller === 'cpu' ? this.skill.power : 1) * (1 + this.boost);
    const surface = this.track.theme.surface;
    const turbo = this.turbo > 0 ? TURBO_POWER : 0;
    const accel = (onGrass ? surface.offAccel : 440) * power * (1 + turbo); // more power also raises top speed
    const drag = onGrass ? surface.offDrag : 1.05;                          // terminal speed ≈ accel / drag
    const wet = this.track.weather === 'rain' ? 0.85 : 1;                   // rain makes the road slippery
    const grip = oily ? 0.5 : onGrass ? surface.offGrip : surface.roadGrip * wet; // lateral grip (per second)

    if (ctl.throttle) vf += accel * ctl.throttle * DT;
    if (ctl.brake) vf -= (vf > 20 ? 620 : 260) * ctl.brake * DT;
    vf -= vf * drag * DT;
    if (!ctl.throttle && !ctl.brake) vf -= vf * 0.6 * DT;
    vf = clamp(vf, -140, 600);

    // Slide: lateral speed decays based on grip; handbrake-ish when braking hard while turning.
    const slideBoost = ctl.brake && ctl.steer && vf > 120 ? 0.45 : 1;
    vl *= Math.exp(-grip * slideBoost * DT);

    // Steering scales with speed (reversed when driving backwards).
    const steerAuth = clamp(vf / 120, -1, 1);
    const turnRate = (oily ? 2.2 : 3.4) * (1 - clamp(Math.abs(vf) / 1400, 0, 0.3));
    this.h += ctl.steer * turnRate * steerAuth * DT;
    this.h += this.av * DT;
    this.av *= Math.exp(-4 * DT);

    this.vx = fx * vf + rx * vl;
    this.vy = fy * vf + ry * vl;

    // Visual-only body motion: lean into slides, wobble after hits.
    this.roll += (clamp(vl / 260, -1, 1) - this.roll) * (1 - Math.exp(-DT * 10));
    this.squashV += (-260 * this.squash - 14 * this.squashV) * DT;
    this.squash += this.squashV * DT;
    this.x += this.vx * DT;
    this.y += this.vy * DT;

    this.collideWalls();
    this.bounceOffScreenEdges();

    // Skid marks & dust.
    this.slip = Math.abs(vl);
    const wheels = this.wheelPositions();
    const hardBraking = ctl.brake > 0 && vf > 150;
    const theme = this.track.theme;
    // Deep snow keeps every tyre track, not just the skids.
    const snowTracks = theme.name === 'snow' && onGrass && Math.hypot(this.vx, this.vy) > 15;
    if (this.wheels && (this.slip > 70 || hardBraking || snowTracks)) {
      skidCtx.strokeStyle = snowTracks ? 'rgba(140,155,185,0.3)' : onGrass ? theme.offroadSkid : 'rgba(15,15,15,0.28)';
      skidCtx.lineWidth = snowTracks ? 3.5 : 3;
      skidCtx.lineCap = 'round';
      skidCtx.beginPath();
      for (let k = 0; k < 2; k++) {
        skidCtx.moveTo(this.wheels[k].x, this.wheels[k].y);
        skidCtx.lineTo(wheels[k].x, wheels[k].y);
      }
      skidCtx.stroke();
    }
    this.wheels = wheels;
    const speed = Math.hypot(this.vx, this.vy);
    const wheel = wheels[Math.random() < 0.5 ? 0 : 1];
    this.emitSmoke(wheel, onGrass, speed, hardBraking);
    if (this.turbo > 0) {
      this.turbo = Math.max(0, this.turbo - DT);
      const exhaust = { x: this.x - Math.cos(this.h) * 18, y: this.y - Math.sin(this.h) * 18 };
      spawnParticle(exhaust, Math.random() < 0.5 ? '#ffb347' : '#ff6a00');
      if (Math.random() < 0.3) spawnSmoke(exhaust, '#8a8a8a', { x: this.vx, y: this.vy }, 0.6, 0.2);
    }

    if (!this.finished && racing) {
      this.countLaps(now);
      this.trackRecovery(speed);
    }
    this.ghost = Math.max(0, this.ghost - DT);
    this.respawnCooldown = Math.max(0, this.respawnCooldown - DT);

    if (this.voice) {
      sound.updateCarVoice(this.voice, {
        speed,
        throttle: ctl.throttle > 0,
        pitchOffset: this.controller === 'cpu' ? 7 : 0,
        // Tyres only squeal on asphalt; grass gets a rumble instead.
        squeal: onGrass ? 0 : Math.max(clamp((this.slip - 70) / 220, 0, 1), hardBraking ? 0.45 : 0),
        rumble: onGrass ? clamp(speed / 260, 0, 1) : 0,
      });
    }
  }

  /** Tyre smoke on the road, powder/sand plumes off it, spray in the rain. */
  private emitSmoke(wheel: Vec, onGrass: boolean, speed: number, hardBraking: boolean): void {
    const theme = this.track.theme;
    const vel = { x: this.vx, y: this.vy };
    if (!onGrass) {
      if ((this.slip > 110 || hardBraking) && Math.random() < 0.55) {
        spawnSmoke(wheel, theme.name === 'snow' ? '#f2f6fc' : '#e4e4e4', vel, 1, 0.28);
      }
    } else if (speed > 70) {
      if (theme.name === 'snow' && Math.random() < 0.6) spawnSmoke(wheel, '#ffffff', vel, 0.9, 0.45);
      else if (theme.name === 'desert' && Math.random() < 0.6) spawnSmoke(wheel, '#d9b77e', vel, 1.1, 0.35);
      else if (Math.random() < 0.5) spawnParticle(wheel, theme.offroadDust);
    }
    if (this.track.weather === 'rain' && speed > 120 && Math.random() < 0.2) spawnSmoke(wheel, '#d5e2f2', vel, 0.8, 0.16);
    if (this.track.puddles.length && speed > 60 && inPuddle(this.x, this.y) && Math.random() < 0.6) {
      spawnDrops(wheel, 3, 'rgba(205,225,255,0.9)', 170, vel);
      spawnSmoke(wheel, '#dfe9f6', vel, 0.7, 0.25);
    }
  }

  /** Kick the squash-and-stretch spring. */
  bump(force: number): void {
    this.squashV += force * 9;
  }

  private bounceOffScreenEdges(): void {
    const r = CAR_RADIUS;
    if (this.x < r) { this.wallHit(Math.abs(this.vx), { x: 0, y: this.y }); this.x = r; this.vx = Math.abs(this.vx) * 0.4; }
    if (this.x > W - r) { this.wallHit(Math.abs(this.vx), { x: W, y: this.y }); this.x = W - r; this.vx = -Math.abs(this.vx) * 0.4; }
    if (this.y < r) { this.wallHit(Math.abs(this.vy), { x: this.x, y: 0 }); this.y = r; this.vy = Math.abs(this.vy) * 0.4; }
    if (this.y > H - r) { this.wallHit(Math.abs(this.vy), { x: this.x, y: H }); this.y = H - r; this.vy = -Math.abs(this.vy) * 0.4; }
  }

  /** Keep the car inside the tyre walls on either side of the track. */
  private collideWalls(): void {
    const { pts, n, wallRight, wallLeft } = this.track;
    // The car moves less than one centerline point per step, so a small local search is enough.
    let bi = this.idx, best = Infinity;
    for (let k = -4; k <= 4; k++) {
      const i = (this.idx + k + n) % n;
      const d = (pts[i].x - this.x) ** 2 + (pts[i].y - this.y) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    const p = pts[bi];
    const lateral = (this.x - p.x) * p.nx + (this.y - p.y) * p.ny;
    const side = lateral >= 0 ? 1 : -1;
    const wall = side > 0 ? wallRight[bi] : wallLeft[bi];
    const pen = Math.abs(lateral) - (wall - WALL_CLEARANCE);
    if (pen <= 0) return;

    const ox = p.nx * side, oy = p.ny * side; // outward, towards the wall
    this.x -= ox * pen;
    this.y -= oy * pen;
    const contact = { x: this.x + ox * WALL_CLEARANCE, y: this.y + oy * WALL_CLEARANCE };
    const vn = this.vx * ox + this.vy * oy;
    if (vn > 0) {
      // Bounce off with a little energy, scrub some speed, and twist the car on glancing hits.
      this.vx -= ox * vn * 1.4;
      this.vy -= oy * vn * 1.4;
      this.vx *= 0.9;
      this.vy *= 0.9;
      const tangential = this.vx * -oy + this.vy * ox;
      this.av += clamp(tangential * vn * 0.00004, -2.5, 2.5) * side;
      this.wallHit(vn, contact);
    } else if (Math.hypot(this.vx, this.vy) > 150 && Math.random() < 0.15) {
      // Grinding along the barrier.
      spawnSparks(contact, { x: this.vx, y: this.vy }, 0);
    }
  }

  /** Wrong-way and stuck detection; CPU cars respawn themselves when they get into trouble. */
  private trackRecovery(speed: number): void {
    const t = this.track.pts[this.idx];
    const along = this.vx * Math.cos(t.ang) + this.vy * Math.sin(t.ang);
    if (along < -40) this.wrongWayTime += DT;
    else if (along > 20) this.wrongWayTime = 0;
    this.stuckTime = speed < 20 ? this.stuckTime + DT : 0;
    if (this.controller === 'cpu' && (this.stuckTime > 2.5 || this.wrongWayTime > 2.5)) this.respawn();
  }

  get wrongWay(): boolean {
    return this.wrongWayTime > 0.8;
  }

  /** True when the player should be told about the respawn key. */
  get needsHelp(): boolean {
    return this.wrongWay || this.stuckTime > 1.5;
  }

  /** Put the car back on the centerline, a few metres behind where it was, facing the right way. */
  respawn(): boolean {
    if (this.finished || this.respawnCooldown > 0) return false;
    const { pts, n } = this.track;
    const back = 3;
    const i = (this.idx - back + n) % n;
    this.x = pts[i].x;
    this.y = pts[i].y;
    this.h = pts[i].ang;
    this.vx = this.vy = this.av = 0;
    this.idx = i;
    this.progress -= back;
    this.oilTimer = 0;
    this.wrongWayTime = this.stuckTime = 0;
    this.wheels = null; // no skid line across the map
    this.ghost = GHOST_TIME;
    this.respawnCooldown = RESPAWN_COOLDOWN;
    if (!this.silent) { sound.beep(520, 0.08, 'triangle', 0.2); setTimeout(() => sound.beep(780, 0.12, 'triangle', 0.2), 80); }
    return true;
  }

  /** Sound, sparks and shake for hitting a wall at `impact` px/s. */
  private wallHit(impact: number, at: Vec): void {
    if (impact < 30) return;
    const force = clamp(impact / 400, 0, 1);
    if (!this.silent) sound.hit(force);
    this.bump(force);
    fxImpact(force, at, { x: 0, y: 0 }, ['#1d1d1f', '#1d1d1f', '#e8e8e8', this.def.color]);
  }

  private countLaps(now: number): void {
    while (this.progress >= (this.laps + 1) * this.track.n) {
      this.laps++;
      const t = now - this.lapStart;
      this.lapTimes.push(t);
      if (this.best === null || t < this.best) this.best = t;
      this.lapStart = now;
      sound.beep(880, 0.12, 'square', 0.15);
      if (this.laps >= LAPS) {
        this.finished = true;
        this.finishTime = now;
      }
    }
  }

  /** Find the nearest centerline point and advance lap progress by how far it moved. */
  private locate(): void {
    const { pts, n } = this.track;
    let best = Infinity, bi = this.idx;
    for (let k = -40; k <= 40; k++) {
      const i = (this.idx + k + n) % n;
      const dx = pts[i].x - this.x, dy = pts[i].y - this.y;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; bi = i; }
    }
    if (best > 200 * 200) { // lost: full search
      for (let i = 0; i < n; i++) {
        const dx = pts[i].x - this.x, dy = pts[i].y - this.y;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bi = i; }
      }
    }
    let delta = bi - this.idx;
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    this.progress += delta;
    this.idx = bi;
    this.dist = Math.sqrt(best);
    this.onTrack = this.dist < pts[bi].w / 2 + CURB_W * 0.6;
  }

  private wheelPositions(): [Vec, Vec] {
    const c = Math.cos(this.h), s = Math.sin(this.h);
    const bx = -10, by = 7;
    return [
      { x: this.x + c * bx - s * by, y: this.y + s * bx + c * by },
      { x: this.x + c * bx + s * by, y: this.y + s * bx - c * by },
    ];
  }

  draw(g: CanvasRenderingContext2D): void {
    g.save();
    if (this.ghost > 0) g.globalAlpha = 0.35 + 0.25 * Math.sin(this.ghost * 30);
    g.translate(this.x, this.y);
    g.rotate(this.h);
    // Soft shadow, pushed to the outside of the slide as the body rolls.
    g.drawImage(shadowSprite(), -SHADOW_W / 2 + 3, -SHADOW_H / 2 + 4 - this.roll * 3, SHADOW_W, SHADOW_H);
    // wheels
    g.fillStyle = '#111';
    g.fillRect(-13, -10, 8, 4); g.fillRect(-13, 6, 8, 4);
    g.fillRect(5, -10, 8, 4); g.fillRect(5, 6, 8, 4);
    // Body leans with the roll and squashes on impact.
    g.translate(0, -this.roll * 1.3);
    const sq = clamp(this.squash, -0.25, 0.25);
    g.scale(1 - sq, 1 + sq * 0.9);
    g.fillStyle = this.def.color;
    roundRect(g, -16, -8, 32, 16, 5); g.fill();
    // Glossy paint: light from the top-left, shade bottom-right.
    const shine = g.createLinearGradient(-16, -8 + this.roll * 4, 10, 8);
    shine.addColorStop(0, 'rgba(255,255,255,0.45)');
    shine.addColorStop(0.4, 'rgba(255,255,255,0)');
    shine.addColorStop(0.75, 'rgba(0,0,0,0)');
    shine.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = shine;
    g.fill();
    g.lineWidth = 1.5; g.strokeStyle = this.def.dark; g.stroke();
    // racing stripe
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(-16, -2, 32, 4);
    // cockpit
    g.fillStyle = '#1b2733';
    roundRect(g, -6, -6, 12, 12, 3); g.fill();
    g.fillStyle = 'rgba(160,210,255,0.6)';
    g.fillRect(3, -5, 3, 10);
    // headlights
    g.fillStyle = '#fff6b0';
    g.fillRect(14, -6, 2, 3); g.fillRect(14, 3, 2, 3);
    g.restore();
  }

  /** True while driving across the bridge deck of a figure-eight. */
  get onBridge(): boolean {
    return isOnBridge(this.track, this.idx);
  }

  get underBridge(): boolean {
    return isUnderBridge(this.track, this.idx);
  }
}

const SHADOW_W = 46, SHADOW_H = 30;
let shadowCanvas: HTMLCanvasElement | null = null;

/** Blurry car shadow, built once from a few stacked translucent rounded rects. */
function shadowSprite(): HTMLCanvasElement {
  if (!shadowCanvas) {
    shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = SHADOW_W;
    shadowCanvas.height = SHADOW_H;
    const g = shadowCanvas.getContext('2d')!;
    for (let k = 4; k >= 0; k--) {
      g.fillStyle = 'rgba(0,0,0,0.11)';
      roundRect(g, 7 - k * 1.5, 7 - k * 1.5, 32 + k * 3, 16 + k * 3, 5 + k * 1.5);
      g.fill();
    }
  }
  return shadowCanvas;
}

export function collideCars(a: Car, b: Car): void {
  if (a.ghost > 0 || b.ghost > 0) return;
  // One on the bridge and one underneath it: different levels, no contact.
  if ((a.onBridge && b.underBridge) || (a.underBridge && b.onBridge)) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minD = 26;
  if (dist === 0 || dist >= minD) return;
  const nx = dx / dist, ny = dy / dist;
  const overlap = (minD - dist) / 2;
  a.x -= nx * overlap; a.y -= ny * overlap;
  b.x += nx * overlap; b.y += ny * overlap;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel > 0) return;
  const j = -(1 + 0.5) * rel / 2;
  a.vx -= j * nx; a.vy -= j * ny;
  b.vx += j * nx; b.vy += j * ny;
  // A bit of spin for drama.
  const tx = -ny, ty = nx;
  const tang = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
  a.av += clamp(tang * 0.01, -3, 3);
  b.av -= clamp(tang * 0.01, -3, 3);

  const force = clamp(-rel / 450, 0, 1);
  if (!a.silent || !b.silent) sound.hit(force);
  a.bump(force);
  b.bump(force);
  const contact = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  fxImpact(force, contact, { x: (a.vx + b.vx) / 2, y: (a.vy + b.vy) / 2 }, [a.def.color, b.def.color, '#222']);
}
