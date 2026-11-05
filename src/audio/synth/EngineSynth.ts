/**
 * EngineSynth: the pure-TS DSP core shared by the AudioWorklet (live) and the
 * offline renderer. No DOM / WebAudio dependency.
 *
 *   crank clock θ (integrated at audio rate, never re-triggered from wall clock)
 *     → per cylinder 0-D blowdown model between EVO and EVC: isentropic
 *       cylinder gas discharging through the exhaust valve curtain area
 *       (compressible orifice flow, choked/unchoked), piston displacement from
 *       slider-crank kinematics, back-pressure from the waveguide at the port.
 *       Injected wave p⁺ = ṁ·c / A_pipe (volume velocity × pipe impedance).
 *     → exhaust waveguide network (exhaust.ts) → outlets
 *     → radiation (d/dt, monopole) + jet/turbulence noise ∝ outflow
 *   + intake suction into runner / plenum / trumpets (induction.ts)
 *   + turbo / supercharger (induction.ts), mechanical (mechanical.ts)
 *   + events: rev limiter cut, overrun DFCO + afterfire pops, idle lope
 *   → pan per outlet (bank A left, bank B right) → room → limiter.
 */
import type { EngineSoundParams } from '../params';
import { tableAt } from '../params';
import { Biquad, DcBlock, Delay, OnePole, Rng, clamp, smoothstep, softClip } from './dsp';
import { ExhaustNetwork } from './exhaust';
import { Induction, type InductionInput } from './induction';
import { Mechanical } from './mechanical';
import { Room } from './room';

export interface EngineState {
  rpm: number;
  /** 0..1 engine load / throttle (the app's "load"). */
  load: number;
  /** Throttle 0..1; defaults to load. */
  throttle?: number;
  /** Override boost (bar gauge); otherwise the synth's own spool model follows the sim curve. */
  boostBar?: number;
  running?: boolean;
  /** Master volume 0..1 (default 1). */
  volume?: number;
}

export interface SynthOptions {
  seed?: number;
  /** Room/early reflections (default true). */
  room?: boolean;
  /** Only the exhaust (no intake / FI / mechanical / room), hard-panned outlets: for analysis. */
  exhaustOnly?: boolean;
}

export interface SynthStats {
  rpm: number;
  boostBar: number;
  shaftRpm: number;
  wastegate: number;
  limiter: boolean;
  dfco: boolean;
  pops: number;
  cycles: number;
  cutCycles: number;
  knockPings: number;
  egtC: number;
  peak: number;
  /** Max acoustic pressure seen at a port, bar (diagnostic). */
  maxPortBar: number;
  /** Peak level before the limiter (diagnostic). */
  preLimPeak: number;
  bov: number;
}

const GAMMA = 1.33;
const R_GAS = 288;
const BLOCK = 32;

interface Pop {
  t: number;
  att: number;
  dec: number;
  amp: number;
  pipe: number;
  delay: number;
  active: boolean;
}

/** Compressible orifice flow function Ψ(pr), pr = p_down / p_up ∈ [0,1]. */
function buildPsiLut(n: number): Float64Array {
  const lut = new Float64Array(n + 1);
  const g = GAMMA;
  const crit = Math.pow(2 / (g + 1), g / (g - 1));
  const choked = Math.sqrt(g * Math.pow(2 / (g + 1), (g + 1) / (g - 1)));
  for (let i = 0; i <= n; i++) {
    const pr = i / n;
    const v = pr <= crit ? choked : Math.sqrt(((2 * g) / (g - 1)) * (Math.pow(pr, 2 / g) - Math.pow(pr, (g + 1) / g)));
    // Regularise the infinite slope at pr → 1 so the port back-pressure feedback stays stable.
    const e = 1 - pr;
    lut[i] = v * (e / (e + 0.015));
  }
  return lut;
}
const PSI_N = 1024;
const PSI = buildPsiLut(PSI_N);
const psi = (pr: number) => {
  const x = clamp(pr, 0, 1) * PSI_N;
  const i = x | 0;
  return i >= PSI_N ? 0 : PSI[i] + (PSI[i + 1] - PSI[i]) * (x - i);
};

export class EngineSynth {
  readonly fs: number;
  private opts: SynthOptions;
  private p: EngineSoundParams | null = null;
  private pending: EngineSoundParams | null = null;
  private swapGain = 1;
  private rng: Rng;
  private net!: ExhaustNetwork;
  private ind!: Induction;
  private mech!: Mechanical;
  private room: Room;

  // targets
  private tRpm = 800;
  private tLoad = 0.2;
  private tThrottle = 0.2;
  private tBoost: number | undefined;
  private tRunning = true;
  private tVolume = 1;
  // smoothed
  private rpm = 800;
  private rpmPrev = 800;
  private thr = 0.2;
  private load = 0.2;
  private map = 0.3;
  private egtK = 900;
  private runGain = 1;
  private vol = 1;
  private theta = 0;
  private time = 0;

