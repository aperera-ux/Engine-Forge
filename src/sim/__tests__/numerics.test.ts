import { describe, expect, it } from 'vitest';
import { turbineInletPressure } from '../model/boost';
import { orificeFlow, solveThrottle } from '../model/airflow';
import { GAMMA_EXH, R_EXH } from '../model/constants';

describe('turbine-inlet pressure (closed-form orifice inverse)', () => {
  it('passes the requested mass flow, subsonic and choked', () => {
    const p4 = 1.06e5;
    for (const cdA of [2e-4, 6e-4, 1.5e-3])
      for (const t3 of [800, 1100, 1300])
        for (const m of [0.005, 0.03, 0.1, 0.3]) {
          const p3 = turbineInletPressure(cdA, m, t3, p4);
          expect(p3).toBeGreaterThanOrEqual(p4);
          expect(orificeFlow(cdA, p3, t3, p4, GAMMA_EXH, R_EXH) / m).toBeCloseTo(1, 10);
        }
  });
});

describe('throttle solve (closed form)', () => {
  it('balances engine demand against throttle flow, subsonic and choked', () => {
    const tUp = 300;
    const pUp = 1.0e5;
    for (const cdA of [3e-4, 1e-3, 3e-3])
      for (const demandPerPa of [1e-7, 1e-6, 5e-6, 2e-5]) {
        const pm = solveThrottle(cdA, pUp, tUp, demandPerPa);
        expect(pm).toBeGreaterThanOrEqual(0.1 * pUp);
        expect(pm).toBeLessThanOrEqual(pUp);
        if (pm > 0.1 * pUp) expect((demandPerPa * pm) / orificeFlow(cdA, pUp, tUp, pm)).toBeCloseTo(1, 10);
      }
  });
});
