import { GLOBALS } from '../globals';
import type { VehicleGlobals } from '../types';
import { evaluateCar } from './run';
import { REFERENCE_CARS } from './referenceCars';

/**
 * Global-parameter fit. ONLY the TRAIN cars are used, with the PUBLISHED curves
 * (so engine-model error does not leak into vehicle parameters). Free
 * parameters (shared by all cars, no per-car terms):
 *   muMax  peak friction of the 'max-performance' tyre class (other classes keep
 *          their a-priori ratio to it)
 *   etaRWD drivetrain efficiency for RWD (FWD/AWD keep their offsets)
 * Objective: sum over train cars of squared relative errors of 0-60, 1/4 ET and trap.
 */
export function makeGlobals(muMax: number, etaRWD: number, spinKappa = GLOBALS.spinSlipRatio, ks = 0): Partial<VehicleGlobals> {
  const k = muMax / GLOBALS.muByClass['max-performance'];
  return {
    etaRWD,
    spinSlipRatio: spinKappa,
    tireLoadSensitivity: ks,
    etaFWD: etaRWD + 0.02,
    etaAWD: etaRWD - 0.05,
    muByClass: {
      'all-season': GLOBALS.muByClass['all-season'] * k,
      'summer-performance': GLOBALS.muByClass['summer-performance'] * k,
      'max-performance': muMax,
      'semi-slick': GLOBALS.muByClass['semi-slick'] * k,
    },
  };
}

export function trainLoss(g: Partial<VehicleGlobals>): number {
  let s = 0;
  for (const car of REFERENCE_CARS.filter((c) => c.split === 'train')) {
    const r = evaluateCar(car, 'published', { globals: g });
    for (const e of [r.err060, r.errQm, r.errTrap]) if (e !== null) s += (e / 100) ** 2;
  }
  return s;
}

export function gridFit(muGrid: number[], etaGrid: number[], utilGrid: number[], ksGrid: number[]) {
  let best = { mu: 0, eta: 0, util: 0, ks: 0, loss: Infinity };
  for (const mu of muGrid)
    for (const eta of etaGrid)
      for (const util of utilGrid)
        for (const ks of ksGrid) {
          const loss = trainLoss(makeGlobals(mu, eta, util, ks));
          if (loss < best.loss) best = { mu, eta, util, ks, loss };
        }
  return best;
}
