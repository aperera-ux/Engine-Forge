import { simulate } from '../../sim/engine';
import { DYNO_CURVES, DYNO_ENGINE_BY_ID } from '../../sim/validation/dynoCurves';
import { runAcceleration } from '../accelerate';
import { buildTorqueCurve, curveFromSimResult, scaleCurveToPeaks } from '../torqueCurve';
import type { AccelResult, RunOptions, TorqueCurve, VehicleGlobals } from '../types';
import { REFERENCE_CARS, type ReferenceCar } from './referenceCars';

export type CurveSource = 'published' | 'simulated';

export interface CurveInfo {
  curve: TorqueCurve;
  /** 'dyno-curve' = digitised published curve; 'peak-scaled' = simulator shape scaled to published peaks. */
  basis: 'dyno-curve' | 'peak-scaled' | 'simulated';
}

const simCache = new Map<string, ReturnType<typeof simulate>>();
function simFor(engineId: string) {
  let r = simCache.get(engineId);
  if (!r) {
    r = simulate(DYNO_ENGINE_BY_ID[engineId].config);
    simCache.set(engineId, r);
  }
  return r;
}

export function curveFor(engineId: string, src: CurveSource): CurveInfo {
  const eng = DYNO_ENGINE_BY_ID[engineId];
  if (!eng) throw new Error(`unknown engine ${engineId}`);
  const sim = simFor(engineId);
  if (src === 'simulated') return { curve: curveFromSimResult(sim), basis: 'simulated' };
  const dyno = DYNO_CURVES.find((c) => c.engineId === engineId && c.crankBasis);
  if (dyno) {
    return {
      curve: buildTorqueCurve(
        dyno.points.map((p) => ({ rpm: p.rpm, torqueNm: p.torqueNm })),
        eng.config.redlineRpm,
        sim.displacementL,
      ),
      basis: 'dyno-curve',
    };
  }
  return { curve: scaleCurveToPeaks(sim, eng.published), basis: 'peak-scaled' };
}

export interface CarRow {
  car: ReferenceCar;
  src: CurveSource;
  basis: CurveInfo['basis'];
  result: AccelResult;
  /** Signed % error (model - measured)/measured; null if no reference value. */
  err060: number | null;
  errQm: number | null;
  errTrap: number | null;
}

const pct = (m: number | null, r: number | null) => (m === null || r === null ? null : (100 * (m - r)) / r);

export function evaluateCar(car: ReferenceCar, src: CurveSource, opts: RunOptions = {}): CarRow {
  const ci = curveFor(car.engineId, src);
  const result = runAcceleration(car.spec, ci.curve, { rollout: car.measured.rollout, sampleDt: 0, ...opts });
  return {
    car,
    src,
    basis: ci.basis,
    result,
    err060: pct(result.t0to60mph, car.measured.zeroTo60),
    errQm: pct(result.quarterMileS, car.measured.quarterMileS),
    errTrap: pct(result.quarterMileTrapMph, car.measured.quarterMileTrapMph),
  };
}

export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
};

export interface Summary {
  n: number;
  med060: number;
  medQm: number;
  medTrap: number;
  /** Median of signed errors (bias). */
  bias060: number;
  biasQm: number;
  biasTrap: number;
}

export function summarize(rows: CarRow[]): Summary {
  const abs = (f: (r: CarRow) => number | null) => rows.map(f).filter((x): x is number => x !== null).map(Math.abs);
  const sgn = (f: (r: CarRow) => number | null) => rows.map(f).filter((x): x is number => x !== null);
  return {
    n: rows.length,
    med060: median(abs((r) => r.err060)),
    medQm: median(abs((r) => r.errQm)),
    medTrap: median(abs((r) => r.errTrap)),
    bias060: median(sgn((r) => r.err060)),
    biasQm: median(sgn((r) => r.errQm)),
    biasTrap: median(sgn((r) => r.errTrap)),
  };
}

export function evaluateAll(src: CurveSource, globals?: Partial<VehicleGlobals>): CarRow[] {
  return REFERENCE_CARS.map((c) => evaluateCar(c, src, { globals }));
}

const f = (x: number | null, d = 2) => (x === null ? '  -  ' : x.toFixed(d));
const e = (x: number | null) => (x === null ? '  -  ' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%');

export function formatTable(rows: CarRow[]): string {
  const lines = ['car | split | basis | 0-60 meas/model/err | 1/4 ET meas/model/err | trap meas/model/err'];
  for (const r of rows) {
    const m = r.car.measured;
    lines.push(
      `${r.car.id} | ${r.car.split} | ${r.basis} | ${f(m.zeroTo60, 1)}/${f(r.result.t0to60mph)}/${e(r.err060)} | ${f(m.quarterMileS, 1)}/${f(r.result.quarterMileS)}/${e(r.errQm)} | ${f(m.quarterMileTrapMph, 1)}/${f(r.result.quarterMileTrapMph, 1)}/${e(r.errTrap)}`,
    );
  }
  return lines.join('\n');
}
