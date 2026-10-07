import { makeRng } from './rng';

export type ThemeName = 'grass' | 'snow' | 'desert' | 'night';

/** How the car handles on the road and off it. */
export interface Surface {
  roadGrip: number;   // lateral grip on asphalt (per second)
  offAccel: number;   // engine acceleration off the road
  offDrag: number;    // drag off the road (terminal speed ≈ offAccel / offDrag)
  offGrip: number;    // lateral grip off the road
}

export interface Theme {
  name: ThemeName;
  label: string;
  ground: string;
  groundNoise: [string, string];
  stripes: boolean;            // mowing stripes
  asphalt: string;
  decor: 'trees' | 'pines' | 'cacti';
  surface: Surface;
  offroadDust: string;
  offroadSkid: string;
  /** Scales how fast the CPU dares to corner (lower on slippery themes). */
  cpuCorner: number;
  dark: boolean;               // night: darkness + headlights
}

const GRASS_SURFACE: Surface = { roadGrip: 4.2, offAccel: 330, offDrag: 2.6, offGrip: 3.2 };

export const THEMES: Record<ThemeName, Theme> = {
  grass: {
    name: 'grass', label: 'GRASS',
    ground: '#3f8f3a', groundNoise: ['rgba(20,60,20,0.25)', 'rgba(140,200,110,0.18)'], stripes: true,
    asphalt: '#555a60', decor: 'trees', surface: GRASS_SURFACE,
    offroadDust: '#7a5a32', offroadSkid: 'rgba(60,40,20,0.22)', cpuCorner: 1, dark: false,
  },
  snow: {
    name: 'snow', label: 'SNOW',
    ground: '#e8eef6', groundNoise: ['rgba(150,170,200,0.22)', 'rgba(255,255,255,0.6)'], stripes: false,
    asphalt: '#646c78', decor: 'pines',
    surface: { roadGrip: 2.9, offAccel: 300, offDrag: 3.0, offGrip: 2.2 },
    offroadDust: '#ffffff', offroadSkid: 'rgba(110,125,150,0.3)', cpuCorner: 0.86, dark: false,
  },
  desert: {
    name: 'desert', label: 'DESERT',
    ground: '#d8b878', groundNoise: ['rgba(150,110,60,0.22)', 'rgba(255,235,190,0.25)'], stripes: false,
    asphalt: '#5f5a55', decor: 'cacti',
    surface: { roadGrip: 4.0, offAccel: 270, offDrag: 3.4, offGrip: 2.6 },
    offroadDust: '#c9a063', offroadSkid: 'rgba(120,80,40,0.25)', cpuCorner: 1, dark: false,
  },
  night: {
    name: 'night', label: 'NIGHT',
    ground: '#2f6e2c', groundNoise: ['rgba(10,40,10,0.3)', 'rgba(120,180,100,0.12)'], stripes: true,
    asphalt: '#4d5258', decor: 'trees', surface: GRASS_SURFACE,
    offroadDust: '#6b5030', offroadSkid: 'rgba(40,30,15,0.3)', cpuCorner: 1, dark: true,
  },
};

const WEIGHTS: [ThemeName, number][] = [['grass', 0.4], ['snow', 0.2], ['desert', 0.2], ['night', 0.2]];

/** The theme belongs to the track code, so a shared link keeps its theme. */
export function themeFor(seed: number): Theme {
  // Own random stream, so adding themes never changes track layouts.
  let r = makeRng(seed ^ 0x27d4eb2d).next();
  for (const [name, w] of WEIGHTS) {
    if ((r -= w) < 0) return THEMES[name];
  }
  return THEMES.grass;
}
