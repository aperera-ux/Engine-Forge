/**
 * SHARED CONTRACT — EngineConfig (input) and SimResult (output).
 *
 * This file is the interface between the simulation (src/sim), the 3D renderer
 * (src/render) and the UI (src/ui). Changes must be ADDITIVE (new optional
 * fields) so other modules keep compiling. Units are SI-ish and always in the
 * field name or doc comment: mm, deg, bar, kg, rpm, K, °C.
 */

export type Layout = 'inline' | 'v' | 'flat';
export type ValvetrainType = 'pushrod' | 'sohc' | 'dohc';
export type InductionType = 'na' | 'turbo' | 'supercharger';
export type SuperchargerType = 'roots' | 'twin-screw' | 'centrifugal';
export type FuelType = 'gas87' | 'gas91' | 'gas93' | 'race100' | 'e85' | 'methanol';
export type ExhaustType = 'log' | 'shorty' | 'long-tube' | 'tuned-equal';
export type BlockMaterial = 'iron' | 'aluminum';
export type PistonType = 'cast' | 'hypereutectic' | 'forged';
export type RodType = 'cast' | 'forged-steel' | 'billet-steel' | 'titanium';
export type CrankType = 'cast' | 'forged' | 'billet';
/** V8 only: crossplane (90° pins) or flatplane (180° pins). Ignored otherwise. */
export type CrankPlane = 'cross' | 'flat';

export interface CamConfig {
  /** Intake duration at 0.050" (1.27 mm) lift, crank degrees. Typical 200–300. */
  intakeDurationDeg: number;
  /** Exhaust duration at 0.050" lift, crank degrees. */
  exhaustDurationDeg: number;
  /** Peak valve lift at the valve, mm. Typical 8–16. */
  intakeLiftMm: number;
  exhaustLiftMm: number;
  /** Lobe separation angle, cam degrees. Typical 104–118. */
  lobeSeparationDeg: number;
  /** Intake centerline, crank degrees ATDC. Typical 100–115. */
  intakeCenterlineDeg: number;
  /** Variable valve timing (cam phasing) — broadens the VE curve. */
  vvt: boolean;
  /** Variable lift (VTEC/Valvetronic-style) — two-stage lift/duration. */
  variableLift: boolean;
}

export interface TurboConfig {
  /** Target boost pressure, bar gauge. */
  targetBoostBar: number;
  /** Compressor inducer diameter, mm. Bigger = more flow, more lag. Typical 40–80. */
  compressorInducerMm: number;
  /** Turbine housing A/R. Typical 0.5–1.2. Smaller = earlier spool. */
  turbineAR: number;
  /** Intercooler effectiveness 0–1 (0 = none). */
  intercoolerEffectiveness: number;
  twinScroll: boolean;
  /** Number of turbos (1 or 2). */
  count: 1 | 2;
}

export interface SuperchargerConfig {
  type: SuperchargerType;
  /** Target boost, bar gauge, reached at `referenceRpm` (fixed pulley drive ratio). */
  targetBoostBar: number;
  /** Optional (physics agent): crank rpm at which targetBoostBar is reached, i.e. the pulley sizing. Default 6000. */
  referenceRpm?: number;
  intercoolerEffectiveness: number;
}

/**
 * Optional (physics agent, v4): OEM engine-management calibration at wide-open
 * throttle. Absent fields mean "no explicit limit" (an aftermarket-style map
 * that only respects knock and hardware limits).
 */
