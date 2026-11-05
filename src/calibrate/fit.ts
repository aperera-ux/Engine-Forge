/**
 * Calibration fit: bounded Nelder-Mead on the RMS % torque error between the
 * calibrated model and a measured curve, over the overlapping rpm range.
 *
 *  - Search space: the active parameters (params.ts) mapped to the unit cube,
 *    so every vertex is always inside its documented physical range.
 *  - Start points: the nominal model, plus the best of a small quasi-random
 *    scan (guards against a local minimum in the timing parameters); each
 *    converged run is restarted once with a fresh simplex.
 *  - A very weak ridge toward the nominal values breaks ties for parameters
 *    the curve cannot determine (it is excluded from the reported RMS).
 *  - Afterwards the Jacobian at the optimum is used for diagnostics:
 *    per-parameter sensitivity, parameter-correlation conditioning and
 *    at-bound flags, which drive the warnings.
 *  - Never regularises away error: the reported RMS is the honest residual,
 *    and above 5 % the result says so.
 *
 * simulate() is reached only through ./model (public API).
 */
import type { EngineConfig, SimOptions } from '../sim/types';
import { makeFrame, simulateWith, torqueAt, type ModelFrame } from './model';
import { PARAM_DEFS, activeParams, type ParamId, type ParamValues } from './params';

export const RMS_OK_PCT = 3;
/** Above this the fit is reported as not explaining the data. */
export const RMS_POOR_PCT = 5;

export interface MeasuredTorque {
  rpm: number[];
  torqueNm: number[];
}

export interface FitInput {
  base: EngineConfig;
  simOpts: SimOptions;
  measured: MeasuredTorque;
  /** Override the parameter set (tests). Default: all that apply to the build. */
  paramIds?: ParamId[];
  maxEvals?: number;
}

export interface FitHooks {
  onProgress?: (p: { evals: number; frac: number; bestRmsPct: number }) => void;
  /** Return true to stop; checked between evaluations. */
  isCancelled?: () => boolean;
  /** Yield to the event loop every n evaluations so cancel messages can arrive. Default 20. */
  yieldEvery?: number;
}

export type FitWarningCode =
  | 'poor-fit'
  | 'at-bound'
  | 'ill-conditioned'
  | 'weak-parameter'
  | 'little-improvement'
  | 'partial-overlap'
  | 'few-points'
  | 'peak-shape';

export interface FitWarning {
  severity: 'info' | 'warn' | 'critical';
  code: FitWarningCode;
  message: string;
}

export interface ParamReport {
  id: ParamId;
  label: string;
  unit: string;
  nominal: number;
  min: number;
  max: number;
  value: number;
  atBound: 'low' | 'high' | null;
  /** RMS change in modelled torque (%) when this parameter sweeps its whole range, others held at the optimum. */
  sensitivityPct: number;
  /** Too insensitive for the data to determine it. */
  weak: boolean;
}

export interface PeakSummary {
  torqueNm: number;
  torqueRpm: number;
  powerKw: number;
  powerRpm: number;
}

export interface FitOk {
  ok: true;
  cancelled: boolean;
  rmsBeforePct: number;
  rmsAfterPct: number;
  /** Overall bias (mean signed % error) before and after. */
  biasBeforePct: number;
  biasAfterPct: number;
  verdict: 'good' | 'fair' | 'poor';
  values: ParamValues;
  params: ParamReport[];
  /** Fixed context the calibration must be re-applied with. */
  capRefNm: number;
  overlap: { loRpm: number; hiRpm: number; n: number; measuredN: number };
  conditioning: { cond: number; maxCorr: number; pair: [ParamId, ParamId] | null; illConditioned: boolean };
  warnings: FitWarning[];
  /** For plotting: measured grid with model torque before / after. */
  series: { rpm: number[]; measuredNm: number[]; beforeNm: number[]; afterNm: number[] };
  peaks: { measured: PeakSummary; before: PeakSummary; after: PeakSummary };
  evals: number;
  ms: number;
}

export interface FitErr {
  ok: false;
  error: { code: 'no-overlap' | 'too-few-points' | 'bad-input' | 'cancelled' | 'sim-failed'; message: string };
}

