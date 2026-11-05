/**
 * Intake acoustics and forced induction.
 *
 * Intake: per-bank runner waveguide (closed at the valve, open at the plenum or
 * trumpet) fed by the summed per-cylinder suction volume velocity. Plenum
 * engines then pass through a Helmholtz resonator (plenum volume + throttle /
 * intake tract neck), the throttle (transmission ∝ opening) and an airbox
 * low-pass. ITBs radiate straight from the trumpets (honk). Throttle hiss is
 * band-passed noise ∝ airflow × pressure drop across the plate.
 *
 * Turbo: shaft speed from compressor pressure ratio via Euler work
 * (Δh = σ·ψ·U², U = π·D2·N), spool dynamics with lag, compressor blade-pass
 * tones (band-limited sines, faded out near Nyquist), broadband whoosh ∝ flow,
 * wastegate hiss, blow-off-valve burst on lift-off from boost.
 *
 * Supercharger: rotor speed = crank × drive ratio; lobe-pass whine with a
 * timbre per type (roots = rich pulsating harmonics, twin-screw = purer and
 * higher plus sync-gear mesh, centrifugal = rpm²-scaled gear-drive whine and
 * impeller blade pass).
 */
import type { EngineSoundParams } from '../params';
import { Biquad, Delay, OnePole, Rng, TAU, clamp, smoothstep } from './dsp';

export interface InductionInput {
  rpm: number;
  throttle: number;
  /** effective manifold pressure, bar abs */
  map: number;
  /** air mass flow, kg/s */
  airflow: number;
  /** WOT airflow at this rpm, kg/s */
  airflowWot: number;
  /** target boost from the curve at this rpm and throttle, bar */
  boostTarget: number;
  /** firing-frequency envelope (for turbine AM), 0..1 */
  pulseEnv: number;
  dt: number;
}

class Runner {
  fwd: Delay;
  bwd: Delay;
  d = 10;
  lp = 0;
  a: number;
  endLp = 0;
  endA: number;
  bo = 0;
  constructor(fs: number, lenM: number, diamM: number) {
    this.fwd = new Delay(Math.ceil(0.01 * fs));
    this.bwd = new Delay(Math.ceil(0.01 * fs));
    this.a = 1 - Math.exp((-TAU * Math.min(fs * 0.45, 7000 / Math.sqrt(lenM))) / fs);
    this.endA = 1 - Math.exp((-TAU * Math.min(fs * 0.45, 520 / (TAU * diamM * 0.5))) / fs);
    this.setTemp(320, lenM, diamM, fs);
  }
  setTemp(T: number, lenM: number, diamM: number, fs: number) {
    const c = Math.sqrt(1.4 * 287 * T);
    this.d = Math.max(1.5, ((lenM + 0.6 * diamM * 0.5) / c) * fs);
  }
  /** src: pressure wave injected at the valve end. Returns transmitted (p⁺ − p⁻) at the open end. */
  step(src: number): number {
    // valve end: closed-ish reflection
    const inValve = this.bwd.read(this.d);
    const outValve = 0.9 * inValve + src;
    this.lp += this.a * (this.fwd.read(this.d) - this.lp);
    const inc = 0.98 * this.lp;
    this.endLp += this.endA * (inc - this.endLp);
    const refl = -0.97 * this.endLp;
    this.fwd.write(outValve);
    this.bwd.write(refl);
    return inc - refl;
  }
}

export class Induction {
  private fs: number;
  private p: EngineSoundParams;
  private rng = new Rng(0x51ed);
  private runners: Runner[];
  private helm = new Biquad();
  private airbox = new Biquad();
  private hissBp = new Biquad();
  private radPrev = 0;
  private radPrevItb = 0;
  // turbo
  shaftRps = 0;
  boost = 0;
  private bovEnv = 0;
  private bovBp = new Biquad();
  private bovF = 3000;
  private bovFlutterPh = 0;
  private lastThrottle = 0;
  private whooshBp = new Biquad();
  private whooshLp = new OnePole();
  private wgBp = new Biquad();
  private phBlade = 0;
  private phSplit = 0;
  private phShaft = 0;
  private wobble = new OnePole();
  wastegate = 0;
  bovCount = 0;
  /** Peak WOT airflow over the whole curve, kg/s (absolute exhaust-energy reference). */
  private airflowMax = 0.05;
  /** Smoothed positive shaft acceleration, normalised (drives the spool whistle). */
  private spoolAcc = 0;
  private prevShaft = 0;
  /** Exhaust energy fraction at which the turbo first reaches target boost (from the curve). */
  private eOnBoost = 0.35;
  // supercharger
  private scPh = new Float64Array(8);
  private scGearPh = 0;
  private scLp = new OnePole();
  /** Per-sample outputs */
  outIntake = 0;
  outTurbo = 0;
  outWastegate = 0;
  outBov = 0;
  outSc = 0;

