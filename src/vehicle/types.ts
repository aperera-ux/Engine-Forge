/**
 * Vehicle mode (Stage 1): longitudinal straight-line performance model.
 * All SI unless the name says otherwise (...Mph, ...Kph).
 */

export type DriveLayout = 'FWD' | 'RWD' | 'AWD';
export type TransmissionType = 'manual' | 'dct' | 'automatic';
export type ShiftStrategy = 'optimal' | 'redline';

/** Coarse tyre grip class -> peak friction coefficient on a prepared/clean surface. */
export type TireClass = 'all-season' | 'summer-performance' | 'max-performance' | 'semi-slick';

export interface Transmission {
  type: TransmissionType;
  /** Forward gear ratios, 1st first. */
  gearRatios: number[];
  finalDrive: number;
  /** Zero-torque time per shift, s. Default by type (see GLOBALS). */
  shiftTimeS?: number;
  /**
   * Launch engine speed (clutch slip / converter stall / launch control), rpm.
   * Omit for the global rule defaultLaunchRpm(): lowest rpm reaching 90 % of
   * peak torque, clamped to 35-65 % of the rev limit.
   */
  launchRpm?: number;
  /**
   * Automatic only: torque multiplication at stall (speed ratio 0), fading
   * linearly to 1.0 at speed ratio 0.85 (coupling point). Default 1 (off).
   */
  converterStallRatio?: number;
}

export interface VehicleSpec {
  name: string;
  /** Curb mass, kg (fluids, no driver). The runner adds driverKg. */
  curbMassKg: number;
  /** Driver + test gear, kg. Default GLOBALS.driverKg. */
  driverKg?: number;
  cgHeightM: number;
  wheelbaseM: number;
  /** Static fraction of weight on the FRONT axle, 0-1. */
  frontWeightFraction: number;
  layout: DriveLayout;
  /** AWD only: fraction of drive torque sent to the front axle. Default 0.4. */
  awdFrontSplit?: number;
  /** Driven-tyre rolling radius, m. Use tireRollingRadiusM('255/35R19'). */
  tireRadiusM: number;
  tireClass: TireClass;
  /** Section width of one driven tyre, mm (for tyre load sensitivity). Default 245. */
  tireWidthMm?: number;
  /** Peak friction override (rarely used; prefer tireClass). */
  muPeak?: number;
  /** Drag area Cd*A, m^2. */
  cdA: number;
  /** Rolling-resistance coefficient at low speed. Default GLOBALS.crr0. */
  crr0?: number;
  /** Speed-dependent crr term: crr = crr0 + crr2*(v/27.78)^2. */
  crr2?: number;
  transmission: Transmission;
  /** Engine + flywheel + clutch rotating inertia, kg m^2. Default from displacement. */
  engineInertiaKgM2?: number;
  /** Rotating mass per wheel assembly (wheel, tyre, rotor), kg. Default 20. */
  wheelMassKg?: number;
  /** Drivetrain efficiency override (crank -> contact patch). Default by layout. */
  drivetrainEfficiency?: number;
  /** Electronic speed limiter, mph (undefined = none). */
  speedLimiterMph?: number;
}

export interface Ambient {
  tempC: number;
  pressureKPa: number;
  /** Relative humidity 0-1. Default 0. */
  humidity?: number;
}

/** Engine torque curve consumed by the vehicle model (crank basis, Nm). */
export interface TorqueCurve {
  /** Torque (Nm) tabulated every `step` rpm starting at 0 rpm. */
  tq: Float64Array;
  step: number;
  redlineRpm: number;
  /** Displacement, L (for the inertia default). */
  displacementL: number;
}

export interface RunOptions {
  ambient?: Ambient;
  shiftStrategy?: ShiftStrategy;
  /** Redline strategy shifts at this fraction of the limiter. Default 1.0. */
  shiftRpmFraction?: number;
  /** 1-ft rollout deducted from the start (US magazine convention). Default true. */
  rollout?: boolean;
  /** Time step, s. Default 0.001. */
  dt?: number;
  /** Stop after this distance (m) if reached. Default 402.336 (quarter mile). */
  stopDistanceM?: number;
  /** Also keep running until this speed (mph) is reached, e.g. 130 for 60-130. */
  stopSpeedMph?: number;
  maxTimeS?: number;
  /** Time-series sampling interval, s (0 = no series). Default 0.01. */
  sampleDt?: number;
  /** Override global parameters (for tuning only). */
  globals?: Partial<VehicleGlobals>;
}

export interface TimeSeries {
  t: Float64Array;
  /** m/s */
  v: Float64Array;
  /** m/s^2 */
  a: Float64Array;
  /** 1-based gear; 0 while shifting */
  gear: Int8Array;
  rpm: Float64Array;
  /** m */
  distance: Float64Array;
  /** 1 where the tractive force was grip-limited */
  tractionLimited: Uint8Array;
}

export interface TopSpeed {
  speedMs: number;
  speedMph: number;
  speedKph: number;
  gear: number;
  limitedBy: 'power' | 'redline' | 'limiter';
}

export interface AccelResult {
  /** All times use the `rollout` convention stated here. */
  rollout: boolean;
  t0to60mph: number | null;
  t0to100kph: number | null;
  t60to130mph: number | null;
  eighthMileS: number | null;
  eighthMileTrapMph: number | null;
  quarterMileS: number | null;
  /** Instantaneous speed at the quarter-mile line, mph (VBOX-style). */
  quarterMileTrapMph: number | null;
  /** Average over the last 66 ft (timing-light style), mph. */
  quarterMileTrap66ftMph: number | null;
  series: TimeSeries | null;
  shifts: { t: number; from: number; to: number; v: number }[];
}

export interface VehicleGlobals {
  /** Crank -> contact patch efficiency by layout. */
  etaRWD: number;
  etaFWD: number;
  etaAWD: number;
  /** Peak mu by tyre class. */
  muByClass: Record<TireClass, number>;
  /**
   * Slip ratio at which a spinning driven axle settles (driver / traction-control
   * quality). Sets the sliding grip D(kappa_spin) relative to peak.
   */
  spinSlipRatio: number;
  /** Slip-curve shape (Pacejka-like, E = 0): Fx = mu Fz sin(C atan(B kappa)). Peak at kappa = tan(pi/(2C))/B. */
  slipB: number;
  slipC: number;
  /** Master switch for the tyre slip model (false = legacy hard grip cap, no slip in rpm). */
  slipModel: boolean;
  /** Default torque-converter stall torque ratio for automatics (a priori, no per-car value). */
  converterStallRatioDefault: number;
  /** Tyre load sensitivity: mu falls by this fraction per fractional increase of static load per mm of width above tireLoadRef. */
  tireLoadSensitivity: number;
  /** Reference static load per mm tread width, N/mm. */
  tireLoadRef: number;
  crr0: number;
  crr2: number;
  driverKg: number;
  shiftTimeS: Record<TransmissionType, number>;
  /** Clutch / launch engagement ramp 0 -> full torque, s. */
  clutchRampS: Record<TransmissionType, number>;
  /** Extra rotating inertia (clutch, shafts, diff) as a fraction of engine inertia. */
  drivelineInertiaFraction: number;
}
