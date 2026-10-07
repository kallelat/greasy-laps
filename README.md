# Greasy Laps

A top-down arcade racer for one or two players that runs in the browser. Every race is on a randomly generated track, and the first car to finish 5 laps wins.

Tracks are loops or figure-eights with a bridge, with wider and narrower stretches, in one of four themes: grass, snow, desert or night. Each track has a code, such as `#482113`. Open the game at `…/#482113`, or press `L` to copy a link, and anyone gets exactly the same track.

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
| Use item          | `/` or `.`   | `E`     |
| Respawn           | Right `Shift` or `Enter` | Left `Shift` or `Q` |

On the menu, press `1` for player vs CPU or `2` for two players on one keyboard. In player-vs-CPU mode, Red can use either key set, and `Space` also uses the item.

| Key     | Where          | Action                         |
| ------- | -------------- | ------------------------------ |
| `N`     | Menu, results  | Generate a new random track    |
| `L`     | Menu, results  | Copy a link to the current track |
| `D`     | Menu           | CPU difficulty: Easy, Normal or Hard |
| `C`     | Menu           | Turn catch-up on or off        |
| `Enter` | Results        | Rematch on the same track      |
| `Esc`   | In a race      | Back to the menu               |
| `M`     | Anywhere       | Mute or unmute                 |

Tips:
- Braking and steering together at speed throws the car into a slide.
- Grass slows you down a lot, so stay on the asphalt.
- Oil slicks take away almost all grip for about a second.
- Drive through a **? crate** to get an item. You can hold one at a time, and the crate comes back after 4 seconds.
  - **Turbo:** 1.6 seconds of extra power and top speed. Save it for a straight.
  - **Oil drop:** leaves an oil slick behind you for 12 seconds. Use it when someone is right on your tail.
- Each theme drives differently:
  - **Snow:** less grip on the road, and deep snow off it.
  - **Desert:** sand slows you down even more than grass.
  - **Night:** you only see what your headlights and the floodlights light up.

  The theme belongs to the track code, so a shared link keeps it.
- On figure-eights, the cars on the bridge and the cars underneath can't hit each other.
- The track is lined with tyre walls. Hitting them hard bounces you off and costs speed.
- If you spin out, get stuck or drive the wrong way, press your respawn key. You go back on the track a few metres behind where you were, see-through for 1.5 seconds so you can't be hit. You can respawn at most once every 2 seconds. CPU cars respawn on their own.
- With **catch-up** on (the default), the trailing car gets up to 16% extra engine power, so races stay close. A trailing CPU also takes corners a bit faster.

Difficulty and catch-up are saved in your browser.

## Project layout

```
src/
  main.ts       Entry point: canvas setup and the fixed-timestep game loop
  game.ts       Game state machine (menu → countdown → race → finished)
  car.ts        Car physics, CPU driver, lap counting, car-to-car collisions
  track.ts      Track generation from a seed: loops, figure-eights, bridges, walls
  themes.ts     Grass, snow, desert and night: colours, scenery, handling
  pickups.ts    Crates, items (turbo, oil drop) and the CPU's item use
  rng.ts        Seeded random numbers, so a track code always gives the same track
  share.ts      Track code in the URL and copy-link
  layers.ts     Pre-rendered scenery, bridge deck and the persistent skid-mark layer
  render.ts     HUD, menus and the per-frame drawing
  sound.ts      Web Audio synth: engines, beeps, thuds
  input.ts      Keyboard state and per-player controls
  particles.ts  Dust and tyre smoke
  settings.ts   CPU difficulty and catch-up settings (saved in localStorage)
  shake.ts      Screen shake
  config.ts     Game title and tuning constants
```

To rename the game, change `GAME_TITLE` in `src/config.ts` and the `<title>` in `index.html`. To change how the cars handle, edit the `accel`, `drag`, `grip` and `turnRate` values in `Car.update` in `src/car.ts`.
