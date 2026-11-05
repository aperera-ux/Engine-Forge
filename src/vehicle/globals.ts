import type { VehicleGlobals } from './types';

/**
 * Global (car-independent) vehicle parameters. Values marked FITTED were chosen
 * once on the TRAIN cars of the validation set (see research/vehicle_sources.md);
 * all others are a-priori engineering values. No per-car overrides.
 */
export const GLOBALS: VehicleGlobals = {
  etaRWD: 0.92, // FITTED (train); at the upper edge of the physical range, see report
  etaFWD: 0.94, // prior: RWD + 0.02 (no prop shaft / diff; one fewer mesh)
  etaAWD: 0.87, // prior: RWD - 0.05 (transfer case + two diffs); not validated
  muByClass: {
    // max-performance FITTED (train) = 1.36; the other classes keep their a-priori
    // ratio (0.82 / 0.91 / 1.0 / 1.14) to it. Effective launch mu = x launchTractionUtilization.
    'all-season': 1.11,
    'summer-performance': 1.24,
    'max-performance': 1.36,
    'semi-slick': 1.55,
  },
  spinSlipRatio: 0.2, // FITTED (train); wheelspin settles on the falling branch of the slip curve
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
