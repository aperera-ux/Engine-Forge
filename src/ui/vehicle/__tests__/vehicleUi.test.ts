import { describe, expect, it } from 'vitest';
import { simulate } from '../../../sim/engine';
import { DYNO_ENGINE_BY_ID } from '../../../sim/validation/dynoCurves';
import { REFERENCE_CARS } from '../../../vehicle/validation/referenceCars';
import { curveFromSimResult } from '../../../vehicle';
import { parseSavedEngine } from '../../store';
import { handleRequest, type SimOutput, type OptimizeOutput } from '../compute';
import { DEFAULT_DESIGN, designFromReferenceCar, mergeDesign, parseTire } from '../design';

const cond = { ambient: { tempC: 20, pressureKPa: 101.325 }, shiftStrategy: 'optimal' as const, shiftRpmFraction: 1, rollout: true };

describe('vehicle design merge / Garage back-compat', () => {
  it('undefined / garbage -> defaults, never throws', () => {
    expect(mergeDesign(undefined)).toEqual(DEFAULT_DESIGN);
    expect(() => mergeDesign({ spec: { transmission: { gearRatios: 'x' }, curbMassKg: NaN } })).not.toThrow();
    expect(mergeDesign({ spec: { curbMassKg: 1e9 } }).spec.curbMassKg).toBe(6000);
  });
  it('old garage save with no vehicle field parses and leaves vehicle undefined', () => {
    const old = { name: 'Old build', config: DYNO_ENGINE_BY_ID['gm-ls7'].config, savedAt: 1, peakHp: 500, peakTorqueNm: 600, displacementL: 7 };
    const e = parseSavedEngine(old);
    expect(e).not.toBeNull();
    expect(e!.vehicle).toBeUndefined();
    expect(e!.name).toBe('Old build');
  });
  it('new save round-trips the vehicle through JSON', () => {
    const v = designFromReferenceCar(REFERENCE_CARS[0]);
    const e = parseSavedEngine(JSON.parse(JSON.stringify({ name: 'x', config: DYNO_ENGINE_BY_ID['gm-ls7'].config, vehicle: v })));
    expect(e!.vehicle!.spec.curbMassKg).toBeCloseTo(v.spec.curbMassKg, 6);
    expect(e!.vehicle!.spec.transmission.gearRatios).toEqual(v.spec.transmission.gearRatios);
  });
  it('tyre codes', () => {
    expect(parseTire('255/35R19')!.widthMm).toBe(255);
    expect(parseTire('garbage')).toBeNull();
  });
});

describe('vehicle jobs (worker payload logic)', () => {
  const car = REFERENCE_CARS.find((c) => c.id === 'corvette-z06-2006')!;
  const res = simulate(DYNO_ENGINE_BY_ID[car.engineId].config);
  const curve = curveFromSimResult(res);
  it('sim returns KPIs, per-gear force curves and a road-load line', () => {
    const o = handleRequest({ kind: 'sim', spec: car.spec, curve, idleRpm: 800, cond }) as SimOutput;
    expect(o.kind).toBe('sim');
    expect(o.accel.t0to60mph).toBeGreaterThan(3);
    expect(o.accel.t0to60mph).toBeLessThan(5);
    expect(o.accel.quarterMileS).toBeGreaterThan(10.5);
    expect(o.accel.quarterMileS).toBeLessThan(13);
    expect(o.gears).toHaveLength(car.spec.transmission.gearRatios.length);
    expect(o.top.speedKph).toBeGreaterThan(250);
    expect(o.roadLoad.n[o.roadLoad.n.length - 1]).toBeGreaterThan(o.roadLoad.n[0]);
  });
  it('optimize goes through optimizeGearing and never returns worse than baseline', () => {
    const o = handleRequest({ kind: 'optimize', spec: car.spec, curve, cond, objective: '0-60', finalDrive: true, gearRatios: false }) as OptimizeOutput;
    expect(o.kind).toBe('optimize');
    expect(o.best).toBeLessThanOrEqual(o.baseline);
    expect(o.finalDrive / o.finalDrive0).toBeGreaterThanOrEqual(0.69);
    expect(o.finalDrive / o.finalDrive0).toBeLessThanOrEqual(1.41);
  });
  it('bad input comes back as a response, not an exception', () => {
    const bad = { ...car.spec, transmission: { ...car.spec.transmission, gearRatios: [] } };
    const o = handleRequest({ kind: 'sim', spec: bad, curve, idleRpm: 800, cond });
    expect(['error', 'sim']).toContain(o.kind);
  });
});
