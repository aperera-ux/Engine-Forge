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
  veBase: { pushrod: 0.99, sohc: 0.99, dohc: 1.01 } as Record<'pushrod' | 'sohc' | 'dohc', number>,
  /** VE penalty for 2-valve heads (shrouding, single port). */
  ve2ValvePenalty: 0.02,
  /** Taylor inlet Mach index at which choking begins to bite. */
  zChoke: 0.85,
  zChokeExp: 4,
  /** Optimum inlet Mach index for cam filling vs IVC (deg ABDC @0.050"). */
  zOptAt43: 0.62,
  zOptPerDeg: 0.0075,
  /** Mean valve flow coefficient scale (Ci = cdPeak * this * duration factor). */
  ciProfile: 0.6,
  /** Seat-timing offset added to IVC@0.050" for low-speed charge push-back, deg. */
  ivcSeatOffset: 20,
  /** Exponent on (1 − Z/Zopt) for push-back loss below the cam's tuned speed. */
  backflowExp: 1.5,
  /** VE loss coefficient above the cam's tuned speed. */
  camHighLoss: 0.5,
  /** Inertia-ram VE gain near the cam's tuned speed, × push-back volume fraction. */
  ramGain: 0.35,
  /** Intake cam-phaser authority used at WOT, ± crank deg about the nominal centerline. */
  vvtRangeDeg: 24,
  /** Variable-lift low-speed lobe: duration reduction (deg) and lift ratio. */
  lowLobeDurDelta: 45,
  lowLobeLiftRatio: 0.65,
  /** Intake runner tuning amplitude (plenum / ITB). */
  runnerAmp: 0.09,
  runnerAmpItb: 0.11,
  /** Helmholtz frequency ratio for the main tuning peak. */
  helmholtzK: 2.1,
  /** Depth of the off-tune VE dip at 1.5× the runner tuned rpm (× amplitude). */
  runnerOffTune: 0.45,
  /** Exhaust scavenging amplitude by header type. */
  exhAmp: { log: 0.0, shorty: 0.02, 'long-tube': 0.045, 'tuned-equal': 0.06 } as Record<string, number>,
  /** Exhaust loss coefficient (header + system), multiples of dynamic head. */
  exhZeta: { log: 5.0, shorty: 3.2, 'long-tube': 2.4, 'tuned-equal': 2.2 } as Record<string, number>,
  throttleCd: 0.82,
  // ── gas exchange / wave action (gasExchange.ts) ──
  /** Integration steps per gas-exchange period (EVO → IVC). */
  gxSteps: 150,
  /** Ratio between adjacent rpm nodes of the breathing table (fixed log lattice). */
  gxRpmNodeRatio: 1.16,
  /** Global scale on the gas-exchange VE (port losses, in-cylinder heat pick-up not resolved). */
  gxVeScale: 0.97,
  /** Lift-profile shape exponent: L = Lmax·(1 − x²)^n over the seat duration. */
  liftShapeExp: 2,
  /** Valve curtain discharge coefficient and port-throat discharge coefficients (re. valve head area). */
  valveCurtainCd: 0.7,
  intakeThroatCd: 0.75,
  exhaustThroatCd: 0.72,
  /** Runner cross-section / total intake-valve head area. */
  runnerAreaRatio: 0.9,
  /** Port length added to the runner / primary acoustic length, × bore. */
  intakePortLenBore: 1.2,
  exhaustPortLenBore: 1.0,
  /** Magnitude of the (inverting) open-end reflection at the plenum / bellmouth. */
  intakeReflect: 0.92,
  intakeReflectItb: 0.85,
  /** Magnitude of the (inverting) reflection at the collector, by exhaust type. */
  exhReflect: { log: 0.15, shorty: 0.3, 'long-tube': 0.37, 'tuned-equal': 0.4 } as Record<string, number>,
  /** Fraction of another cylinder's blowdown pulse that reaches this valve through a shared (log/turbine) manifold. */
  logPulseTransmit: 0.35,
  /** Runner entry + friction loss, multiples of runner dynamic head. */
  runnerLoss: 0.6,
  runnerLossItb: 0.3,
  /** Nominal exhaust gas temperature for wave speed, K; cylinder temperature at EVO / that. */
  gxExhaustTempK: 1250,
  gxEvoTempFactor: 1.3,
  /** Time constant separating the mean (fully reflected) from the pulsating part of returning waves, ms. */
  waveMeanTauMs: 6,
  /** Fraction of the closed-valve wave ringing carried into the next cycle (plenum/collector interaction damps it). */
  gxRingCarry: 0,
  /** Use the gas-exchange cycle's pumping work (true) or the mean-pressure + Mach-index correlation. */
  gxPumpingFromCycle: true,
  // ── combustion ──
  /** Indicated gross efficiency = etaScale * (1 - CR^-etaExp) at MBT, stoich-ish. */
  etaScale: 0.8,
  etaExp: 0.28,
  /** Base 0–100 % Wiebe burn duration, crank deg (4-valve pent-roof, B/S = 1). */
  burnDeg: 50,
  /** Burn-duration exponent on bore (flame travel distance). */
  burnBoreExp: 0.5,
  /** Burn-duration factor for DI high-tumble combustion systems. */
  diBurnFactor: 0.8,
  /** Burn-duration exponent on rpm (laminar share larger at low speed). */
  burnRpmExp: 0.1,
  /** In-cylinder heat-loss fraction at 3000 rpm and its rpm exponent. */
  heatLoss: 0.13,
  heatLossRpmExp: 0.35,
  /** Ignition / flame-development delay, crank deg. */
  delayDeg: 10,
  /** Douaud–Eyzat induction-time multiplier (global knock calibration). */
  knockTauScale: 1.3,
  /** Knock time-base exponent β: 0 = wall-clock time (∝1/rpm), 1 = crank-angle based. */
  knockRpmExp: 0.6,
  /** Pressure exponent of the induction-time correlation (Douaud–Eyzat 1.7). */
  knockPressureExp: 1.7,
  /** CR-dependent heat-transfer/crevice penalty on indicated efficiency, per CR² above 10. */
  crPenalty: 0.0015,
  /** Torque loss coefficient per deg² of retard from MBT. */
  sparkLossK: 0.0005,
  /** Exponent on (1 − residual fraction) in the auto-ignition delay: burned-gas dilution slows end-gas chemistry. */
  knockDilutionExp: 1.0,
  /** ECU cam-phasing objective: maximise VE − weight × residual fraction (residual costs burn rate / knock margin). */
  ecuResidualWeight: 0.5,
  /** Knock-aware boost control: max spark retard the ECU accepts before trimming boost, deg. */
  ecuMaxRetardDeg: 10,
  /** Fraction of the excess retard (beyond ecuMaxRetardDeg) the ECU still accepts. */
  ecuRetardSoft: 0.5,
  /** Relative reduction of the end-gas compression exponent at 1000 rpm (wall heat loss). */
  endGasHeatLoss: 0.0,
  /** Residual blow-through rate when intake pressure exceeds exhaust pressure. */
  scavengeK: 1,
  /** Octane-index weighting K in OI = RON − K·S. */
  octaneK: 0.25,
  /** Reduction of K per bar of boost (Kalghatgi: K < 0 under boosted conditions). */
  octaneKPerBar: 1.0,
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
  compChokePerMm2: 1.2e-4,
  compEtaPeak: 0.74,
  turbineEta: 0.68,
  /** Turbine effective flow area per (A/R · inducer² mm²), m². */
  turbineAreaPerARmm2: 2.6e-7,
  /** (turbine nozzle + open wastegate) / turbine nozzle effective area. */
  wastegateAreaFactor: 2.0,
  /** Fraction of the header-type exhaust loss that a turbo manifold adds ahead of the turbine. */
  turboManifoldLossFrac: 0.5,
  /** Compressor top-speed line: max PR and the flow fraction where it starts rolling off. */
  compPrMax: 3.9,
  compPrMaxPerMm: 0.01,
  compSpeedLineKnee: 0.75,
  /** Turbine frame size exponent on inducer diameter (turbine area ∝ A/R · D^exp). */
  turbineFrameExp: 1.5,
  /** Extra low-flow turbine efficiency from twin-scroll pulse separation. */
  twinScrollPulse: 0.5,
  /** Supercharger pulley sizing: crank rpm where targetBoostBar is reached (default). */
  scReferenceRpm: 6000,
  /** Turbine-inlet (exhaust manifold) pressure limit enforced by boost control, bar abs. */
  turbineInletMaxBar: 4.5,
};
