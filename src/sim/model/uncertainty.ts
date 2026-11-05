/**
 * Prediction uncertainty: a ±% band per dyno point, derived from the model's
 * validation residuals and widened by how far the configuration lies outside
 * the envelope of the validated reference engines (extrapolation score with
 * human-readable reasons). Data only — the UI decides how to draw it.
 */
import type { DynoPoint, EngineConfig, SimUncertainty } from '../types';
import { REFERENCE_ENGINES } from '../validation/referenceEngines';
import { CAL } from './constants';

interface Feature {
  key: string;
  label: string;
  unit: string;
  get: (c: EngineConfig) => number;
}

const sp = (c: EngineConfig) => (2 * (c.strokeMm / 1000) * c.redlineRpm) / 60;
const cylL = (c: EngineConfig) => (Math.PI / 4) * (c.boreMm / 100) ** 2 * (c.strokeMm / 100);
const boost = (c: EngineConfig) => (c.induction === 'turbo' ? c.turbo.targetBoostBar : c.induction === 'supercharger' ? c.supercharger.targetBoostBar : 0);

const FEATURES: Feature[] = [
  { key: 'bore', label: 'bore', unit: 'mm', get: (c) => c.boreMm },
  { key: 'bs', label: 'bore/stroke ratio', unit: '', get: (c) => c.boreMm / c.strokeMm },
  { key: 'cyl', label: 'cylinder size', unit: 'L', get: cylL },
  { key: 'cr', label: 'compression ratio', unit: '', get: (c) => c.compressionRatio },
  { key: 'sp', label: 'mean piston speed at redline', unit: 'm/s', get: sp },
  { key: 'redline', label: 'redline', unit: 'rpm', get: (c) => c.redlineRpm },
  { key: 'boost', label: 'boost', unit: 'bar', get: boost },
  { key: 'durI', label: 'intake duration @0.050"', unit: '°', get: (c) => c.cam.intakeDurationDeg },
  { key: 'lsa', label: 'lobe separation', unit: '°', get: (c) => c.cam.lobeSeparationDeg },
  { key: 'runner', label: 'intake runner length', unit: 'mm', get: (c) => c.intakeRunnerMm },
  { key: 'header', label: 'header primary length', unit: 'mm', get: (c) => c.headerPrimaryMm },
  { key: 'lambda', label: 'lambda', unit: '', get: (c) => c.lambda },
  { key: 'ivd', label: 'intake valve / bore', unit: '', get: (c) => c.intakeValveMm / c.boreMm },
];

let envelope: { f: Feature; lo: number; hi: number }[] | null = null;
let fuels: Set<string> | null = null;
let cylCounts: Set<number> | null = null;

function ensureEnvelope() {
  if (envelope) return;
  envelope = FEATURES.map((f) => {
    const v = REFERENCE_ENGINES.map((e) => f.get(e.config));
    return { f, lo: Math.min(...v), hi: Math.max(...v) };
  });
  fuels = new Set(REFERENCE_ENGINES.map((e) => e.config.fuel));
  cylCounts = new Set(REFERENCE_ENGINES.map((e) => e.config.cylinders));
}

const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));

export function computeUncertainty(c: EngineConfig, curve: DynoPoint[], peakPowerRpm: number, peakTorqueRpm: number): SimUncertainty {
  ensureEnvelope();
  const reasons: string[] = [];
  let d2 = 0;
  for (const { f, lo, hi } of envelope!) {
    const x = f.get(c);
    const span = Math.max(1e-9, hi - lo);
    const out = x < lo ? (lo - x) / span : x > hi ? (x - hi) / span : 0;
    if (out > 0.02) {
      d2 += out * out;
      reasons.push(`${f.label} ${fmt(x)}${f.unit} is outside the validated range ${fmt(lo)}–${fmt(hi)}${f.unit}`);
    }
  }
  if (!fuels!.has(c.fuel)) {
    d2 += 0.25;
    reasons.push(`fuel ${c.fuel} is not represented in the validation set (knock and efficiency are extrapolated)`);
  }
  if (!cylCounts!.has(c.cylinders)) {
    d2 += 0.05;
    reasons.push(`${c.cylinders}-cylinder engines are not in the validation set`);
  }
  if (c.induction === 'supercharger' && c.supercharger.type !== 'twin-screw') {
    d2 += 0.1;
    reasons.push(`${c.supercharger.type} superchargers are not in the validation set (only twin-screw)`);
  }
  // 0 = inside the envelope; → 1 far outside.
  const extrapolation = 1 - Math.exp(-CAL.uncExtrapK * d2);
  const knockMax = Math.max(0, ...curve.map((p) => p.knockRetardDeg));
  if (knockMax > 15) reasons.push(`heavy knock retard (${knockMax.toFixed(0)}°): the knock model is least certain there`);

  const widen = 1 + CAL.uncExtrapWiden * extrapolation;
  const rpmTq = Math.max(1, peakTorqueRpm);
  const torquePct = curve.map((p) => {
    // Residual-based base band; curve shape is less certain away from the peak
    // and at lugging speeds; knock-limited and boosted points add spread.
    const off = Math.abs(Math.log(p.rpm / rpmTq));
    let b = CAL.uncBasePct * (1 + CAL.uncShapePerLn * off) + (p.rpm < 2000 ? CAL.uncLowRpmPct : 0);
    b += CAL.uncKnockPctPerDeg * p.knockRetardDeg;
    if (p.boostBar > 0.05) b += CAL.uncBoostPct;
    return Math.round(10 * b * widen) / 10;
  });
  const at = (rpm: number) => torquePct[Math.max(0, curve.findIndex((p) => p.rpm === rpm))] ?? torquePct[0];
  return {
    torquePct,
    peakHpPct: at(peakPowerRpm),
    peakTorquePct: at(peakTorqueRpm),
    extrapolation: Math.round(1000 * extrapolation) / 1000,
    reasons,
  };
}
