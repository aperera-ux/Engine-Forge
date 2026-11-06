/**
 * SimOptions.calibration (physics_audit.md §17.2): VE / friction multipliers and
 * a torque cap that act inside the operating-point solve, before the ECU.
 */
import { describe, expect, it } from 'vitest';
import { pointSolveStats, simulate } from '../engine';
import { CAL } from '../model/constants';
import { EXTENDED_REFERENCE_ENGINES, REFERENCE_ENGINES } from '../validation/referenceEngines';
import type { EngineConfig, SimResult } from '../types';

const eng = (id: string): EngineConfig => [...REFERENCE_ENGINES, ...EXTENDED_REFERENCE_ENGINES].find((e) => e.id === id)!.config;
const LS3 = eng('gm-ls3');
const K20 = eng('honda-k20a-dc5');
const B58 = eng('bmw-b58-340i');
const FORD10 = eng('ford-10-ecoboost');
const HELLCAT = eng('dodge-hellcat-62');
const TOL = CAL.ecuTorqueTolNm;
const maxTq = (r: SimResult) => Math.max(...r.curve.map((p) => p.torqueNm));

describe('identity', () => {
  for (const c of [LS3, B58, HELLCAT])
    it(`${c.name}: omitted / unit multipliers / no cap give the bit-identical result`, () => {
      const ref = simulate(c, { includeUnlimited: true });
      expect(simulate(c, { includeUnlimited: true, calibration: {} })).toEqual(ref);
      expect(simulate(c, { includeUnlimited: true, calibration: { veScale: 1, frictionScale: 1, torqueCapNm: undefined } })).toEqual(ref);
      // Non-finite or non-positive values are ignored.
      expect(simulate(c, { includeUnlimited: true, calibration: { veScale: NaN, frictionScale: Infinity, torqueCapNm: -5 } })).toEqual(ref);
    });
});

describe('veScale acts on the trapped air inside the point solve', () => {
  it('NA: airflow, VE and fuel scale; knock, EGT and torque follow', () => {
    const a = simulate(K20);
    const b = simulate(K20, { calibration: { veScale: 1.05 } });
    a.curve.forEach((p, i) => {
      const q = b.curve[i];
      expect(q.airFlowKgS / p.airFlowKgS).toBeGreaterThan(1.03);
      expect(q.airFlowKgS / p.airFlowKgS).toBeLessThan(1.06);
      expect(q.volumetricEfficiency / p.volumetricEfficiency).toBeCloseTo(q.airFlowKgS / p.airFlowKgS, 9);
      expect(q.imepBar).toBeGreaterThan(p.imepBar);
      // More charge, same CR and spark limit: never less knock retard, higher peak pressure.
      expect(q.knockRetardDeg).toBeGreaterThanOrEqual(p.knockRetardDeg - 1e-6);
      expect(q.peakCylinderPressureBar).toBeGreaterThan(p.peakCylinderPressureBar);
    });
    expect(b.peakTorqueNm / a.peakTorqueNm).toBeGreaterThan(1.04);
  });

  it('turbo (limits off): the turbine sees the extra exhaust flow, so boost below target rises', () => {
    const a = simulate(B58, { applyOemLimits: false });
    const b = simulate(B58, { applyOemLimits: false, calibration: { veScale: 1.05 } });
    // Spool-limited first point: more exhaust mass flow → more turbine power → more boost.
    expect(b.curve[0].boostBar).toBeGreaterThan(a.curve[0].boostBar + 0.005);
    expect(b.curve[0].exhaustPressureBar).toBeGreaterThan(a.curve[0].exhaustPressureBar!);
  });

  it('turbo with the OEM torque limit: the plateau holds at the limit with less boost', () => {
    const a = simulate(B58);
    const b = simulate(B58, { calibration: { veScale: 1.05 } });
    const lim = B58.ecu!.torqueLimitNm!;
    let n = 0;
    a.curve.forEach((p, i) => {
      const q = b.curve[i];
      expect(q.torqueNm).toBeLessThanOrEqual(lim + TOL);
      if (Math.abs(p.torqueNm - lim) <= TOL && Math.abs(q.torqueNm - lim) <= TOL) {
        n++;
        expect(q.boostBar).toBeLessThan(p.boostBar);
      }
    });
    expect(n).toBeGreaterThan(5);
  });

  it('is continuous: ±1e-4 gives a near-linear torque response', () => {
    const t = (k: number) => simulate(LS3, { calibration: { veScale: k } }).curve.map((p) => p.torqueNm);
    const [m, z, p] = [t(1 - 1e-4), t(1), t(1 + 1e-4)];
    z.forEach((v, i) => expect(Math.abs(p[i] + m[i] - 2 * v) / v).toBeLessThan(2e-6));
  });
});

