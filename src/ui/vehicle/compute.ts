/**
 * Pure vehicle jobs. Runs identically inside the Web Worker and (fallback) on the main thread.
 * Everything in/out is structured-cloneable.
 */
import { optimizeGearing, runAcceleration, topSpeed, tractionCap, type AccelResult, type Objective, type RunOptions, type TopSpeed, type TorqueCurve, type VehicleSpec } from '../../vehicle';
import { resistance, resolve, rpmFromSpeed, speedFromRpm, msToKph } from '../../vehicle/physics';
import { torqueAt } from '../../vehicle/torqueCurve';

export interface RunConditions {
  ambient: { tempC: number; pressureKPa: number };
  shiftStrategy: 'optimal' | 'redline';
  shiftRpmFraction: number;
  rollout: boolean;
}

export interface SimRequest {
  kind: 'sim';
  spec: VehicleSpec;
  curve: TorqueCurve;
  idleRpm: number;
  cond: RunConditions;
}
export interface OptimizeRequest {
  kind: 'optimize';
  spec: VehicleSpec;
  curve: TorqueCurve;
  cond: RunConditions;
  objective: Objective;
  finalDrive: boolean;
  gearRatios: boolean;
}
export type VehicleRequest = SimRequest | OptimizeRequest;

export interface GearForce {
  gear: number;
  /** Road speed, km/h. */
  kph: number[];
  /** Wheel tractive force, N (before the traction cap). */
  n: number[];
}

export interface SimOutput {
  kind: 'sim';
  accel: AccelResult;
  top: TopSpeed;
  gears: GearForce[];
  roadLoad: { kph: number[]; n: number[] };
  /** Tyre-grip limits, N (launch uses the fitted launch-utilisation factor). */
  gripFullN: number;
  redlineRpm: number;
  /** Speed at redline in each gear, km/h. */
  redlineKph: number[];
  mu: number;
  massKg: number;
  /** Engine peak power, kW and rpm, from the curve (crank basis). */
  peakKw: number;
  peakKwRpm: number;
  ms: number;
}
export interface OptimizeOutput {
  kind: 'optimize';
  objective: Objective;
  baseline: number;
  best: number;
  finalDrive0: number;
  finalDrive: number;
  gearRatios0: number[];
  gearRatios: number[];
  evaluations: number;
  ms: number;
}
export type VehicleResponse = SimOutput | OptimizeOutput | { kind: 'error'; message: string };

const runOpts = (c: RunConditions): RunOptions => ({
  ambient: { tempC: c.ambient.tempC, pressureKPa: c.ambient.pressureKPa, humidity: 0 },
  shiftStrategy: c.shiftStrategy,
  shiftRpmFraction: c.shiftRpmFraction,
  rollout: c.rollout,
});

/** Keep the series only until the car stops accelerating (top speed / limiter), so the charts do not fill with a plateau. */
function trimSeries(a: AccelResult): AccelResult {
  const s = a.series;
  if (!s) return a;
  let n = s.t.length;
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] > 3 && s.gear[i] > 0 && s.a[i] < 0.03) {
      n = i + 1;
      break;
    }
  }
  if (n === s.t.length) return a;
  return {
    ...a,
    series: {
      t: s.t.slice(0, n),
      v: s.v.slice(0, n),
      a: s.a.slice(0, n),
      gear: s.gear.slice(0, n),
      rpm: s.rpm.slice(0, n),
      distance: s.distance.slice(0, n),
      tractionLimited: s.tractionLimited.slice(0, n),
    },
  };
}

export function simulateVehicle(req: SimRequest): SimOutput {
  const t0 = performance.now();
  const o = runOpts(req.cond);
  // Long enough for 60-130 on a quick car; the series is trimmed once acceleration dies out.
  const accel = trimSeries(runAcceleration(req.spec, req.curve, { ...o, stopSpeedMph: 130, maxTimeS: 40, sampleDt: 0.02 }));
  const top = topSpeed(req.spec, req.curve, o);
  const R = resolve(req.spec, req.curve, o);
  const redlineRpm = req.curve.redlineRpm;
  const rpmLo = Math.max(req.idleRpm, 0.18 * redlineRpm);
  const gears: GearForce[] = [];
  const redlineKph: number[] = [];
  for (let gi = 0; gi < R.ratios.length; gi++) {
    const vLo = speedFromRpm(R, rpmLo, gi);
    const vHi = speedFromRpm(R, redlineRpm, gi);
    redlineKph.push(msToKph(vHi));
    const kph: number[] = [];
    const n: number[] = [];
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const v = vLo + ((vHi - vLo) * i) / N;
      const rpm = rpmFromSpeed(R, v, gi);
      kph.push(msToKph(v));
      n.push((torqueAt(req.curve, rpm) * R.ratios[gi] * R.eta) / R.r);
    }
    gears.push({ gear: gi + 1, kph, n });
  }
  const vMax = Math.max(speedFromRpm(R, redlineRpm, R.ratios.length - 1) * 1.05, top.speedMs * 1.05);
  const roadKph: number[] = [];
  const roadN: number[] = [];
  for (let i = 0; i <= 60; i++) {
    const v = (vMax * i) / 60;
    roadKph.push(msToKph(v));
    roadN.push(resistance(R, v));
  }
  let peakKw = 0;
  let peakKwRpm = 0;
  for (let rpm = 500; rpm <= redlineRpm; rpm += 50) {
    const kw = (torqueAt(req.curve, rpm) * rpm * 2 * Math.PI) / 60 / 1000;
    if (kw > peakKw) {
      peakKw = kw;
      peakKwRpm = rpm;
    }
  }
  return {
    kind: 'sim',
    accel,
    top,
    gears,
    roadLoad: { kph: roadKph, n: roadN },
    gripFullN: tractionCap(R, R.mu),
    redlineRpm,
    redlineKph,
    mu: R.mu,
    massKg: R.mass,
    peakKw,
    peakKwRpm,
    ms: performance.now() - t0,
  };
}

export function optimizeVehicle(req: OptimizeRequest): OptimizeOutput {
  const t0 = performance.now();
  // Through the public API only: whatever launch/traction model src/vehicle has is what gets optimised.
  const r = optimizeGearing(req.spec, req.curve, {
    objective: req.objective,
    finalDrive: req.finalDrive,
    gearRatios: req.gearRatios,
    run: runOpts(req.cond),
  });
  return {
    kind: 'optimize',
    objective: req.objective,
    baseline: r.baseline,
    best: r.best,
    finalDrive0: req.spec.transmission.finalDrive,
    finalDrive: r.finalDrive,
    gearRatios0: req.spec.transmission.gearRatios.slice(),
    gearRatios: r.gearRatios,
    evaluations: r.evaluations,
    ms: performance.now() - t0,
  };
}

export function handleRequest(req: VehicleRequest): VehicleResponse {
  try {
    return req.kind === 'sim' ? simulateVehicle(req) : optimizeVehicle(req);
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
