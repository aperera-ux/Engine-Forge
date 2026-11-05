/**
 * Share-link codec for the URL hash: `#cfg=<engine>&cal=<calibration>`.
 *
 * `cfg` is the engine exactly as before (links without `cal` keep working).
 * `cal` carries the applied calibration: the fitted parameter values, the fit summary (RMS, verdict,
 * measured-curve name) and the build the fit started from (a preset name, or the full config when it is
 * not a stock preset). The measured curve is NOT embedded raw: it is downsampled to at most
 * MAX_LINK_POINTS points and rounded, and dropped altogether if the whole `cal` payload would be big.
 * A link without the curve opens calibrated, without the overlay, and says so.
 */
import { hardwareDiff } from '../sim/customBuild';
import { PRESETS } from '../sim/presets';
import type { EngineConfig } from '../sim/types';
import { ALL_PARAM_IDS, PARAM_DEFS, configFor, parseCalibration, type Calibration, type ParamId, type ParamValues } from '../calibrate';

export const MAX_LINK_POINTS = 40;
/** If the encoded `cal` payload would exceed this many characters the measured curve is left out. */
export const MAX_CAL_CHARS = 1800;

export function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlDecode(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

/** Evenly spaced subset of n indices out of len, always including both ends. */
function pickIndices(len: number, n: number): number[] {
  if (len <= n) return Array.from({ length: len }, (_, i) => i);
  return Array.from({ length: n }, (_, i) => Math.round((i * (len - 1)) / (n - 1)));
}

/** Downsample a measured curve to at most `max` points (rpm to 1, torque to 0.1 N.m). */
export function downsampleCurve(m: { rpm: number[]; torqueNm: number[] }, max = MAX_LINK_POINTS): { rpm: number[]; torqueNm: number[] } {
  const idx = pickIndices(m.rpm.length, max);
  return { rpm: idx.map((i) => Math.round(m.rpm[i])), torqueNm: idx.map((i) => Math.round(m.torqueNm[i] * 10) / 10) };
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

interface CalPayload {
  v: 1;
  val: Record<string, number>;
  n: string;
  rb: number;
  ra: number;
  vd: 'good' | 'fair' | 'poor';
  ab?: string[];
  oem: 0 | 1;
  cap: number;
  bs: 'crank' | 'wheel';
  dl: number;
  sd: string;
  /** Stock preset name the fit started from, when baseConfig is that preset unchanged. */
  b?: string;
  /** Full base config otherwise. */
  bc?: EngineConfig;
  /** Downsampled measured curve and the original point count. */
  m?: { r: number[]; t: number[]; n: number };
}

function presetMatching(base: EngineConfig): string | undefined {
  const p = PRESETS.find((x) => x.name === base.name);
  return p && hardwareDiff(base, p).length === 0 ? p.name : undefined;
}

/** Encode the `cal` part of the hash. */
export function encodeCalibration(cal: Calibration): string {
  const val: Record<string, number> = {};
  for (const id of ALL_PARAM_IDS) {
    const v = cal.values[id];
    if (typeof v === 'number' && Number.isFinite(v)) val[id] = r4(v);
  }
  const preset = presetMatching(cal.baseConfig);
  const payload: CalPayload = {
    v: 1,
    val,
    n: cal.sourceName.slice(0, 60),
    rb: Math.round(cal.rmsBeforePct * 100) / 100,
    ra: Math.round(cal.rmsAfterPct * 100) / 100,
    vd: cal.verdict,
    ...(cal.atBound.length ? { ab: cal.atBound } : {}),
    oem: cal.applyOemLimits ? 1 : 0,
    cap: Math.round(cal.capRefNm * 10) / 10,
    bs: cal.basis,
    dl: cal.drivetrainLossPct,
    sd: cal.standard,
    ...(preset ? { b: preset } : { bc: cal.baseConfig }),
  };
  if (cal.measured.rpm.length >= 2) {
    const d = downsampleCurve(cal.measured);
    const full = b64urlEncode(JSON.stringify({ ...payload, m: { r: d.rpm, t: d.torqueNm, n: cal.measured.rpm.length } }));
    if (full.length <= MAX_CAL_CHARS) return full;
  }
  return b64urlEncode(JSON.stringify(payload));
}

export interface DecodedCalibration {
  calibration: Calibration;
  /** Plain-language note for the UI when the link did not carry the whole measured curve; null when it is complete. */
  note: string | null;
}

/**
 * Rebuild a Calibration from a `cal` payload.
 * Returns null for anything malformed: the engine then opens uncalibrated.
 */
export function decodeCalibration(text: string, merge: (raw: unknown) => EngineConfig): DecodedCalibration | null {
  try {
    const p = JSON.parse(b64urlDecode(text)) as Partial<CalPayload>;
    if (!p || p.v !== 1 || !p.val || typeof p.val !== 'object') return null;
    const base = p.bc ? merge(p.bc) : p.b ? (PRESETS.find((x) => x.name === p.b) ?? null) : null;
    if (!base) return null;
    const values: ParamValues = {};
    for (const id of ALL_PARAM_IDS) {
      const v = (p.val as Record<string, unknown>)[id];
      if (typeof v === 'number' && Number.isFinite(v)) values[id as ParamId] = Math.min(PARAM_DEFS[id].max, Math.max(PARAM_DEFS[id].min, v));
    }
    const m =
      p.m && Array.isArray(p.m.r) && Array.isArray(p.m.t) && p.m.r.length === p.m.t.length && p.m.r.length >= 2 && p.m.r.length <= 4 * MAX_LINK_POINTS && p.m.r.every(Number.isFinite) && p.m.t.every(Number.isFinite)
        ? p.m
        : null;
    const baseConfig = merge(structuredClone(base));
    const raw = {
      version: 1,
      createdAt: Date.now(),
      sourceName: typeof p.n === 'string' ? p.n : 'measured curve',
      basis: p.bs,
      drivetrainLossPct: p.dl,
      standard: p.sd,
      baseConfig,
      fittedConfig: configFor(baseConfig, values),
      values,
      capRefNm: p.cap,
      applyOemLimits: p.oem !== 0,
      rmsBeforePct: p.rb,
      rmsAfterPct: p.ra,
      verdict: p.vd,
      atBound: p.ab ?? [],
      // parseCalibration wants a curve; a link without one gets a stand-in that is cleared below.
      measured: m ? { rpm: m.r, torqueNm: m.t } : { rpm: [0, 1], torqueNm: [0, 0] },
    };
    const cal = parseCalibration(raw, merge);
    if (!cal) return null;
    if (!m) cal.measured = { rpm: [], torqueNm: [] };
    const note = !m
      ? 'Opened from a share link: the fitted calibration is applied, but the link did not include the measured curve, so there is no overlay.'
      : typeof p.m?.n === 'number' && p.m.n > m.r.length
        ? `Opened from a share link: the measured overlay is downsampled to ${m.r.length} of ${p.m.n} points (the fitted values are exact).`
        : null;
    return { calibration: cal, note };
  } catch {
    return null;
  }
}

/**
 * parseCalibration for storage (garage, localStorage) that also accepts a calibration whose measured
 * curve is empty (opened from a link that did not carry it).
 */
export function parseStoredCalibration(raw: unknown, merge: (r: unknown) => EngineConfig): Calibration | null {
  const direct = parseCalibration(raw, merge);
  if (direct) return direct;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { measured?: { rpm?: unknown } };
  if (!Array.isArray(r.measured?.rpm) || r.measured.rpm.length > 0) return null;
  const cal = parseCalibration({ ...raw, measured: { rpm: [0, 1], torqueNm: [0, 0] } }, merge);
  if (cal) cal.measured = { rpm: [], torqueNm: [] };
  return cal;
}

// ---- hash ---------------------------------------------------------------------
export function configToHash(cfg: EngineConfig, cal?: Calibration | null): string {
  return `#cfg=${b64urlEncode(JSON.stringify(cfg))}${cal ? `&cal=${encodeCalibration(cal)}` : ''}`;
}

export function parseHash(hash: string, merge: (raw: unknown) => EngineConfig): { config: EngineConfig; cal: DecodedCalibration | null } | null {
  const m = /[#&]cfg=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  let config: EngineConfig;
  try {
    config = merge(JSON.parse(b64urlDecode(m[1])));
  } catch {
    return null;
  }
  const c = /[#&]cal=([A-Za-z0-9_-]+)/.exec(hash);
  return { config, cal: c ? decodeCalibration(c[1], merge) : null };
}

/** One-line description of an applied calibration, shared by the build sheet and the UI. */
export function calibrationNote(cal: Calibration, stale: boolean): string {
  const rms = `RMS torque error ${cal.rmsBeforePct.toFixed(1)} % to ${cal.rmsAfterPct.toFixed(1)} %`;
  return `fitted to ${cal.sourceName}, ${rms}${cal.verdict === 'poor' ? ' (poor fit, above 5 %)' : ''}${stale ? ', build edited since the fit' : ''}`;
}
