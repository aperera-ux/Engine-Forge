import { runAcceleration } from './accelerate';
import type { RunOptions, TorqueCurve, VehicleSpec } from './types';

/** Default optimiser search ranges (multiples of the current value). Used by the UI to detect optima on a range edge. */
export const DEFAULT_FINAL_DRIVE_RANGE: readonly [number, number] = [0.7, 1.4];
export const DEFAULT_RATIO_SCALE_RANGE: readonly [number, number] = [0.85, 1.15];

export type Objective = '0-60' | '0-100kph' | 'quarter-mile' | '60-130';

export interface OptimizeOptions {
  objective: Objective;
  /** Search the final drive. Default true. */
  finalDrive?: boolean;
  /** Also search individual gear ratios (coordinate descent). Default false. */
  gearRatios?: boolean;
  /** Final-drive search range as a multiple of the current value. Default DEFAULT_FINAL_DRIVE_RANGE. */
  finalDriveRange?: [number, number];
  /** Per-gear scale limits relative to the original ratio. Default DEFAULT_RATIO_SCALE_RANGE. */
  ratioScaleRange?: [number, number];
  /** Minimum ratio step between adjacent gears (r_n / r_{n+1}). Default 1.05. */
  minStep?: number;
  /** Maximum overall speed in top gear must not exceed the engine redline by this factor (keeps it driveable). Optional. */
  run?: RunOptions;
}

export interface OptimizeResult {
  spec: VehicleSpec;
  finalDrive: number;
  gearRatios: number[];
  objective: Objective;
  baseline: number;
  best: number;
  evaluations: number;
}

function score(spec: VehicleSpec, engine: TorqueCurve, obj: Objective, run: RunOptions): number {
  const o: RunOptions = { sampleDt: 0, ...run };
  if (obj === '0-60') {
    o.stopSpeedMph = 60;
    o.stopDistanceM = 0;
  } else if (obj === '0-100kph') {
    o.stopSpeedMph = 62.2;
    o.stopDistanceM = 0;
  } else if (obj === '60-130') {
    o.stopSpeedMph = 130;
    o.stopDistanceM = 0;
    o.maxTimeS = 40;
  }
  const r = runAcceleration(spec, engine, o);
  const v = obj === '0-60' ? r.t0to60mph : obj === '0-100kph' ? r.t0to100kph : obj === '60-130' ? r.t60to130mph : r.quarterMileS;
  return v ?? 1e9;
}

const withTransmission = (spec: VehicleSpec, fd: number, ratios: number[]): VehicleSpec => ({
  ...spec,
  transmission: { ...spec.transmission, finalDrive: fd, gearRatios: ratios },
});

/**
 * Gearing optimiser. 1) Final drive: coarse grid over the range then
 * golden-section refinement of the best bracket. 2) Optionally gear ratios:
 * coordinate descent on a per-gear scale within ratioScaleRange, keeping
 * ratios strictly decreasing with at least `minStep` between neighbours.
 * ~40-80 simulated runs for the final drive alone.
 */
export function optimizeGearing(spec: VehicleSpec, engine: TorqueCurve, o: OptimizeOptions): OptimizeResult {
  const run = o.run ?? {};
  const [fLo, fHi] = o.finalDriveRange ?? DEFAULT_FINAL_DRIVE_RANGE;
  const [sLo, sHi] = o.ratioScaleRange ?? DEFAULT_RATIO_SCALE_RANGE;
  const minStep = o.minStep ?? 1.05;
  let evals = 0;
  const f = (fd: number, ratios: number[]) => {
    evals++;
    return score(withTransmission(spec, fd, ratios), engine, o.objective, run);
  };
  const base = spec.transmission.gearRatios.slice();
  const fd0 = spec.transmission.finalDrive;
  const baseline = f(fd0, base);
  let fd = fd0;
  let ratios = base.slice();
  let best = baseline;

  if (o.finalDrive !== false) {
    const N = 15;
    let bi = 0;
    let bv = Infinity;
    const grid: number[] = [];
    for (let i = 0; i <= N; i++) {
      const x = fd0 * (fLo + ((fHi - fLo) * i) / N);
      grid.push(x);
      const val = f(x, ratios);
      if (val < bv) {
        bv = val;
        bi = i;
      }
    }
    let a = grid[Math.max(0, bi - 1)];
    let b = grid[Math.min(N, bi + 1)];
    const gr = 0.6180339887;
    let c = b - gr * (b - a);
    let d = a + gr * (b - a);
    let fc = f(c, ratios);
    let fdv = f(d, ratios);
    for (let k = 0; k < 12; k++) {
      if (fc < fdv) {
        b = d;
        d = c;
        fdv = fc;
        c = b - gr * (b - a);
        fc = f(c, ratios);
      } else {
        a = c;
        c = d;
        fc = fdv;
        d = a + gr * (b - a);
        fdv = f(d, ratios);
      }
    }
    const cand = fc < fdv ? c : d;
    const cv = Math.min(fc, fdv);
    if (cv < bv) {
      fd = cand;
      best = cv;
    } else {
      fd = grid[bi];
      best = bv;
    }
    if (best > baseline) {
      fd = fd0;
      best = baseline;
    }
  }

  if (o.gearRatios) {
    const valid = (r: number[]) => r.every((x, i) => i === 0 || r[i - 1] / x >= minStep);
    for (let sweep = 0; sweep < 2; sweep++) {
      for (let g = 0; g < ratios.length; g++) {
        for (const s of [0.97, 1.03, 0.99, 1.01]) {
          for (let rep = 0; rep < 6; rep++) {
            const trial = ratios.slice();
            trial[g] = trial[g] * s;
            if (trial[g] < base[g] * sLo || trial[g] > base[g] * sHi || !valid(trial)) break;
            const val = f(fd, trial);
            if (val < best - 1e-5) {
              best = val;
              ratios = trial;
            } else break;
          }
        }
      }
    }
  }
  return { spec: withTransmission(spec, fd, ratios), finalDrive: fd, gearRatios: ratios, objective: o.objective, baseline, best, evaluations: evals };
}
