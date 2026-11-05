/**
 * Dyno-file import: CSV / TSV / pasted text -> a clean crank-basis torque and
 * power curve on a uniform rpm grid.
 *
 * Pipeline: tokenise (delimiter + decimal-comma detection) -> header / column
 * roles and units (from header text, else from torque-vs-power consistency)
 * -> unit conversion -> wheel-to-crank (drivetrain loss) -> correction-
 * standard normalisation -> despike -> local-linear Gaussian smoothing and
 * resampling.  Nothing here touches the simulator.
 */

export type TorqueUnit = 'Nm' | 'lbft';
export type PowerUnit = 'kW' | 'hp' | 'PS';
export type Basis = 'crank' | 'wheel';
/** Correction standard the measured figures are quoted to. The simulator is calibrated to SAE J1349 figures. */
export type CorrectionStandard = 'sae-j1349' | 'din-70020' | 'unknown';
export type Smoothing = 'auto' | 'none' | 'light' | 'medium' | 'heavy';

export const LBFT_TO_NM = 1.35582;
export const HP_TO_KW = 0.7457;
export const PS_TO_KW = 0.73549875;
/** kW = Nm * rpm / 9549.3 */
export const NM_RPM_TO_KW = 1 / 9549.297;

/**
 * DIN 70020 (20 C, 1013 mbar, no humidity term) -> SAE J1349 (25 C, 99 kPa dry air):
 * reference-condition arithmetic (99 / 101.3) * sqrt(293.15 / 298.15) = 0.969.
 * This is the size of the standards gap from the reference conditions alone; real
 * dynos differ by the correction implementation too, so it is applied as a stated
 * approximation and the user can choose "unknown" to apply nothing.
 */
export const DIN_TO_SAE = (99 / 101.3) * Math.sqrt(293.15 / 298.15);

export const STANDARD_NOTES: Record<CorrectionStandard, string> = {
  'sae-j1349': 'SAE J1349 (25 C, 99 kPa dry air): the basis the model is validated against. No adjustment.',
  'din-70020': `DIN 70020 (20 C, 1013 mbar) reads about ${((1 / DIN_TO_SAE - 1) * 100).toFixed(1)}% higher than SAE J1349 for the same engine; the data is scaled by ${DIN_TO_SAE.toFixed(3)} to SAE J1349 (approximate: it covers the reference conditions only, not each dyno's correction implementation).`,
  unknown: 'Correction standard unknown: no adjustment applied. Standards differ by about 1 to 3 %, which the fit can absorb into the volumetric-efficiency scale.',
};

export interface ImportOptions {
  /** Force the column roles (0-based). null = no such column. */
  rpmCol?: number;
  torqueCol?: number | null;
  powerCol?: number | null;
  torqueUnit?: TorqueUnit;
  powerUnit?: PowerUnit;
  /** Force header / no header. */
  hasHeader?: boolean;
  basis?: Basis;
  /** Drivetrain loss, % of crank power, used when basis is 'wheel'. */
  drivetrainLossPct?: number;
  standard?: CorrectionStandard;
  smoothing?: Smoothing;
  /** Output rpm grid step. Default 100. */
  stepRpm?: number;
}

export interface ResolvedOptions {
  rpmCol: number;
  torqueCol: number | null;
  powerCol: number | null;
  torqueUnit: TorqueUnit;
  powerUnit: PowerUnit;
  hasHeader: boolean;
  basis: Basis;
  drivetrainLossPct: number;
  standard: CorrectionStandard;
  smoothing: Smoothing;
  stepRpm: number;
}

export interface RawPoint {
  rpm: number;
  torqueNm: number;
  powerKw: number;
}

export interface MeasuredCurve {
  /** Uniform grid, crank basis, SAE J1349 basis, smoothed. */
  rpm: number[];
  torqueNm: number[];
  powerKw: number[];
  /** Same normalisation but not smoothed or resampled (sorted, de-duplicated). */
  raw: RawPoint[];
  /** Gaussian sigma used, rpm (0 = none). */
  smoothingSigmaRpm: number;
  /** Estimated point-to-point noise, % of median torque. */
  noisePct: number;
}

