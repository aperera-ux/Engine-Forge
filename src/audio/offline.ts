/**
 * Offline rendering with the same DSP core as the live worklet: test engines,
 * scripted scenarios (state automation over time) and a render loop.
 * Pure TS: used by scripts/audio/render.ts and the vitest suite.
 */
import type { EngineConfig } from '../sim/types';
import { DEFAULT_CONFIG } from '../sim/defaults';
import { REFERENCE_ENGINES } from '../sim/validation/referenceEngines';
import { simulate } from '../sim/engine';
import { deriveSoundParams, type EngineSoundParams } from './params';
import { EngineSynth, type EngineState, type SynthOptions, type SynthStats } from './synth/EngineSynth';

const ref = (id: string): EngineConfig => {
  const e = REFERENCE_ENGINES.find((r) => r.id === id);
  if (!e) throw new Error(`missing reference engine ${id}`);
  return structuredClone(e.config);
};

/** Harley-style 45° shared-pin V-twin (hypothetical build, not a reference engine). */
export const VTWIN: EngineConfig = {
  ...structuredClone(DEFAULT_CONFIG),
  name: 'V-twin 1.75 L 45° pushrod (Harley-style)',
  layout: 'v',
  cylinders: 2,
  vAngleDeg: 45,
  crankPlane: 'cross',
  boreMm: 100,
  strokeMm: 111,
  rodLengthMm: 170,
  compressionRatio: 10,
  valvetrain: 'pushrod',
  valvesPerCylinder: 2,
  intakeValveMm: 50,
  exhaustValveMm: 41,
  cam: {
    intakeDurationDeg: 225,
    exhaustDurationDeg: 232,
    intakeLiftMm: 13,
    exhaustLiftMm: 13,
    lobeSeparationDeg: 106,
    intakeCenterlineDeg: 104,
    vvt: false,
    variableLift: false,
  },
  induction: 'na',
  turbo: { ...DEFAULT_CONFIG.turbo, targetBoostBar: 0 },
  supercharger: { ...DEFAULT_CONFIG.supercharger, targetBoostBar: 0 },
  intakeRunnerMm: 180,
  throttleMm: 55,
  itb: false,
  exhaust: 'shorty',
  headerPrimaryMm: 500,
  headerDiameterMm: 45,
  fuel: 'gas91',
  lambda: 0.88,
  directInjection: false,
  redlineRpm: 5600,
  idleRpm: 900,
};

export interface TestEngine {
  id: string;
  label: string;
  config: EngineConfig;
}

export const TEST_ENGINES: TestEngine[] = [
  { id: 'k20a', label: 'Honda K20A I4 (NA, 4-2-1)', config: ref('honda-k20a-dc5') },
  { id: 'ls3', label: 'GM LS3 crossplane V8', config: ref('gm-ls3') },
  { id: 'f136', label: 'Ferrari F136 flat-plane V8', config: ref('ferrari-f136-458') },
  { id: 'f140', label: 'Ferrari F140 V12', config: ref('ferrari-f140fc-f12') },
  { id: 'ej257', label: 'Subaru EJ257 flat-4 turbo (UEL)', config: ref('subaru-ej257-sti') },
  { id: 'b58', label: 'BMW B58 I6 turbo', config: ref('bmw-b58-340i') },
  { id: 'hellcat', label: 'Dodge Hellcat supercharged V8', config: ref('dodge-hellcat-62') },
  { id: 'ecoboost-i3', label: 'Ford 1.0 EcoBoost I3 turbo', config: ref('ford-10-ecoboost') },
  { id: 'vtwin', label: 'V-twin 45° (Harley-style)', config: VTWIN },
];

export function testEngine(id: string): TestEngine {
  const e = TEST_ENGINES.find((t) => t.id === id);
  if (!e) throw new Error(`unknown test engine ${id}`);
  return { ...e, config: structuredClone(e.config) };
}

export function paramsFor(cfg: EngineConfig): EngineSoundParams {
  return deriveSoundParams(cfg, simulate(cfg));
}