  // per-cylinder state
  private nCyl = 0;
  private phase!: Float64Array; // firing phase + static timing offset
  private prevPh!: Float64Array;
  private exOpen!: Uint8Array;
  private inOpen!: Uint8Array;
  private fired!: Uint8Array;
  private pEvoCyc!: Float64Array;
  private jit!: Float64Array;
  private staticGain!: Float64Array;
  private pc!: Float64Array;
  private mRef!: Float64Array;
  private rhoRef!: Float64Array;
  private pRef!: Float64Array;
  private tRef!: Float64Array;
  private mGas!: Float64Array;
  private cylBank!: Uint8Array;
  private popPipe!: Int32Array;
  private primArea!: Float64Array;
  private portLp!: Float64Array;
  private srcGain!: Float64Array;
  private srcPrev!: Float64Array;
  /** Same-system close-pulse interaction factor (research §2.3). */
  private interact!: Float64Array;
  private suction = new Float64Array(2);
  private reversion = new Float64Array(2);
  // V(θ) lookup over 0..360 local crank deg, 0.25° steps
  private vLut = new Float64Array(1441);

  // control-rate values
  private pEvo = 2;
  private loadFrac = 1;
  private pEvoMotor = 0.5;
  private pExhMean = 1.05;
  private tEvo = 1200;
  private sigmaAmp = 0.05;
  private sigmaT = 0.8;
  private misfireP = 0;
  private knockRetard = 0;
  private airflow = 0.01;
  private airflowWot = 0.02;
  private boostTarget = 0;
  private pulseEnv = 0;
  private cPort = 650;

  // events
  private overrunT = 0;
  private liftT = 99;
  private wasOnThrottle = false;
  private dfco = false;
  private limiter = false;
  private limPh = 0;
  private limCut = false;
  private pops: Pop[] = [];
  private lopePh = 0;
  private lopeNoise = new OnePole();

  // output stage
  private radPrev = new Float64Array(8);
  private radY = new Float64Array(8);
  private jetEnv = new Float64Array(8);
  private jetSlow = new Float64Array(8);
  private jetHp: Biquad[] = [];
  private jetLp: Biquad[] = [];
  private outLp: Biquad[] = [];
  /** Per-outlet propagation delay to the listener (tailpipe spacing, research §7.3). */
  private outDelay: Delay[] = [];
  private outDelayS = new Float64Array(8);
  private panL = new Float64Array(8);
  private panR = new Float64Array(8);
  private dcL = new DcBlock();
  private dcR = new DcBlock();
  private limEnv = 0;
  private lowShelf = [new Biquad(), new Biquad()];
  private bayLp = new Biquad();

  stats: SynthStats = {
    rpm: 0,
    boostBar: 0,
    shaftRpm: 0,
    wastegate: 0,
    limiter: false,
    dfco: false,
    pops: 0,
    cycles: 0,
    cutCycles: 0,
    knockPings: 0,
    egtC: 0,
    peak: 0,
    maxPortBar: 0,
    preLimPeak: 0,
    bov: 0,
  };

  constructor(sampleRate: number, opts: SynthOptions = {}) {
    this.fs = sampleRate;
    this.opts = opts;
    this.rng = new Rng(opts.seed ?? 12345);
    this.room = new Room(sampleRate);
    if (opts.room === false || opts.exhaustOnly) this.room.mix = 0;
    this.dcL.setCutoff(18, sampleRate);
    this.dcR.setCutoff(18, sampleRate);
    this.lopeNoise.setCutoff(0.8, sampleRate / BLOCK);
    for (const b of this.lowShelf) b.peak(90, 0.7, 2.5, sampleRate);
    this.bayLp.lowpass(2200, 0.6, sampleRate);
    for (let i = 0; i < 6; i++) this.pops.push({ t: 0, att: 0, dec: 0, amp: 0, pipe: 0, delay: 0, active: false });
  }

  get params(): EngineSoundParams | null {
    return this.p;
  }

  setEngine(p: EngineSoundParams) {
    if (!this.p) this.install(p);
    else this.pending = p; // crossfade swap in process()
  }

  setState(s: Partial<EngineState>) {
    if (s.rpm !== undefined && Number.isFinite(s.rpm)) this.tRpm = Math.max(0, s.rpm);
    if (s.load !== undefined && Number.isFinite(s.load)) {
      this.tLoad = clamp(s.load, 0, 1);
      if (s.throttle === undefined) this.tThrottle = this.tLoad;
    }
    if (s.throttle !== undefined && Number.isFinite(s.throttle)) this.tThrottle = clamp(s.throttle, 0, 1);
    if ('boostBar' in s) this.tBoost = s.boostBar !== undefined && Number.isFinite(s.boostBar) ? s.boostBar : undefined;
    if (s.running !== undefined) this.tRunning = s.running;
    if (s.volume !== undefined && Number.isFinite(s.volume)) this.tVolume = clamp(s.volume, 0, 1);
  }