  constructor(p: EngineSoundParams, fs: number) {
    this.fs = fs;
    this.p = p;
    const banks = p.layout === 'inline' ? 1 : 2;
    this.runners = [];
    for (let b = 0; b < banks; b++) this.runners.push(new Runner(fs, p.runnerLenM * (1 + 0.02 * b), p.runnerDiamM));
    // Helmholtz: neck = throttle + 0.35 m intake tract, cavity = plenum.
    const aNeck = (Math.PI / 4) * p.throttleDiamM * p.throttleDiamM;
    const fH = p.plenumM3 > 0 ? (343 / TAU) * Math.sqrt(aNeck / (p.plenumM3 * (0.35 + 0.8 * p.throttleDiamM))) : 0;
    this.helm.bandpass(clamp(fH || 120, 40, 600), 3.5, fs);
    this.airbox.lowpass(p.itb ? 6000 : 1400, 0.7, fs);
    this.hissBp.bandpass(3500, 0.9, fs);
    this.bovBp.bandpass(3000, 1.2, fs);
    this.whooshBp.bandpass(2200, 0.8, fs);
    this.whooshLp.setCutoff(8, fs);
    this.wgBp.bandpass(1800, 0.7, fs);
    this.wobble.setCutoff(3, fs);
    this.scLp.setCutoff(5, fs);
    const af = p.curve.airFlowKgS;
    this.airflowMax = Math.max(1e-3, ...af);
    // First rpm where the curve reaches ~90 % of its peak boost → energy needed to hold boost.
    const bMax = Math.max(0, ...p.curve.boostBar);
    const k = p.curve.boostBar.findIndex((b) => b >= 0.9 * bMax);
    this.eOnBoost = bMax > 0.05 && k >= 0 ? clamp(af[k] / this.airflowMax, 0.1, 0.9) : 0.35;
  }

  /** Start the turbo at its free-wheel speed for this exhaust flow (no spool-from-zero on start). */
  presetShaft(flowFrac: number) {
    this.shaftRps = (140 * Math.sqrt(clamp(flowFrac, 0.02, 1.2))) / (Math.PI * this.p.turbo.exducerM);
  }

  /** Compressor tip speed (m/s) needed for pressure ratio PR (Euler work, σψ ≈ 0.62, η ≈ 0.72). */
  private tipSpeedForPr(pr: number): number {
    const dh = (1005 * 300 * (Math.pow(Math.max(1, pr), 0.2857) - 1)) / 0.72;
    return Math.sqrt(dh / 0.62);
  }
  private prForTip(u: number): number {
    const dh = 0.62 * u * u * 0.72;
    return Math.pow(1 + dh / (1005 * 300), 3.5);
  }

  /**
   * Advance one sample. `suction[b]` is the summed intake pressure-wave source per bank.
   */
  step(inp: InductionInput, suction: Float64Array): void {
    const fs = this.fs;
    const p = this.p;
    // ── intake runners → plenum / trumpets ──
    let tx = 0;
    for (let b = 0; b < this.runners.length; b++) tx += this.runners[b].step(suction[b]);
    const thr = inp.throttle;
    let intake: number;
    if (p.itb) {
      const rad = tx - this.radPrevItb;
      this.radPrevItb = tx;
      intake = this.airbox.process(rad * 6);
    } else {
      const h = this.helm.process(tx) * 2.2 + tx * 0.25;
      const throttleT = 0.12 + 0.88 * Math.sqrt(thr);
      const a = this.airbox.process(h * throttleT);
      intake = (a - this.radPrev) * 3;
      this.radPrev = a;
    }
    // Throttle hiss: flow × pressure drop across the plate.
    const drop = clamp(1 - inp.map, 0, 1);
    const flowFrac = clamp(inp.airflow / Math.max(1e-4, inp.airflowWot), 0, 1.5);
    const hissAmp = (p.itb ? 0.5 : 1) * drop * (0.15 + flowFrac) * Math.min(1, inp.rpm / 4000) * 0.006;
    intake += this.hissBp.process(this.rng.bi()) * hissAmp;
    this.outIntake = intake;

    // ── turbo ──
    this.outTurbo = 0;
    this.outWastegate = 0;
    this.outBov = 0;
    if (p.induction === 'turbo') this.stepTurbo(inp);
    // ── supercharger ──
    this.outSc = 0;
    if (p.induction === 'supercharger') this.stepSc(inp);
    this.lastThrottle = thr;
    void fs;
  }

