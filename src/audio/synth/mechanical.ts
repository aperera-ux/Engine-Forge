/**
 * Mechanical noise: valve-seating ticks into modal resonators (pushrod: lower,
 * longer, clattery; DOHC: finer and higher), a subtle cam-drive chain whine,
 * a soft combustion "knock" into block modes at each firing and occasional
 * knock pings at the first circumferential bore modes (1.84 and 3.05 ·c/πB)
 * when the sim reports knock retard.
 */
import type { EngineSoundParams } from '../params';
import { Biquad, Mode, Rng, TAU, clamp, smoothstep } from './dsp';

export class Mechanical {
  private fs: number;
  private valveModes: Mode[] = [];
  private valveGains: number[] = [];
  private blockModes: Mode[] = [];
  private pingModes: Mode[] = [];
  private pingOk = true;
  private rng = new Rng(0x7a11);
  private chainPh = 0;
  private chainTeeth = 21;
  private pushrod: boolean;
  private hp = new Biquad();
  /** Pending impulses (sample-accurate enough at this level). */
  private valveImp = 0;
  private blockImp = 0;
  private pingImp = 0;
  out = 0;

  constructor(p: EngineSoundParams, fs: number) {
    this.fs = fs;
    this.pushrod = p.valvetrain === 'pushrod';
    const vm = this.pushrod
      ? [
          [1650, 0.0025, 1],
          [2850, 0.0018, 0.7],
          [4300, 0.0012, 0.5],
          [6100, 0.0008, 0.3],
        ]
      : p.valvetrain === 'sohc'
        ? [
            [2900, 0.0015, 1],
            [4700, 0.001, 0.6],
            [7200, 0.0007, 0.35],
          ]
        : [
            [3800, 0.0012, 1],
            [5900, 0.0009, 0.6],
            [8600, 0.0006, 0.35],
          ];
    for (const [f, d, g] of vm) {
      const m = new Mode();
      m.set(f, d, fs);
      this.valveModes.push(m);
      this.valveGains.push(g);
    }
    // Block / head structural modes (scale gently with engine size).
    const sz = Math.pow(p.displacementL / 3, -0.15);
    for (const [f, d] of [
      [620, 0.004],
      [1150, 0.003],
      [1900, 0.002],
    ]) {
      const m = new Mode();
      m.set(f * sz, d, fs);
      this.blockModes.push(m);
    }
    // Knock: first two circumferential acoustic modes of the bore (burned gas c ≈ 950 m/s).
    const cB = 950;
    const f1 = (1.841 * cB) / (Math.PI * p.boreM);
    const f2 = (3.054 * cB) / (Math.PI * p.boreM);
    this.pingOk = f1 < fs * 0.42;
    for (const [f, d] of [
      [f1, 0.0018],
      [Math.min(f2, fs * 0.44), 0.0012],
    ]) {
      const m = new Mode();
      m.set(f, d, fs);
      this.pingModes.push(m);
    }
    this.hp.highpass(400, 0.7, fs);
  }

  /** A valve seats; `vel` ~ seating velocity (∝ rpm). */
  valveClose(vel: number) {
    const j = this.pushrod ? 0.5 + this.rng.next() : 0.8 + 0.4 * this.rng.next();
    this.valveImp += vel * j;
  }
  /** Combustion at a firing TDC; strength ∝ pressure rise. */
  combustion(strength: number) {
    this.blockImp += strength;
  }
  ping(strength: number) {
    if (this.pingOk) this.pingImp += strength;
  }

  step(rpm: number): number {
    const fs = this.fs;
    let v = 0;
    const vi = this.valveImp;
    this.valveImp = 0;
    for (let i = 0; i < this.valveModes.length; i++) v += this.valveGains[i] * this.valveModes[i].process(vi);
    let b = 0;
    const bi = this.blockImp;
    this.blockImp = 0;
    for (let i = 0; i < this.blockModes.length; i++) b += this.blockModes[i].process(bi);
    let k = 0;
    const ki = this.pingImp;
    this.pingImp = 0;
    for (let i = 0; i < this.pingModes.length; i++) k += this.pingModes[i].process(ki) * (i === 0 ? 1 : 0.6);
    // Chain whine at crank sprocket tooth-pass, AM'd by cam torque.
    const fc = (rpm / 60) * this.chainTeeth;
    this.chainPh = (this.chainPh + fc / fs) % 1;
    const chain = Math.sin(TAU * this.chainPh) * 0.0025 * clamp(rpm / 7000, 0, 1.3) ** 2 * (1 - smoothstep(0.36 * fs, 0.45 * fs, fc));
    this.out = this.hp.process(v * (this.pushrod ? 0.06 : 0.035) + b * 0.03) + k * 0.12 + chain;
    return this.out;
  }
}
