/**
 * Full-curve validation report: simulated WOT torque curve vs published
 * (digitised) dyno curves, see src/sim/validation/dynoCurves.ts and
 * research/dyno_sources.md.
 *
 * Run: npx vitest run src/sim/__tests__/dynoCurves.test.ts
 *
 * This is a REPORT. Assertions only check data integrity for now; physics
 * accuracy thresholds will be tightened later. Summaries are printed
 * separately for TRAIN and HOLDOUT engines - holdout engines must never be
 * used for tuning.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../engine';
import type { DynoPoint } from '../types';
import { DYNO_CURVES, DYNO_ENGINE_BY_ID } from '../validation/dynoCurves';

const pct = (a: number, b: number) => (100 * (a - b)) / b;

/** Linear interpolation of simulated torque at rpm (null outside the simulated range). */
function simTorqueAt(curve: DynoPoint[], rpm: number): number | null {
  if (rpm < curve[0].rpm - 1e-6 || rpm > curve[curve.length - 1].rpm + 1e-6) return null;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (rpm >= a.rpm && rpm <= b.rpm) {
      const t = b.rpm === a.rpm ? 0 : (rpm - a.rpm) / (b.rpm - a.rpm);
      return a.torqueNm + t * (b.torqueNm - a.torqueNm);
    }
  }
  return curve[curve.length - 1].torqueNm;
}

interface Row {
  id: string;
  split: 'train' | 'holdout';
  conf: string;
  type: string;
  n: number;
  rms: number;
  maxErr: number;
  maxErrRpm: number;
  bias: number;
  pkTqErr: number;
  pkTqRpmErr: number;
  pkHpErr: number;
  pkHpRpmErr: number;
}

const median = (v: number[]) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

