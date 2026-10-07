import './style.css';
import { DT, GAME_TITLE, H, W } from './config';
import { Game } from './game';
import { onKeyPress } from './input';
import { Renderer } from './render';
import { parseSeed } from './rng';
import { seedFromUrl } from './share';
import { sound } from './sound';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const renderer = new Renderer(canvas.getContext('2d')!);
document.title = GAME_TITLE;

function resize(): void {
  const s = Math.min(innerWidth / W, innerHeight / H);
  canvas.style.width = `${W * s}px`;
  canvas.style.height = `${H * s}px`;
}
addEventListener('resize', resize);
resize();

const game = new Game(seedFromUrl() ?? undefined);

// Pasting a track link (or editing the #code in the address bar) loads that track.
addEventListener('hashchange', () => {
  const seed = parseSeed(location.hash);
  if (seed !== null) game.loadTrack(seed);
});

// Unlock audio before the game reacts, so the first race already has engine sounds.
onKeyPress(() => sound.unlock());
onKeyPress(code => game.handleKey(code));

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= DT) { game.step(); acc -= DT; }
  renderer.draw(game, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
