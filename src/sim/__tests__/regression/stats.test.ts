/**
 * Headline accuracy statistics (opt-in; skipped in normal runs).
 *
 *   SIM_STATS=1 npx vitest run src/sim/__tests__/regression/stats.test.ts
 *
 * Prints, at full precision, the numbers quoted in tests/reports/physics_audit.md
 * and model_card.md, computed exactly as calibration.test.ts and dynoCurves.test.ts do:
 *  - 21-set (REFERENCE_ENGINES, excl. low-confidence ratings): median / mean / max
 *    |peak hp error|, max |peak torque error|, torque-peak rpm within ±10 %.
 *  - Dyno-curve torque RMS (mean per group) for TRAIN and HOLDOUT, all / NA / boosted.
 * SIM_STATS_JSON=<file> also writes them as JSON.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { simulate } from '../../engine';
import type { DynoPoint } from '../../types';
import { REFERENCE_ENGINES } from '../../validation/referenceEngines';
import { DYNO_CURVES, DYNO_ENGINE_BY_ID } from '../../validation/dynoCurves';

const pct = (a: number, b: number) => (100 * (a - b)) / b;
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

function torqueAt(curve: DynoPoint[], rpm: number): number | null {
  if (rpm < curve[0].rpm - 1e-6 || rpm > curve[curve.length - 1].rpm + 1e-6) return null;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (rpm >= a.rpm && rpm <= b.rpm) return a.torqueNm + ((rpm - a.rpm) / (b.rpm - a.rpm || 1)) * (b.torqueNm - a.torqueNm);
  }
  return curve[curve.length - 1].torqueNm;
}

describe.runIf(!!process.env.SIM_STATS)('headline accuracy statistics', () => {
  it('prints', () => {
    const rows = REFERENCE_ENGINES.map((e) => {
      const r = simulate(e.config);
      const p = e.published;
      const tqRange = p.torqueRpmRange;
      const tqRpmErr = tqRange
        ? r.peakTorqueRpm >= tqRange[0] && r.peakTorqueRpm <= tqRange[1]
          ? 0
          : pct(r.peakTorqueRpm, r.peakTorqueRpm < tqRange[0] ? tqRange[0] : tqRange[1])
        : pct(r.peakTorqueRpm, p.torqueRpm);
      return { id: e.id, conf: e.ratingConfidence ?? 'high', hpErr: pct(r.peakHp, p.hp), tqErr: pct(r.peakTorqueNm, p.torqueNm), tqRpm: r.peakTorqueRpm, tqRpmErr };
    });
    const scored = rows.filter((r) => r.conf !== 'low');
    const absHp = scored.map((r) => Math.abs(r.hpErr)).sort((a, b) => a - b);
    const set21 = {
      n: rows.length,
      nScored: scored.length,
      medianHp: absHp[Math.floor(absHp.length / 2)],
      meanHp: mean(absHp),
      maxHp: Math.max(...absHp),
      maxTq: Math.max(...scored.map((r) => Math.abs(r.tqErr))),
      tqRpmWithin10: rows.filter((r) => Math.abs(r.tqRpmErr) <= 10).length,
      tqRpm: Object.fromEntries(rows.map((r) => [r.id, r.tqRpm])),
    };
    const curves = DYNO_CURVES.map((c) => {
      const e = DYNO_ENGINE_BY_ID[c.engineId];
      const r = simulate(e.config);
      const errs: number[] = [];
      for (const p of c.points) {
        const s = torqueAt(r.curve, p.rpm);
        if (s !== null) errs.push(pct(s, p.torqueNm));
      }
      return { id: c.engineId, split: c.split, na: e.config.induction === 'na', rms: Math.sqrt(mean(errs.map((x) => x * x))) };
    });
    const grp = (split: string, f: (x: (typeof curves)[number]) => boolean) => {
      const v = curves.filter((x) => x.split === split && f(x));
      return { n: v.length, rms: mean(v.map((x) => x.rms)) };
    };
    const dyno = {
      trainAll: grp('train', () => true),
      trainNa: grp('train', (x) => x.na),
      trainBoost: grp('train', (x) => !x.na),
      holdAll: grp('holdout', () => true),
      holdNa: grp('holdout', (x) => x.na),
      holdBoost: grp('holdout', (x) => !x.na),
      perCurve: Object.fromEntries(curves.map((x) => [x.id, x.rms])),
    };
    const f = (x: number) => x.toFixed(4);
    console.log(
      [
        `21-set (n=${set21.n}, scored ${set21.nScored}): median|hp| ${f(set21.medianHp)}  mean ${f(set21.meanHp)}  max ${f(set21.maxHp)}  max|tq| ${f(set21.maxTq)}  tq-rpm ±10%: ${set21.tqRpmWithin10}/${set21.n}`,
        ...(['trainAll', 'trainNa', 'trainBoost', 'holdAll', 'holdNa', 'holdBoost'] as const).map((k) => `${k.padEnd(10)} n=${dyno[k].n}  RMS ${f(dyno[k].rms)}`),
      ].join('\n'),
    );
    if (process.env.SIM_STATS_JSON) fs.writeFileSync(process.env.SIM_STATS_JSON, JSON.stringify({ set21, dyno }, null, 1));
    expect(Number.isFinite(set21.medianHp)).toBe(true);
  });
});