describe('published dyno curves: data integrity', () => {
  it('every curve references a known engine and the ids are unique', () => {
    const seen = new Set<string>();
    for (const c of DYNO_CURVES) {
      expect(DYNO_ENGINE_BY_ID[c.engineId], c.engineId).toBeDefined();
      expect(seen.has(c.engineId), `duplicate ${c.engineId}`).toBe(false);
      seen.add(c.engineId);
    }
  });
  for (const c of DYNO_CURVES) {
    it(`${c.engineId}: >= 8 points, strictly increasing rpm, hp = Nm*rpm/7121 within 1 %`, () => {
      expect(c.points.length).toBeGreaterThanOrEqual(8);
      for (let i = 1; i < c.points.length; i++) expect(c.points[i].rpm).toBeGreaterThan(c.points[i - 1].rpm);
      for (const p of c.points) {
        expect(p.torqueNm).toBeGreaterThan(0);
        const hp = (p.torqueNm * p.rpm) / 7121;
        expect(Math.abs(p.hp - hp), `${c.engineId} @${p.rpm}`).toBeLessThanOrEqual(Math.max(1, 0.01 * hp));
      }
      expect(c.source.url).toMatch(/^https?:\/\//);
      if (!c.crankBasis) expect(c.drivetrainLossPct, 'wheel data needs a documented loss').toBeDefined();
    });
  }
  it('roughly 30 % of the engines are holdout', () => {
    const h = DYNO_CURVES.filter((c) => c.split === 'holdout').length;
    expect(h / DYNO_CURVES.length).toBeGreaterThanOrEqual(0.15);
    expect(h / DYNO_CURVES.length).toBeLessThanOrEqual(0.45);
  });
});

describe('published dyno curves: simulated vs published (report)', () => {
  const rows: Row[] = DYNO_CURVES.map((c) => {
    const e = DYNO_ENGINE_BY_ID[c.engineId];
    const r = simulate(e.config);
    const errs: { rpm: number; e: number }[] = [];
    for (const p of c.points) {
      const s = simTorqueAt(r.curve, p.rpm);
      if (s !== null) errs.push({ rpm: p.rpm, e: pct(s, p.torqueNm) });
    }
    const rms = Math.sqrt(mean(errs.map((x) => x.e * x.e)));
    const worst = errs.reduce((a, b) => (Math.abs(b.e) > Math.abs(a.e) ? b : a), { rpm: 0, e: 0 });
    // published peaks from the curve itself (within the published rpm range)
    const pTq = c.points.reduce((a, b) => (b.torqueNm > a.torqueNm ? b : a));
    const pHp = c.points.reduce((a, b) => (b.hp > a.hp ? b : a));
    const lo = c.points[0].rpm;
    const hi = c.points[c.points.length - 1].rpm;
    const sim = r.curve.filter((d) => d.rpm >= lo - 1e-6 && d.rpm <= hi + 1e-6);
    const sTq = sim.length ? sim.reduce((a, b) => (b.torqueNm > a.torqueNm ? b : a)) : r.curve[0];
    const sHp = sim.length ? sim.reduce((a, b) => (b.hp > a.hp ? b : a)) : r.curve[0];
    const cfg = e.config;
    const type = `${cfg.layout === 'v' ? 'V' : cfg.layout === 'flat' ? 'F' : 'I'}${cfg.cylinders} ${cfg.induction === 'na' ? 'NA' : cfg.induction === 'turbo' ? 'T' : 'SC'}`;
    return {
      id: c.engineId,
      split: c.split,
      conf: c.confidence,
      type,
      n: errs.length,
      rms,
      maxErr: worst.e,
      maxErrRpm: worst.rpm,
      bias: mean(errs.map((x) => x.e)),
      pkTqErr: pct(sTq.torqueNm, pTq.torqueNm),
      pkTqRpmErr: sTq.rpm - pTq.rpm,
      pkHpErr: pct(sHp.hp, pHp.hp),
      pkHpRpmErr: sHp.rpm - pHp.rpm,
    };
  });

  const f = (x: number, w = 6, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a').padStart(w);
  const header =
    'id                        split   conf   type     n  tqRMS%  bias%  maxErr% @rpm  | pkTq%  dRpm  | pkHp%  dRpm';
  const line = (r: Row) =>
    `${r.id.padEnd(25)} ${r.split.padEnd(7)} ${r.conf.padEnd(6)} ${r.type.padEnd(7)}${f(r.n, 3, 0)}${f(r.rms, 8)}${f(r.bias, 7)}${f(r.maxErr, 9)}${f(r.maxErrRpm, 6, 0)}  |${f(r.pkTqErr, 6)}${f(r.pkTqRpmErr, 6, 0)}  |${f(r.pkHpErr, 6)}${f(r.pkHpRpmErr, 6, 0)}`;
  const summary = (name: string, rs: Row[]) => {
    if (!rs.length) return `${name}: (none)`;
    const a = (k: (r: Row) => number) => rs.map((r) => Math.abs(k(r)));
    return `${name.padEnd(8)} n=${String(rs.length).padStart(2)} | torque RMS%: median ${median(a((r) => r.rms)).toFixed(1)} mean ${mean(a((r) => r.rms)).toFixed(1)} | |max pt err|%: median ${median(a((r) => r.maxErr)).toFixed(1)} mean ${mean(a((r) => r.maxErr)).toFixed(1)} | |pk tq|%: median ${median(a((r) => r.pkTqErr)).toFixed(1)} | |pk hp|%: median ${median(a((r) => r.pkHpErr)).toFixed(1)} mean ${mean(a((r) => r.pkHpErr)).toFixed(1)} | |dRpm pkTq| median ${median(a((r) => r.pkTqRpmErr)).toFixed(0)}`;
  };
  const train = rows.filter((r) => r.split === 'train');
  const hold = rows.filter((r) => r.split === 'holdout');
  const out = [
    '',
    'FULL-CURVE VALIDATION (sim vs published WOT torque curve; errors = sim vs published, % of published)',
    header,
    ...train.map(line),
    '--- holdout ---',
    ...hold.map(line),
    '',
    summary('TRAIN', train),
    summary('HOLDOUT', hold),
    summary('ALL', rows),
    'worst 5 by torque RMS: ' +
      [...rows]
        .sort((a, b) => b.rms - a.rms)
        .slice(0, 5)
        .map((r) => `${r.id} (${r.rms.toFixed(1)}%, ${r.split})`)
        .join(', '),
  ];
  console.log(out.join('\n'));

  it('every curve overlaps the simulated rpm range', () => {
    for (const r of rows) expect(r.n, r.id).toBeGreaterThanOrEqual(5);
  });
  it('report values are finite', () => {
    for (const r of rows) expect(Number.isFinite(r.rms), r.id).toBe(true);
  });
});
