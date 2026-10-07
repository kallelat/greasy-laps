import { CURB_W, DT, H, LAPS, TRACK_W, W } from './config';
import { NO_INPUT, readControls, type Controls } from './input';
import { skidCtx } from './layers';
import { spawnParticle, spawnSparks } from './particles';
import { addShake } from './shake';
import { sound, type CarVoice } from './sound';
import type { Track } from './track';
import { clamp, rand, roundRect, wrapAngle, type Vec } from './util';

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

  private wheels: [Vec, Vec] | null = null;
  private voice: CarVoice | null;
  private inOil = false;
  private cpuOffset = 0;
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
    this.x = pts[i].x + pts[i].nx * side * TRACK_W * 0.22;
    this.y = pts[i].y + pts[i].ny * side * TRACK_W * 0.22;
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
      this.cpuOffset = rand(-0.18, 0.18) * TRACK_W;
    }
    const look = Math.round(10 + speed / 14);
    const t = pts[(this.idx + look) % n];
    const tx = t.x + t.nx * this.cpuOffset, ty = t.y + t.ny * this.cpuOffset;
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
    const limit = 360 - corner * 140;
    if (speed > limit) { throttle = 0; if (speed > limit + 40) brake = 1; }
    if (Math.abs(diff) > 0.9 && speed > 150) throttle = 0;
    return { throttle, brake, steer: clamp(diff * 3, -1, 1) };
  }

  update(now: number, racing: boolean): void {
    const ctl: Controls = racing && !this.finished ? this.input() : { ...NO_INPUT };
    if (this.finished) ctl.brake = 0.4;

    // Surface checks.
    this.locate();
    const inOil = this.track.oils.some(o => (this.x - o.x) ** 2 + (this.y - o.y) ** 2 < o.r * o.r);
    if (inOil) {
      if (!this.inOil && !this.silent) sound.splat();
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
    const accel = onGrass ? 330 : 440;
    const drag = onGrass ? 2.6 : 1.05;             // terminal speed ≈ accel / drag
    const grip = oily ? 0.5 : onGrass ? 3.2 : 4.2; // lateral grip (per second)

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
    this.x += this.vx * DT;
    this.y += this.vy * DT;

    this.bounceOffScreenEdges();

    // Skid marks & dust.
    this.slip = Math.abs(vl);
    const wheels = this.wheelPositions();
    const hardBraking = ctl.brake > 0 && vf > 150;
    if (this.wheels && (this.slip > 70 || hardBraking)) {
      skidCtx.strokeStyle = onGrass ? 'rgba(60,40,20,0.22)' : 'rgba(15,15,15,0.28)';
      skidCtx.lineWidth = 3;
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
    if (onGrass && speed > 60 && Math.random() < 0.5) spawnParticle(wheel, '#7a5a32');
    else if (!onGrass && this.slip > 120 && Math.random() < 0.35) spawnParticle(wheel, '#cfcfcf');

    if (!this.finished && racing) this.countLaps(now);

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

  private bounceOffScreenEdges(): void {
    const r = CAR_RADIUS;
    if (this.x < r) { this.wallHit(Math.abs(this.vx), { x: 0, y: this.y }); this.x = r; this.vx = Math.abs(this.vx) * 0.4; }
    if (this.x > W - r) { this.wallHit(Math.abs(this.vx), { x: W, y: this.y }); this.x = W - r; this.vx = -Math.abs(this.vx) * 0.4; }
    if (this.y < r) { this.wallHit(Math.abs(this.vy), { x: this.x, y: 0 }); this.y = r; this.vy = Math.abs(this.vy) * 0.4; }
    if (this.y > H - r) { this.wallHit(Math.abs(this.vy), { x: this.x, y: H }); this.y = H - r; this.vy = -Math.abs(this.vy) * 0.4; }
  }

  /** Sound, sparks and shake for hitting a wall at `impact` px/s. */
  private wallHit(impact: number, at: Vec): void {
    if (impact < 30) return;
    const force = clamp(impact / 400, 0, 1);
    if (!this.silent) sound.hit(force);
    if (impact > 80) spawnSparks(at, { x: 0, y: 0 }, force);
    addShake(force);
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
    this.onTrack = this.dist < TRACK_W / 2 + CURB_W * 0.6;
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
    g.translate(this.x, this.y);
    g.rotate(this.h);
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(g, -14, -6, 32, 18, 5); g.fill();
    // wheels
    g.fillStyle = '#111';
    g.fillRect(-13, -10, 8, 4); g.fillRect(-13, 6, 8, 4);
    g.fillRect(5, -10, 8, 4); g.fillRect(5, 6, 8, 4);
    // body
    g.fillStyle = this.def.color;
    roundRect(g, -16, -8, 32, 16, 5); g.fill();
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
}

export function collideCars(a: Car, b: Car): void {
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
  if (-rel > 60) {
    const contact = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    spawnSparks(contact, { x: (a.vx + b.vx) / 2, y: (a.vy + b.vy) / 2 }, force);
  }
  addShake(force * 0.8);
}
