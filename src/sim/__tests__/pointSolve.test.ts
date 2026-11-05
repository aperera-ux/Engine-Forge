/**
 * Self-consistent operating point (engine.ts › solvePoint) and smoothness of
 * the ECU solves in the inputs. See tests/reports/physics_audit.md §16.
 */
import { describe, expect, it } from 'vitest';
import { pointSolveStats, simulate } from '../engine';
import { CAL } from '../model/constants';
import { computeGeometry, sanitize } from '../model/geometry';
import { burnDuration, knockLimitedSpark, type SparkHint } from '../model/combustion';
import { PRESETS } from '../presets';
import { EXTENDED_REFERENCE_ENGINES } from '../validation/referenceEngines';
import type { EngineConfig } from '../types';

const all: EngineConfig[] = [];
for (const c of [...PRESETS, ...EXTENDED_REFERENCE_ENGINES.map((e) => e.config)]) if (!all.some((x) => x.name === c.name)) all.push(c);
const byName = (s: string) => all.find((c) => c.name.startsWith(s)) as EngineConfig;

describe('operating point is a converged fixed point in EGT / exhaust pressure', () => {
  for (const c of all) {
    it(`${c.name}: every operating point and every ECU solve converged`, () => {
      simulate(c);
      expect(pointSolveStats.solves).toBeGreaterThan(0);
      expect(pointSolveStats.unconverged).toBe(0);
      expect(pointSolveStats.ecuUnconverged, 'torque-limit / knock-trim / protection solves stopped at the cap').toBe(0);
      // Accepted points: |EGT out − in| ≤ 2 × tol, |p out − in| ≤ 2 × tol · p.
      expect(pointSolveStats.maxEgtResK).toBeLessThanOrEqual(2 * CAL.pointEgtTolK);
      expect(pointSolveStats.maxPExhResRel).toBeLessThanOrEqual(2 * CAL.pointPExhTolRel);
    });
  }
});

describe('knock-limited spark is continuous and independent of the warm start', () => {
  const c = sanitize(byName('BMW B58'));
  const g = computeGeometry(c);
  const rpm = 3000;
  const burn = burnDuration(c, rpm);
  const base = (tIvc: number) => ({ g, rpm, pBdc: 1.9e5, tIvc, q: 2200, burnDeg: burn, octane: 95, residual: 0.04 });
  it('retard vs charge temperature: no steps (second differences tiny), cold/hint solves agree', () => {
    const rs: number[] = [];
    const hint: SparkHint = { retard: -1, slope: NaN, pSlope: 0 };
    for (let i = 0; i <= 400; i++) {
      const t = 330 + 0.05 * i;
      const cold = knockLimitedSpark(base(t), burn);
      const warm = knockLimitedSpark(base(t), burn, hint);
      expect(Math.abs(warm.retard - cold.retard), `T ${t}`).toBeLessThan(2e-3);
      rs.push(cold.retard);
    }
    expect(rs[400]).toBeGreaterThan(rs[0] + 0.5); // the scan crosses knocking territory
    let maxStep = 0;
    let max2 = 0;
    for (let i = 1; i < rs.length; i++) maxStep = Math.max(maxStep, Math.abs(rs[i] - rs[i - 1]));
    for (let i = 2; i < rs.length; i++) if (rs[i - 2] > 0) max2 = Math.max(max2, Math.abs(rs[i] - 2 * rs[i - 1] + rs[i - 2]));
    // Mean step is (rs[400] − rs[0]) / 400; a 0.05° stair-step or the former
    // 0.5° knock-window saw-tooth would show up as a step ≫ that.
    expect(maxStep).toBeLessThan((3 * (rs[400] - rs[0])) / 400 + 1e-3);
    expect(max2).toBeLessThan(2e-3);
  });
});