describe('frictionScale acts on mechanical FMEP before the ECU', () => {
  it('NA: only mechanical friction scales (imep and pumping unchanged)', () => {
    const a = simulate(LS3);
    const b = simulate(LS3, { calibration: { frictionScale: 1.3 } });
    a.curve.forEach((p, i) => {
      const q = b.curve[i];
      expect(q.imepBar).toBeCloseTo(p.imepBar, 9);
      expect(q.pmepBar!).toBeCloseTo(p.pmepBar!, 9);
      expect(q.fmepBar - q.pmepBar!).toBeCloseTo(1.3 * (p.fmepBar - p.pmepBar!), 9);
      expect(q.torqueNm).toBeLessThan(p.torqueNm);
    });
  });

  it('turbo with the OEM limit: the limiter holds the torque by raising boost', () => {
    const a = simulate(B58);
    const b = simulate(B58, { calibration: { frictionScale: 1.3 } });
    const lim = B58.ecu!.torqueLimitNm!;
    let n = 0;
    a.curve.forEach((p, i) => {
      const q = b.curve[i];
      if (Math.abs(p.torqueNm - lim) <= TOL && Math.abs(q.torqueNm - lim) <= TOL) {
        n++;
        expect(q.boostBar).toBeGreaterThan(p.boostBar);
      }
    });
    expect(n).toBeGreaterThan(3);
  });
});

describe('exhaustRestrictionScale acts on the exhaust back-pressure inside the gas exchange (§18.3)', () => {
  const LS7 = eng('gm-ls7');
  it('identity at 1 (bit-identical), NaN ignored', () => {
    for (const c of [LS7, B58, HELLCAT]) {
      const ref = simulate(c, { includeUnlimited: true });
      expect(simulate(c, { includeUnlimited: true, calibration: { exhaustRestrictionScale: 1 } })).toEqual(ref);
      expect(simulate(c, { includeUnlimited: true, calibration: { exhaustRestrictionScale: NaN } })).toEqual(ref);
    }
  });
  it('NA: a freer exhaust lowers back-pressure and pumping, raises VE; the effect grows with flow', () => {
    const a = simulate(LS7);
    const b = simulate(LS7, { calibration: { exhaustRestrictionScale: 0.5 } });
    const gain: number[] = [];
    a.curve.forEach((p, i) => {
      const q = b.curve[i];
      // Back-pressure above ambient halves (same flow to first order; the flow rises slightly).
      const dp0 = (p.exhaustPressureBar ?? 0) - 1.01325;
      const dp1 = (q.exhaustPressureBar ?? 0) - 1.01325;
      expect(dp1 / dp0).toBeGreaterThan(0.45);
      expect(dp1 / dp0).toBeLessThan(0.56);
      expect(q.pmepBar!).toBeLessThan(p.pmepBar!);
      expect(q.volumetricEfficiency).toBeGreaterThanOrEqual(p.volumetricEfficiency);
      expect(q.imepBar).toBeGreaterThanOrEqual(p.imepBar - 1e-9);
      expect(q.fmepBar - q.pmepBar!).toBeCloseTo(p.fmepBar - p.pmepBar!, 2); // mechanical friction untouched (to the pMax effect)
      gain.push(q.torqueNm / p.torqueNm - 1);
    });
    // Back-pressure ∝ flow², so the gain at redline is several times the gain at 1000 rpm.
    expect(gain[gain.length - 1]).toBeGreaterThan(3 * gain[0]);
    expect(gain[gain.length - 1]).toBeGreaterThan(0.005);
  });
  it('turbo: a more restrictive post-turbine system raises turbine-inlet pressure and costs boost where spool-limited', () => {
    const o = { applyOemLimits: false };
    const a = simulate(B58, o);
    const b = simulate(B58, { ...o, calibration: { exhaustRestrictionScale: 2 } });
    let n = 0;
    a.curve.forEach((p, i) => {
      const q = b.curve[i];
      expect(q.exhaustPressureBar!).toBeGreaterThanOrEqual(p.exhaustPressureBar! - 1e-6);
      if (p.boostBar < 0.5 * B58.turbo.targetBoostBar) {
        n++;
        expect(q.boostBar).toBeLessThanOrEqual(p.boostBar + 1e-6);
      }
    });
    expect(n).toBeGreaterThan(0);
    expect(pointSolveStats.unconverged).toBe(0);
  });
  it('is continuous: ±1e-4 gives a near-linear torque response', () => {
    const t = (k: number) => simulate(LS7, { calibration: { exhaustRestrictionScale: k } }).curve.map((p) => p.torqueNm);
    const [m, z, p] = [t(1 - 1e-4), t(1), t(1 + 1e-4)];
    z.forEach((v, i) => expect(Math.abs(p[i] + m[i] - 2 * v)).toBeLessThan(1e-6 * v + 1e-3 * Math.abs(p[i] - m[i])));
  });
});

