import { GAME_TITLE, H, LAPS, W } from './config';
import { settings } from './settings';
import type { Car } from './car';
import type { Game } from './game';
import { bridgeLayer, floodlights, skidLayer, trackLayer } from './layers';
import { drawParticles, drawSparks } from './particles';
import { activeCrates, drawCrates, drawDroppedOils } from './pickups';
import { shakeOffset } from './shake';
import { sound } from './sound';
import { roundRect } from './util';

function fmt(t: number | null | undefined): string {
  if (t === null || t === undefined || t < 0) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

const ITEM_LABEL = { turbo: 'TURBO', oil: 'OIL DROP' } as const;

export class Renderer {
  private readonly night: CanvasRenderingContext2D;

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    this.night = c.getContext('2d')!;
  }

  draw(game: Game, now: number): void {
    const { ctx } = this;
    // Shake the world (not the HUD); the attract-mode demo behind the menu stays still.
    const shake = game.state === 'menu' ? { x: 0, y: 0 } : shakeOffset();
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(shake.x, shake.y);
    ctx.drawImage(trackLayer, 0, 0);
    ctx.drawImage(skidLayer, 0, 0);
    drawDroppedOils(ctx, false);
    drawCrates(ctx, now / 1000);
    drawParticles(ctx);
    // Figure-eights: cars on the lower road go under the bridge deck, cars on the deck over it.
    for (const c of game.cars) if (!c.onBridge) c.draw(ctx);
    ctx.drawImage(bridgeLayer, 0, 0);
    drawDroppedOils(ctx, true);
    for (const c of game.cars) if (c.onBridge) c.draw(ctx);
    if (game.track.theme.dark) this.drawNight(game.cars);
    drawSparks(ctx);
    if (game.state === 'race') this.drawCarWarnings(game, now);
    ctx.restore();

    if (game.state === 'menu') this.drawMenu(game);
    else {
      this.drawHud(game);
      if (game.state === 'countdown') this.drawCountdown(game.clock);
      if (game.state === 'race' && game.clock < 0.8) this.text('GO!', W / 2, H / 2, 160, '#66bb6a');
      if (game.state === 'finished') this.drawFinished(game);
    }
    this.text(this.trackLabel(game), 20, H - 20, 14, 'rgba(255,255,255,0.7)', 'left', '700');
    if (game.toast) {
      this.ctx.globalAlpha = Math.min(1, game.toast.time * 3);
      this.text(game.toast.text, W / 2, H - 40, 22, '#fff', 'center', '700');
      this.ctx.globalAlpha = 1;
    }
    if (sound.muted) this.text('MUTED', W - 20, H - 20, 14, '#aaa', 'right', '700');
  }

  private text(str: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'center', weight = '800'): void {
    const { ctx } = this;
    ctx.font = `${weight} ${size}px "Trebuchet MS", "Arial Black", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  /** Darken everything except headlights, floodlights and crates. */
  private drawNight(cars: Car[]): void {
    const g = this.night;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(4,8,26,0.86)';
    g.fillRect(0, 0, W, H);

    // Everything drawn with destination-out punches light into the darkness.
    g.globalCompositeOperation = 'destination-out';
    const glow = (x: number, y: number, r: number, strength: number) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(0,0,0,${strength})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    for (const l of floodlights) glow(l.x, l.y, 170, 0.8);
    for (const c of activeCrates()) glow(c.x, c.y, 30, 0.7);
    for (const car of cars) {
      glow(car.x, car.y, 38, 0.75);
      // Headlight cone.
      const fx = car.x + Math.cos(car.h) * 14, fy = car.y + Math.sin(car.h) * 14;
      const reach = 230, spread = 0.45;
      const grad = g.createRadialGradient(fx, fy, 0, fx, fy, reach);
      grad.addColorStop(0, 'rgba(0,0,0,0.95)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(fx, fy);
      g.arc(fx, fy, reach, car.h - spread, car.h + spread);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(g.canvas, 0, 0);

    // Warm tint in the beams and red tail lights, on top of the darkness.
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const car of cars) {
      const fx = car.x + Math.cos(car.h) * 14, fy = car.y + Math.sin(car.h) * 14;
      const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, 200);
      grad.addColorStop(0, 'rgba(255,230,160,0.22)');
      grad.addColorStop(1, 'rgba(255,230,160,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.arc(fx, fy, 200, car.h - 0.45, car.h + 0.45);
      ctx.closePath();
      ctx.fill();
      const bx = car.x - Math.cos(car.h) * 16, by = car.y - Math.sin(car.h) * 16;
      const tail = ctx.createRadialGradient(bx, by, 0, bx, by, 14);
      tail.addColorStop(0, 'rgba(255,40,40,0.6)');
      tail.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = tail;
      ctx.beginPath(); ctx.arc(bx, by, 14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  private panel(x: number, y: number, w: number, h: number): void {
    this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(this.ctx, x, y, w, h, 10);
    this.ctx.fill();
  }

  private drawHud(game: Game): void {
    const leader = game.cars.slice().sort((a, b) => b.progress - a.progress)[0];
    game.cars.forEach((c, i) => {
      const x = i === 0 ? 16 : W - 16 - 250;
      this.panel(x, 14, 250, 118);
      const label = c.controller === 'cpu' ? `${c.def.name} (CPU)` : c.def.name;
      this.text(label, x + 16, 36, 22, c.def.color, 'left');
      if (game.state === 'race' && c === leader) this.text('P1', x + 234, 36, 22, '#ffd54f', 'right');
      const lap = Math.min(c.laps + 1, LAPS);
      this.text(`LAP ${lap}/${LAPS}`, x + 16, 64, 20, '#fff', 'left');
      const cur = game.state === 'race' && !c.finished ? game.clock - c.lapStart : (c.lapTimes[c.lapTimes.length - 1] ?? null);
      this.text(fmt(cur), x + 234, 64, 20, '#fff', 'right', '700');
      this.text(`BEST ${fmt(c.best)}`, x + 16, 90, 15, '#bbb', 'left', '700');
      if (c.turbo > 0) this.text('TURBO!', x + 234, 90, 15, '#ffb347', 'right');
      else if (c.oilTimer > 0) this.text('OIL!', x + 234, 90, 15, '#b388ff', 'right');
      const item = c.item ? ITEM_LABEL[c.item] : '—';
      const key = c.controller === 'cpu' || !c.item ? '' : `  [${game.mode === 1 ? '/ or SPACE' : i === 0 ? '/' : 'E'}]`;
      this.text(`ITEM  ${item}${key}`, x + 16, 116, 15, c.item ? '#ffe066' : '#777', 'left', '700');
    });
  }

  /** Floating "WRONG WAY" and respawn hint above cars that are in trouble. */
  private drawCarWarnings(game: Game, now: number): void {
    const blink = Math.floor(now / 300) % 2 === 0;
    game.cars.forEach((c, i) => {
      if (!c.needsHelp || c.finished) return;
      if (c.wrongWay && blink) this.text('WRONG WAY', c.x, c.y - 34, 20, '#ff5252');
      if (c.controller !== 'cpu') {
        const key = game.mode === 1 || i === 0 ? 'R-SHIFT' : 'L-SHIFT';
        this.text(`${key}: respawn`, c.x, c.y + 32, 14, '#fff', 'center', '700');
      }
    });
  }

  private trackLabel(game: Game): string {
    const kind = game.track.layout === 'figure8' ? '  ·  FIGURE-8' : '';
    return `TRACK #${game.track.seed}${kind}  ·  ${game.track.theme.label}`;
  }

  private drawMenu(game: Game): void {
    this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this.ctx.fillRect(0, 0, W, H);
    this.text(GAME_TITLE.toUpperCase(), W / 2, H / 2 - 190, 96, '#ffd54f');
    this.text(`First to ${LAPS} laps wins`, W / 2, H / 2 - 115, 28, '#fff', 'center', '700');

    this.panel(W / 2 - 360, H / 2 - 75, 720, 310);
    this.text('[1]  Player vs CPU', W / 2, H / 2 - 35, 34);
    this.text('[2]  Two players', W / 2, H / 2 + 15, 34);
    this.text(`[N]  New track      [L]  Copy link to track #${game.track.seed}`, W / 2, H / 2 + 62, 22, '#ccc', 'center', '700');
    const diff = settings.difficulty.toUpperCase();
    const catchUp = settings.catchUp ? 'ON' : 'OFF';
    this.text(`[D]  CPU: ${diff}        [C]  Catch-up: ${catchUp}`, W / 2, H / 2 + 102, 22, '#ccc', 'center', '700');
    this.text('RED: Arrows,  / item,  R-Shift respawn      BLUE: WASD,  E item,  L-Shift respawn', W / 2, H / 2 + 160, 17, '#aaa', 'center', '700');
    this.text('Grab ? crates for a TURBO or an OIL DROP    ·    M: mute    ESC: menu', W / 2, H / 2 + 184, 16, '#aaa', 'center', '700');
    this.text('Tip: brake + steer at speed to throw the car into a slide. Avoid the oil!', W / 2, H / 2 + 210, 16, '#888', 'center', '600');
  }

  private drawCountdown(clock: number): void {
    const n = Math.ceil(-clock);
    const frac = -clock - Math.floor(-clock);
    const size = 120 + frac * 60;
    this.text(String(n), W / 2, H / 2, size, n === 1 ? '#66bb6a' : n === 2 ? '#ffca28' : '#ef5350');
  }

  private drawFinished(game: Game): void {
    const winner = game.winner;
    if (!winner) return;
    this.ctx.fillStyle = 'rgba(0,0,0,0.5)';
    this.ctx.fillRect(0, 0, W, H);
    this.text(`${winner.def.name} WINS!`, W / 2, H / 2 - 120, 100, winner.def.color);
    this.text(`Race time ${fmt(winner.finishTime)}`, W / 2, H / 2 - 40, 30, '#fff', 'center', '700');
    game.cars.forEach((c, i) => {
      const y = H / 2 + 20 + i * 36;
      this.text(`${c.def.name}  ·  laps ${Math.min(c.laps, LAPS)}/${LAPS}  ·  best lap ${fmt(c.best)}`, W / 2, y, 22, c.def.color, 'center', '700');
    });
    this.text('ENTER: rematch    N: new track    L: copy link    ESC: menu', W / 2, H / 2 + 140, 22, '#ddd', 'center', '700');
  }
}
