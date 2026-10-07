import { GAME_TITLE, H, LAPS, W } from './config';
import { settings } from './settings';
import type { Game } from './game';
import { bridgeLayer, skidLayer, trackLayer } from './layers';
import { drawParticles, drawSparks } from './particles';
import { shakeOffset } from './shake';
import { sound } from './sound';
import { roundRect } from './util';

function fmt(t: number | null | undefined): string {
  if (t === null || t === undefined || t < 0) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export class Renderer {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}

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
    drawParticles(ctx);
    // Figure-eights: cars on the lower road go under the bridge deck, cars on the deck over it.
    for (const c of game.cars) if (!c.onBridge) c.draw(ctx);
    ctx.drawImage(bridgeLayer, 0, 0);
    for (const c of game.cars) if (c.onBridge) c.draw(ctx);
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

  private panel(x: number, y: number, w: number, h: number): void {
    this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(this.ctx, x, y, w, h, 10);
    this.ctx.fill();
  }

  private drawHud(game: Game): void {
    const leader = game.cars.slice().sort((a, b) => b.progress - a.progress)[0];
    game.cars.forEach((c, i) => {
      const x = i === 0 ? 16 : W - 16 - 250;
      this.panel(x, 14, 250, 92);
      const label = c.controller === 'cpu' ? `${c.def.name} (CPU)` : c.def.name;
      this.text(label, x + 16, 36, 22, c.def.color, 'left');
      if (game.state === 'race' && c === leader) this.text('P1', x + 234, 36, 22, '#ffd54f', 'right');
      const lap = Math.min(c.laps + 1, LAPS);
      this.text(`LAP ${lap}/${LAPS}`, x + 16, 64, 20, '#fff', 'left');
      const cur = game.state === 'race' && !c.finished ? game.clock - c.lapStart : (c.lapTimes[c.lapTimes.length - 1] ?? null);
      this.text(fmt(cur), x + 234, 64, 20, '#fff', 'right', '700');
      this.text(`BEST ${fmt(c.best)}`, x + 16, 90, 15, '#bbb', 'left', '700');
      if (c.oilTimer > 0) this.text('OIL!', x + 234, 90, 15, '#b388ff', 'right');
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
    return `TRACK #${game.track.seed}${kind}`;
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
    this.text('RED: Arrows, R-Shift respawn    BLUE: WASD, L-Shift respawn', W / 2, H / 2 + 160, 18, '#aaa', 'center', '700');
    this.text('M: mute    ESC: menu', W / 2, H / 2 + 184, 16, '#aaa', 'center', '700');
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