export interface TableInfo {
  delimiter: string;
  decimalComma: boolean;
  hasHeader: boolean;
  headers: string[];
  nCols: number;
  nRows: number;
  /** First rows as numbers, for the preview. */
  preview: (number | null)[][];
}

export type ImportErrorCode =
  | 'empty'
  | 'binary'
  | 'too-large'
  | 'no-table'
  | 'no-numeric'
  | 'no-rpm'
  | 'no-values'
  | 'too-few-points'
  | 'rpm-range'
  | 'implausible'
  | 'bad-options';

export interface DynoImportErr {
  ok: false;
  error: { code: ImportErrorCode; message: string };
}

export interface DynoImportOk {
  ok: true;
  table: TableInfo;
  options: ResolvedOptions;
  curve: MeasuredCurve;
  /** Things the user should look at (units assumed, points dropped, ...). */
  warnings: string[];
  /** Informational: what was detected and applied. */
  notes: string[];
}

export type DynoImport = DynoImportOk | DynoImportErr;

const MAX_CHARS = 2_000_000;

const fail = (code: ImportErrorCode, message: string): DynoImportErr => ({ ok: false, error: { code, message } });

// ---------------------------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------------------------

const strip = (s: string) => s.trim().replace(/^["']+|["']+$/g, '').trim();

function splitHeaderWhitespace(line: string): string[] {
  // "RPM Torque (lb-ft) Power (hp)" -> ["RPM", "Torque (lb-ft)", "Power (hp)"]
  const m = line.match(/[^\s(]+(?:\s*\([^)]*\))?/g);
  return m ? m.map(strip) : [];
}

function splitLine(line: string, delim: string): string[] {
  if (delim === ' ') return line.trim().split(/\s+/).map(strip);
  return line.split(delim).map(strip);
}

/** Parse one cell. Returns null when it is not a number. */
function cellNumber(raw: string, decimalComma: boolean, thousandsComma: boolean): number | null {
  let s = raw.trim();
  if (!s) return null;
  if (thousandsComma) s = s.replace(/,/g, '');
  else if (decimalComma) s = s.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

interface Tokenised {
  delimiter: string;
  decimalComma: boolean;
  /** Per column: commas are thousands separators. */
  thousandsCols: boolean[];
  lines: string[][];
  headerLine: string | null;
  headers: string[];
  hasHeader: boolean;
  nCols: number;
  rows: (number | null)[][];
}

function modeCount(counts: number[]): { mode: number; frac: number } {
  const m = new Map<number, number>();
  counts.forEach((c) => m.set(c, (m.get(c) ?? 0) + 1));
  let best = 0;
  let bc = 0;
  m.forEach((n, c) => {
    if (n > bc || (n === bc && c > best)) {
      bc = n;
      best = c;
    }
  });
  return { mode: best, frac: counts.length ? bc / counts.length : 0 };
}

function tokenise(text: string, forceHeader: boolean | undefined): Tokenised | DynoImportErr {
  const raw = text
    .replace(/^﻿/, '')
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(#|\/\/)/.test(l) && !/^sep=/i.test(l));
  if (!raw.length) return fail('empty', 'The file is empty (no data lines found).');

  const sample = raw.slice(0, 60);
  const cands = ['\t', ';', '|', ',', ' '];
  let chosen: { d: string; mode: number } | null = null;
  for (const d of cands) {
    const counts = sample.map((l) => splitLine(l, d).filter((c, i, a) => c !== '' || i < a.length - 1).length);
    const { mode, frac } = modeCount(counts.slice(1).length >= 3 ? counts.slice(1) : counts);
    if (mode < 2 || frac < 0.6) continue;
    // Body fields must actually be numbers (allowing decimal commas unless the delimiter is a comma).
    const body = sample.slice(1).length >= 3 ? sample.slice(1) : sample;
    let num = 0;
    let tot = 0;
    for (const l of body) {
      for (const c of splitLine(l, d)) {
        tot++;
        if (cellNumber(c, d !== ',', false) !== null) num++;
      }
    }
    if (tot && num / tot >= 0.6) {
      chosen = { d, mode };
      break;
    }
  }
  if (!chosen) {
    return fail(
      'no-table',
      'Could not find a table: expected at least two columns (rpm plus torque and/or power) separated by commas, semicolons, tabs or spaces.',
    );
  }
  const d = chosen.d;
  const lines = raw.map((l) => splitLine(l, d));
  const nCols = chosen.mode;

  // Decimal comma: any non-comma-delimited cell like "12,5".
  const commaCells = lines.flat().filter((c) => /^\d*,\d+$/.test(c));
  const decimalComma = d !== ',' && commaCells.length > 0 && !lines.flat().some((c) => /^\d+\.\d+$/.test(c));
  const thousandsCols: boolean[] = Array.from({ length: nCols }, () => false);
  if (d !== ',') {
    for (let c = 0; c < nCols; c++) {
      const withComma = lines.map((l) => l[c] ?? '').filter((x) => x.includes(','));
      if (withComma.length && withComma.every((x) => /^\d{1,3}(,\d{3})+$/.test(x)) && lines.flat().some((x) => /^\d+\.\d+$/.test(x))) thousandsCols[c] = true;
    }
  }

  const parseRow = (l: string[]) => Array.from({ length: nCols }, (_, c) => (l[c] === undefined ? null : cellNumber(l[c], decimalComma, thousandsCols[c])));
  const firstNumeric = (l: string[]) => parseRow(l).filter((v) => v !== null).length / Math.max(1, l.length);
  let hasHeader = firstNumeric(lines[0]) < 0.5;
  if (forceHeader !== undefined) hasHeader = forceHeader;
  const headerLine = hasHeader ? raw[0] : null;
  let headers = hasHeader ? (d === ' ' ? splitHeaderWhitespace(headerLine as string) : lines[0]) : [];
  const body = hasHeader ? lines.slice(1) : lines;
  // Rows that are not numeric at all (units row, notes, footers) are dropped.
  const rows = body.map(parseRow).filter((r) => r.filter((v) => v !== null).length >= 2);
  return { delimiter: d, decimalComma, thousandsCols, lines, headerLine, headers, hasHeader, nCols, rows };
}

// ---------------------------------------------------------------------------------------------
// Header / unit recognition
// ---------------------------------------------------------------------------------------------

const RPM_RE = /rpm|r\/min|rev|engine\s*speed|^speed$|^n$/i;
const TORQUE_RE = /torq|\btq\b|\bnm\b|n[·.\-\s]?m\b|lb[\s\-·.]?ft|ft[\s\-·.]?lb|lbf|\bwtq\b/i;
const POWER_RE = /pow|\bhp\b|bhp|whp|\bkw\b|\bps\b|\bcv\b|\bpk\b|wkw/i;

function torqueUnitFromText(h: string): TorqueUnit | null {
  if (/lb[\s\-·.]?ft|ft[\s\-·.]?lb|lbf|lbft/i.test(h)) return 'lbft';
  if (/\bnm\b|n[·.\-\s]?m\b|newton|\(nm\)/i.test(h)) return 'Nm';
  return null;
}
function powerUnitFromText(h: string): PowerUnit | null {
  if (/\bkw\b|wkw|kilowatt/i.test(h)) return 'kW';
  if (/\bps\b|\bcv\b|\bpk\b|pferd|metric\s*h/i.test(h)) return 'PS';
  if (/\bhp\b|bhp|whp|horse/i.test(h)) return 'hp';
  return null;
}
const WHEEL_RE = /whp|wtq|wheel|\bw(hp|kw)\b|rwhp|awhp/i;
const CRANK_RE = /bhp|crank|flywheel|brake|\bengine\s*(torque|power)/i;

const torqueFactor = (u: TorqueUnit) => (u === 'Nm' ? 1 : LBFT_TO_NM);
const powerFactor = (u: PowerUnit) => (u === 'kW' ? 1 : u === 'hp' ? HP_TO_KW : PS_TO_KW);

/** Prior order for tie-breaking ambiguous unit pairs (Nm+hp and lb-ft+kW differ by only ~1 %). */
const PAIR_PRIOR: [TorqueUnit, PowerUnit][] = [
  ['Nm', 'kW'],
  ['lbft', 'hp'],
  ['Nm', 'hp'],
  ['Nm', 'PS'],
  ['lbft', 'kW'],
  ['lbft', 'PS'],
];

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function colStats(rows: (number | null)[][], c: number) {
  const v = rows.map((r) => r[c]).filter((x): x is number => x !== null);
  return { n: v.length, med: median(v), min: Math.min(...v), max: Math.max(...v), v };
}

function monotoneFrac(vals: number[]): number {
  if (vals.length < 3) return 0;
  let up = 0;
  let dn = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] > vals[i - 1]) up++;
    else if (vals[i] < vals[i - 1]) dn++;
  }
  return Math.max(up, dn) / (vals.length - 1);
}

interface Roles {
  rpmCol: number;
  torqueCol: number | null;
  powerCol: number | null;
  torqueUnit: TorqueUnit | null;
  powerUnit: PowerUnit | null;
  wheelHint: boolean;
  crankHint: boolean;
  ignored: string[];
}

function detectRoles(t: Tokenised): Roles | DynoImportErr {
  const { rows, headers, hasHeader, nCols } = t;
  let rpmCol = -1;
  let torqueCol: number | null = null;
  let powerCol: number | null = null;
  let torqueUnit: TorqueUnit | null = null;
  let powerUnit: PowerUnit | null = null;
  let wheelHint = false;
  let crankHint = false;

  if (hasHeader && headers.length) {
    headers.forEach((h, c) => {
      if (c >= nCols) return;
      const isT = TORQUE_RE.test(h);
      const isP = POWER_RE.test(h);
      if (rpmCol < 0 && RPM_RE.test(h) && !isT && !isP) rpmCol = c;
      else if (torqueCol === null && isT && !(isP && !/torq|\btq\b/i.test(h))) {
        torqueCol = c;
        torqueUnit = torqueUnitFromText(h);
        if (WHEEL_RE.test(h)) wheelHint = true;
        if (CRANK_RE.test(h)) crankHint = true;
      } else if (powerCol === null && isP) {
        powerCol = c;
        powerUnit = powerUnitFromText(h);
        if (WHEEL_RE.test(h)) wheelHint = true;
        if (CRANK_RE.test(h)) crankHint = true;
      }
    });
  }

  // Data-driven rpm column when the header did not name one.
  if (rpmCol < 0) {
    for (let c = 0; c < nCols; c++) {
      if (c === torqueCol || c === powerCol) continue;
      const s = colStats(rows, c);
      if (s.n >= 3 && s.min >= 200 && s.max <= 20000 && s.med >= 800 && monotoneFrac(s.v) >= 0.8) {
        rpmCol = c;
        break;
      }
    }
  }
  if (rpmCol < 0) {
    return fail(
      'no-rpm',
      'Could not find an rpm column. Expected a column named "rpm" or values between about 800 and 20000 that increase down the file. Choose the rpm column manually.',
    );
  }

  // Remaining numeric columns become torque / power by data if the header did not say.
  const others: number[] = [];
  for (let c = 0; c < nCols; c++) {
    if (c === rpmCol) continue;
    if (colStats(rows, c).n >= Math.max(3, rows.length * 0.5)) others.push(c);
  }
  const ignored: string[] = [];
  if (torqueCol === null && powerCol === null) {
    const used = others.slice(0, 2);
    others.slice(2).forEach((c) => ignored.push(headers[c] || `column ${c + 1}`));
    if (used.length === 2) {
      // Decide which is which by torque * rpm consistency, in both orders.
      const rpm = rows.map((r) => r[rpmCol]);
      let best: { tc: number; pc: number; tu: TorqueUnit; pu: PowerUnit; err: number } | null = null;
      for (const [tc, pc] of [[used[0], used[1]], [used[1], used[0]]] as [number, number][]) {
        for (const [tu, pu] of PAIR_PRIOR) {
          const err = pairError(rpm, rows.map((r) => r[tc]), rows.map((r) => r[pc]), tu, pu);
          const prior = PAIR_PRIOR.findIndex((p) => p[0] === tu && p[1] === pu);
          const score = err + prior * 0.004;
          if (best === null || score < best.err) best = { tc, pc, tu, pu, err: score };
        }
      }
      if (best) {
        torqueCol = best.tc;
        powerCol = best.pc;
        torqueUnit = best.tu;
        powerUnit = best.pu;
      }
    } else if (used.length === 1) {
      torqueCol = used[0]; // a single value column is assumed to be torque (unit assumed later)
    }
  } else {
    others
      .filter((c) => c !== torqueCol && c !== powerCol)
      .forEach((c) => ignored.push(headers[c] || `column ${c + 1}`));
  }
  if (torqueCol === null && powerCol === null) {
    return fail('no-values', 'Found an rpm column but no torque or power column. Add a torque (Nm or lb-ft) and/or power (kW, hp or PS) column.');
  }
  return { rpmCol, torqueCol, powerCol, torqueUnit, powerUnit, wheelHint, crankHint, ignored };
}

/** Median relative error between measured power and power implied by torque x rpm, for a unit pair. */
function pairError(rpm: (number | null)[], tq: (number | null)[], pw: (number | null)[], tu: TorqueUnit, pu: PowerUnit): number {
  const errs: number[] = [];
  for (let i = 0; i < rpm.length; i++) {
    const r = rpm[i];
    const t = tq[i];
    const p = pw[i];
    if (r === null || t === null || p === null || p <= 0 || t <= 0) continue;
    const pred = t * torqueFactor(tu) * r * NM_RPM_TO_KW;
    errs.push(Math.abs(pred / (p * powerFactor(pu)) - 1));
  }
  return errs.length ? median(errs) : Infinity;
}

// ---------------------------------------------------------------------------------------------
// Smoothing / resampling
// ---------------------------------------------------------------------------------------------

const SIGMA: Record<Exclude<Smoothing, 'auto'>, number> = { none: 0, light: 75, medium: 150, heavy: 250 };

/** Noise estimate: robust std of the second difference, relative to median torque, in %. */
export function estimateNoisePct(rpm: number[], torque: number[]): number {
  if (torque.length < 5) return 0;
  const d: number[] = [];
  for (let i = 1; i < torque.length - 1; i++) {
    const w = (rpm[i + 1] - rpm[i]) / (rpm[i + 1] - rpm[i - 1] || 1);
    d.push(Math.abs(torque[i] - (torque[i - 1] * w + torque[i + 1] * (1 - w))));
  }
  const sigma = (1.4826 * median(d)) / Math.sqrt(1.5);
  return (sigma / (median(torque) || 1)) * 100;
}

function interpLinear(x: number[], y: number[], v: number): number {
  if (v <= x[0]) return y[0];
  if (v >= x[x.length - 1]) return y[y.length - 1];
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (x[m] <= v) lo = m;
    else hi = m;
  }
  return y[lo] + ((y[hi] - y[lo]) * (v - x[lo])) / (x[hi] - x[lo] || 1);
}

