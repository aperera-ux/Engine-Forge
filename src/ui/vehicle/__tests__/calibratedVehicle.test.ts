import { describe, expect, it } from 'vitest';
import { simulate } from '../../../sim/engine';
import { DYNO_ENGINE_BY_ID } from '../../../sim/validation/dynoCurves';
import { REFERENCE_CARS } from '../../../vehicle/validation/referenceCars';
import { buildCalibration, simulateCalibrated, type FitOk } from '../../../calibrate';
import { curveFromSimResult } from '../../../vehicle';
import { curveFor, handleRequest, type SimOutput } from '../compute';

const cond = { ambient: { tempC: 20, pressureKPa: 101.325 }, shiftStrategy: 'optimal' as const, shiftRpmFraction: 1, rollout: true };
const car = REFERENCE_CARS.find((c) => c.id === 'corvette-z06-2006')!;
const config = DYNO_ENGINE_BY_ID[car.engineId].config;
const calWith = (values: FitOk['values']) =>
  buildCalibration({
    fit: { values, capRefNm: 0, rmsBeforePct: 8, rmsAfterPct: 2, verdict: 'good', params: [] } as unknown as FitOk,
    base: config,
    applyOemLimits: false,
    sourceName: 't.csv',
    basis: 'crank',
    drivetrainLossPct: 15,
    standard: 'sae-j1349',
    measured: { rpm: [1000, 7000], torqueNm: [300, 300] },
  });
const run = (engine?: { config: typeof config; calibration: ReturnType<typeof calWith> }) => {
  const plain = curveFromSimResult(simulate(config, { applyOemLimits: false }));
  return handleRequest({ kind: 'sim', spec: car.spec, curve: plain, idleRpm: 800, cond, engine }) as SimOutput;
};

describe('vehicle mode uses the calibrated engine', () => {
  const weak = calWith({ veScale: 0.88 });
  const strong = calWith({ veScale: 1.1 });
  it('the worker curve is the simulateCalibrated curve (same options)', () => {
    const c = curveFor({ curve: curveFromSimResult(simulate(config)), engine: { config: weak.fittedConfig, calibration: weak } });
    const ref = curveFromSimResult(simulateCalibrated(weak.fittedConfig, weak));
    expect(Array.from(c.tq)).toEqual(Array.from(ref.tq));
  });
  it('0-60 moves the expected way: weaker fit slower, stronger fit quicker', () => {
    const t0 = run().accel.t0to60mph!;
    const tWeak = run({ config: weak.fittedConfig, calibration: weak }).accel.t0to60mph!;
    const tStrong = run({ config: strong.fittedConfig, calibration: strong }).accel.t0to60mph!;
    expect(tWeak).toBeGreaterThan(t0);
    expect(tStrong).toBeLessThan(t0);
  });
  it('no calibration: the supplied curve is used untouched', () => {
    const curve = curveFromSimResult(simulate(config));
    expect(curveFor({ curve })).toBe(curve);
  });
});
