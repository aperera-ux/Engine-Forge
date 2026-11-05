/**
 * A stored calibration: what was fitted, to what, and how well. Lives in the UI
 * store and in Garage saves (optional field, so old saves load unchanged).
 */
import { simulate } from '../sim/engine';
import { hardwareDiff } from '../sim/customBuild';
import type { EngineConfig, SimResult } from '../sim/types';
import { applyPost, configFor, postFor } from './model';
import { ALL_PARAM_IDS, PARAM_DEFS, type ParamId, type ParamValues } from './params';
import type { FitOk } from './fit';
import type { Basis, CorrectionStandard } from './parse';

export interface Calibration {
  version: 1;
  createdAt: number;
  /** File name or "pasted data". */
  sourceName: string;
  basis: Basis;
  drivetrainLossPct: number;
  standard: CorrectionStandard;
  /** The build as it was before calibration (Revert restores this). */
  baseConfig: EngineConfig;
  /** The build with the hardware-side parameters applied (what the editor shows). */
  fittedConfig: EngineConfig;
  values: ParamValues;
  capRefNm: number;
  /** simulate() option fixed at fit time (the OEM-limit policy of the unmodified build). */
  applyOemLimits: boolean;
  rmsBeforePct: number;
  rmsAfterPct: number;
  verdict: 'good' | 'fair' | 'poor';
  /** Parameter ids that ended at a bound. */
  atBound: ParamId[];
  /** The measured curve the fit used (crank basis, resampled). */
  measured: { rpm: number[]; torqueNm: number[] };
}

export function buildCalibration(args: {
  fit: FitOk;
  base: EngineConfig;
  applyOemLimits: boolean;
  sourceName: string;
  basis: Basis;
  drivetrainLossPct: number;
  standard: CorrectionStandard;
  measured: { rpm: number[]; torqueNm: number[] };
}): Calibration {
  const { fit } = args;
  return {
    version: 1,
    createdAt: Date.now(),
    sourceName: args.sourceName,
    basis: args.basis,
    drivetrainLossPct: args.drivetrainLossPct,
    standard: args.standard,
    baseConfig: structuredClone(args.base),
    fittedConfig: configFor(args.base, fit.values),
    values: { ...fit.values },
    capRefNm: fit.capRefNm,
    applyOemLimits: args.applyOemLimits,
    rmsBeforePct: fit.rmsBeforePct,
    rmsAfterPct: fit.rmsAfterPct,
    verdict: fit.verdict,
    atBound: fit.params.filter((p) => p.atBound).map((p) => p.id),
    measured: { rpm: [...args.measured.rpm], torqueNm: [...args.measured.torqueNm] },
  };
}

/** simulate() with a stored calibration's corrections applied. `config` may be edited since the fit. */
export function simulateCalibrated(config: EngineConfig, cal: Calibration): SimResult {
  return applyPost(simulate(config, { applyOemLimits: cal.applyOemLimits }), postFor(cal, cal.values));
}

/** True when the build has been edited since the calibration was applied. */
export function isCalibrationStale(config: EngineConfig, cal: Calibration): boolean {
  return hardwareDiff(config, cal.fittedConfig).length > 0;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numArr = (a: unknown): number[] | null => (Array.isArray(a) && a.every(finite) ? (a as number[]) : null);

/** Validate a calibration from storage. Returns null for anything malformed (the save then loads without it). */
export function parseCalibration(raw: unknown, mergeConfig: (r: unknown) => EngineConfig): Calibration | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !r.baseConfig || !r.fittedConfig || !r.values || typeof r.values !== 'object') return null;
  const mr = r.measured as { rpm?: unknown; torqueNm?: unknown } | undefined;
  const rpm = numArr(mr?.rpm);
  const tq = numArr(mr?.torqueNm);
  if (!rpm || !tq || rpm.length !== tq.length || rpm.length < 2) return null;
  const values: ParamValues = {};
  for (const id of ALL_PARAM_IDS) {
    const v = (r.values as Record<string, unknown>)[id];
    if (finite(v)) values[id] = Math.min(PARAM_DEFS[id].max, Math.max(PARAM_DEFS[id].min, v));
  }
  const verdict = r.verdict === 'good' || r.verdict === 'fair' || r.verdict === 'poor' ? r.verdict : 'poor';
  return {
    version: 1,
    createdAt: finite(r.createdAt) ? r.createdAt : Date.now(),
    sourceName: typeof r.sourceName === 'string' ? r.sourceName : 'measured curve',
    basis: r.basis === 'wheel' ? 'wheel' : 'crank',
    drivetrainLossPct: finite(r.drivetrainLossPct) ? r.drivetrainLossPct : 15,
    standard: r.standard === 'din-70020' || r.standard === 'unknown' ? r.standard : 'sae-j1349',
    baseConfig: mergeConfig(r.baseConfig),
    fittedConfig: mergeConfig(r.fittedConfig),
    values,
    capRefNm: finite(r.capRefNm) ? r.capRefNm : 0,
    applyOemLimits: r.applyOemLimits !== false,
    rmsBeforePct: finite(r.rmsBeforePct) ? r.rmsBeforePct : NaN,
    rmsAfterPct: finite(r.rmsAfterPct) ? r.rmsAfterPct : NaN,
    verdict,
    atBound: Array.isArray(r.atBound) ? (r.atBound.filter((x) => ALL_PARAM_IDS.includes(x as ParamId)) as ParamId[]) : [],
    measured: { rpm, torqueNm: tq },
  };
}