export interface EcuConfig {
  /**
   * Where torqueLimitNm / powerLimitKw come from.
   *  - 'published-rating': copied from the manufacturer's published torque
   *    plateau / power band for a stock preset. This is an INPUT, not a
   *    prediction: with it applied, the stock engine's peak torque and power
   *    are the published ones by construction. It is meaningful only while the
   *    hardware equals the stock hardware (see customBuild.ts).
   *  - 'hardware' (or absent): a limit the user or the hardware imposes
   *    (e.g. a deliberate torque cap to protect a gearbox); always applied.
   */
  limitSource?: 'published-rating' | 'hardware';
  /**
   * Brake-torque limit, N·m (OEM torque management / "torque structure").
   * Boosted engines: the ECU lowers the boost target until brake torque is at
   * the limit. This is how factory turbo engines produce flat plateaus.
   * 0 or absent = no limit.
   */
  torqueLimitNm?: number;
  /**
   * Rated-power limit, kW (OEM power management: boost is tapered above the
   * rpm where torque × ω would exceed it, giving the published flat power
   * band). Boosted engines only. 0 or absent = no limit.
   */
  powerLimitKw?: number;
  /**
   * Boost target schedule, bar gauge vs rpm (linear interpolation, clamped at
   * the ends). Turbo only; replaces turbo.targetBoostBar where given.
   */
  boostSchedule?: { rpm: number; bar: number }[];
  /** Knock retard (deg) the ECU accepts before trimming boost. Default 10. */
  maxKnockRetardDeg?: number;
}

export interface EngineConfig {
  /**
   * Intake system the power is measured / modelled with (optional).
   *  - 'stock' (default): production airbox, filter and ducting (~3 % total-pressure
   *    loss at rated flow; loss grows with flow squared).
   *  - 'open': bare-engine dyno (crate-engine test: carburettor or open
   *    throttle body, no airbox).
   * NA engines only; boosted engines' inlet loss is inside the compressor map.
   */
  intakeSystem?: 'stock' | 'open';
  name: string;
  layout: Layout;
  /** 1–16. Allowed counts depend on layout (see layout.ts SUPPORTED_CYLINDERS). */
  cylinders: number;
  /** V-angle, deg (V layout only). Flat engines are 180. */
  vAngleDeg: number;
  crankPlane: CrankPlane;

  boreMm: number;
  strokeMm: number;
  /** Connecting rod center-to-center length, mm. */
  rodLengthMm: number;
  compressionRatio: number;

  valvetrain: ValvetrainType;
  /** 2, 3, 4 or 5. */
  valvesPerCylinder: number;
  /** Head diameter of a single intake valve, mm. */
  intakeValveMm: number;
  exhaustValveMm: number;
  cam: CamConfig;

  induction: InductionType;
  turbo: TurboConfig;
  supercharger: SuperchargerConfig;

  /** Intake runner length (valve to plenum), mm. Tunes the torque peak. */
  intakeRunnerMm: number;
  /** Total throttle area expressed as equivalent single throttle diameter, mm. */
  throttleMm: number;
  /** Individual throttle bodies. */
  itb: boolean;

  exhaust: ExhaustType;
  /** Header primary length, mm. */
  headerPrimaryMm: number;
  /** Header primary inner diameter, mm. */
  headerDiameterMm: number;

  fuel: FuelType;
  /** Target lambda at WOT (1.0 = stoich). Typical 0.78–0.90 at WOT. */
  lambda: number;
  directInjection: boolean;

  /** Rev limiter, rpm. */
  redlineRpm: number;
  idleRpm: number;

  blockMaterial: BlockMaterial;
  pistons: PistonType;
  rods: RodType;
  crank: CrankType;
  /** Optional (physics agent, v4): ECU torque management / boost schedule. */
  ecu?: EcuConfig;
}

