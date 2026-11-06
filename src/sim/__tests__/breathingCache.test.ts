/**
 * Guard for the per-config breathing-table cache in engine.ts: every config
 * field excluded from the cache key must leave the result bit-identical to an
 * uncached simulation, and a CAL change must invalidate the table.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { BREATHING_IRRELEVANT, setBreathingCache, simulate } from '../engine';
import { PRESETS } from '../presets';
import { CAL } from '../model/constants';
import type { EngineConfig } from '../types';

const clone = (c: EngineConfig): EngineConfig => JSON.parse(JSON.stringify(c));
const pick = (pred: (c: EngineConfig) => boolean) => PRESETS.find(pred)!;
const BASES = [
  pick((c) => c.induction === 'na'),
  pick((c) => c.induction === 'turbo' && !!c.ecu?.torqueLimitNm),
  pick((c) => c.induction === 'supercharger'),
];

function perturb(c: EngineConfig, field: string, inTurbo: boolean): EngineConfig {
  const o = clone(c);
  const tgt = (inTurbo ? o.turbo : o) as unknown as Record<string, unknown>;
  const v = tgt[field];
  if (field === 'ecu') tgt.ecu = { torqueLimitNm: 300, powerLimitKw: 200, maxKnockRetardDeg: 4 };
  else if (field === 'supercharger') tgt.supercharger = { type: 'roots', targetBoostBar: 0.9, intercoolerEffectiveness: 0.3 };
  else if (typeof v === 'number') tgt[field] = v * 1.13 + 0.01;
  else if (typeof v === 'boolean' || v === undefined) tgt[field] = !v;
  else if (field === 'name') tgt.name = 'perturbed';
  else if (field === 'intakeSystem') tgt.intakeSystem = v === 'open' ? 'stock' : 'open';
  else if (field === 'blockMaterial') tgt.blockMaterial = v === 'iron' ? 'aluminum' : 'iron';
  else if (field === 'pistons') tgt.pistons = v === 'cast' ? 'forged' : 'cast';
  else if (field === 'rods') tgt.rods = v === 'titanium' ? 'cast' : 'titanium';
  else if (field === 'crank') tgt.crank = v === 'billet' ? 'cast' : 'billet';
  else throw new Error(`no perturbation for ${field}`);
  return o;
}

afterAll(() => setBreathingCache(true));

describe('breathing-table cache', () => {
  const cases: [string, boolean][] = [
    ...BREATHING_IRRELEVANT.top.map((f) => [f, false] as [string, boolean]),
    ...BREATHING_IRRELEVANT.turbo.map((f) => [f, true] as [string, boolean]),
  ];
  for (const base of BASES)
    for (const [field, inTurbo] of cases)
      it(`${base.induction}: ${inTurbo ? 'turbo.' : ''}${field} does not affect the breathing table`, () => {
        const pert = perturb(base, field, inTurbo);
        setBreathingCache(false);
        const ref = simulate(pert, { includeUnlimited: true });
        setBreathingCache(true);
        simulate(base); // warm the cache with the unperturbed config (same key)
        const hit = simulate(pert, { includeUnlimited: true });
        expect(hit).toEqual(ref);
      });

  // SimOptions (applyOemLimits, includeUnlimited, calibration) are not part of the
  // key: no option reaches the table (calibration.veScale multiplies the looked-up VE,
  // exhaustRestrictionScale moves the pressure ratio the lookup is corrected to;
  // the torque cap acts through the ECU). Guard: cached == uncached with them set.
  for (const base of BASES)
    it(`${base.induction}: SimOptions.calibration does not affect the breathing table`, () => {
      const opts = { includeUnlimited: true, calibration: { veScale: 1.07, frictionScale: 1.2, exhaustRestrictionScale: 0.6, torqueCapNm: 0.8 * simulate(base).peakTorqueNm } };
      setBreathingCache(false);
      const ref = simulate(base, opts);
      setBreathingCache(true);
      simulate(base); // table cached without calibration
      expect(simulate(base, opts)).toEqual(ref);
    });

  it('a CAL change invalidates the cached table', () => {
    const base = BASES[0];
    setBreathingCache(true);
    simulate(base);
    const old = CAL.gxVeScale;
    try {
      CAL.gxVeScale = old * 1.05;
      setBreathingCache(false);
      const ref = simulate(base);
      setBreathingCache(true);
      simulate(clone(base));
      CAL.gxVeScale = old;
      simulate(base); // cache the original-CAL table
      CAL.gxVeScale = old * 1.05;
      expect(simulate(base)).toEqual(ref);
    } finally {
      CAL.gxVeScale = old;
    }
  });
});
