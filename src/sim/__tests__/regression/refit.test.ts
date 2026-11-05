/**
 * Train-only refit harness for global CAL constants (opt-in; skipped in normal runs).
 *
 *   SIM_REFIT=scan SIM_REFIT_PARAMS='{"knockTauScale":[1.2,1.33,1.45]}' npx vitest run src/sim/__tests__/regression/refit.test.ts
 *   SIM_REFIT=fit  SIM_REFIT_PARAMS='{"knockTauScale":[1.0,2.0],"ecuMaxRetardDeg":[8,12]}' npx vitest run src/sim/__tests__/regression/refit.test.ts
 *
 * It sees the 32 TRAIN dyno curves only: the holdout curves are never simulated
 * here, so a fit run cannot be steered by them (score the holdout once, after
 * freezing, with stats.test.ts). Objective = mean per-curve torque RMS over the
 * TRAIN set, computed exactly as stats.test.ts does.
 *  - scan: evaluates each listed value of each constant (others at their CAL value).
 *  - fit:  bounded coordinate descent (golden section per constant, a few sweeps)
 *          inside the given [min, max] range, which must be the documented
 *          literature range (physics_audit.md §14.2 / §17.1).
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../../engine';
import { CAL } from '../../model/constants';
import type { DynoPoint } from '../../types';
import { DYNO_CURVES, DYNO_ENGINE_BY_ID } from '../../validation/dynoCurves';
import { REFERENCE_ENGINES } from '../../validation/referenceEngines';

const MODE = process.env.SIM_REFIT;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

function torqueAt(curve: DynoPoint[], rpm: number): number | null {
  if (rpm < curve[0].rpm - 1e-6 || rpm > curve[curve.length - 1].rpm + 1e-6) return null;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (rpm >= a.rpm && rpm <= b.rpm) return a.torqueNm + ((rpm - a.rpm) / (b.rpm - a.rpm || 1)) * (b.torqueNm - a.torqueNm);
  }
  return curve[curve.length - 1].torqueNm;
}

const TRAIN = DYNO_CURVES.filter((c) => c.split === 'train');

export function trainScore(): { all: number; na: number; boost: number; per: Record<string, number> } {
  const per: Record<string, number> = {};
  const na: number[] = [];
  const bo: number[] = [];
  for (const c of TRAIN) {
    const e = DYNO_ENGINE_BY_ID[c.engineId];
    const r = simulate(e.config);
    const errs: number[] = [];
    for (const p of c.points) {
      const s = torqueAt(r.curve, p.rpm);
      if (s !== null) errs.push((100 * (s - p.torqueNm)) / p.torqueNm);
    }
    const rms = Math.sqrt(mean(errs.map((x) => x * x)));
    per[c.engineId] = rms;
    (e.config.induction === 'na' ? na : bo).push(rms);
  }
  return { all: mean([...na, ...bo]), na: mean(na), boost: mean(bo), per };
}

/**
 * 21-set peak-hp error (REFERENCE_ENGINES, excl. low-confidence ratings), as stats.test.ts.
 * None of these engines is in the dyno-curve holdout, so it is a TRAIN-side guard.
 */
export function set21(): { median: number; mean: number; max: number; meanTq: number; maxTq: number } {
  const rs = REFERENCE_ENGINES.filter((e) => (e.ratingConfidence ?? 'high') !== 'low').map((e) => ({ e, r: simulate(e.config) }));
  const abs = rs.map(({ e, r }) => Math.abs((100 * (r.peakHp - e.published.hp)) / e.published.hp)).sort((a, b) => a - b);
  const tq = rs.map(({ e, r }) => Math.abs((100 * (r.peakTorqueNm - e.published.torqueNm)) / e.published.torqueNm));
  return { median: abs[Math.floor(abs.length / 2)], mean: mean(abs), max: abs[abs.length - 1], meanTq: mean(tq), maxTq: Math.max(...tq) };
}
const HOLDOUT_IDS = new Set(DYNO_CURVES.filter((c) => c.split === 'holdout').map((c) => c.engineId));
if (REFERENCE_ENGINES.some((e) => HOLDOUT_IDS.has(e.id))) throw new Error('21-set overlaps the holdout: not usable as a train-side guard');

