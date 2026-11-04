/**
 * Small synthesized space: a ground reflection, a handful of early
 * reflections with different left/right times, and a short diffuse tail from
 * two Schroeder allpasses. Cheap and gives depth without washing out pulses.
 */
import { Delay, OnePole } from './dsp';

const TAPS_MS_L = [2.6, 7.3, 11.9, 17.4, 24.1, 33.7];
const TAPS_MS_R = [2.9, 8.6, 13.1, 19.8, 27.5, 37.2];
const TAPS_G = [0.45, 0.24, 0.18, 0.13, 0.09, 0.06];

class Allpass {
  d: Delay;
  n: number;
  g: number;
  constructor(n: number, g: number) {
    this.d = new Delay(n + 2);
    this.n = n;
    this.g = g;
  }
  process(x: number): number {
    const z = this.d.read(this.n);
    const v = x + this.g * z;
    this.d.write(v);
    return z - this.g * v;
  }
}

export class Room {
  private dl: Delay;
  private dr: Delay;
  private tl: number[];
  private tr: number[];
  private lpL = new OnePole();
  private lpR = new OnePole();
  private apL: Allpass[];
  private apR: Allpass[];
  mix = 0.32;
  outL = 0;
  outR = 0;
  constructor(fs: number) {
    const max = Math.ceil(0.045 * fs);
    this.dl = new Delay(max);
    this.dr = new Delay(max);
    this.tl = TAPS_MS_L.map((m) => (m / 1000) * fs);
    this.tr = TAPS_MS_R.map((m) => (m / 1000) * fs);
    this.lpL.setCutoff(4500, fs);
    this.lpR.setCutoff(4200, fs);
    const s = fs / 48000;
    this.apL = [new Allpass(Math.round(347 * s), 0.6), new Allpass(Math.round(911 * s), 0.55)];
    this.apR = [new Allpass(Math.round(389 * s), 0.6), new Allpass(Math.round(997 * s), 0.55)];
  }
  process(l: number, r: number) {
    this.dl.write(l);
    this.dr.write(r);
    let el = 0;
    let er = 0;
    for (let i = 0; i < TAPS_G.length; i++) {
      // Cross-feed alternate taps so each side hears the other source too.
      const g = TAPS_G[i];
      if (i & 1) {
        el += g * this.dr.read(this.tl[i]);
        er += g * this.dl.read(this.tr[i]);
      } else {
        el += g * this.dl.read(this.tl[i]);
        er += g * this.dr.read(this.tr[i]);
      }
    }
    el = this.lpL.process(el);
    er = this.lpR.process(er);
    for (const a of this.apL) el = a.process(el);
    for (const a of this.apR) er = a.process(er);
    this.outL = l + this.mix * el;
    this.outR = r + this.mix * er;
  }
}
