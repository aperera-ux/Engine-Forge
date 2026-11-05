import { describe, expect, it } from 'vitest';
import { turbineInletPressure } from '../model/boost';
import { orificeFlow } from '../model/airflow';
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