export interface Scenario {
  id: string;
  durationS: number;
  /** State at time t (s). */
  at: (t: number, cfg: EngineConfig) => EngineState;
  description: string;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'idle',
    durationS: 10,
    description: 'Warm idle, closed throttle.',
    at: (_t, c) => ({ rpm: c.idleRpm, load: 0.1 }),
  },
  {
    id: 'pull',
    durationS: 16,
    description: 'Idle 1.5 s → WOT pull to redline (~8 s) → 1.2 s on the limiter → lift-off overrun to idle.',
    at: (t, c) => {
      const t0 = 1.5;
      const sweep = 8;
      const lim = 1.2;
      const fall = 3.5;
      const start = c.idleRpm;
      if (t < t0) return { rpm: c.idleRpm, load: 0.1 };
      if (t < t0 + sweep) {
        const x = (t - t0) / sweep;
        // Inertia-dyno style: slightly accelerating at the bottom, flattening at the top.
        const shaped = Math.min(1, 0.15 * x + 0.85 * (1 - Math.pow(1 - x, 1.6)));
        return { rpm: lerp(start, c.redlineRpm, shaped), load: lerp(0.1, 1, (t - t0) / 0.15) };
      }
      if (t < t0 + sweep + lim) return { rpm: c.redlineRpm, load: 1 };
      const x = (t - t0 - sweep - lim) / fall;
      return { rpm: lerp(c.redlineRpm, c.idleRpm * 1.15, ease(x)), load: 0 };
    },
  },
  {
    id: 'cruise',
    durationS: 8,
    description: 'Part-throttle cruise at ~35 % of redline, 30 % load with gentle variations.',
    at: (t, c) => ({ rpm: Math.round(c.redlineRpm * 0.35) + 60 * Math.sin(t * 0.7), load: 0.3 + 0.05 * Math.sin(t * 1.3) }),
  },
  {
    id: 'overrun',
    durationS: 8,
    description: 'WOT at 75 % redline for 1.5 s, then lift-off: closed-throttle overrun down to idle (pops/crackle, DFCO, BOV on turbos).',
    at: (t, c) => {
      const hi = c.redlineRpm * 0.75;
      if (t < 1.5) return { rpm: lerp(hi * 0.85, hi, t / 1.5), load: 1 };
      return { rpm: lerp(hi, c.idleRpm * 1.1, ease((t - 1.5) / 5.5)), load: 0 };
    },
  },
];

export function scenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}

/** Steady state at fixed rpm/load (for order analysis). */
export function steady(rpm: number, load: number, durationS = 4): Scenario {
  return { id: `steady-${rpm}-${load}`, durationS, description: 'steady', at: () => ({ rpm, load }) };
}

export interface RenderResult {
  left: Float32Array;
  right: Float32Array;
  fs: number;
  stats: SynthStats;
  /** Wall time spent in synth.process, ms. */
  cpuMs: number;
  /** State timeline sampled per block (for analysis). */
  rpmTrack: Float32Array;
  loadTrack: Float32Array;
}

export function renderScenario(params: EngineSoundParams, cfg: EngineConfig, sc: Scenario, fs = 48000, opts: SynthOptions = {}, warmupS = 0.5): RenderResult {
  const synth = new EngineSynth(fs, opts);
  synth.setEngine(params);
  const block = 128;
  const s0 = sc.at(0, cfg);
  synth.setState(s0);
  synth.settle();
  // Warm-up (discarded): fills the pipes and settles temperatures.
  const wl = new Float32Array(block);
  const wr = new Float32Array(block);
  for (let i = 0; i < Math.ceil((warmupS * fs) / block); i++) synth.process(wl, wr);
  synth.stats.peak = 0;
  const n = Math.round(sc.durationS * fs);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const nb = Math.ceil(n / block);
  const rpmTrack = new Float32Array(nb);
  const loadTrack = new Float32Array(nb);
  let cpu = 0;
  for (let b = 0; b < nb; b++) {
    const st = sc.at((b * block) / fs, cfg);
    synth.setState(st);
    rpmTrack[b] = st.rpm;
    loadTrack[b] = st.load;
    const a = b * block;
    const e = Math.min(n, a + block);
    const l = left.subarray(a, e);
    const r = right.subarray(a, e);
    const t0 = performance.now();
    synth.process(l, r);
    cpu += performance.now() - t0;
  }
  return { left, right, fs, stats: { ...synth.stats }, cpuMs: cpu, rpmTrack, loadTrack };
}
