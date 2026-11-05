/**
 * The calibrated model: simulate() (public API only) with the parameter vector
 * applied. Hardware shifts go in through the EngineConfig; the scale factors
 * and the torque cap are applied to the returned SimResult.
 */
import { simulate } from '../sim/engine';
import type { DynoPoint, EngineConfig, SimOptions, SimResult } from '../sim/types';
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

/** Output side of the parameter vector. */
export interface PostCorrection {
  /** Scale on IMEP. */
  veScale: number;
  /** Scale on FMEP. */
  fricScale: number;
  /** Absolute brake-torque cap, N.m (undefined = none). */
  capNm?: number;
}

export function postFor(frame: Pick<ModelFrame, 'capRefNm'>, v: ParamValues): PostCorrection {
  const cap = v.torqueCap === undefined ? 1 : clampParam('torqueCap', v.torqueCap);
  return {
    veScale: v.veScale === undefined ? 1 : clampParam('veScale', v.veScale),
    fricScale: v.fricScale === undefined ? 1 : clampParam('fricScale', v.fricScale),
    capNm: cap < 0.995 ? cap * frame.capRefNm : undefined,
  };
}

const isIdentity = (p: PostCorrection) => p.veScale === 1 && p.fricScale === 1 && p.capNm === undefined;

/** Plateau band used for peak-rpm ranges (same N.m band the simulator uses). */
const BAND_NM = 0.1;

/**
 * Apply the output corrections to a simulated result.
 *   bmep' = ve * imep - fric * fmep;   T = bmep * Vd / (4 pi);   T' = min(T', cap, OEM torque limit in force)
 * Every field derived from torque or power is recomputed; fields that are not
 * (uncertainty band, warnings, mechanical limits) are carried over unchanged.
 */
export function applyPost(r: SimResult, p: PostCorrection): SimResult {
  if (isIdentity(p)) return r;
  const vd = r.displacementCc * 1e-6;
  const lim = r.oemLimits.applied ? r.oemLimits : undefined;
  let capped = false;
  const curve: DynoPoint[] = r.curve.map((pt) => {
    const imep = pt.imepBar * p.veScale;
    const fmep = pt.fmepBar * p.fricScale;
    let bmep = Math.max(0, imep - fmep);
    let tq = (bmep * 1e5 * vd) / (4 * Math.PI);
    const w = (pt.rpm * 2 * Math.PI) / 60;
    let cap = Infinity;
    if (p.capNm !== undefined) cap = p.capNm;
    if (lim?.torqueLimitNm) cap = Math.min(cap, lim.torqueLimitNm);
    if (lim?.powerLimitKw) cap = Math.min(cap, (lim.powerLimitKw * 1000) / w);
    if (tq > cap) {
      tq = cap;
      bmep = (tq * 4 * Math.PI) / (1e5 * vd);
      capped = true;
    }
    const powerKw = (tq * w) / 1000;
    const hp = powerKw / 0.7457;
    const fuelKgH = pt.fuelFlowKgH * p.veScale;
    return {
      ...pt,
      torqueNm: tq,
      torqueLbFt: tq * 0.737562,
      powerKw,
      hp,
      bmepBar: bmep,
      imepBar: imep,
      fmepBar: fmep,
      volumetricEfficiency: pt.volumetricEfficiency * p.veScale,
      airFlowKgS: pt.airFlowKgS * p.veScale,
      fuelFlowKgH: fuelKgH,
      bsfcGkWh: powerKw > 0 ? (fuelKgH * 1000) / powerKw : pt.bsfcGkWh,
      thermalEfficiency: pt.powerKw > 0 ? (pt.thermalEfficiency * (powerKw / pt.powerKw)) / p.veScale : pt.thermalEfficiency,
    };
  });
  void capped;
  let iT = 0;
  let iP = 0;
  curve.forEach((pt, i) => {
    if (pt.torqueNm > curve[iT].torqueNm) iT = i;
    if (pt.powerKw > curve[iP].powerKw) iP = i;
  });
  const pkT = curve[iT].torqueNm;
  const pkP = curve[iP].powerKw;
  const tBand = curve.filter((pt) => pkT - pt.torqueNm <= BAND_NM);
  const pBand = curve.filter((pt) => (pkP - pt.powerKw) * 1000 <= BAND_NM * ((pt.rpm * 2 * Math.PI) / 60));
  const tRange: [number, number] = tBand.length >= 2 ? [tBand[0].rpm, tBand[tBand.length - 1].rpm] : [curve[iT].rpm, curve[iT].rpm];
  const pRange: [number, number] = pBand.length >= 2 ? [pBand[0].rpm, pBand[pBand.length - 1].rpm] : [curve[iP].rpm, curve[iP].rpm];
  return {
    ...r,
    curve,
    unlimited: undefined,
    peakTorqueNm: pkT,
    peakTorqueLbFt: pkT * 0.737562,
    peakTorqueRpm: tRange[0],
    peakTorqueRpmRange: tRange,
    peakPowerKw: pkP,
    peakHp: pkP / 0.7457,
    peakPowerRpm: pRange[0],
    peakPowerRpmRange: pRange,
    specificOutputHpL: pkP / 0.7457 / (r.displacementL || 1),
    hpPerKg: r.massKg > 0 ? pkP / 0.7457 / r.massKg : r.hpPerKg,
  };
}

/** simulate() with the full parameter vector applied. */
export function simulateWith(frame: ModelFrame, v: ParamValues): SimResult {
  return applyPost(simulate(configFor(frame.base, v), frame.opts), postFor(frame, v));
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