/** One row of the dyno sweep. */
export interface DynoPoint {
  rpm: number;
  torqueNm: number;
  powerKw: number;
  /** Mechanical horsepower (1 hp = 745.7 W). */
  hp: number;
  torqueLbFt: number;
  /** Brake mean effective pressure, bar. */
  bmepBar: number;
  /** Indicated mean effective pressure, bar. */
  imepBar: number;
  /** Friction mean effective pressure (incl. pumping), bar. */
  fmepBar: number;
  /** Volumetric efficiency referenced to ambient, 0–1.5 (can exceed 1 from tuning/boost). */
  volumetricEfficiency: number;
  /** Manifold absolute pressure, bar. */
  mapBar: number;
  /** Boost, bar gauge (0 for NA). */
  boostBar: number;
  /** Air mass flow, kg/s. */
  airFlowKgS: number;
  /** Fuel mass flow, kg/h. */
  fuelFlowKgH: number;
  /** Brake specific fuel consumption, g/kWh. */
  bsfcGkWh: number;
  /** Brake thermal efficiency 0–1. */
  thermalEfficiency: number;
  /** Spark advance used, deg BTDC. */
  sparkAdvanceDeg: number;
  /** Retard from MBT due to knock limit, deg (0 = running at MBT). */
  knockRetardDeg: number;
  /** Exhaust gas temperature, °C. */
  egtC: number;
  /** Intake charge temperature after compressor/intercooler, °C. */
  chargeTempC: number;
  /** Mean piston speed, m/s. */
  meanPistonSpeedMs: number;
  /** Peak cylinder pressure, bar. */
  peakCylinderPressureBar: number;
  /** Exhaust-side pressure seen by the cylinder (turbine inlet for turbos), bar abs. Optional (physics agent). */
  exhaustPressureBar?: number;
  /** Pumping MEP (part of fmepBar), bar. Optional (physics agent). */
  pmepBar?: number;
  /** Lambda actually run (ECU EGT-protection enrichment may richen the requested value). Optional (physics agent, v4). */
  lambda?: number;
}

export type WarningSeverity = 'info' | 'warn' | 'critical';

export interface SimWarning {
  severity: WarningSeverity;
  /** Short machine id, e.g. 'piston-speed', 'knock', 'valve-float'. */
  code: string;
  message: string;
}

/**
 * Optional (physics agent, v4): prediction uncertainty (data only).
 * Bands are ≈1σ, in % of the predicted value, from validation residuals against
 * published figures, widened when the configuration is outside the validated
 * envelope.
 */
export interface SimUncertainty {
  /** ±% band on torque (and power) for each curve point (same order as `curve`). */
  torquePct: number[];
  /** ±% on peak power and peak torque. */
  peakHpPct: number;
  peakTorquePct: number;
  /** 0 = inside the envelope of the validated reference engines, → 1 far outside. */
  extrapolation: number;
  /** Why the band is wide (which inputs are outside the validated range, etc.). */
  reasons: string[];
}

/** Options for simulate(). All optional. */
export interface SimOptions {
  /**
   * Apply ecu.torqueLimitNm / ecu.powerLimitKw (default true). When false both
   * are ignored; boost schedule, knock control and EGT protection stay on, so
   * the curve is what the hardware can do under a normal safe tune.
   */
  applyOemLimits?: boolean;
  /**
   * Also return SimResult.unlimited (the curve with the OEM limits ignored).
   * Costs a second solve only when the config actually carries a limit.
   */
  includeUnlimited?: boolean;
  /**
   * Additive (physics agent, §17): per-build calibration multipliers (src/calibrate
   * fits them to a measured dyno curve). Omitted fields, or the whole object, are
   * the identity and leave every output bit-identical.
   */
  calibration?: SimCalibration;
}

/**
 * Calibration multipliers that act INSIDE every operating-point solve, so the
 * ECU (torque limiter, knock trim, protection) and the turbo / exhaust fixed
 * point see them; they are not a post-hoc rescaling of the result.
 */
export interface SimCalibration {
  /**
   * Multiplier on the trapped-air volumetric efficiency of the gas-exchange
   * model (after the ECU's cam choice). Moves airflow, MAP and boost (turbo
   * flow, wastegate), trapped charge, knock retard, EGT and fuel flow
   * together. Default 1; clamped to [0.5, 1.5].
   */
  veScale?: number;
  /**
   * Multiplier on mechanical friction MEP (Chen–Flynn rings/bearings,
   * valvetrain, accessories). Pumping MEP (from the gas-exchange cycle) and
   * supercharger drive power are not friction and are not scaled. Acts on
   * brake MEP before the ECU torque limiter. Default 1; clamped to [0.3, 3].
   */
  frictionScale?: number;
  /**
   * Brake-torque cap, N·m, enforced like an ECU torque limit: on boosted
   * engines by lowering the boost target (combined with any OEM limit in force
   * as the lower of the two), and by closing the throttle (manifold-pressure
   * target) where boost cannot go lower or the engine is NA. Applies whether
   * or not applyOemLimits is set. Points it holds count as torque-limited for
   * peakTorqueRpm / peakTorqueRpmRange. Ignored unless finite and > 0.
   * SimResult.unlimited is computed without it.
   */
  torqueCapNm?: number;
}