  /** Jump smoothed state to the targets (offline renders start settled). */
  settle() {
    this.rpm = this.rpmPrev = this.tRpm;
    this.thr = this.tThrottle;
    this.load = this.tLoad;
    this.runGain = this.tRunning ? 1 : 0;
    this.vol = this.tVolume;
    if (this.p) {
      this.control(true);
      this.map = this.mapTarget();
      this.ind.presetShaft(this.airflow / Math.max(1e-4, this.airflowWot));
    }
  }

  private install(p: EngineSoundParams) {
    const fs = this.fs;
    this.p = p;
    this.net = new ExhaustNetwork(p, fs);
    this.ind = new Induction(p, fs);
    this.mech = new Mechanical(p, fs);
    const n = p.nCyl;
    this.nCyl = n;
    this.phase = new Float64Array(n);
    this.prevPh = new Float64Array(n);
    this.exOpen = new Uint8Array(n);
    this.inOpen = new Uint8Array(n);
    this.fired = new Uint8Array(n).fill(1);
    this.pEvoCyc = new Float64Array(n).fill(2);
    this.jit = new Float64Array(n);
    this.staticGain = new Float64Array(n);
    this.pc = new Float64Array(n);
    this.mRef = new Float64Array(n);
    this.rhoRef = new Float64Array(n);
    this.pRef = new Float64Array(n);
    this.tRef = new Float64Array(n);
    this.mGas = new Float64Array(n);
    this.cylBank = new Uint8Array(n);
    this.popPipe = new Int32Array(n);
    this.primArea = new Float64Array(n);
    this.portLp = new Float64Array(n);
    this.srcGain = new Float64Array(n).fill(1);
    this.srcPrev = new Float64Array(n);
    const srng = new Rng(0xc0ffee ^ n);
    for (let i = 0; i < n; i++) {
      const c = p.cylinders[i];
      // Static per-cylinder offsets: timing ±1.5°, amplitude ±5 %.
      this.phase[i] = c.firingPhaseDeg + srng.bi() * 1.5;
      this.staticGain[i] = 1 + srng.bi() * 0.05;
      this.cylBank[i] = p.layout === 'inline' ? 0 : c.bank;
      const d = p.pipes[c.pipe].diamM;
      this.primArea[i] = (Math.PI / 4) * d * d;
      this.popPipe[i] = this.findDownstream(c.pipe, 'mid');
      this.prevPh[i] = 0;
    }
    // A cylinder exhausting soon after a system-mate pushes into a still-pressurised
    // collector: pulse scaled by 1 − 0.25·exp(−Δθ/60°).
    this.interact = new Float64Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      let best = 720;
      for (let j = 0; j < n; j++) {
        if (j === i || this.popPipe[j] !== this.popPipe[i]) continue;
        const d = (((p.cylinders[i].firingPhaseDeg - p.cylinders[j].firingPhaseDeg) % 720) + 720) % 720;
        if (d > 0 && d < best) best = d;
      }
      // Research §2.3 quotes ≈0.82 after 90° and ≈0.95 after 180°; 0.8·e^(−Δθ/60) reproduces those values.
      this.interact[i] = 1 - 0.8 * Math.exp(-best / 60);
    }
    // Volume lookup V(φ), φ local crank deg from TDC.
    const r = p.strokeM / 2;
    const l = p.rodM;
    const ap = (Math.PI / 4) * p.boreM * p.boreM;
    for (let k = 0; k <= 1440; k++) {
      const ph = ((k / 4) * Math.PI) / 180;
      const s = Math.sin(ph);
      const x = r * (1 - Math.cos(ph)) + l - Math.sqrt(l * l - r * r * s * s);
      this.vLut[k] = p.clearanceM3 + ap * x;
    }
    // Output stage per outlet.
    this.jetHp = [];
    this.jetLp = [];
    this.outLp = [];
    this.outDelay = [];
    for (let o = 0; o < p.outlets.length; o++) {
      // Turbulent jet noise is broadband, peaking near St ≈ 0.2 (a few hundred Hz for
      // a 60–100 m/s tailpipe jet) and falling ~−12 dB/oct above ~1.5 kHz (Lighthill).
      this.jetHp.push(new Biquad().highpass(180, 0.6, fs));
      this.jetLp.push(new Biquad().lowpass(1500, 0.5, fs));
      this.outLp.push(new Biquad().lowpass(11000, 0.7, fs));
      const pan = this.opts.exhaustOnly ? Math.sign(p.outlets[o].pan) : p.outlets[o].pan;
      this.outDelay[o] = new Delay(64);
      this.outDelayS[o] = Math.max(1, ((p.outlets[o].pan + 1) / 2) * 0.00015 * fs);
      const a = ((pan + 1) / 4) * Math.PI;
      this.panL[o] = Math.cos(a);
      this.panR[o] = Math.sin(a);
    }
    this.radPrev.fill(0);
    this.radY.fill(0);
    this.jetEnv.fill(0);
    this.jetSlow.fill(0);
    this.control(true);
  }

  /**
   * Blowdown pulses follow the sub-linear level law; the smooth piston-displacement
   * flow is scaled with manifold filling (calibration: WOT vs 30 % load ≈ +8–12 dB, §8 #9).
   */
  private srcWeight(g: number, blow: number): number {
    const disp = 0.08 + 0.17 * this.loadFrac;
    return (1 + (g - 1) * blow) * (disp + (1 - disp) * blow);
  }

  private findDownstream(pipe: number, kind: string): number {
    const p = this.p!;
    let cur = pipe;
    for (let guard = 0; guard < 32; guard++) {
      if (p.pipes[cur].kind === kind) return cur;
      const node = p.pipes[cur].down;
      const next = p.pipes.findIndex((q) => q.up === node);
      if (next < 0) return cur;
      cur = next;
    }
    return cur;
  }

  private volumeAt(ph: number): number {
    let x = ph % 360;
    if (x < 0) x += 360;
    const f = x * 4;
    const i = f | 0;
    return this.vLut[i] + (this.vLut[i + 1] - this.vLut[i]) * (f - i);
  }

  private mapTarget(): number {
    const p = this.p!;
    const c = p.curve;
    const mapWot = tableAt(c.rpm, c.mapBar, this.rpm);
    const idleMap = 0.3;
    if (this.dfco) return 0.22;
    let m = idleMap + (Math.max(idleMap, mapWot) - idleMap) * this.load;
    if (p.induction === 'turbo') {
      // Real boost lags: manifold can't exceed what the spool model provides.
      const avail = 1.0 + this.ind.boost;
      m = Math.min(m, Math.max(idleMap + (1 - idleMap) * this.load, avail));
    }
    return m;
  }

  /** Control-rate update (every BLOCK samples). */
  private control(init = false) {
    const p = this.p!;
    const fs = this.fs;
    const c = p.curve;
    const dtB = BLOCK / fs;
    const k = (tau: number) => (init ? 1 : 1 - Math.exp(-dtB / tau));
    this.rpmPrev = this.rpm;
    this.rpm += (this.tRpm - this.rpm) * k(0.025);
    this.thr += (this.tThrottle - this.thr) * k(0.02);
    this.load += (this.tLoad - this.load) * k(0.04);
    this.runGain += ((this.tRunning ? 1 : 0) - this.runGain) * k(0.08);
    this.vol += (this.tVolume - this.vol) * k(0.05);
    const rpm = this.rpm;

    // ── events: overrun / DFCO / limiter ──
    const onThrottle = this.thr > 0.25;
    if (onThrottle) this.wasOnThrottle = true;
    if (this.thr < 0.07 && rpm > p.idleRpm + 600) {
      if (this.overrunT === 0 && this.wasOnThrottle) this.liftT = 0;
      this.overrunT += dtB;
      this.wasOnThrottle = false;
    } else this.overrunT = 0;
    this.liftT += dtB;
    this.dfco = this.overrunT > 0.35 && rpm > p.idleRpm + 900;
    const limOn = this.tRpm >= p.redlineRpm - 30 && this.thr > 0.4;
    if (limOn && !this.limiter) this.limPh = 0;
    this.limiter = limOn;
    if (this.limiter) {
      // ~10 Hz fuel/spark-cut chop.
      this.limPh += dtB * 10.5;
      if (this.limPh >= 1) this.limPh -= 1;
      this.limCut = this.limPh < 0.42;
    } else this.limCut = false;

    // ── curve lookups ──
    const mapWot = tableAt(c.rpm, c.mapBar, rpm);
    const imepWot = tableAt(c.rpm, c.imepBar, rpm);
    this.airflowWot = tableAt(c.rpm, c.airFlowKgS, rpm);
    this.knockRetard = tableAt(c.rpm, c.knockRetardDeg, rpm);
    const curveBoost = tableAt(c.rpm, c.boostBar, rpm);
    this.boostTarget = this.tBoost !== undefined ? this.tBoost : curveBoost * smoothstep(0.35, 0.95, this.thr);
    const mapT = this.mapTarget();
    this.map += (mapT - this.map) * k(0.06);
    const mapFrac = clamp((this.map - 0.12) / Math.max(0.2, mapWot - 0.12), 0, 1.6);
    const imep = Math.max(0.8, imepWot * mapFrac);
    this.loadFrac = clamp(mapFrac, 0, 1);
    this.pEvo = 0.6 + 0.3 * imep;
    this.pEvoMotor = 0.2 + 0.9 * this.map;
    this.airflow = this.airflowWot * clamp(this.map / Math.max(0.3, mapWot), 0.05, 1.5);
    const exhP = tableAt(c.rpm, c.exhaustPressureBar, rpm);
    this.pExhMean = 1.0 + (Math.max(1.0, exhP) - 1.0) * clamp(this.airflow / Math.max(1e-4, this.airflowWot), 0, 1.2);
    // Gas temperature: part-load EGT lower; DFCO cools; slow (1.5 s) thermal lag.
    const egtWot = tableAt(c.rpm, c.egtC, rpm);
    const egtT = this.dfco ? 380 : 420 + (egtWot - 420) * (0.35 + 0.65 * clamp(this.load, 0, 1));
    this.egtK += (egtT + 273 - this.egtK) * k(1.5);
    this.tEvo = this.egtK + 250;
    this.cPort = Math.sqrt(1.35 * R_GAS * Math.max(400, this.egtK - 80));
    this.net.setTemperature(this.egtK, 1);
    this.net.smoothDelays(init ? 1 : 0.05);

    // Variability: idle is rougher, big cams lope.
    const idleness = (1 - smoothstep(0.15, 0.6, this.load)) * (1 - smoothstep(p.idleRpm * 1.2, p.idleRpm * 2.5, rpm));
    this.sigmaAmp = 0.04 + 0.08 * idleness + p.lope * 0.2 * idleness;
    this.sigmaT = 0.5 + 1.0 * idleness;
    this.misfireP = p.lope * 0.025 * idleness;

    // Turbine: wastegate opens transmission, twin-scroll preserves pulses.
    if (p.induction === 'turbo') {
      // Research §5.6: the turbine damps exhaust pulses by −(6 + 4·boost) dB (cap −14),
      // more above 1 kHz (the node's low-pass). Wastegate flow bypasses it; twin-scroll
      // keeps a little more pulse character.
      const wg = this.ind.wastegate;
      const attDb = Math.min(14, 7 + 4 * Math.max(0, this.ind.boost)) - (p.turbo.twinScroll ? 1.5 : 0);
      const tTurb = Math.pow(10, -attDb / 20) * 0.62;
      // A wide-open gate passes ~30 % of the flow, pulses largely intact.
      const tByp = 0.45;
      const byp = 0.3 * wg;
      this.net.turbineT = tTurb * (1 - byp) + tByp * byp;
      this.net.turbineR = 0.4 - 0.15 * wg;
    }

    // Lope: idle speed hunting ±(10..40) rpm at ~1 Hz.
    this.lopePh += dtB * (0.9 + 0.3 * p.lope);
    if (this.lopePh > 1) this.lopePh -= 1;

    this.stats.rpm = rpm;
    this.stats.boostBar = this.ind.boost;
    this.stats.shaftRpm = this.ind.shaftRps * 60;
    this.stats.wastegate = this.ind.wastegate;
    this.stats.bov = this.ind.bovCount;
    this.stats.limiter = this.limiter;
    this.stats.dfco = this.dfco;
    this.stats.egtC = this.egtK - 273;
  }

  private triggerPop(cyl: number, big: boolean) {
    const pop = this.pops.find((q) => !q.active);
    if (!pop) return;
    const fs = this.fs;
    pop.active = true;
    pop.t = 0;
    pop.delay = Math.floor(this.rng.next() * 0.02 * fs);
    pop.att = (0.0005 + this.rng.next() * 0.0025) * fs;
    pop.dec = (big ? 0.012 + this.rng.next() * 0.018 : 0.004 + this.rng.next() * 0.008) * fs;
    // ±6 dB spread; big bangs at/above WOT pulse level.
    pop.amp = (big ? 1.1 : 0.35) * Math.pow(10, (this.rng.bi() * 6) / 20);
    pop.pipe = this.popPipe[cyl];
    this.stats.pops++;
  }

  /** Start of a cylinder cycle (firing TDC): decide combustion, amplitude, jitter. */
  private cycleStart(i: number) {
    const p = this.p!;
    this.stats.cycles++;
    let fire = 1;
    if (this.dfco) fire = 0;
    if (this.limCut) fire = 0;
    if (this.misfireP > 0 && this.rng.next() < this.misfireP) fire = 0;
    if (this.rpm < 120) fire = 0;
    this.fired[i] = fire;
    if (!fire) this.stats.cutCycles++;
    const amp = this.staticGain[i] * this.interact[i] * (1 + this.sigmaAmp * this.rng.gauss());
    this.pEvoCyc[i] = fire ? 1 + Math.max(0.05, (this.pEvo - 1) * amp) : this.pEvoMotor;
    this.jit[i] = this.sigmaT * this.rng.gauss();
    if (fire) {
      this.mech.combustion(clamp((this.pEvo - 1) / 4, 0.05, 2));
      if (this.knockRetard > 0.5 && this.load > 0.7) {
        const pk = clamp(this.knockRetard / 10, 0, 1) * 0.12;
        if (this.rng.next() < pk) {
          this.mech.ping(0.6 + this.rng.next());
          this.stats.knockPings++;
        }
      }
    } else {
      // Unburnt mixture into a hot exhaust → afterfire.
      const hot = smoothstep(500, 800, this.egtK - 273);
      const rich = clamp((1.0 - p.lambda) / 0.2 + 0.3, 0.3, 1.5);
      let pp = 0;
      if (this.limCut) pp = (p.aggressiveness > 0.7 ? 0.15 : 0.02) * hot;
      else if (this.liftT < 4 && this.rpm > 2200) {
        const p0 = 0.02 + 0.2 * p.aggressiveness * p.aggressiveness;
        pp = p0 * hot * rich * Math.exp(-this.liftT / 1.3);
      }
      if (pp > 0 && this.rng.next() < pp) this.triggerPop(i, this.rng.next() < 0.3);
    }
  }

  process(outL: Float32Array, outR: Float32Array) {
    const n = outL.length;
    if (!this.p) {
      outL.fill(0);
      outR.fill(0);
      return;
    }
    for (let s0 = 0; s0 < n; s0 += BLOCK) {
      const s1 = Math.min(n, s0 + BLOCK);
      this.control();
      if (this.pending) {
        this.swapGain -= 0.25;
        if (this.swapGain <= 0) {
          const np = this.pending;
          this.pending = null;
          this.install(np);
          this.swapGain = 0;
        }
      } else if (this.swapGain < 1) this.swapGain = Math.min(1, this.swapGain + 0.05);
      this.renderBlock(outL, outR, s0, s1);
    }
  }

  private renderBlock(outL: Float32Array, outR: Float32Array, s0: number, s1: number) {
    const p = this.p!;
    const fs = this.fs;
    const dt = 1 / fs;
    const net = this.net;
    const nCyl = this.nCyl;
    const exOnly = !!this.opts.exhaustOnly;
    const evo = p.evoDeg;
    const evc = p.evcDeg;
    const exSpan = evc - evo;
    const ivo = p.ivoDeg;
    const ivc = p.ivcDeg;
    const inSpan = ivc - ivo;
    const aExMax = 0.85 * (Math.PI / 4) * p.exValveDiamM * p.exValveDiamM * p.exValves;
    const aInMax = 0.85 * (Math.PI / 4) * p.inValveDiamM * p.inValveDiamM * p.inValves;
    const curtainK = Math.PI * p.exValveDiamM * p.exValves * p.exLiftM;
    const curtainKi = Math.PI * p.inValveDiamM * p.inValves * p.inLiftM;
    const cd = 0.65;
    const runnerArea = (Math.PI / 4) * p.runnerDiamM * p.runnerDiamM;
    const rhoAir = (this.map * 1e5) / (287 * 320);
    const len = s1 - s0;
    const valveVel = clamp(this.rpm / 6000, 0.05, 1.6);
    const idleness = (1 - smoothstep(0.15, 0.6, this.load)) * (1 - smoothstep(p.idleRpm * 1.2, p.idleRpm * 2.5, this.rpm));
    const lopeRpm = p.lope * 35 * idleness * Math.sin(2 * Math.PI * this.lopePh) + idleness * 12 * this.lopeNoise.process(this.rng.bi() * 3);
    const limBounce = this.limiter ? -90 * (this.limCut ? this.limPh / 0.42 : 1 - (this.limPh - 0.42) / 0.58) : 0;
    const nOut = p.outlets.length;
    const jetK = 2.0;
    const radA = Math.exp((-2 * Math.PI * 350) / fs);
    const jetSlowK = 1 - Math.exp(-1 / (0.008 * fs));
    // Level calibration (research §3.2 / §8 #9): the d/dt radiation makes level grow
    // ~+30 dB/decade of rpm; real WOT data is ~+17 dB/decade, so compensate partially.
    const rpmComp = Math.pow(clamp(this.rpm / 3000, 0.15, 4), -0.65);
    const master = p.gain * this.runGain * this.vol * this.swapGain * rpmComp;
    const roomOn = this.room.mix > 0;
    let peak = this.stats.peak;
    let pulseAcc = 0;

    for (let s = 0; s < len; s++) {
      const fr = (s + 1) / len;
      const rpm = Math.max(0, this.rpmPrev + (this.rpm - this.rpmPrev) * fr + lopeRpm + limBounce);
      const dTheta = (rpm / 60) * 360 * dt;
      this.theta += dTheta;
      if (this.theta >= 720) this.theta -= 720;
      const th = this.theta;
      this.suction[0] = this.reversion[0] * 0.5;
      this.suction[1] = this.reversion[1] * 0.5;
      this.reversion[0] = 0;
      this.reversion[1] = 0;

      for (let i = 0; i < nCyl; i++) {
        let ph = th - this.phase[i];
        if (ph < 0) ph += 720;
        if (ph < 0) ph += 720;
        const prev = this.prevPh[i];
        this.prevPh[i] = ph;
        if (ph < prev && prev - ph > 360) this.cycleStart(i); // wrapped through firing TDC
        // ── exhaust valve event ──
        const evoJ = evo + this.jit[i];
        if (!this.exOpen[i]) {
          if (ph >= evoJ && ph < evc && prev < evoJ) {
            this.exOpen[i] = 1;
            const V = this.volumeAt(ph);
            const pe = this.pEvoCyc[i] * 1e5;
            const T = this.fired[i] ? this.tEvo : 420;
            this.pRef[i] = pe;
            this.tRef[i] = T;
            this.rhoRef[i] = pe / (R_GAS * T);
            this.mGas[i] = this.rhoRef[i] * V;
            this.mRef[i] = this.mGas[i];
            this.pc[i] = pe;
            const dP = Math.max(0.05, this.pEvoCyc[i] - this.pExhMean);
            this.srcGain[i] = clamp(Math.pow(dP / 3.5, -0.2), 0.8, 2);
          }
        }
        if (this.exOpen[i]) {
          if (ph >= evc || ph < evoJ - 1) {
            this.exOpen[i] = 0;
            net.portR[i] = 0.85;
            net.portSrc[i] = 0;
            this.srcPrev[i] = 0;
            this.mech.valveClose(valveVel * p.exValves * 0.5);
          } else {
            const x = (ph - evoJ) / exSpan;
            // Cam lift: fast opening flank (ramp + acceleration), dwell near peak.
            const lift = Math.sin(Math.PI * clamp(x, 0, 1));
            // Effective blowdown area: calibrated so the pulse peaks ~20–40° after EVO and
            // blowdown completes in ~50–70° at mid speed (research §1.2).
            const area = cd * 1.9 * Math.min(curtainK * lift, aExMax * 1.4);
            const pcyl = this.pc[i];
            this.portLp[i] += 0.18 * (net.portP[i] - this.portLp[i]);
            const pe = Math.max(0.4e5, this.pExhMean * 1e5 + 0.35e5 * this.portLp[i]);
            let mdot: number;
            if (pcyl >= pe) mdot = ((area * pcyl) / Math.sqrt(R_GAS * this.tRef[i])) * psi(pe / pcyl);
            else mdot = -((area * pe) / Math.sqrt(R_GAS * this.egtK)) * psi(pcyl / pe);
            // Overlap: the intake valve is opening too; cylinder gas also vents
            // into (or is pulled from) the intake manifold — reversion.
            let mdotIn = 0;
            let pin = ph;
            if (pin < ivo) pin += 720;
            const xo = (pin - ivo) / inSpan;
            if (xo > 0 && xo < 1) {
              const so = Math.sin(Math.PI * xo);
              const ai = cd * Math.min(curtainKi * so * so, aInMax);
              const pm = this.map * 1e5;
              if (pcyl >= pm) mdotIn = ((ai * pcyl) / Math.sqrt(R_GAS * this.tRef[i])) * psi(pm / pcyl);
              else mdotIn = -((ai * pm) / Math.sqrt(287 * 320)) * psi(pcyl / pm);
              this.reversion[this.cylBank[i]] += mdotIn > 0 ? (mdotIn * 400) / runnerArea / 1e5 : 0;
            }
            let m = this.mGas[i] - (mdot + mdotIn) * dt;
            if (m < 1e-8) m = 1e-8;
            this.mGas[i] = m;
            const V = this.volumeAt(ph);
            const rr = m / V / this.rhoRef[i];
            this.pc[i] = this.pRef[i] * Math.pow(rr, GAMMA);
            // Injected pressure wave, in bar.
            // Sub-linear level law (research §1.1: A ∝ ΔP^0.8 from non-linear choked jets).
            const src = ((mdot * this.cPort) / this.primArea[i] / 1e5) * this.srcWeight(this.srcGain[i], smoothstep(1.1, 1.7, pcyl / pe));
            // Finite-amplitude steepening (c_eff = c·(1 + k·p′/p0), research §1.4): large
            // pulses get sharper fronts → amplitude-dependent emphasis above ~1 kHz.
            const steep = src > 0 ? 6 * src * (src - this.srcPrev[i]) : 0;
            this.srcPrev[i] = src;
            net.portSrc[i] = src + clamp(steep, -0.5 * src - 0.5, 2);
            net.portR[i] = 0.85 - 0.7 * lift;
            pulseAcc += src > 0 ? src : 0;
            if (net.portP[i] > this.stats.maxPortBar) this.stats.maxPortBar = net.portP[i];
          }
        }
        // ── intake valve event: suction volume velocity into the runner ──
        let pi = ph;
        if (pi < ivo) pi += 720;
        const xi = (pi - ivo) / inSpan;
        if (xi >= 0 && xi <= 1) {
          if (!this.inOpen[i]) this.inOpen[i] = 1;
          const si = Math.sin(Math.PI * xi);
          const li = si * si;
          const a = Math.min(curtainKi * li, aInMax) / aInMax;
          const dV = this.volumeAt(pi + 0.25) - this.volumeAt(pi - 0.25); // per 0.5°
          const q = (dV / 0.5) * (dTheta / dt); // m³/s
          if (q > 0) this.suction[this.cylBank[i]] -= ((rhoAir * 340 * q * a) / runnerArea) / 1e5;
        } else if (this.inOpen[i]) {
          this.inOpen[i] = 0;
          this.mech.valveClose(valveVel * p.inValves * 0.5);
        }
      }

      // Afterfire pops into the mid pipe.
      for (let k = 0; k < this.pops.length; k++) {
        const pop = this.pops[k];
        if (!pop.active) continue;
        if (pop.delay > 0) {
          pop.delay--;
          continue;
        }
        const t = pop.t++;
        const env = t < pop.att ? t / pop.att : Math.exp(-(t - pop.att) / pop.dec);
        const thump = t < pop.att * 3 ? Math.sin((Math.PI * t) / (pop.att * 3)) : 0;
        net.inject[pop.pipe] += pop.amp * env * (0.55 * this.rng.bi() + 0.45 * thump);
        if (t > pop.att + pop.dec * 7) pop.active = false;
      }

      net.step();

      // ── radiation + jet noise per outlet ──
      let L = 0;
      let R = 0;
      for (let o = 0; o < nOut; o++) {
        const u = net.out[o];
        // Monopole radiation: d/dt below ~radFc (ka ≪ 1), flattening above where
        // the open end radiates efficiently (first-order high-pass).
        const rad = radA * (this.radY[o] + u - this.radPrev[o]);
        this.radY[o] = rad;
        this.radPrev[o] = u;
        // Jet strength follows the mean exit flow (≈8 ms) with only partial
        // pulse-synchronous modulation; a fully pulse-gated noise reads as buzz.
        const au = Math.abs(u);
        const ef = this.jetEnv[o] + 0.08 * (au - this.jetEnv[o]);
        this.jetEnv[o] = ef;
        const es = this.jetSlow[o] + jetSlowK * (au - this.jetSlow[o]);
        this.jetSlow[o] = es;
        const e = 0.3 * ef + 0.7 * es;
        const jet = this.jetLp[o].process(this.jetHp[o].process(this.rng.bi() * e * e * jetK));
        const dl = this.outDelay[o];
        dl.write(this.outLp[o].process(rad + jet));
        const y = dl.read(this.outDelayS[o]);
        L += y * this.panL[o] * this.mixExhaust;
        R += y * this.panR[o] * this.mixExhaust;
      }

      if (!exOnly) {
        const inp = this.indIn;
        inp.rpm = rpm;
        inp.throttle = this.thr;
        inp.map = this.map;
        inp.airflow = this.airflow;
        inp.airflowWot = this.airflowWot;
        inp.boostTarget = this.boostTarget;
        inp.pulseEnv = this.pulseEnv;
        inp.dt = dt;
        this.ind.step(inp, this.suction);
        const ig = p.itb ? 0.55 : 0.22;
        // Engine-bay sources reach an exhaust-side listener around/through the body:
        // mechanical ticks and intake hiss arrive low-passed (~2.2 kHz, 2nd order).
        const bay = this.bayLp.process(this.ind.outIntake * ig * this.mixIntake + this.mech.step(rpm) * this.mixMech);
        const c = bay + this.ind.outTurbo * this.mixTurbo + this.ind.outSc * this.mixSc;
        const wg = this.ind.outWastegate + this.ind.outBov;
        L += c * 0.7 + (wg * 0.75 + this.ind.outBov * 0.2) * this.mixWg;
        R += c * 0.7 + wg * 0.6 * this.mixWg;
      }

      L = this.lowShelf[0].process(L);
      R = this.lowShelf[1].process(R);
      if (roomOn) {
        this.room.process(L, R);
        L = this.room.outL;
        R = this.room.outR;
      }
      L *= master;
      R *= master;
      // Gentle peak limiter (fast attack, 150 ms release) then soft clip.
      const pk = Math.max(Math.abs(L), Math.abs(R));
      this.limEnv = pk > this.limEnv ? this.limEnv + 0.5 * (pk - this.limEnv) : this.limEnv * 0.99986;
      const thr = 0.7;
      const g = this.limEnv > thr ? thr / this.limEnv : 1;
      if (pk > this.stats.preLimPeak) this.stats.preLimPeak = pk;
      L = softClip(L * g * 1.05) * 0.95;
      R = softClip(R * g * 1.05) * 0.95;
      // DC block last: soft-clipping asymmetric (positive-peaked) pulses creates DC.
      L = this.dcL.process(L);
      R = this.dcR.process(R);
      if (!(L === L)) L = 0; // NaN guard
      if (!(R === R)) R = 0;
      outL[s0 + s] = L;
      outR[s0 + s] = R;
      const a = Math.abs(L) > Math.abs(R) ? Math.abs(L) : Math.abs(R);
      if (a > peak) peak = a;
    }
    this.pulseEnv += (Math.min(1, (pulseAcc / len) * 2) - this.pulseEnv) * 0.3;
    this.stats.peak = peak;
    this.time += len * dt;
  }

  /** Component mix (exhaust-exit perspective, research §7.1). */
  mixIntake = 1;
  mixTurbo = 0.35;
  /** Exhaust outlets (analysis solo control). */
  mixExhaust = 1;
  /** Wastegate + blow-off valve (analysis solo control). */
  mixWg = 1;
  mixSc = 1;
  mixMech = 0.1;

  private indIn: InductionInput = {
    rpm: 0,
    throttle: 0,
    map: 1,
    airflow: 0,
    airflowWot: 0,
    boostTarget: 0,
    pulseEnv: 0,
    dt: 0,
  };
}