/** Relative input perturbations of the acceptance spec. */
const PERT: [string, (c: EngineConfig, f: number) => EngineConfig][] = [
  ['bore', (c, f) => ({ ...c, boreMm: c.boreMm * f })],
  ['stroke', (c, f) => ({ ...c, strokeMm: c.strokeMm * f })],
  ['CR', (c, f) => ({ ...c, compressionRatio: c.compressionRatio * f })],
  ['intercooler', (c, f) => ({ ...c, turbo: { ...c.turbo, intercoolerEffectiveness: c.turbo.intercoolerEffectiveness * f } })],
  [
    'boost target',
    (c, f) => ({
      ...c,
      turbo: { ...c.turbo, targetBoostBar: c.turbo.targetBoostBar * f },
      ecu: c.ecu?.boostSchedule ? { ...c.ecu, boostSchedule: c.ecu.boostSchedule.map((s) => ({ ...s, bar: s.bar * f })) } : c.ecu,
    }),
  ],
];
const EPS = 1e-3;

describe('1e-3 input perturbations move outputs smoothly (Ford 1.0, B58, EA888 gen 3)', () => {
  for (const name of ['Ford 1.0 EcoBoost', 'BMW B58', 'VW EA888 Gen 3']) {
    const c = byName(name);
    const r0 = simulate(c);
    const step = r0.curve[2].rpm - r0.curve[1].rpm;
    for (const [label, f] of PERT) {
      it(`${name}: ${label} ±1e-3 — torque continuous at every rpm (no jumps), bounded sensitivity, peak rpms move ≤ 1 grid step`, () => {
        // 9 configs from −ε to +ε in steps of ε/4. A jump J shows as one
        // increment larger than both neighbours by far; a kink (a limit starting
        // to bind) only changes the increment from one value to another.
        const ks = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
        const rs = ks.map((k) => (k === 0 ? r0 : simulate(f(c, 1 + (k * EPS) / 4))));
        r0.curve.forEach((p, i) => {
          const tq = rs.map((r) => r.curve[i].torqueNm);
          const inc = tq.slice(1).map((v, j) => v - tq[j]);
          const floor = 2e-5 * p.torqueNm; // solver tolerances
          const msg = `${p.rpm} rpm: torque ${tq.map((v) => v.toFixed(4)).join(' ')}`;
          inc.forEach((d, j) => {
            const nb = Math.max(j > 0 ? Math.abs(inc[j - 1]) : 0, j < inc.length - 1 ? Math.abs(inc[j + 1]) : 0);
            expect(Math.abs(d), msg).toBeLessThanOrEqual(3 * nb + floor);
          });
          // Elasticity ≤ 20 (a 0.1 % input change moves torque < 2 %).
          expect(Math.abs(tq[8] - tq[4]) / p.torqueNm, msg).toBeLessThan(20 * EPS);
          expect(Math.abs(tq[0] - tq[4]) / p.torqueNm, msg).toBeLessThan(20 * EPS);
        });
        for (const r of rs) {
          expect(Math.abs(r.peakTorqueRpm - r0.peakTorqueRpm), 'peakTorqueRpm').toBeLessThanOrEqual(step);
          expect(Math.abs(r.peakPowerRpm - r0.peakPowerRpm), 'peakPowerRpm').toBeLessThanOrEqual(step);
        }
        const hp = rs.map((r) => r.peakHp);
        const hInc = hp.slice(1).map((v, j) => v - hp[j]);
        hInc.forEach((d, j) => {
          const nb = Math.max(j > 0 ? Math.abs(hInc[j - 1]) : 0, j < hInc.length - 1 ? Math.abs(hInc[j + 1]) : 0);
          expect(Math.abs(d), `peak hp ${hp.join(' ')}`).toBeLessThanOrEqual(3 * nb + 2e-5 * r0.peakHp);
        });
      });
    }
    it(`${name}: torque ≤ limit + ${CAL.ecuTorqueTolNm} N·m on every perturbed config`, () => {
      const lim = c.ecu?.torqueLimitNm ?? Infinity;
      for (const [, f] of PERT)
        for (const s of [1 + EPS, 1 - EPS]) for (const p of simulate(f(c, s)).curve) expect(p.torqueNm).toBeLessThanOrEqual(lim + CAL.ecuTorqueTolNm + 1e-9);
    });
  }
});
