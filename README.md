# Greasy Laps

A top-down arcade racer for one or two players that runs in the browser. Every race is on a randomly generated track, and the first car to finish 5 laps wins.

Built with TypeScript and an HTML canvas, bundled with [Vite](https://vite.dev). There are no runtime dependencies, and every sound is synthesized with the Web Audio API.

## Run it with Docker Compose

You only need [Docker](https://docs.docker.com/get-docker/), not Node or Yarn.

```sh
docker compose up --build
```

Open <http://localhost:8080>. This builds the game and serves it with nginx. To stop it, press `Ctrl+C`, or run `docker compose down` if you started it with `-d`.

### Dev server with hot reload

```sh
docker compose --profile dev up dev
```

Open <http://localhost:5173>. Your local files are mounted into the container, so the page reloads when you edit code in `src/`.

## Run it with Yarn

Requirements: Node.js 20.19+ or 22.12+ with Corepack. Corepack ships with Node and provides the Yarn 4 version pinned in `package.json`.

```sh
corepack enable    # one-time: makes the `yarn` command use the pinned Yarn 4
yarn install
yarn dev           # dev server at http://localhost:5173
```

| Command          | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `yarn dev`       | Starts the dev server with hot reload                  |
| `yarn build`     | Type-checks, then builds a static bundle into `dist/`  |
| `yarn preview`   | Serves the built `dist/` folder locally                |
| `yarn typecheck` | Runs the TypeScript compiler without emitting files    |

`dist/` is plain static files, so you can host it on any static web server.

## How to play

| Action            | Red          | Blue    |
| ----------------- | ------------ | ------- |
| Accelerate        | `↑`          | `W`     |
| Brake / reverse   | `↓`          | `S`     |
| Steer             | `←` `→`      | `A` `D` |

On the menu, press `1` for player vs CPU or `2` for two players on one keyboard. In player-vs-CPU mode, Red can use either the arrow keys or WASD.

| Key     | Where          | Action                         |
| ------- | -------------- | ------------------------------ |
| `N`     | Menu, results  | Generate a new random track    |
| `Enter` | Results        | Rematch on the same track      |
| `Esc`   | In a race      | Back to the menu               |
| `M`     | Anywhere       | Mute or unmute                 |

Tips:
- Braking and steering together at speed throws the car into a slide.
- Grass slows you down a lot, so stay on the asphalt.
- Oil slicks take away almost all grip for about a second.

## Project layout

```
src/
  main.ts       Entry point: canvas setup and the fixed-timestep game loop
  game.ts       Game state machine (menu → countdown → race → finished)
  car.ts        Car physics, CPU driver, lap counting, car-to-car collisions
  track.ts      Random track generation (spline loop + validity checks)
  layers.ts     Pre-rendered scenery and the persistent skid-mark layer
  render.ts     HUD, menus and the per-frame drawing
  sound.ts      Web Audio synth: engines, beeps, thuds
  input.ts      Keyboard state and per-player controls
  particles.ts  Dust and tyre smoke
  config.ts     Game title and tuning constants
```

To rename the game, change `GAME_TITLE` in `src/config.ts` and the `<title>` in `index.html`. To change how the cars handle, edit the `accel`, `drag`, `grip` and `turnRate` values in `Car.update` in `src/car.ts`.
