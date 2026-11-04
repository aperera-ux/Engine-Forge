/**
 * Synthesised engine sound (WebAudio). Muted by default.
 *
 * Model: each bank's exhaust is a pulse train over one 4-stroke cycle (720°),
 * with a pulse at each cylinder's firing phase from computeLayout. We turn that
 * into a PeriodicWave (Fourier series of Gaussian pulses) whose fundamental is
 * the cycle frequency rpm/120 Hz — so uneven firing (V-twin, per-bank crossplane
 * V8) naturally produces the sub-harmonic "burble", and even-fire engines with
 * many cylinders produce a smooth high-pitched scream. Bank A → left, bank B → right.
 * Filtered noise gated by the pulse train adds combustion/exhaust roughness.
 */
import { computeLayout } from '../sim/layout';
import type { EngineConfig } from '../sim/types';
import { useStore } from './store';

interface Graph {
  ctx: AudioContext;
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  noiseGain: GainNode;
  modDepth: GainNode;
  bp: BiquadFilterNode;
  lp: BiquadFilterNode;
  master: GainNode;
  intake: OscillatorNode;
  intakeGain: GainNode;
}

let g: Graph | null = null;
let unsub: (() => void) | null = null;
let lastCfg: EngineConfig | null = null;

const HARMONICS = 160;

function bankWave(ctx: AudioContext, phasesDeg: number[], n: number): PeriodicWave {
  const real = new Float32Array(HARMONICS);
  const imag = new Float32Array(HARMONICS);
  // Pulse width: a fraction of the firing interval (sharper for fewer cylinders).
  const width = ((2 * Math.PI) / Math.max(2, n)) * 0.28;
  phasesDeg.forEach((ph, k) => {
    const phi = (ph / 720) * 2 * Math.PI;
    // Slight per-cylinder amplitude variance gives character.
    const amp = 1 + 0.07 * Math.sin(k * 2.3 + n);
    for (let m = 1; m < HARMONICS; m++) {
      const G = Math.exp(-0.5 * (m * width) ** 2) * amp;
      real[m] += G * Math.cos(m * phi);
      imag[m] += G * Math.sin(m * phi);
    }
  });
  return ctx.createPeriodicWave(real, imag);
}

function applyConfig(cfg: EngineConfig) {
  if (!g) return;
  lastCfg = cfg;
  const lay = computeLayout(cfg);
  const n = lay.cylinders.length;
  const a = lay.cylinders.filter((c) => c.bank === 0).map((c) => c.firingPhaseDeg);
  const b = lay.cylinders.filter((c) => c.bank === 1).map((c) => c.firingPhaseDeg);
  const all = lay.cylinders.map((c) => c.firingPhaseDeg);
  if (cfg.layout === 'inline' || b.length === 0) {
    const w = bankWave(g.ctx, all, n);
    g.oscA.setPeriodicWave(w);
    g.oscB.setPeriodicWave(w);
  } else {
    // Flat-plane V8 / V12 etc: each bank is itself even; crossplane gets per-bank uneven pulses.
    g.oscA.setPeriodicWave(bankWave(g.ctx, a, n));
    g.oscB.setPeriodicWave(bankWave(g.ctx, b, n));
  }
}

function update() {
  if (!g) return;
  const s = useStore.getState();
  const t = g.ctx.currentTime;
  const rpm = s.running ? s.rpm : 0;
  const fCycle = Math.max(0.5, rpm / 120);
  const load = s.load;
  [g.oscA, g.oscB].forEach((o) => o.frequency.setTargetAtTime(fCycle, t, 0.015));
  const nCyl = s.config.cylinders;
  const firing = fCycle * nCyl;
  g.lp.frequency.setTargetAtTime(Math.min(14000, 350 + firing * 6 + load * 3800), t, 0.03);
  g.bp.frequency.setTargetAtTime(Math.min(8000, 400 + firing * 3), t, 0.03);
  g.modDepth.gain.setTargetAtTime(0.25 + load * 0.55, t, 0.05);
  g.intake.frequency.setTargetAtTime(firing * 2, t, 0.02);
  g.intakeGain.gain.setTargetAtTime(load * 0.04 * (s.config.itb ? 2.2 : 1), t, 0.05);
  const vol = s.muted || !s.running ? 0 : 0.1 + 0.22 * load;
  g.master.gain.setTargetAtTime(vol, t, 0.06);
  if (s.config !== lastCfg) applyConfig(s.config);
}

function build(): Graph {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.9;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.2 * x);
  }
  shaper.curve = curve;
  shaper.oversample = '2x';
  shaper.connect(lp).connect(master);

  const panA = ctx.createStereoPanner();
  panA.pan.value = -0.55;
  const panB = ctx.createStereoPanner();
  panB.pan.value = 0.55;
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  const gA = ctx.createGain();
  const gB = ctx.createGain();
  gA.gain.value = 0.5;
  gB.gain.value = 0.5;
  oscA.connect(gA).connect(panA).connect(shaper);
  oscB.connect(gB).connect(panB).connect(shaper);

  // Pulse-gated noise.
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.04;
  const modDepth = ctx.createGain();
  modDepth.gain.value = 0.3;
  oscA.connect(modDepth).connect(noiseGain.gain);
  noise.connect(bp).connect(noiseGain).connect(shaper);

  // Intake whine/howl, faint.
  const intake = ctx.createOscillator();
  intake.type = 'triangle';
  const intakeGain = ctx.createGain();
  intakeGain.gain.value = 0;
  intake.connect(intakeGain).connect(lp);

  const t0 = ctx.currentTime + 0.02;
  oscA.start(t0);
  oscB.start(t0);
  noise.start(t0);
  intake.start(t0);
  return { ctx, oscA, oscB, noiseGain, modDepth, bp, lp, master, intake, intakeGain };
}

/** Call from a user gesture. */
export function setAudioEnabled(on: boolean) {
  if (on) {
    try {
      if (!g) {
        g = build();
        applyConfig(useStore.getState().config);
        unsub = useStore.subscribe(update);
      }
      void g.ctx.resume();
      update();
    } catch (e) {
      console.warn('[engine-forge] audio unavailable', e);
    }
  } else if (g) {
    update();
    const ctx = g.ctx;
    window.setTimeout(() => {
      if (useStore.getState().muted) void ctx.suspend();
    }, 300);
  }
}

export function disposeAudio() {
  unsub?.();
  unsub = null;
  if (g) void g.ctx.close();
  g = null;
}
