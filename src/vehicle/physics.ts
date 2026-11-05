import { G, GLOBALS, KPH, MPH } from './globals';
import { airDensity } from './tire';
import type { Ambient, RunOptions, TorqueCurve, VehicleGlobals, VehicleSpec } from './types';

export const DEFAULT_AMBIENT: Ambient = { tempC: 20, pressureKPa: 101.325, humidity: 0 };

/** Everything the integrator needs, resolved once per run. */
export interface Resolved {
  spec: VehicleSpec;
  g: VehicleGlobals;
  mass: number;
  rho: number;
  eta: number;
  mu: number;
  /** Rotating inertia of all four wheel assemblies expressed as mass, kg. */
  mWheels: number;
  /** Engine+driveline inertia, kg m^2. */
  iEng: number;
  ratios: number[]; // overall (gear * final) per gear
  r: number;
  shiftTimeS: number;
  clutchRampS: number;
  frontSplit: number;
}

/** Peak friction with tyre load sensitivity: mu0 * (1 - ks * (q - qref) / qref), q = static driven load per mm width. */
function tireMu(spec: VehicleSpec, g: VehicleGlobals, weightN: number): number {
  const mu0 = g.muByClass[spec.tireClass];
  const w = spec.tireWidthMm ?? 245;
  const drivenFrac = spec.layout === 'RWD' ? 1 - spec.frontWeightFraction : spec.layout === 'FWD' ? spec.frontWeightFraction : 1;
  const nTires = spec.layout === 'AWD' ? 4 : 2;
  const q = (weightN * drivenFrac) / (nTires * w);
  return mu0 * Math.max(0.6, 1 - (g.tireLoadSensitivity * (q - g.tireLoadRef)) / g.tireLoadRef);
}

export function mergeGlobals(over?: Partial<VehicleGlobals>): VehicleGlobals {
  return over ? { ...GLOBALS, ...over } : GLOBALS;
}

export function resolve(spec: VehicleSpec, engine: TorqueCurve, opts: RunOptions): Resolved {
  const g = mergeGlobals(opts.globals);
  const tr = spec.transmission;
  const eta =
    spec.drivetrainEfficiency ?? (spec.layout === 'RWD' ? g.etaRWD : spec.layout === 'FWD' ? g.etaFWD : g.etaAWD);
  const wheelM = spec.wheelMassKg ?? 20;
  const rg = 0.75 * spec.tireRadiusM; // radius of gyration of a wheel+tyre
  const iEng = (spec.engineInertiaKgM2 ?? 0.05 + 0.04 * engine.displacementL) * (1 + g.drivelineInertiaFraction);
  return {
    spec,
    g,
    mass: spec.curbMassKg + (spec.driverKg ?? g.driverKg),
    rho: airDensity(opts.ambient ?? DEFAULT_AMBIENT),
    eta,
    mu: spec.muPeak ?? tireMu(spec, g, (spec.curbMassKg + (spec.driverKg ?? g.driverKg)) * G),
    mWheels: (4 * wheelM * rg * rg) / (spec.tireRadiusM * spec.tireRadiusM),
    iEng,
    ratios: tr.gearRatios.map((x) => x * tr.finalDrive),
    r: spec.tireRadiusM,
    shiftTimeS: tr.shiftTimeS ?? g.shiftTimeS[tr.type],
    clutchRampS: g.clutchRampS[tr.type],
    frontSplit: spec.layout === 'FWD' ? 1 : spec.layout === 'RWD' ? 0 : (spec.awdFrontSplit ?? 0.4),
  };
}

/** Rolling + aerodynamic resistance, N (level road, no wind). */
export function resistance(R: Resolved, v: number): number {
  const s = R.spec;
  const x = v / 27.78;
  const crr = (s.crr0 ?? R.g.crr0) + (s.crr2 ?? R.g.crr2) * x * x;
  return crr * R.mass * G + 0.5 * R.rho * s.cdA * v * v;
}

/**
 * Maximum total tractive force before the driven tyres slip, N, with
 * longitudinal load transfer dN = F*h/L. Solved in closed form per axle for a
 * fixed front torque split s (s=1 FWD, 0 RWD):
 *   front: s F <= mu (W wf - F h/L)       -> F <= mu W wf / (s + mu h/L)
 *   rear : (1-s) F <= mu (W (1-wf) + F h/L) -> F <= mu W (1-wf) / ((1-s) - mu h/L)
 */
export function tractionCap(R: Resolved, mu: number): number {
  const s = R.spec;
  const W = R.mass * G;
  const k = (mu * s.cgHeightM) / s.wheelbaseM;
  const sp = R.frontSplit;
  let cap = Infinity;
  if (sp > 0) cap = Math.min(cap, (mu * W * s.frontWeightFraction) / (sp + k));
  const rd = 1 - sp - k;
  if (1 - sp > 0 && rd > 1e-9) cap = Math.min(cap, (mu * W * (1 - s.frontWeightFraction)) / rd);
  return cap;
}

export function rpmFromSpeed(R: Resolved, v: number, gearIdx: number): number {
  return ((v / R.r) * R.ratios[gearIdx] * 60) / (2 * Math.PI);
}

export function speedFromRpm(R: Resolved, rpm: number, gearIdx: number): number {
  return ((rpm * 2 * Math.PI) / 60) * (R.r / R.ratios[gearIdx]);
}

export const mphToMs = (x: number) => x * MPH;
export const msToMph = (x: number) => x / MPH;
export const msToKph = (x: number) => x / KPH;