/** Local-linear Gaussian kernel regression evaluated at xs. sigma = 0 gives linear interpolation. */
export function smoothResample(x: number[], y: number[], xs: number[], sigma: number): number[] {
  if (sigma <= 0) return xs.map((v) => interpLinear(x, y, v));
  return xs.map((x0) => {
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let t0 = 0;
    let t1 = 0;
    for (let i = 0; i < x.length; i++) {
      const dx = x[i] - x0;
      if (Math.abs(dx) > 4 * sigma) continue;
      const w = Math.exp(-0.5 * (dx / sigma) ** 2);
      s0 += w;
      s1 += w * dx;
      s2 += w * dx * dx;
      t0 += w * y[i];
      t1 += w * dx * y[i];
    }
    const det = s0 * s2 - s1 * s1;
    if (s0 < 1.5 || Math.abs(det) < 1e-9 * s0 * s0 * sigma * sigma) return interpLinear(x, y, x0);
    return (s2 * t0 - s1 * t1) / det;
  });
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Parse + convert + normalise + smooth. Pure; never throws for bad user data (returns { ok: false }). */
export function importDyno(text: string, opts: ImportOptions = {}): DynoImport {
  if (typeof text !== 'string') return fail('empty', 'No text to import.');
  if (text.includes('\u0000')) return fail('binary', 'This looks like a binary file (for example an Excel .xlsx). Export it as CSV or paste the columns as text.');
  if (text.length > MAX_CHARS) return fail('too-large', 'The file is larger than 2 MB, which is far more than a dyno pull needs. Check that it is a plain CSV.');
  if (!text.trim()) return fail('empty', 'The file is empty.');

  const t = tokenise(text, opts.hasHeader);
  if ('ok' in t) return t;
  if (t.rows.length === 0) return fail('no-numeric', 'No numeric data rows were found below the header.');

  const warnings: string[] = [];
  const notes: string[] = [];

  let roles: Roles;
  if (opts.rpmCol !== undefined || opts.torqueCol !== undefined || opts.powerCol !== undefined) {
    // Manual override: start from detection where possible, then replace what the caller specified.
    const auto = detectRoles(t);
    const base: Roles = 'ok' in auto
      ? { rpmCol: 0, torqueCol: null, powerCol: null, torqueUnit: null, powerUnit: null, wheelHint: false, crankHint: false, ignored: [] }
      : auto;
    roles = {
      ...base,
      rpmCol: opts.rpmCol ?? base.rpmCol,
      torqueCol: opts.torqueCol === undefined ? base.torqueCol : opts.torqueCol,
      powerCol: opts.powerCol === undefined ? base.powerCol : opts.powerCol,
    };
    for (const c of [roles.rpmCol, roles.torqueCol, roles.powerCol]) {
      if (c !== null && (c < 0 || c >= t.nCols)) return fail('bad-options', `Column ${c + 1} does not exist (the file has ${t.nCols} columns).`);
    }
    if (roles.torqueCol === null && roles.powerCol === null) return fail('no-values', 'Pick at least one of torque or power.');
  } else {
    const r = detectRoles(t);
    if ('ok' in r) return r;
    roles = r;
  }

  const rpmRaw = t.rows.map((r) => r[roles.rpmCol]);
  // Resolve units: header, then explicit option, then data consistency, then a stated default.
  let torqueUnit: TorqueUnit | null = opts.torqueUnit ?? roles.torqueUnit;
  let powerUnit: PowerUnit | null = opts.powerUnit ?? roles.powerUnit;
  const tqRaw = roles.torqueCol === null ? null : t.rows.map((r) => r[roles.torqueCol as number]);
  const pwRaw = roles.powerCol === null ? null : t.rows.map((r) => r[roles.powerCol as number]);
  if (tqRaw && pwRaw && (!torqueUnit || !powerUnit)) {
    let best: { tu: TorqueUnit; pu: PowerUnit; s: number } | null = null;
    for (const [tu, pu] of PAIR_PRIOR) {
      if (torqueUnit && tu !== torqueUnit) continue;
      if (powerUnit && pu !== powerUnit) continue;
      const err = pairError(rpmRaw, tqRaw, pwRaw, tu, pu);
      const s = err + PAIR_PRIOR.findIndex((p) => p[0] === tu && p[1] === pu) * 0.004;
      if (!best || s < best.s) best = { tu, pu, s };
    }
    if (best) {
      torqueUnit = best.tu;
      powerUnit = best.pu;
      notes.push(`Units inferred from the torque x rpm = power relation: ${best.tu === 'Nm' ? 'N·m' : 'lb-ft'} and ${best.pu}.`);
      if ((best.tu === 'Nm' && best.pu === 'hp') || (best.tu === 'lbft' && best.pu === 'kW') || best.pu === 'PS') {
        warnings.push('The unit pair is ambiguous (N·m + hp, lb-ft + kW and N·m + PS differ by only about 1 %). Check the unit selectors.');
      }
    }
  }
  if (tqRaw && !torqueUnit) {
    torqueUnit = 'Nm';
    warnings.push('Torque unit not given in the file: assumed N·m. Change the unit if the values are lb-ft.');
  }
  if (pwRaw && !powerUnit) {
    powerUnit = 'hp';
    warnings.push('Power unit not given in the file: assumed hp. Change the unit if the values are kW or PS.');
  }
  const tu: TorqueUnit = torqueUnit ?? 'Nm';
  const pu: PowerUnit = powerUnit ?? 'hp';

  const basis: Basis = opts.basis ?? (roles.wheelHint && !roles.crankHint ? 'wheel' : 'crank');
  const lossPct = opts.drivetrainLossPct ?? 15;
  if (!(lossPct >= 0 && lossPct < 60)) return fail('bad-options', 'Drivetrain loss must be between 0 and 60 %.');
  const standard = opts.standard ?? 'sae-j1349';
  const smoothing = opts.smoothing ?? 'auto';
  const stepRpm = opts.stepRpm ?? 100;
  if (!(stepRpm >= 10 && stepRpm <= 1000)) return fail('bad-options', 'The rpm step must be between 10 and 1000.');

  if (opts.basis === undefined && roles.wheelHint && !roles.crankHint) notes.push('Header mentions wheel figures: treated as wheel data (change the basis if it is crank data).');
  if (roles.ignored.length) notes.push(`Ignored columns: ${roles.ignored.join(', ')}.`);

  // Convert every row to crank-basis, SAE-basis N.m / kW.
  const gain = (basis === 'wheel' ? 1 / (1 - lossPct / 100) : 1) * (standard === 'din-70020' ? DIN_TO_SAE : 1);
  let dropped = 0;
  const pts: RawPoint[] = [];
  let tqFromPower = false;
  t.rows.forEach((_row, i) => {
    const rpm = rpmRaw[i];
    if (rpm === null || !Number.isFinite(rpm) || rpm <= 0) {
      dropped++;
      return;
    }
    const tq = tqRaw ? tqRaw[i] : null;
    const pw = pwRaw ? pwRaw[i] : null;
    let nm: number | null = null;
    if (tq !== null && tq > 0) nm = tq * torqueFactor(tu);
    else if (pw !== null && pw > 0) {
      nm = (pw * powerFactor(pu)) / (rpm * NM_RPM_TO_KW);
      tqFromPower = true;
    }
    if (nm === null || !(nm > 0)) {
      dropped++;
      return;
    }
    nm *= gain;
    pts.push({ rpm, torqueNm: nm, powerKw: nm * rpm * NM_RPM_TO_KW });
  });
  if (tqFromPower && !tqRaw) notes.push('Torque derived from power (T = P / omega).');
  if (dropped) warnings.push(`${dropped} row${dropped > 1 ? 's' : ''} without a usable rpm or positive value were dropped.`);

  if (pts.length < 6) return fail('too-few-points', `Only ${pts.length} usable data point${pts.length === 1 ? '' : 's'}: at least 6 are needed across the rev range.`);
  pts.sort((a, b) => a.rpm - b.rpm);
  // Merge duplicate rpm (average).
  const merged: RawPoint[] = [];
  for (const p of pts) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.rpm - p.rpm) < 0.5) {
      const n = (last as RawPoint & { n?: number }).n ?? 1;
      last.torqueNm = (last.torqueNm * n + p.torqueNm) / (n + 1);
      last.powerKw = (last.powerKw * n + p.powerKw) / (n + 1);
      (last as RawPoint & { n?: number }).n = n + 1;
    } else merged.push({ ...p });
  }
  merged.forEach((m) => delete (m as RawPoint & { n?: number }).n);
  if (merged.length < pts.length) notes.push(`${pts.length - merged.length} duplicate-rpm rows averaged.`);

  const rpmMin = merged[0].rpm;
  const rpmMax = merged[merged.length - 1].rpm;
  if (rpmMax < 500 || rpmMin > 20000) return fail('implausible', `The rpm values (${Math.round(rpmMin)} to ${Math.round(rpmMax)}) are not plausible engine speeds. Check the rpm column, or the decimal separator (1,500 vs 1.500).`);
  if (rpmMax - rpmMin < 1000) return fail('rpm-range', `The rpm range is only ${Math.round(rpmMax - rpmMin)} rpm (${Math.round(rpmMin)} to ${Math.round(rpmMax)}). A usable pull spans at least 1000 rpm.`);
  const maxT = Math.max(...merged.map((m) => m.torqueNm));
  const maxP = Math.max(...merged.map((m) => m.powerKw));
  if (maxT > 6000 || maxP > 3500) return fail('implausible', `Peak values of ${Math.round(maxT)} N·m / ${Math.round(maxP)} kW are not plausible for a road engine: the units are probably wrong.`);
  if (maxT < 20) return fail('implausible', `Peak torque of ${maxT.toFixed(1)} N·m is too small to be an engine: check the units or the column.`);

  // Despike: drop points more than 25 % away from the median of their 5 neighbours.
  const keep: RawPoint[] = [];
  for (let i = 0; i < merged.length; i++) {
    const nb: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(merged.length - 1, i + 2); j++) if (j !== i) nb.push(merged[j].torqueNm);
    const med = median(nb);
    if (nb.length >= 3 && Math.abs(merged[i].torqueNm - med) > 0.25 * med) continue;
    keep.push(merged[i]);
  }
  if (keep.length < merged.length) warnings.push(`${merged.length - keep.length} spike${merged.length - keep.length > 1 ? 's' : ''} (more than 25 % from neighbouring points) removed.`);
  if (keep.length < 6) return fail('too-few-points', 'Too few valid points remain after removing spikes.');

  // Cross-check of torque vs power columns after unit resolution.
  if (tqRaw && pwRaw) {
    const e = pairError(rpmRaw, tqRaw, pwRaw, tu, pu);
    if (e > 0.1) warnings.push(`Torque and power columns disagree by a median of ${(e * 100).toFixed(0)} % (power should equal torque x rpm / 9549 in kW). The units or the column choice may be wrong; torque is used for the fit.`);
  }

  const xr = keep.map((p) => p.rpm);
  const yr = keep.map((p) => p.torqueNm);
  const noisePct = estimateNoisePct(xr, yr);
  let sigma = 0;
  const spacing = (xr[xr.length - 1] - xr[0]) / (xr.length - 1);
  // Sparse data (> 150 rpm apart) cannot separate noise from curvature, so auto never smooths it.
  if (smoothing === 'auto') sigma = spacing > 150 || noisePct < 0.3 ? 0 : noisePct < 1 ? SIGMA.light : noisePct < 2.5 ? SIGMA.medium : SIGMA.heavy;
  else sigma = SIGMA[smoothing];
  // The kernel must not be narrower than the data spacing to be a smoother rather than an interpolator.
  if (sigma > 0 && sigma < 0.6 * spacing) sigma = 0.6 * spacing;
  const gridLo = Math.ceil(xr[0] / stepRpm) * stepRpm;
  const gridHi = Math.floor(xr[xr.length - 1] / stepRpm) * stepRpm;
  const grid: number[] = [];
  for (let r = gridLo; r <= gridHi + 1e-6; r += stepRpm) grid.push(r);
  if (grid.length < 6) return fail('rpm-range', 'The rpm range is too narrow for the chosen step to give at least 6 points.');
  const ys = smoothResample(xr, yr, grid, sigma);
  const torqueNm = ys.map((v) => Math.max(1, v));
  const powerKw = torqueNm.map((v, i) => v * grid[i] * NM_RPM_TO_KW);
  if (sigma > 0) notes.push(`Smoothed with a ${Math.round(sigma)} rpm Gaussian kernel (noise estimate ${noisePct.toFixed(1)} %).`);
  else notes.push(`Light data (noise estimate ${noisePct.toFixed(1)} %): resampled by interpolation, not smoothed.`);
  if (noisePct > 4) warnings.push(`The data is very noisy (about ${noisePct.toFixed(1)} % point to point); the fit can only be as good as the smoothed curve.`);
  notes.push(`Resampled to ${grid.length} points at ${stepRpm} rpm, ${grid[0]} to ${grid[grid.length - 1]} rpm.`);
  if (basis === 'wheel') notes.push(`Wheel data converted to crank: divided by (1 - ${lossPct} %) = ${(1 / (1 - lossPct / 100)).toFixed(3)}.`);
  notes.push(STANDARD_NOTES[standard]);
  if (standard === 'unknown') warnings.push(STANDARD_NOTES.unknown);

  const preview = t.rows.slice(0, 5);
  return {
    ok: true,
    table: { delimiter: t.delimiter, decimalComma: t.decimalComma, hasHeader: t.hasHeader, headers: t.headers, nCols: t.nCols, nRows: t.rows.length, preview },
    options: {
      rpmCol: roles.rpmCol,
      torqueCol: roles.torqueCol,
      powerCol: roles.powerCol,
      torqueUnit: tu,
      powerUnit: pu,
      hasHeader: t.hasHeader,
      basis,
      drivetrainLossPct: lossPct,
      standard,
      smoothing,
      stepRpm,
    },
    curve: { rpm: grid, torqueNm, powerKw, raw: keep, smoothingSigmaRpm: sigma, noisePct },
    warnings,
    notes,
  };
}
