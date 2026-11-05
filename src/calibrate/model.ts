/**
 * The calibrated model: simulate() (public API only) with the parameter vector
 * applied. Hardware shifts go in through the EngineConfig; the VE and friction
 * scales and the torque cap go in through SimOptions.calibration, inside the
 * simulator's operating-point solve (no post-hoc rescaling of the result).
 */
import { simulate } from '../sim/engine';
import type { EngineConfig, SimCalibration, SimOptions, SimResult } from '../sim/types';
import { clampParam, type ParamValues } from './params';

/** The fixed context a fit and its later re-use share. */
export interface ModelFrame {
  /** The build being calibrated, as the user had it. */
  base: EngineConfig;
  /** simulate() options, fixed for the whole fit (OEM-limit policy is decided once, from the unmodified build). */
  opts: SimOptions;
  /** Hardware peak torque of the base build, N.m: the reference for the torqueCap fraction. */
  capRefNm: number;
}

export function makeFrame(base: EngineConfig, opts: SimOptions): ModelFrame {
  const r = simulate(base, opts);
  return { base, opts, capRefNm: r.peakTorqueNm };
}

/** Hardware side of the parameter vector: the EngineConfig to simulate. */
export function configFor(base: EngineConfig, v: ParamValues): EngineConfig {
  const c: EngineConfig = { ...base, cam: { ...base.cam }, turbo: { ...base.turbo }, supercharger: { ...base.supercharger } };
  if (base.ecu) c.ecu = { ...base.ecu, boostSchedule: base.ecu.boostSchedule?.map((p) => ({ ...p })) };
  if (v.runnerScale !== undefined) c.intakeRunnerMm = base.intakeRunnerMm * clampParam('runnerScale', v.runnerScale);
  if (v.camShiftDeg !== undefined) c.cam.intakeCenterlineDeg = base.cam.intakeCenterlineDeg + clampParam('camShiftDeg', v.camShiftDeg);
  if (v.boostScale !== undefined && base.induction !== 'na') {
    const k = clampParam('boostScale', v.boostScale);
    c.turbo.targetBoostBar = base.turbo.targetBoostBar * k;
    c.supercharger.targetBoostBar = base.supercharger.targetBoostBar * k;
    if (c.ecu?.boostSchedule) c.ecu.boostSchedule = c.ecu.boostSchedule.map((p) => ({ rpm: p.rpm, bar: p.bar * k }));
  }
  return c;
}

/**
 * Simulator side of the parameter vector: the first-class SimOptions.calibration
 * multipliers. They act inside every operating-point solve (VE moves airflow,
 * boost, knock and EGT together; friction moves brake MEP before the ECU torque
 * limiter; the cap is an ECU torque limit, the lower of it and any OEM limit in
 * force), so the ECU and the turbo see them. Identity values are omitted, so a
 * nominal vector gives exactly simulate(config, opts).
 */
export function calibrationFor(frame: Pick<ModelFrame, 'capRefNm'>, v: ParamValues): SimCalibration {
  const out: SimCalibration = {};
  const ve = v.veScale === undefined ? 1 : clampParam('veScale', v.veScale);
  const fr = v.fricScale === undefined ? 1 : clampParam('fricScale', v.fricScale);
  const cap = v.torqueCap === undefined ? 1 : clampParam('torqueCap', v.torqueCap);
  if (ve !== 1) out.veScale = ve;
  if (fr !== 1) out.frictionScale = fr;
  if (cap < 0.995 && frame.capRefNm > 0) out.torqueCapNm = cap * frame.capRefNm;
  return out;
}

const isIdentity = (k: SimCalibration) => k.veScale === undefined && k.frictionScale === undefined && k.torqueCapNm === undefined;

/** simulate() for a build with a calibration applied. */
export function simulateCalibratedConfig(config: EngineConfig, opts: SimOptions, k: SimCalibration): SimResult {
  if (isIdentity(k)) return simulate(config, opts);
  const r = simulate(config, { ...opts, calibration: k });
  // The model's validation-residual band describes the uncalibrated model; it does not apply to a fitted curve.
  return { ...r, unlimited: undefined, uncertainty: undefined };
}

/** simulate() with the full parameter vector applied. */
export function simulateWith(frame: ModelFrame, v: ParamValues): SimResult {
  return simulateCalibratedConfig(configFor(frame.base, v), frame.opts, calibrationFor(frame, v));
}

/** Linear interpolation of torque on a result curve; undefined outside its rpm range. */
export function torqueAt(r: SimResult, rpm: number): number | undefined {
  const c = r.curve;
  if (!c.length || rpm < c[0].rpm - 1e-6 || rpm > c[c.length - 1].rpm + 1e-6) return undefined;
  let lo = 0;
  let hi = c.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (c[m].rpm <= rpm) lo = m;
    else hi = m;
  }
  const a = c[lo];
  const b = c[hi];
  return a.torqueNm + ((b.torqueNm - a.torqueNm) * (rpm - a.rpm)) / (b.rpm - a.rpm || 1);
}