type Cal = Record<string, number>;
const cal = CAL as unknown as Cal;

describe.runIf(!!MODE)('train-only refit', () => {
  it(`mode ${MODE}`, () => {
    const spec = JSON.parse(process.env.SIM_REFIT_PARAMS ?? '{}') as Record<string, number[]>;
    const orig: Cal = Object.fromEntries(Object.keys(spec).map((k) => [k, cal[k]]));
    const f = (x: number) => x.toFixed(4);
    const base = trainScore();
    const g21 = (s: ReturnType<typeof set21>) => `| 21-set |hp| median ${f(s.median)} mean ${f(s.mean)} max ${f(s.max)} | |tq| mean ${f(s.meanTq)} max ${f(s.maxTq)}`;
    console.log(`TRAIN n=${TRAIN.length} at CAL: all ${f(base.all)}  na ${f(base.na)}  boost ${f(base.boost)} ${g21(set21())}  (${JSON.stringify(orig)})`);
    try {
      if (MODE === 'scan') {
        for (const [k, vals] of Object.entries(spec)) {
          for (const v of vals) {
            cal[k] = v;
            const s = trainScore();
            console.log(`  ${k}=${v}: all ${f(s.all)}  na ${f(s.na)}  boost ${f(s.boost)} ${g21(set21())}`);
          }
          cal[k] = orig[k];
        }
      } else if (MODE === 'fit') {
        const sweeps = Number(process.env.SIM_REFIT_SWEEPS ?? 2);
        const tol = Number(process.env.SIM_REFIT_TOL ?? 0.01);
        let best = base.all;
        for (let s = 0; s < sweeps; s++) {
          for (const [k, [lo0, hi0]] of Object.entries(spec)) {
            const cur = cal[k];
            const g = (x: number) => {
              cal[k] = x;
              return trainScore().all;
            };
            // Golden section on [lo, hi], then keep the best of it and the current value.
            const phi = (Math.sqrt(5) - 1) / 2;
            let a = lo0;
            let b = hi0;
            let x1 = b - phi * (b - a);
            let x2 = a + phi * (b - a);
            let f1 = g(x1);
            let f2 = g(x2);
            while (b - a > tol * (hi0 - lo0)) {
              if (f1 <= f2) {
                b = x2;
                x2 = x1;
                f2 = f1;
                x1 = b - phi * (b - a);
                f1 = g(x1);
              } else {
                a = x1;
                x1 = x2;
                f1 = f2;
                x2 = a + phi * (b - a);
                f2 = g(x2);
              }
            }
            const xb = f1 <= f2 ? x1 : x2;
            const fb = Math.min(f1, f2);
            if (fb < best) {
              best = fb;
              cal[k] = xb;
            } else cal[k] = cur;
            const atBound = Math.abs(cal[k] - lo0) < 0.02 * (hi0 - lo0) || Math.abs(cal[k] - hi0) < 0.02 * (hi0 - lo0);
            console.log(`  sweep ${s} ${k} = ${cal[k].toPrecision(5)}  train all ${f(best)}${atBound ? '  AT BOUND' : ''}`);
          }
        }
        const fin = trainScore();
        const vals: Cal = Object.fromEntries(Object.keys(spec).map((k) => [k, cal[k]]));
        console.log(`FIT ${JSON.stringify(vals)}: all ${f(fin.all)}  na ${f(fin.na)}  boost ${f(fin.boost)} ${g21(set21())}`);
        for (const [id, v] of Object.entries(fin.per)) if (Math.abs(v - base.per[id]) > 0.05) console.log(`    ${id}: ${f(base.per[id])} -> ${f(v)}`);
      }
    } finally {
      for (const k of Object.keys(orig)) cal[k] = orig[k];
    }
    expect(Number.isFinite(base.all)).toBe(true);
  }, 3_600_000);
});