export type FitResult = FitOk | FitErr;

// ----------------------------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------------------------

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function peaksOf(rpm: number[], tq: number[]): PeakSummary {
  let iT = 0;
  let iP = 0;
  const pw = tq.map((t, i) => t * rpm[i]);
  tq.forEach((t, i) => {
    if (t > tq[iT]) iT = i;
    if (pw[i] > pw[iP]) iP = i;
  });
  return { torqueNm: tq[iT], torqueRpm: rpm[iT], powerKw: pw[iP] / 9549.297, powerRpm: rpm[iP] };
}

/** Eigenvalues of a small symmetric matrix (cyclic Jacobi). */
export function symEigenvalues(a: number[][]): number[] {
  const n = a.length;
  const m = a.map((r) => r.slice());
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-30) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const kp = m[k][p];
          const kq = m[k][q];
          m[k][p] = c * kp - s * kq;
          m[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < n; k++) {
          const pk = m[p][k];
          const qk = m[q][k];
          m[p][k] = c * pk - s * qk;
          m[q][k] = s * pk + c * qk;
        }
      }
    }
  }
  return m.map((r, i) => r[i]);
}

function halton(i: number, base: number): number {
  let f = 1;
  let r = 0;
  let k = i;
  while (k > 0) {
    f /= base;
    r += f * (k % base);
    k = Math.floor(k / base);
  }
  return r;
}
const PRIMES = [2, 3, 5, 7, 11, 13, 17];

// ----------------------------------------------------------------------------------------------
// fit
// ----------------------------------------------------------------------------------------------

