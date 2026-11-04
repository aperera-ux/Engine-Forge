/**
 * Physical constants, fuel properties and the GLOBAL calibration constants of
 * the 0-D engine model. Every tunable number that is not a textbook constant
 * lives in `CAL` so calibration never touches per-engine logic.
 */
import type { FuelType } from '../types';

export const P_AMB_PA = 101325; // 1.013 bar
export const T_AMB_K = 298.15; // 25 °C
export const R_AIR = 287.05; // J/(kg K)
export const CP_AIR = 1005; // J/(kg K)
export const GAMMA_AIR = 1.4;
export const R_EXH = 290;
export const CP_EXH = 1200; // hot exhaust, J/(kg K)
export const GAMMA_EXH = 1.33;
export const RHO_AMB = P_AMB_PA / (R_AIR * T_AMB_K); // ≈1.184 kg/m³
export const HP_W = 745.7;
export const LBFT_PER_NM = 0.737562;

export interface FuelProps {
  /** Lower heating value, J/kg. */
  lhv: number;
  /** Stoichiometric air/fuel mass ratio. */
  afr: number;
  ron: number;
  mon: number;
  /** Heat of vaporisation, J/kg. */
  hfg: number;
  /** Indicated-efficiency multiplier (more product moles, lower flame temperature). */
  etaFactor: number;
  /** Laminar flame speed factor (burn rate). */
  flameSpeed: number;
}

export const FUELS: Record<FuelType, FuelProps> = {
  gas87: { lhv: 43.0e6, afr: 14.6, ron: 91.5, mon: 82.5, hfg: 350e3, etaFactor: 1.0, flameSpeed: 1.0 },
  gas91: { lhv: 43.0e6, afr: 14.6, ron: 95.5, mon: 86.5, hfg: 350e3, etaFactor: 1.0, flameSpeed: 1.0 },
  gas93: { lhv: 43.0e6, afr: 14.6, ron: 98.0, mon: 88.0, hfg: 350e3, etaFactor: 1.0, flameSpeed: 1.0 },
  race100: { lhv: 43.8e6, afr: 14.8, ron: 104, mon: 96, hfg: 340e3, etaFactor: 1.0, flameSpeed: 1.0 },
  e85: { lhv: 29.2e6, afr: 9.8, ron: 107, mon: 89, hfg: 810e3, etaFactor: 1.02, flameSpeed: 1.08 },
  methanol: { lhv: 19.9e6, afr: 6.45, ron: 109, mon: 89, hfg: 1100e3, etaFactor: 1.05, flameSpeed: 1.12 },
};

/**
 * Global calibration constants. Tuned once against the reference-engine set
 * (src/sim/validation/referenceEngines.ts); never per engine.
 */
export const CAL = {
  // ── airflow ──
  /** Base volumetric efficiency (re. manifold density, before tuning gains). */
  veBase: { pushrod: 1.0, sohc: 1.0, dohc: 1.02 } as Record<'pushrod' | 'sohc' | 'dohc', number>,
  /** VE penalty for 2-valve heads (shrouding, single port). */
  ve2ValvePenalty: 0.02,
  /** Taylor inlet Mach index at which choking begins to bite. */
  zChoke: 0.95,
  zChokeExp: 6,
  /** Optimum inlet Mach index for cam filling vs IVC (deg ABDC @0.050"). */
  zOptAt43: 0.47,
  zOptPerDeg: 0.0075,
  /** Mean valve flow coefficient scale (Ci = cdPeak * this * duration factor). */
  ciProfile: 0.6,
  /** Intake runner tuning amplitude (plenum / ITB). */
  runnerAmp: 0.06,
  runnerAmpItb: 0.08,
  /** Helmholtz frequency ratio for the main tuning peak. */
  helmholtzK: 2.1,
  /** Depth of the off-tune VE dip at 1.5× the runner tuned rpm (× amplitude). */
  runnerOffTune: 0.45,
  /** Exhaust scavenging amplitude by header type. */
  exhAmp: { log: 0.0, shorty: 0.02, 'long-tube': 0.045, 'tuned-equal': 0.06 } as Record<string, number>,
  /** Exhaust loss coefficient (header + system), multiples of dynamic head. */
  exhZeta: { log: 5.0, shorty: 3.2, 'long-tube': 2.4, 'tuned-equal': 2.2 } as Record<string, number>,
  throttleCd: 0.82,
  // ── combustion ──
  /** Indicated gross efficiency = etaScale * (1 - CR^-etaExp) at MBT, stoich-ish. */
  etaScale: 0.81,
  etaExp: 0.28,
  /** Base 0–100 % Wiebe burn duration, crank deg (4-valve pent-roof, B/S = 1). */
  burnDeg: 50,
  /** Burn-duration exponent on bore (flame travel distance). */
  burnBoreExp: 0.5,
  /** Ignition / flame-development delay, crank deg. */
  delayDeg: 10,
  /** Douaud–Eyzat induction-time multiplier (global knock calibration). */
  knockTauScale: 3.0,
  /** Torque loss coefficient per deg² of retard from MBT. */
  sparkLossK: 0.0006,
  /** Relative reduction of the end-gas compression exponent at 1000 rpm (wall heat loss). */
  endGasHeatLoss: 0.0,
  /** Octane-index weighting K in OI = RON − K·S. */
  octaneK: 0.25,
  /** Fraction of fuel heat of vaporisation that cools the charge (PFI / DI). */
  evapPfi: 0.35,
  evapDi: 0.55,
  /** Fraction of fuel energy actually released as pressure in the 1-zone model. */
  pressureHeatFrac: 0.78,
  // ── friction (Chen–Flynn, bar, m/s) ──
  fA: 0.36,
  fB: 0.004,
  fC: 0.045,
  fD: 0.0006,
  valvetrainFmep: { pushrod: 0.12, sohc: 0.1, dohc: 0.12 } as Record<'pushrod' | 'sohc' | 'dohc', number>,
  // ── turbo ──
  /** Compressor choke flow per inducer area, kg/s per mm². */
  compChokePerMm2: 1.15e-4,
  compEtaPeak: 0.74,
  turbineEta: 0.68,
  /** Turbine effective flow area per (A/R · inducer² mm²), m². */
  turbineAreaPerARmm2: 3.5e-7,
  /** (turbine nozzle + open wastegate) / turbine nozzle effective area. */
  wastegateAreaFactor: 1.5,
};