export interface SimResult {
  config: EngineConfig;
  curve: DynoPoint[];
  /** Which OEM limits were in force for `curve`. */
  oemLimits: {
    /** true when a torque and/or power limit was present AND applied. */
    applied: boolean;
    /** true when the config carries a limit at all (applied or not). */
    present: boolean;
    torqueLimitNm?: number;
    powerLimitKw?: number;
    source?: 'published-rating' | 'hardware';
  };
  /**
   * Hardware-only curve (OEM limits ignored). Present only when
   * SimOptions.includeUnlimited was set; identical to `curve` when no limit is
   * present or applied.
   */
  unlimited?: DynoPoint[];

  displacementCc: number;
  displacementL: number;
  /** Swept volume of one cylinder, cc. */
  cylinderCc: number;
  boreStrokeRatio: number;
  /** Rod length / stroke  (rod ratio is often quoted as rod/stroke). */
  rodStrokeRatio: number;

  peakPowerKw: number;
  peakHp: number;
  /** Lowest rpm with power within PEAK_PLATEAU_BAND_NM (0.1 N·m) × ω of peakPowerKw: the band start on an ECU power-limited band, else the argmax. */
  peakPowerRpm: number;
  peakTorqueNm: number;
  peakTorqueLbFt: number;
  /** Lowest rpm with torque within PEAK_PLATEAU_BAND_NM (0.1 N·m) of peakTorqueNm: the plateau START on an ECU torque-limited plateau, else the argmax. */
  peakTorqueRpm: number;
  /**
   * Additive (physics agent): rpm range quoted for peak torque, OEM style
   * ("450 N·m @ 1400–5000 rpm"): first and last rpm within PEAK_PLATEAU_BAND_NM
   * of the peak when an ECU torque limit holds the top, else [argmax, argmax].
   * peakTorqueRpm === peakTorqueRpmRange[0].
   */
  peakTorqueRpmRange?: [number, number];
  /** Additive (physics agent): same for power (ECU power limit); peakPowerRpm === peakPowerRpmRange[0]. */
  peakPowerRpmRange?: [number, number];
  /** hp per litre */
  specificOutputHpL: number;

  /** Mean piston speed at redline, m/s. */
  meanPistonSpeedRedlineMs: number;
  /** Max piston acceleration at redline, m/s². */
  maxPistonAccelRedline: number;
  /** Estimated valve-float rpm. */
  valveFloatRpm: number;
  /** Estimated safe max rpm considering rotating assembly. */
  mechanicalLimitRpm: number;

  /** Estimated dry engine mass, kg. */
  massKg: number;
  /** Power-to-weight, hp/kg of engine. */
  hpPerKg: number;

  /** e.g. "1-3-4-2" */
  firingOrder: string;
  evenFiring: boolean;
  /** Human-readable primary/secondary balance summary. */
  balance: {
    primaryForce: 'balanced' | 'unbalanced';
    primaryCouple: 'balanced' | 'unbalanced';
    secondaryForce: 'balanced' | 'unbalanced';
    secondaryCouple: 'balanced' | 'unbalanced';
    summary: string;
  };

  /** 0–100 reliability score; 100 = stock-like margins. */
  reliabilityScore: number;
  warnings: SimWarning[];
  /** Optional (physics agent, v4): prediction uncertainty band and extrapolation score. */
  uncertainty?: SimUncertainty;
}