  private stepTurbo(inp: InductionInput) {
    const p = this.p;
    const fs = this.fs;
    const D2 = p.turbo.exducerM;
    // Exhaust energy available, ABSOLUTE: flow relative to the engine's peak flow, so a
    // tip-in at 1500 rpm spools far slower than one at 4000 rpm (classic lag).
    const energy = clamp(inp.airflow / this.airflowMax, 0.02, 1.2);
    const prTarget = 1 + Math.max(0, inp.boostTarget) / 1.013;
    const uBoost = this.tipSpeedForPr(prTarget);
    // Free-wheel speed from exhaust flow alone (no load on the compressor).
    const uFlow = 140 * Math.sqrt(energy);
    const uTarget = Math.max(uBoost * smoothstep(0.25, 0.75, inp.throttle), uFlow);
    const nTarget = uTarget / (Math.PI * D2);
    const up = nTarget > this.shaftRps;
    const tau = up ? p.turbo.spoolTauS / Math.max(0.12, Math.min(1, energy / this.eOnBoost)) : 1.6;
    this.shaftRps += (nTarget - this.shaftRps) * (inp.dt / tau);
    const u = Math.PI * D2 * this.shaftRps;
    const prNow = this.prForTip(u);
    const throttleOpen = inp.throttle > 0.25;
    const boostNow = throttleOpen ? Math.max(0, (prNow - 1) * 1.013) : 0;
    // Wastegate: once boost is at target, the surplus exhaust energy bypasses the turbine.
    const surplus = clamp((energy - this.eOnBoost) / Math.max(0.1, 1 - this.eOnBoost), 0, 1);
    const atTarget = smoothstep(0.85, 1, boostNow / Math.max(0.05, inp.boostTarget));
    this.wastegate += ((throttleOpen ? (0.15 + 0.85 * surplus) * atTarget : 0.6) - this.wastegate) * (inp.dt / 0.08);

    // Blow-off: sudden lift-off while on boost.
    const dThr = (inp.throttle - this.lastThrottle) / inp.dt;
    if (this.boost > 0.25 && (dThr < -4 || (inp.throttle < 0.2 && this.lastThrottle >= 0.2)) && this.bovEnv < 0.2) {
      this.bovEnv = clamp(this.boost / 1.2, 0.3, 1.3);
      this.bovF = 4200;
      this.bovCount++;
    }
    this.boost = boostNow;
    if (this.bovEnv > 1e-4) {
      const decay = Math.exp(-inp.dt / (0.12 + 0.2 * clamp(this.bovEnv, 0, 1)));
      this.bovEnv *= decay;
      this.bovF += (1400 - this.bovF) * inp.dt * 4;
      this.bovBp.bandpass(this.bovF, 1.1, fs);
      this.bovFlutterPh += inp.dt * 22;
      const flutter = p.turbo.targetBoostBar > 1.5 ? 0.55 + 0.45 * Math.sin(TAU * this.bovFlutterPh) : 1;
      // Atmospheric BOV ≈ −6…−10 dB re WOT exhaust at the rear (research §7.1).
      this.outBov = this.bovBp.process(this.rng.bi()) * this.bovEnv * flutter * 0.3;
    }

    // Compressor tones: shaft order, full-blade pass and splitter pass. Band-limited:
    // each partial fades out between 0.38 fs and 0.45 fs.
    const f0 = this.shaftRps * (1 + 0.004 * this.wobble.process(this.rng.bi()) * 30);
    const nyqFade = (f: number) => 1 - smoothstep(0.36 * fs, 0.45 * fs, f);
    const load = clamp(prNow - 1, 0, 2.5);
    // Spool whistle follows the shaft actually ACCELERATING (not the gap to target, which
    // made it loudest the instant the throttle opened, before anything spun up).
    const nMax = this.tipSpeedForPr(1 + p.turbo.targetBoostBar / 1.013) / (Math.PI * D2);
    const acc = Math.max(0, (this.shaftRps - this.prevShaft) / inp.dt) * (p.turbo.spoolTauS / Math.max(1, nMax));
    this.prevShaft = this.shaftRps;
    this.spoolAcc += (clamp(acc, 0, 1.5) - this.spoolAcc) * (inp.dt / 0.05);
    const spoolUp = this.spoolAcc;
    const am = 0.75 + 0.25 * inp.pulseEnv;
    const fb = f0 * p.turbo.fullBlades;
    const fs2 = fb * 2;
    this.phShaft = (this.phShaft + f0 / fs) % 1;
    this.phBlade = (this.phBlade + fb / fs) % 1;
    this.phSplit = (this.phSplit + fs2 / fs) % 1;
    // Rear-perspective levels (research §7.1): whistle −20…−30 dB re exhaust, swelling
    // while spooling; steady boost leaves a faint whistle (tone ∝ U²).
    const uFrac = clamp(u / Math.max(1, Math.PI * D2 * nMax), 0, 1.3);
    const toneAmp = (0.0004 + 0.0045 * uFrac * uFrac * Math.min(1, load) + 0.018 * spoolUp) * am;
    // Perceptual: very high partials need less level; keep mostly lower components.
    this.outTurbo =
      toneAmp *
      (0.25 * Math.sin(TAU * this.phShaft) * nyqFade(f0) +
        1.0 * Math.sin(TAU * this.phBlade) * nyqFade(fb) * (fb > 12000 ? 0.5 : 1) +
        0.35 * Math.sin(TAU * this.phSplit) * nyqFade(fs2) * (fs2 > 12000 ? 0.4 : 1));
    // Whoosh: broadband compressor inlet noise ∝ flow × PR.
    // Whoosh is strongest at high PR / part flow (near surge) and while spooling.
    const wAmp = this.whooshLp.process(energy * energy * (0.15 + 0.5 * load) * (0.5 + spoolUp)) * 0.012;
    this.whooshBp.bandpass(1200 + 3000 * clamp(u / 500, 0, 1), 0.7, fs);
    this.outTurbo += this.whooshBp.process(this.rng.bi()) * wAmp;
    this.outTurbo *= 0.1 + 0.9 * smoothstep(0.08, 0.45, energy);
    // Wastegate hiss into the exhaust side.
    this.outWastegate = this.wgBp.process(this.rng.bi()) * this.wastegate * energy * smoothstep(0.2, 0.8, this.boost / Math.max(0.1, inp.boostTarget)) * 0.008;
  }

