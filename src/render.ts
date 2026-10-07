import { GAME_TITLE, H, LAPS, W } from './config';
import type { Game } from './game';
import { skidLayer, trackLayer } from './layers';
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

  draw(game: Game): void {
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
    for (const c of game.cars) c.draw(ctx);
    drawSparks(ctx);
    ctx.restore();

    if (game.state === 'menu') this.drawMenu();
    else {
      this.drawHud(game);
      if (game.state === 'countdown') this.drawCountdown(game.clock);
      if (game.state === 'race' && game.clock < 0.8) this.text('GO!', W / 2, H / 2, 160, '#66bb6a');
      if (game.state === 'finished') this.drawFinished(game);
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

  private drawMenu(): void {
    this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this.ctx.fillRect(0, 0, W, H);
    this.text(GAME_TITLE.toUpperCase(), W / 2, H / 2 - 170, 96, '#ffd54f');
    this.text(`First to ${LAPS} laps wins`, W / 2, H / 2 - 95, 28, '#fff', 'center', '700');

    this.panel(W / 2 - 330, H / 2 - 55, 660, 250);
    this.text('[1]  Player vs CPU', W / 2, H / 2 - 15, 34);
    this.text('[2]  Two players', W / 2, H / 2 + 35, 34);
    this.text('[N]  New random track', W / 2, H / 2 + 85, 26, '#ccc', 'center', '700');
    this.text('RED: Arrow keys    BLUE: W A S D    ·    M: mute    ESC: menu', W / 2, H / 2 + 150, 18, '#aaa', 'center', '700');
    this.text('Tip: brake + steer at speed to throw the car into a slide. Avoid the oil!', W / 2, H / 2 + 175, 16, '#888', 'center', '600');
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
    this.text('ENTER: rematch    N: new track    ESC: menu', W / 2, H / 2 + 140, 22, '#ddd', 'center', '700');
  }
}
