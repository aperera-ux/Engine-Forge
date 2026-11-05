/**
 * Spool branch (physics_audit §18.1): the coupled turbine/compressor balance
 * can have several equilibria at low rpm; the operating point is the lowest
 * (spool-up from rest), found once per rpm by spoolCeiling and imposed as a PR
 * cap. Before, B58 at veScale 1.03–1.08 sat on a fold at 1000 rpm: up to 30
 * unconverged fixed points (EGT residual up to 24 K) and 19–33 ms per call.
 *
 * Sweeps SimOptions.calibration.veScale over the calibrate range 0.85–1.15 on
 * the five turbo engines with spool-limited low-rpm points and checks:
 *  - every operating-point and ECU solve converges (pointSolveStats), and
 *    any final point that did not would be listed in SimResult.solverUnconverged
 *    with a 'solver-unconverged' warning (never silent);
 *  - spool-limited torque is non-decreasing in veScale (more air, more exhaust
 *    energy: the lowest equilibrium can only move up), so no branch hopping;
 *  - the median simulate() time stays under 10 ms at every veScale.
 */
import { describe, expect, it } from 'vitest';
import { pointSolveStats, simulate } from '../engine';
import { EXTENDED_REFERENCE_ENGINES, REFERENCE_ENGINES } from '../validation/referenceEngines';
import type { SimResult } from '../types';

const ALL = [...REFERENCE_ENGINES, ...EXTENDED_REFERENCE_ENGINES];
const IDS = ['bmw-b58-340i', 'bmw-n74-760i', 'vw-ea888-gen3-gti', 'ford-10-ecoboost', 'subaru-ej257-sti'];
const VES = Array.from({ length: 31 }, (_, i) => Math.round((0.85 + 0.01 * i) * 1000) / 1000);
const BUDGET_MS = 10;

function medianMs(f: () => void, n: number): number {
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    f();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return t[Math.floor(n / 2)];
}

describe('spool fold: veScale sweep 0.85–1.15', () => {
  for (const id of IDS) {
    const e = ALL.find((x) => x.id === id);
    it(`${id}: every point converges or is flagged; spool-limited torque monotone in VE`, () => {
      expect(e).toBeDefined();
      const rs: SimResult[] = [];
      for (const ve of VES) {
        const r = simulate(e!.config, { calibration: { veScale: ve } });
        const s = { ...pointSolveStats };
        // Flagging is complete: a final point that did not converge is listed.
        const listed = r.solverUnconverged ?? [];
        expect(listed.length > 0).toBe(r.warnings.some((w) => w.code === 'solver-unconverged'));
        // And on these engines nothing is left unconverged at all.
        expect({ ve, unconverged: s.unconverged, ecu: s.ecuUnconverged, listed: listed.length }).toEqual({ ve, unconverged: 0, ecu: 0, listed: 0 });
        expect(s.maxEgtResK).toBeLessThanOrEqual(0.02 + 1e-9);
        rs.push(r);
      }
      // Below the plateau, torque is non-decreasing in veScale at every rpm
      // (a branch hop to a lower equilibrium would show as a drop).
      for (let i = 1; i < rs.length; i++)
        for (let k = 0; k < rs[i].curve.length; k++) {
          const a = rs[i - 1].curve[k];
          const b = rs[i].curve[k];
          if (a.boostBar > 0 && b.knockRetardDeg < 1e-3 && a.knockRetardDeg < 1e-3) expect(b.torqueNm, `${id} ${a.rpm} rpm ve ${VES[i]}`).toBeGreaterThanOrEqual(a.torqueNm - 0.05);
        }
    }, 60_000);
    it(`${id}: median time < ${BUDGET_MS} ms at every veScale`, () => {
      let worst = 0;
      for (const ve of VES) {
        const o = { calibration: { veScale: ve } };
        simulate(e!.config, o);
        // Median of 5, best of 3 tries: wall-clock tests share the CPU with the
        // rest of the suite, so one try can be inflated by load spikes.
        let m = Infinity;
        for (let k = 0; k < 3 && m >= BUDGET_MS; k++) m = Math.min(m, medianMs(() => simulate(e!.config, o), 5));
        worst = Math.max(worst, m);
      }
      expect(worst).toBeLessThan(BUDGET_MS);
    }, 60_000);
  }
});
