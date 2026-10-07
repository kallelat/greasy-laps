import { clamp } from './util';

/** Per-car looping sounds: engine tone, tyre squeal and off-road rumble. */
export interface CarVoice {
  osc: OscillatorNode;
  gain: GainNode;
  filt: BiquadFilterNode;
  noise: AudioBufferSourceNode;
  squealGain: GainNode;
  squealFilt: BiquadFilterNode;
  rumbleGain: GainNode;
}

export interface CarSoundState {
  speed: number;
  throttle: boolean;
  pitchOffset: number;
  squeal: number;  // 0..1 tyre squeal intensity
  rumble: number;  // 0..1 off-road rumble intensity
}

/** Tiny WebAudio synth — every sound is generated, no audio files. */
class SoundSystem {
  ac: AudioContext | null = null;
  muted = false;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voices: CarVoice[] = [];

  /** Browsers only allow audio after a user gesture, so call this on the first key press. */
  unlock(): void {
    if (this.ac) return;
    try { this.ac = new AudioContext(); } catch { return; }
    this.master = this.ac.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ac.destination);

    // Two seconds of white noise, shared by every noise-based sound.
    const len = this.ac.sampleRate * 2;
    this.noiseBuffer = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  carVoice(): CarVoice | null {
    if (!this.ac || !this.master || !this.noiseBuffer) return null;
    const ac = this.ac;

    // Engine: low-passed sawtooth.
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    const filt = ac.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 600;
    const gain = ac.createGain();
    gain.gain.value = 0;
    osc.connect(filt).connect(gain).connect(this.master);
    osc.start();

    // One looping noise source feeds both the squeal and the rumble.
    const noise = ac.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    noise.loopStart = Math.random(); // decorrelate the two cars

    // Squeal: a narrow band-pass turns noise into a whistly tyre screech.
    const squealFilt = ac.createBiquadFilter();
    squealFilt.type = 'bandpass';
    squealFilt.frequency.value = 1800;
    squealFilt.Q.value = 14;
    const squealGain = ac.createGain();
    squealGain.gain.value = 0;
    noise.connect(squealFilt).connect(squealGain).connect(this.master);

    // Rumble: low-passed noise for gravel and grass.
    const rumbleFilt = ac.createBiquadFilter();
    rumbleFilt.type = 'lowpass';
    rumbleFilt.frequency.value = 260;
    const rumbleGain = ac.createGain();
    rumbleGain.gain.value = 0;
    noise.connect(rumbleFilt).connect(rumbleGain).connect(this.master);

    noise.start(0, noise.loopStart);

    const v = { osc, gain, filt, noise, squealGain, squealFilt, rumbleGain };
    this.voices.push(v);
    return v;
  }

  updateCarVoice(v: CarVoice, s: CarSoundState): void {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const on = this.muted ? 0 : 1;
    v.gain.gain.setTargetAtTime(on * (0.06 + (s.throttle ? 0.05 : 0)), t, 0.05);
    v.osc.frequency.setTargetAtTime(55 + s.speed * 0.32 + s.pitchOffset, t, 0.05);
    v.filt.frequency.setTargetAtTime(400 + s.speed * 2, t, 0.05);

    // Fast attack, slower release so short slides still register.
    const squeal = on * s.squeal * 0.55;
    v.squealGain.gain.setTargetAtTime(squeal, t, squeal > v.squealGain.gain.value ? 0.02 : 0.08);
    v.squealFilt.frequency.setTargetAtTime(1500 + s.squeal * 900 + Math.random() * 120, t, 0.03);

    v.rumbleGain.gain.setTargetAtTime(on * s.rumble * 0.9, t, 0.06);
  }

  stopCarVoices(): void {
    for (const v of this.voices) {
      try { v.osc.stop(); v.noise.stop(); } catch { /* already stopped */ }
    }
    this.voices = [];
  }

  beep(freq: number, dur = 0.15, type: OscillatorType = 'square', vol = 0.25): void {
    if (!this.ac || !this.master || this.muted) return;
    const t = this.ac.currentTime;
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  /** Short filtered noise burst; `sweepTo` slides the filter for a "splat" or "crunch". */
  private noiseBurst(freq: number, sweepTo: number, q: number, dur: number, vol: number): void {
    if (!this.ac || !this.master || !this.noiseBuffer || this.muted) return;
    const t = this.ac.currentTime;
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ac.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  /** Impact: a low thud, plus a metallic crunch on harder hits. `force` is 0..1. */
  hit(force: number): void {
    const f = clamp(force, 0, 1);
    this.beep(70 + Math.random() * 30, 0.12, 'triangle', 0.08 + f * 0.35);
    if (f > 0.25) this.noiseBurst(3000, 900, 2, 0.12 + f * 0.15, f * 0.5);
  }

  /** Rising arpeggio for grabbing a crate. */
  pickup(): void {
    [660, 880, 1320].forEach((f, i) => setTimeout(() => this.beep(f, 0.08, 'triangle', 0.18), i * 55));
  }

  /** Turbo: a rising rush of filtered noise. */
  whoosh(): void {
    this.noiseBurst(300, 2600, 1.5, 0.6, 0.45);
  }

  /** Crowd roar: a swell of band-passed noise. */
  cheer(): void {
    if (!this.ac || !this.master || !this.noiseBuffer || this.muted) return;
    const t = this.ac.currentTime;
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 0.8;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 3);
  }

  /** Firework burst. */
  pop(): void {
    this.noiseBurst(1800, 300, 1, 0.35, 0.3);
  }

  /** Wet slap when a car drives into an oil slick. */
  splat(): void {
    this.noiseBurst(1400, 200, 3, 0.25, 0.35);
  }
}

export const sound = new SoundSystem();
