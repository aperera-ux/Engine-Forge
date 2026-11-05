import type { VehicleGlobals } from './types';

/**
 * Global (car-independent) vehicle parameters. Values marked FITTED were chosen
 * once on the TRAIN cars of the validation set (see research/vehicle_sources.md);
 * all others are a-priori engineering values. No per-car overrides.
 */
export const GLOBALS: VehicleGlobals = {
  etaRWD: 0.92, // CAPPED at the physical edge (unconstrained fit ran to 0.95); at the upper edge of the physical range, see report
  etaFWD: 0.94, // prior: RWD + 0.02 (no prop shaft / diff; one fewer mesh)
  etaAWD: 0.87, // prior: RWD - 0.05 (transfer case + two diffs); not validated
  muByClass: {
    // max-performance FITTED (train, round 2, 9 cars) = 1.30; the other classes keep their a-priori
    // ratio (0.82 / 0.91 / 1.0 / 1.14) to it. Spinning axles settle at D(spinSlipRatio) x mu.
    'all-season': 1.07,
    'summer-performance': 1.20,
    'max-performance': 1.30,
    'semi-slick': 1.49,
  },
  spinSlipRatio: 0.14, // FITTED (train, grid 0.12-0.30); close to the peak (0.12): fit finds little wheelspin loss; wheelspin settles on the falling branch of the slip curve
  slipB: 11.7, // a priori: peak slip ~0.12, typical road/performance radial
  slipC: 1.65, // a priori
  slipModel: true,
  converterStallRatioDefault: 1.8, // a priori: performance converters 1.6-2.2
  tireLoadSensitivity: 0, // FITTED (train)
  tireLoadRef: 14,
  crr0: 0.011,
  crr2: 0.0035,
  driverKg: 80,
  shiftTimeS: { manual: 0.3, dct: 0.08, automatic: 0.25 },
  clutchRampS: { manual: 0.2, dct: 0.1, automatic: 0.0 },
  drivelineInertiaFraction: 0.15,
};

export const G = 9.80665;
export const MPH = 0.44704;
export const KPH = 1 / 3.6;
export const QUARTER_MILE_M = 402.336;
export const EIGHTH_MILE_M = 201.168;
export const FOOT_M = 0.3048;