export async function fitCalibration(input: FitInput, hooks: FitHooks = {}): Promise<FitResult> {
  const t0 = Date.now();
  const { measured } = input;
  if (!measured || measured.rpm.length !== measured.torqueNm.length || measured.rpm.length === 0) {
    return { ok: false, error: { code: 'bad-input', message: 'No measured curve.' } };
  }
  let frame: ModelFrame;
  let base;
  try {
    frame = makeFrame(input.base, input.simOpts);
    base = simulateWith(frame, {});
  } catch (e) {
    return { ok: false, error: { code: 'sim-failed', message: `The simulator failed on this build: ${e instanceof Error ? e.message : String(e)}` } };
  }
  const lo = base.curve[0].rpm;
  const hi = base.curve[base.curve.length - 1].rpm;
  const idx: number[] = [];
  measured.rpm.forEach((r, i) => {
    if (r >= lo && r <= hi && measured.torqueNm[i] > 0) idx.push(i);
  });
  if (idx.length < 5 || measured.rpm[idx[idx.length - 1]] - measured.rpm[idx[0]] < 800) {
    return {
      ok: false,
      error: {
        code: idx.length === 0 ? 'no-overlap' : 'too-few-points',
        message: `The measured curve (${Math.round(measured.rpm[0])} to ${Math.round(measured.rpm[measured.rpm.length - 1])} rpm) overlaps the model's rpm range (${Math.round(lo)} to ${Math.round(hi)} rpm) by only ${idx.length} point${idx.length === 1 ? '' : 's'}. At least 5 points across 800 rpm are needed.`,
      },
    };
  }
  const rpmG = idx.map((i) => measured.rpm[i]);
  const tqG = idx.map((i) => measured.torqueNm[i]);

  const ids = input.paramIds ?? activeParams(input.base);
  const n = ids.length;
  const toValues = (u: number[]): ParamValues => {
    const v: ParamValues = {};
    ids.forEach((id, k) => {
      const d = PARAM_DEFS[id];
      v[id] = d.min + Math.min(1, Math.max(0, u[k])) * (d.max - d.min);
    });
    return v;
  };
  const u0 = ids.map((id) => (PARAM_DEFS[id].nominal - PARAM_DEFS[id].min) / (PARAM_DEFS[id].max - PARAM_DEFS[id].min));

  let evals = 0;
  const maxEvals = input.maxEvals ?? 1200;
  const residualsFor = (u: number[]): number[] => {
    evals++;
    const r = simulateWith(frame, toValues(u));
    return rpmG.map((rpm, i) => {
      const m = torqueAt(r, rpm) ?? 0;
      return ((m - tqG[i]) / tqG[i]) * 100;
    });
  };
  const rmsOf = (res: number[]) => Math.sqrt(res.reduce((s, x) => s + x * x, 0) / res.length);
  const ridge = (u: number[]) => 0.02 * u.reduce((s, x, k) => s + ((x - u0[k]) / 0.5) ** 2, 0);
  const cost = (u: number[]) => rmsOf(residualsFor(u)) + ridge(u);

  const before = residualsFor(u0);
  const rmsBefore = rmsOf(before);
  const biasBefore = before.reduce((s, x) => s + x, 0) / before.length;
  const beforeNm = rpmG.map((_, i) => tqG[i] * (1 + before[i] / 100));

  let best = { u: u0.slice(), f: cost(u0) };
  let cancelled = false;
  const yieldEvery = hooks.yieldEvery ?? 20;
  let lastYield = 0;
  const maybeYield = async () => {
    if (hooks.onProgress) hooks.onProgress({ evals, frac: Math.min(0.99, evals / maxEvals), bestRmsPct: Math.max(0, best.f - ridge(best.u)) });
    if (evals - lastYield >= yieldEvery) {
      lastYield = evals;
      await tick();
    }
    if (hooks.isCancelled?.()) cancelled = true;
  };

  // Bounded Nelder-Mead in the unit cube.
  const nelderMead = async (start: number[], size: number) => {
    const clamp = (u: number[]) => u.map((x) => Math.min(1, Math.max(0, x)));
    const simplex: { u: number[]; f: number }[] = [];
    const s0 = clamp(start);
    simplex.push({ u: s0, f: cost(s0) });
    for (let k = 0; k < n; k++) {
      const u = s0.slice();
      u[k] = u[k] + size > 1 ? u[k] - size : u[k] + size;
      const c = clamp(u);
      simplex.push({ u: c, f: cost(c) });
    }
    let iter = 0;
    while (evals < maxEvals && !cancelled) {
      iter++;
      simplex.sort((a, b) => a.f - b.f);
      if (simplex[0].f < best.f) best = { u: simplex[0].u.slice(), f: simplex[0].f };
      await maybeYield();
      if (cancelled) break;
      const spread = simplex[n].f - simplex[0].f;
      let diam = 0;
      for (let k = 1; k <= n; k++) for (let j = 0; j < n; j++) diam = Math.max(diam, Math.abs(simplex[k].u[j] - simplex[0].u[j]));
      if ((spread < 1e-6 && diam < 2e-3) || diam < 2e-4 || iter > 600) break;
      const cen = new Array(n).fill(0);
      for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) cen[j] += simplex[k].u[j] / n;
      const worst = simplex[n];
      const along = (t: number) => clamp(cen.map((c, j) => c + t * (worst.u[j] - c)));
      const xr = along(-1);
      const fr = cost(xr);
      if (fr < simplex[0].f) {
        const xe = along(-2);
        const fe = cost(xe);
        simplex[n] = fe < fr ? { u: xe, f: fe } : { u: xr, f: fr };
      } else if (fr < simplex[n - 1].f) {
        simplex[n] = { u: xr, f: fr };
      } else {
        const xc = fr < worst.f ? along(-0.5) : along(0.5);
        const fc = cost(xc);
        if (fc < Math.min(fr, worst.f)) simplex[n] = { u: xc, f: fc };
        else {
          for (let k = 1; k <= n; k++) {
            const u = clamp(simplex[k].u.map((x, j) => simplex[0].u[j] + 0.5 * (x - simplex[0].u[j])));
            simplex[k] = { u, f: cost(u) };
          }
        }
      }
    }
    simplex.sort((a, b) => a.f - b.f);
    if (simplex[0].f < best.f) best = { u: simplex[0].u.slice(), f: simplex[0].f };
  };

  // Starts: nominal, and the best of a quasi-random scan.
  const scanN = Math.min(40, Math.max(12, n * 6));
  let scanBest = { u: u0, f: Infinity };
  for (let i = 1; i <= scanN && !cancelled; i++) {
    const u = ids.map((_, k) => halton(i, PRIMES[k % PRIMES.length]));
    const f = cost(u);
    if (f < scanBest.f) scanBest = { u, f };
    if (i % 8 === 0) await maybeYield();
  }
  const starts = [u0, scanBest.u];
  for (const s of starts) {
    if (cancelled || evals >= maxEvals) break;
    await nelderMead(s, 0.15);
    // One restart from the incumbent with a fresh, smaller simplex.
    for (let r = 0; r < 2 && !cancelled && evals < maxEvals; r++) {
      const f0 = best.f;
      await nelderMead(best.u, 0.05);
      if (f0 - best.f < 1e-4) break;
    }
  }

  // ---- final state ----
  const uStar = best.u;
  const after = residualsFor(uStar);
  const rmsAfter = rmsOf(after);
  const biasAfter = after.reduce((s, x) => s + x, 0) / after.length;
  const afterNm = rpmG.map((_, i) => tqG[i] * (1 + after[i] / 100));
  const values = toValues(uStar);

  // Jacobian (central differences in the unit cube) for sensitivity and conditioning.
  const cols: number[][] = [];
  const h = 0.04;
  for (let k = 0; k < n; k++) {
    const up = uStar.slice();
    const dn = uStar.slice();
    up[k] = Math.min(1, uStar[k] + h);
    dn[k] = Math.max(0, uStar[k] - h);
    const rp = residualsFor(up);
    const rm = residualsFor(dn);
    const du = up[k] - dn[k];
    cols.push(rp.map((x, i) => (x - rm[i]) / du));
  }
  const colRms = cols.map((c) => Math.sqrt(c.reduce((s, x) => s + x * x, 0) / c.length));
  const WEAK_PCT = 0.3;
  const params: ParamReport[] = ids.map((id, k) => {
    const d = PARAM_DEFS[id];
    const u = uStar[k];
    return {
      id,
      label: d.label,
      unit: d.unit,
      nominal: d.nominal,
      min: d.min,
      max: d.max,
      value: values[id] as number,
      atBound: id === 'torqueCap' && u >= 0.98 ? null : u <= 0.02 ? 'low' : u >= 0.98 ? 'high' : null,
      sensitivityPct: colRms[k],
      weak: colRms[k] < WEAK_PCT,
    };
  });
  // Conditioning of the parameters the data can see: cosine matrix of the Jacobian columns.
  const strong = ids.map((_, k) => k).filter((k) => !params[k].weak);
  let cond = 1;
  let maxCorr = 0;
  let pair: [ParamId, ParamId] | null = null;
  if (strong.length >= 2) {
    const C = strong.map((a) =>
      strong.map((b) => {
        let s = 0;
        for (let i = 0; i < rpmG.length; i++) s += cols[a][i] * cols[b][i];
        return s / ((colRms[a] * colRms[b] * rpmG.length) || 1);
      }),
    );
    const ev = symEigenvalues(C).sort((a, b) => a - b);
    cond = Math.sqrt(Math.max(ev[ev.length - 1], 1e-12) / Math.max(ev[0], 1e-12));
    for (let a = 0; a < strong.length; a++) {
      for (let b = a + 1; b < strong.length; b++) {
        if (Math.abs(C[a][b]) > maxCorr) {
          maxCorr = Math.abs(C[a][b]);
          pair = [ids[strong[a]], ids[strong[b]]];
        }
      }
    }
  }
  const illConditioned = cond > 30 || maxCorr > 0.97;

  // ---- warnings ----
  const warnings: FitWarning[] = [];
  const verdict: FitOk['verdict'] = rmsAfter <= RMS_OK_PCT ? 'good' : rmsAfter <= RMS_POOR_PCT ? 'fair' : 'poor';
  if (rmsAfter > RMS_POOR_PCT) {
    warnings.push({
      severity: 'critical',
      code: 'poor-fit',
      message: `Fitted RMS error is still ${rmsAfter.toFixed(1)} %, above ${RMS_POOR_PCT} %. The bounded physical parameters cannot reproduce this curve: the rest is model-structure error or a data mismatch (units, wheel vs crank, a different engine state). Do not read the fitted values as measurements of the engine.`,
    });
  }
  const bound = params.filter((p) => p.atBound);
  if (bound.length) {
    warnings.push({
      severity: 'warn',
      code: 'at-bound',
      message: `${bound.map((p) => `${p.label} at its ${p.atBound === 'low' ? 'lower' : 'upper'} limit (${p.atBound === 'low' ? p.min : p.max})`).join('; ')}. The fit wants to go beyond a physically plausible range, so it is absorbing error that is not really that parameter.`,
    });
  }
  if (illConditioned && pair) {
    warnings.push({
      severity: 'warn',
      code: 'ill-conditioned',
      message: `Ill-conditioned fit (parameter conditioning ${cond.toFixed(0)}, strongest coupling ${PARAM_DEFS[pair[0]].label} vs ${PARAM_DEFS[pair[1]].label}, |r| = ${maxCorr.toFixed(2)}): these parameters trade off against each other, so individual values are not uniquely determined even though the curve matches. Trust the curve, not the split.`,
    });
  }
  const weak = params.filter((p) => p.weak);
  if (weak.length) {
    warnings.push({
      severity: 'info',
      code: 'weak-parameter',
      message: `${weak.map((p) => p.label).join(', ')} barely affect${weak.length === 1 ? 'es' : ''} this build's curve (under ${WEAK_PCT} % across the whole range), so the data cannot determine ${weak.length === 1 ? 'it' : 'them'}.`,
    });
  }
  if (rmsBefore - rmsAfter < 0.3 && rmsAfter <= RMS_POOR_PCT) {
    warnings.push({ severity: 'info', code: 'little-improvement', message: 'The model already matched this curve closely; the fit changed little.' });
  }
  if (idx.length < measured.rpm.length) {
    warnings.push({
      severity: 'info',
      code: 'partial-overlap',
      message: `${measured.rpm.length - idx.length} measured point${measured.rpm.length - idx.length === 1 ? '' : 's'} lie outside the model's rpm range (${Math.round(lo)} to ${Math.round(hi)} rpm) and were ignored. Fitting covers ${Math.round(rpmG[0])} to ${Math.round(rpmG[rpmG.length - 1])} rpm only.`,
    });
  }
  if (idx.length < 12) {
    warnings.push({ severity: 'warn', code: 'few-points', message: `Only ${idx.length} points are being fitted: with ${n} free parameters the result is easily over-fitted.` });
  }
  const pm = peaksOf(rpmG, tqG);
  const pa = peaksOf(rpmG, afterNm);
  const iMeasPk = rpmG.indexOf(pm.torqueRpm);
  const flatTop = afterNm[iMeasPk] >= 0.98 * pa.torqueNm;
  if (Math.abs(pa.torqueRpm - pm.torqueRpm) > 0.1 * pm.torqueRpm && verdict !== 'poor' && !flatTop) {
    warnings.push({
      severity: 'warn',
      code: 'peak-shape',
      message: `Fitted peak torque is at ${Math.round(pa.torqueRpm)} rpm against ${Math.round(pm.torqueRpm)} rpm measured: the RMS is acceptable but the curve shape is still off.`,
    });
  }

  return {
    ok: true,
    cancelled,
    rmsBeforePct: rmsBefore,
    rmsAfterPct: rmsAfter,
    biasBeforePct: biasBefore,
    biasAfterPct: biasAfter,
    verdict,
    values,
    params,
    capRefNm: frame.capRefNm,
    overlap: { loRpm: rpmG[0], hiRpm: rpmG[rpmG.length - 1], n: idx.length, measuredN: measured.rpm.length },
    conditioning: { cond, maxCorr, pair, illConditioned },
    warnings,
    series: { rpm: rpmG, measuredNm: tqG, beforeNm, afterNm },
    peaks: { measured: pm, before: peaksOf(rpmG, beforeNm), after: pa },
    evals,
    ms: Date.now() - t0,
  };
}
