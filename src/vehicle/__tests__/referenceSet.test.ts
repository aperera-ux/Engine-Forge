import { describe, expect, it } from 'vitest';
import { REFERENCE_CARS } from '../validation/referenceCars';
import { slipCurve, slipForForceFraction, slipPeak } from '../tire';
import { runAcceleration } from '../accelerate';
import { curveFor } from '../validation/run';

describe('reference set declaration', () => {
  it('has the declared fresh holdout, the seen set and enough variety', () => {
    const ids = (s: string) => REFERENCE_CARS.filter((c) => c.split === s).map((c) => c.id).sort();
    expect(ids('holdout')).toEqual(['bmw-340i-2016', 'mazda6-25-2014', 'porsche-911-gt3-991-2018', 'vw-gti-mk5-dsg-2006']);
    expect(ids('seen')).toEqual(['chevrolet-camaro-ss-2010', 'subaru-wrx-sti-2008', 'toyota-supra-tt-1993']);
    expect(REFERENCE_CARS.length).toBeGreaterThanOrEqual(15);
    expect(REFERENCE_CARS.filter((c) => c.spec.layout === 'FWD').length).toBeGreaterThanOrEqual(3);
    expect(REFERENCE_CARS.filter((c) => c.spec.transmission.type === 'dct').length).toBeGreaterThanOrEqual(2);
    expect(REFERENCE_CARS.filter((c) => c.spec.transmission.type === 'automatic').length).toBeGreaterThanOrEqual(2);
    expect(new Set(REFERENCE_CARS.map((c) => c.id)).size).toBe(REFERENCE_CARS.length);
  });
});

describe('tyre slip model', () => {
  it('slip curve peaks at slipPeak() and falls beyond it', () => {
    const B = 11.7;
    const C = 1.65;
    const kp = slipPeak(B, C);
    expect(slipCurve(kp, B, C)).toBeCloseTo(1, 6);
    expect(slipCurve(kp * 2, B, C)).toBeLessThan(1);
    expect(slipCurve(kp * 0.5, B, C)).toBeLessThan(1);
  });
  it('rising-branch inverse round-trips', () => {
    for (const r of [0.1, 0.5, 0.9]) expect(slipCurve(slipForForceFraction(r, 11.7, 1.65), 11.7, 1.65)).toBeCloseTo(r, 6);
  });
  it('wheelspin costs time: spin at a deep slip ratio is slower than at the peak; slip off is not slower than slip on', () => {
    const car = REFERENCE_CARS.find((c) => c.id === 'dodge-charger-hellcat-2015')!;
    const curve = curveFor(car.engineId, 'published').curve;
    const t = (g: object) => runAcceleration(car.spec, curve, { sampleDt: 0, stopSpeedMph: 60, stopDistanceM: 0, globals: g }).t0to60mph!;
    expect(t({ spinSlipRatio: 0.5 })).toBeGreaterThan(t({ spinSlipRatio: 0.12 }));
    expect(t({ slipModel: false })).toBeLessThanOrEqual(t({}) + 1e-9);
  });
});
