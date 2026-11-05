/**
 * Knock trim vs torque limit: no path dependence (physics_audit §18.2).
 *
 * The knock-aware boost target is set by the knock severity at the SCHEDULED
 * target, so the ECU target is min(torque-limited, knock-trimmed) and a torque
 * limit can only clip the curve: at every rpm
 *     T(with limit L) = min(L, T(without limit))   (to the solve tolerances).
 * Before §18.2 the severity was measured at the torque-limited point, so a
 * lightly knocking limited point was trimmed BELOW the limit whenever the
 * accepted retard was below the retard there (Ford 1.0 at veScale 1.05 peaked
 * at 167.4 instead of 170 N·m; with ecuMaxRetardDeg 9 it never reached 170).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { simulate } from '../engine';
import { CAL } from '../model/constants';
import { REFERENCE_ENGINES } from '../validation/referenceEngines';
import type { EngineConfig } from '../types';

const ids = ['ford-10-ecoboost', 'bmw-b58-340i', 'vw-ea888-gen3-gti', 'ford-35-ecoboost-gen2'];
const cal = CAL as unknown as Record<string, number>;
const maxR0 = CAL.ecuMaxRetardDeg;
afterEach(() => {
  cal.ecuMaxRetardDeg = maxR0;
});

/** The reference config with only its torque limit (no power limit), so the clip property is exact. */
function torqueOnly(id: string): EngineConfig {
  const e = REFERENCE_ENGINES.find((x) => x.id === id)!;
  return { ...e.config, ecu: { ...e.config.ecu, powerLimitKw: undefined } };
}

describe('torque limit clips the knock-trimmed curve (no knock/limit path dependence)', () => {
  for (const id of ids)
    for (const ve of [0.95, 1, 1.05])
      for (const maxR of [9, 10])
        it(`${id} veScale ${ve} ecuMaxRetardDeg ${maxR}: T(L) = min(L, T(no limit))`, () => {
          cal.ecuMaxRetardDeg = maxR;
          const c = torqueOnly(id);
          const L = c.ecu!.torqueLimitNm!;
          const opts = { calibration: { veScale: ve } };
          const lim = simulate(c, opts).curve;
          const free = simulate(c, { ...opts, applyOemLimits: false }).curve;
          for (let i = 0; i < lim.length; i++) {
            const want = Math.min(L, free[i].torqueNm);
            expect(Math.abs(lim[i].torqueNm - want), `${lim[i].rpm} rpm: ${lim[i].torqueNm} vs min(${L}, ${free[i].torqueNm})`).toBeLessThanOrEqual(
              CAL.ecuTorqueTolNm + 2e-5 * want,
            );
          }
        });
  it('Ford 1.0 at veScale 1.05 reaches its 170 N·m limit (was 167.4)', () => {
    const e = REFERENCE_ENGINES.find((x) => x.id === 'ford-10-ecoboost')!;
    const r = simulate(e.config, { calibration: { veScale: 1.05 } });
    expect(r.peakTorqueNm).toBeGreaterThan(170 - CAL.ecuTorqueTolNm);
    expect(r.peakTorqueNm).toBeLessThanOrEqual(170 + CAL.ecuTorqueTolNm);
  });
});