  private stepSc(inp: InductionInput) {
    const p = this.p;
    const fs = this.fs;
    const sc = p.supercharger;
    const rotorRps = (inp.rpm / 60) * sc.driveRatio;
    const nyqFade = (f: number) => 1 - smoothstep(0.36 * fs, 0.45 * fs, f);
    const boostFrac = clamp(inp.boostTarget / Math.max(0.1, sc.targetBoostBar), 0, 1.5);
    const loadW = this.scLp.process(0.25 + 0.75 * smoothstep(0.2, 0.9, inp.throttle));
    let y = 0;
    if (sc.type === 'centrifugal') {
      // Impeller tip-speed² ∝ rpm²: whine grows strongly with rpm.
      const r = clamp(inp.rpm / p.redlineRpm, 0, 1.1);
      const fGear = (inp.rpm / 60) * 3.4 * 23; // step-up gear mesh on the input shaft
      const fBlade = rotorRps * sc.lobesPerRev;
      this.scGearPh = (this.scGearPh + fGear / fs) % 1;
      this.scPh[0] = (this.scPh[0] + fBlade / fs) % 1;
      y = r * r * (0.9 * Math.sin(TAU * this.scGearPh) * nyqFade(fGear) + 0.4 * Math.sin(TAU * this.scPh[0]) * nyqFade(fBlade));
      y *= 0.024 * loadW;
    } else {
      const fLobe = rotorRps * sc.lobesPerRev;
      // Harmonic recipe: roots → pulsating (rich), twin-screw → purer.
      const nH = sc.type === 'roots' ? 6 : 3;
      for (let h = 1; h <= nH; h++) {
        const f = fLobe * h;
        this.scPh[h - 1] = (this.scPh[h - 1] + f / fs) % 1;
        const w = sc.type === 'roots' ? 1 / Math.pow(h, 0.9) : h === 1 ? 1 : h === 2 ? 0.45 : 0.15;
        y += w * Math.sin(TAU * this.scPh[h - 1]) * nyqFade(f);
      }
      const fGear = rotorRps * sc.gearTeeth;
      this.scGearPh = (this.scGearPh + fGear / fs) % 1;
      y += (sc.type === 'twin-screw' ? 0.35 : 0.15) * Math.sin(TAU * this.scGearPh) * nyqFade(fGear);
      const spd = clamp(inp.rpm / 6000, 0, 1.5);
      // Rear-perspective whine ≈ −12…−18 dBA re WOT exhaust (research §7.1: −15…−25, nudged
      // up because the whine is the signature). Twin-screw is purer/higher → reads louder per unit.
      y *= (sc.type === 'twin-screw' ? 0.0075 : 0.016) * spd * (0.3 + 0.7 * boostFrac) * loadW;
    }
    // Roots/screw blow-off: bypass valve opens at closed throttle → soft whoosh, no pssh.
    this.outSc = y;
  }
}