describe('torqueCapNm', () => {
  for (const [c, frac] of [
    [LS3, 0.8],
    [K20, 0.85],
    [K20, 0.5],
    [HELLCAT, 0.8],
    [B58, 0.8],
    [FORD10, 0.5],
  ] as [EngineConfig, number][])
    it(`${c.name} (${c.induction}), cap ${frac} × peak: torque ≤ cap + tol, held where it binds, plateau start reported`, () => {
      const base = simulate(c);
      const cap = frac * base.peakTorqueNm;
      const r = simulate(c, { calibration: { torqueCapNm: cap } });
      expect(pointSolveStats.unconverged).toBe(0);
      expect(pointSolveStats.ecuUnconverged).toBe(0);
      expect(maxTq(r)).toBeLessThanOrEqual(cap + TOL);
      const held = r.curve.filter((p) => Math.abs(p.torqueNm - cap) <= TOL);
      expect(held.length).toBeGreaterThan(2);
      // Plateau: peakTorqueRpm is its start, the range spans it.
      expect(r.peakTorqueRpm).toBe(held[0].rpm);
      expect(r.peakTorqueRpmRange![0]).toBe(held[0].rpm);
      expect(r.peakTorqueRpmRange![1]).toBeGreaterThanOrEqual(held[held.length - 1].rpm);
      // Where the uncapped curve is well below the cap, the point is unchanged (up to the solver tolerance).
      base.curve.forEach((p, i) => {
        if (p.torqueNm < cap - 1) expect(Math.abs(r.curve[i].torqueNm - p.torqueNm) / p.torqueNm).toBeLessThan(1e-5);
      });
    });

  it('NA: the throttle closes (MAP below ambient) and pumping rises at capped points', () => {
    const base = simulate(LS3);
    const cap = 0.8 * base.peakTorqueNm;
    const r = simulate(LS3, { calibration: { torqueCapNm: cap } });
    r.curve.forEach((p, i) => {
      if (Math.abs(p.torqueNm - cap) <= TOL && base.curve[i].torqueNm > cap + 5) {
        expect(p.mapBar).toBeLessThan(base.curve[i].mapBar - 0.02);
        expect(p.pmepBar!).toBeGreaterThan(base.curve[i].pmepBar!);
      }
    });
  });

  it('combines with the OEM limit as the lower of the two, and applies with applyOemLimits false', () => {
    const lim = B58.ecu!.torqueLimitNm!;
    // Cap above the OEM limit: no effect at all.
    expect(simulate(B58, { calibration: { torqueCapNm: lim + 50 } })).toEqual(simulate(B58));
    const below = simulate(B58, { calibration: { torqueCapNm: lim - 50 } });
    expect(maxTq(below)).toBeLessThanOrEqual(lim - 50 + TOL);
    const off = simulate(B58, { applyOemLimits: false, calibration: { torqueCapNm: lim - 50 } });
    expect(maxTq(off)).toBeLessThanOrEqual(lim - 50 + TOL);
    expect(off.oemLimits.applied).toBe(false);
  });

  it('SimResult.unlimited ignores the cap but keeps the VE / friction scales', () => {
    const cal = { veScale: 1.03, frictionScale: 1.1, torqueCapNm: 400 };
    const r = simulate(LS3, { includeUnlimited: true, calibration: cal });
    const u = simulate(LS3, { calibration: { veScale: 1.03, frictionScale: 1.1 } });
    expect(maxTq(r)).toBeLessThanOrEqual(400 + TOL);
    expect(r.unlimited).toEqual(u.curve);
  });
});
