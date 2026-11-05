import { describe, expect, it } from 'vitest';
import { optimizeGearing } from '../optimize';
import { curveFor } from '../validation/run';
import { REFERENCE_CARS } from '../validation/referenceCars';

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

// Optimiser behaviour on TRAIN cars only: does the final-drive optimum sit inside the search range?
describe('gearing optimiser finds interior optima (train cars)', () => {
  const rows: string[] = [];
  const ratios: number[] = [];
  for (const car of REFERENCE_CARS.filter((c) => c.split === 'train')) {
    for (const obj of ['0-60', 'quarter-mile'] as const) {
      it(`${car.id} ${obj}`, () => {
        const curve = curveFor(car.engineId, 'published').curve;
        const o = optimizeGearing(car.spec, curve, { objective: obj, run: { rollout: true } });
        const k = o.finalDrive / car.spec.transmission.finalDrive;
        ratios.push(k);
        rows.push(`${car.id} ${obj}: fd x${k.toFixed(3)} ${o.baseline.toFixed(3)} -> ${o.best.toFixed(3)}`);
        expect(o.best).toBeLessThanOrEqual(o.baseline + 1e-9);
        if (ENV.OPT) console.log(rows[rows.length - 1]);
      });
    }
  }
  it('most optima are interior (not at the 0.7 / 1.4 range edges)', () => {
    const interior = ratios.filter((k) => k > 0.705 && k < 1.395).length;
    if (ENV.OPT) console.log(`interior ${interior}/${ratios.length}`);
    expect(interior).toBeGreaterThanOrEqual(Math.ceil(ratios.length * 0.6));
  });
});
