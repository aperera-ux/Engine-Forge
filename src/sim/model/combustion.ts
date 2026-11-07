/**
 * Combustion submodel: single-zone Wiebe cycle for peak pressure and spark
 * effects, Douaud–Eyzat end-gas auto-ignition integral for the knock limit,
 * fuel-air-cycle indicated efficiency, and exhaust temperature.
 */
import type { EngineConfig } from '../types';
import { CAL, CP_EXH, FUELS, type FuelProps } from './constants';
import type { Geometry } from './geometry';

const GAMMA_CYL = 1.3;
const GAMMA_UNBURNED = 1.33;
const WIEBE_A = 5;
const WIEBE_M1 = 3; // m + 1, m = 2
/** Fraction of burn duration at which 50 % mass is burned (Wiebe a=5, m=2). */
const X50 = Math.pow(Math.LN2 / WIEBE_A, 1 / WIEBE_M1);
/** Fraction of burn duration at which 95 % mass is burned: the end of the knock integral. */
const X95 = Math.pow(Math.log(20) / WIEBE_A, 1 / WIEBE_M1);
/** CA50 for MBT, deg ATDC. */
const CA50_MBT = 8;

export interface CycleInputs {
  g: Geometry;
  rpm: number;
  /** BDC-equivalent pressure of the trapped charge, Pa. */
  pBdc: number;
  /** Trapped charge temperature, K. */
  tIvc: number;
  /** Heat released into the gas per cycle, J. */
  q: number;
  burnDeg: number;
  /** Combustion start, deg relative to TDC (negative = BTDC). */
  thetaStart: number;
  octane: number;
  wantKnock: boolean;
  /** Trapped residual (burned-gas) mass fraction; dilution lengthens the ignition delay. */
  residual?: number;
  /**
   * false: only pMax and the knock integral are wanted — integration stops once
   * combustion is complete and the volume only grows (pressure can only fall),
   * and `work` is then NaN. Default true.
   */
  needWork?: boolean;
}

export interface CycleOut {
  pMaxPa: number;
  work: number;
  knockIntegral: number;
}

/** First index from which every polytropic step is an expansion (per geometry). */
const expansionFrom = new WeakMap<Float64Array, number>();
function expansionStart(polyStep: Float64Array): number {
  let j = expansionFrom.get(polyStep);
  if (j === undefined) {
    j = polyStep.length;
    while (j > 0 && polyStep[j - 1] <= 1) j--;
    expansionFrom.set(polyStep, j);
  }
  return j;
}

/**
 * Shared compression prefix of the knock-mode cycle. Before combustion starts
 * the state (pressure, work, knock integral, pMax) does not depend on the
 * spark timing, so the spark-retard search integrates it once and every cycle
 * resumes from the step where its own burn begins. The stored states are the
 * exact values the full integration produces (same operations, same order),
 * so results are bit-identical to integrating each cycle from BDC.
 */
export interface CyclePrefix {
  /** Number of steps integrated so far (state after step n−1 is stored at n). */
  n: number;
  p: Float64Array;
  work: Float64Array;
  ki: Float64Array;
  pMax: Float64Array;
}

const KNOCK_FROM = 119; // knock integral from 60° BTDC

export function newCyclePrefix(): CyclePrefix {
  return { n: -1, p: new Float64Array(361), work: new Float64Array(361), ki: new Float64Array(361), pMax: new Float64Array(361) };
}

/** Scratch prefix for knockLimitedSpark (synchronous, not re-entrant: reset per call). */
const SPARK_PREFIX = newCyclePrefix();

export function runCycle(inp: CycleInputs, pre?: CyclePrefix): CycleOut {
  const { vol, polyStep } = inp.g;
  const needWork = inp.needWork !== false;
  const wantKnock = inp.wantKnock;
  const thetaStart = inp.thetaStart;
  const q = inp.q;
  const tIvc = inp.tIvc;
  const knockPressureExp = CAL.knockPressureExp;
  const iExp = needWork ? 361 : expansionStart(polyStep);
  let p = inp.pBdc;
  const p0 = inp.pBdc;
  let pMax = p;
  let work = 0;
  let ki = 0;
  let xbPrev = 0;
  // Knock time base: end-gas residence time shrinks ∝ 1/rpm, but turbulent
  // flame speed and end-gas temperature both rise with speed, so knock
  // tolerance improves only weakly with rpm: effective time ∝ rpm^(β−1).
  const msPerDeg = (1000 / (6 * inp.rpm)) * Math.pow(inp.rpm / 3000, CAL.knockRpmExp);
  // τ is referenced to 40 atm so the pressure exponent can be recalibrated without moving the overall level.
  const lnOnFac =
    Math.log(CAL.knockTauScale * 17.68 * Math.pow(inp.octane / 100, 3.402)) +
    (CAL.knockPressureExp - 1.7) * Math.log(40) -
    CAL.knockDilutionExp * Math.log(1 - Math.min(0.5, Math.max(0, inp.residual ?? 0)));
  // End-gas loses heat to the walls during compression: more time at low rpm.
  const kU = ((GAMMA_UNBURNED - 1) / GAMMA_UNBURNED) * (1 - CAL.endGasHeatLoss * (1000 / Math.max(300, inp.rpm)));
  const lnP0 = Math.log(p0);
  const lnAtm = Math.log(101325);
  const invBurn = 1 / inp.burnDeg;
  // The knock integral runs until 95 % of the charge is burned (crank angle th95).
  // On the 1° grid a step is weighted by w = clamp(th95 + ½ − θ, 0, 1): the hard
  // cut "include the step if xb(θ) < 0.95" made KI a saw-tooth in the spark timing
  // (it drops the largest, hottest step whenever th95 crosses a grid node), so the
  // knock-limited retard jumped by up to ~0.5° under tiny input changes. The ramp
  // is that cut averaged over the sub-grid position of th95: the same KI on
  // average, but continuous.
  const th95h = thetaStart + X95 * inp.burnDeg + 0.5;
  // Compression before combustion is pure polytropic: skip straight to it.
  const iStart = Math.max(0, Math.min(359, Math.floor(thetaStart + 180) - 1));
  const kStart = wantKnock ? Math.min(iStart, KNOCK_FROM) : iStart; // knock integral from 60° BTDC
  let i0 = kStart;
  if (pre && wantKnock && kStart === KNOCK_FROM) {
    // Steps before the burn starts (u ≤ 0, xb = 0) are spark-independent.
    let j = kStart;
    while (j < 360 && !((j + 1 - 180 - thetaStart) * invBurn > 0)) j++;
    if (pre.n < 0) {
      for (let i = 0; i < KNOCK_FROM; i++) {
        const pNew = p * polyStep[i];
        work += 0.5 * (p + pNew) * (vol[i + 1] - vol[i]);
        p = pNew;
      }
      pre.n = KNOCK_FROM;
      pre.p[KNOCK_FROM] = p;
      pre.work[KNOCK_FROM] = work;
      pre.ki[KNOCK_FROM] = 0;
      pre.pMax[KNOCK_FROM] = pMax;
    }
    if (pre.n < j) {
      p = pre.p[pre.n];
      work = pre.work[pre.n];
      ki = pre.ki[pre.n];
      pMax = pre.pMax[pre.n];
      for (let i = pre.n; i < j; i++) {
        const v1 = vol[i + 1];
        // xb = 0, dq = 0: identical operations to the main loop below.
        const pNew = p * polyStep[i] + ((GAMMA_CYL - 1) * ((0 - 0) * q)) / v1;
        work += 0.5 * (p + pNew) * (v1 - vol[i]);
        p = pNew;
        if (p > pMax) pMax = p;
        const lnP = Math.log(p);
        const tU = tIvc * Math.exp(kU * (lnP - lnP0));
        ki += msPerDeg * Math.exp(-(lnOnFac - knockPressureExp * (lnP - lnAtm) + 3800 / tU));
        pre.p[i + 1] = p;
        pre.work[i + 1] = work;
        pre.ki[i + 1] = ki;
        pre.pMax[i + 1] = pMax;
      }
      pre.n = j;
    }
    p = pre.p[j];
    work = pre.work[j];
    ki = pre.ki[j];
    pMax = pre.pMax[j];
    i0 = j;
  } else {
    for (let i = 0; i < kStart; i++) {
      const pNew = p * polyStep[i];
      work += 0.5 * (p + pNew) * (vol[i + 1] - vol[i]);
      p = pNew;
    }
  }
  for (let i = i0; i < 360; i++) {
    const th1 = i + 1 - 180;
    const v1 = vol[i + 1];
    let xb = xbPrev;
    if (xbPrev < 0.99999) {
      const u = (th1 - thetaStart) * invBurn;
      xb = u > 0 ? 1 - Math.exp(-WIEBE_A * u * u * u) : 0;
    }
    const dq = (xb - xbPrev) * q;
    xbPrev = xb;
    const pNew = p * polyStep[i] + ((GAMMA_CYL - 1) * dq) / v1;
    work += 0.5 * (p + pNew) * (v1 - vol[i]);
    p = pNew;
    if (p > pMax) pMax = p;
    if (wantKnock && th1 < th95h) {
      // Douaud–Eyzat: τ = 17.68 (ON/100)^3.402 p^-1.7 exp(3800/T), end gas compressed isentropically.
      const lnP = Math.log(p);
      const tU = tIvc * Math.exp(kU * (lnP - lnP0));
      const w = th95h - th1;
      ki += (w < 1 ? w : 1) * msPerDeg * Math.exp(-(lnOnFac - knockPressureExp * (lnP - lnAtm) + 3800 / tU));
    } else if (!needWork && i + 1 >= iExp && (p + ((GAMMA_CYL - 1) * (1 - xb) * q) / v1) * (1 + 1e-12) <= pMax) {
      // Knock integral complete (xb ≥ 0.95) and only expansion left: every later
      // step has polyStep ≤ 1 and a volume ≥ v1, so the pressure can never exceed
      // p + (γ−1)·(remaining heat)/v1 < pMax. pMax and KI are final.
      return { pMaxPa: pMax, work: NaN, knockIntegral: ki };
    } else if (!wantKnock && xb >= 0.99999 && th1 > 120) {
      // Remaining expansion only matters for work; finish polytropically.
      for (let j = i + 1; j < 360; j++) {
        const pn = p * polyStep[j];
        work += 0.5 * (p + pn) * (vol[j + 1] - vol[j]);
        p = pn;
      }
      break;
    }
  }
  return { pMaxPa: pMax, work, knockIntegral: ki };
}

export function fuelOf(c: EngineConfig): FuelProps {
  return FUELS[c.fuel] ?? FUELS.gas91;
}

/** Effective octane index for end-gas auto-ignition (Kalghatgi OI + mixture). */
/**
 * Effective octane index for end-gas auto-ignition, Kalghatgi OI = RON − K·S.
 * K falls with boost (cooler end gas at a given pressure, "beyond-RON"
 * conditions): ≈ +0.3 NA, negative when boosted — octane sensitivity then helps.
 */
export function octaneIndex(c: EngineConfig, mapBar = 1): number {
  const f = fuelOf(c);
  const k = CAL.octaneK - CAL.octaneKPerBar * Math.max(0, mapBar - 1);
  let oi = f.ron - k * (f.ron - f.mon);
  if (c.lambda < 1) oi += 15 * Math.min(0.3, 1 - c.lambda);
  else oi -= 25 * (c.lambda - 1);
  return oi;
}

/** 0–100 % burn duration, crank deg. */
export function burnDuration(c: EngineConfig, rpm: number): number {
  const head =
    c.valvesPerCylinder >= 4 ? 1.0 : c.valvesPerCylinder === 3 ? 1.06 : c.valvetrain === 'pushrod' ? 1.12 : 1.1;
  const bs = c.boreMm / c.strokeMm;
  const lam = 1 + 1.5 * (c.lambda - 0.9) * (c.lambda - 0.9);
  // DI heads are designed around high-tumble ports and a central injector/plug: faster burn.
  const di = c.directInjection ? CAL.diBurnFactor : 1;
  return (
    (CAL.burnDeg * di * head * Math.pow(bs, 0.3) * Math.pow(c.boreMm / 86, CAL.burnBoreExp) * Math.pow(Math.max(500, rpm) / 4000, CAL.burnRpmExp) * lam) /
    fuelOf(c).flameSpeed
  );
}

/** MBT spark advance, deg BTDC (CA50 at 8° ATDC). */
export function mbtSpark(burnDeg: number): number {
  return X50 * burnDeg + CAL.delayDeg - CA50_MBT;
}

/** Air-specific power factor vs lambda, relative to stoichiometric (best power ≈ 0.87). */
export function lambdaPowerFactor(lambda: number): number {
  if (lambda <= 1) {
    const x = (lambda - 0.87) / 0.13;
    return 1 + 0.04 * (1 - x * x);
  }
  return (1 / lambda) * (1 + 0.1 * (lambda - 1));
}

/** Gross indicated efficiency at MBT, referenced to stoichiometric fuel energy. */
export function indicatedEfficiency(c: EngineConfig, rpm: number, burnDeg: number): number {
  const cr = c.compressionRatio;
  const ideal = CAL.etaScale * (1 - Math.pow(cr, -CAL.etaExp));
  const h = CAL.heatLoss * Math.pow(3000 / Math.max(400, rpm), CAL.heatLossRpmExp) * Math.pow(86 / c.boreMm, 0.25) * Math.pow(cr / 11, 0.3);
  const gHeat = (1 - h) / (1 - CAL.heatLoss);
  const gBurn = 1 - 0.0015 * (burnDeg - 50);
  // Heat transfer and crevice losses grow with CR (surface/volume at TDC):
  // the indicated-efficiency benefit saturates around CR 14–16 (Heywood §5.7).
  const gCr = 1 - CAL.crPenalty * Math.max(0, cr - 10) ** 2;
  return ideal * gHeat * gBurn * gCr * fuelOf(c).etaFactor;
}

/** Fraction of released fuel energy lost to the walls/coolant (EGT balance). */
export function wallHeatFraction(c: EngineConfig, rpm: number): number {
  return 0.25 * Math.pow(3000 / Math.max(400, rpm), 0.3) * Math.pow(86 / c.boreMm, 0.2);
}

/** Evaporative charge cooling, K, for a given fraction of h_fg absorbed from the air. */
export function evapCooling(c: EngineConfig, frac: number): number {
  const f = fuelOf(c);
  const mfFrac = 1 / (f.afr * c.lambda + 1);
  return Math.min(70, (frac * mfFrac * f.hfg) / 1050);
}

export interface SparkResult {
  sparkBtdc: number;
  retard: number;
  workRatio: number;
  pMaxBar: number;
  /** Knock integral at MBT (NaN when the search started from a hint and did not need it). */
  knockIntegralMbt: number;
}

/** Knock-limited spark search: stop at |ln KI| below this (≈ 1e-4° of retard)… */
const KNOCK_LNKI_TOL = 2e-5;
/**
 * …or when the bracket on retard is narrower than this, deg. The retard is then
 * interpolated linearly in ln KI across the bracket; ln KI is nearly linear in
 * retard, so the interpolation error is ~1e-5° at 0.05° and grows with the
 * width squared (≲ 2e-4° at 0.2°, ≈ 2e-6 relative in torque at 13° retard).
 * 0.05 → 0.2 (§19): −18 % knock cycles per call, max output change 0.002 % in
 * torque (snapshot, 67 configs × 3 modes).
 */
const KNOCK_BRACKET_DEG = 0.2;
/** First step from a retard hint when bracketing the root, deg. */
const KNOCK_HINT_STEP_DEG = 0.03;
/** A Newton step from the hint is accepted without bracketing when shorter than this, deg (error ≈ slope error × step, ≲ 3e-4°; was 0.01, §19). */
const KNOCK_NEWTON_DEG = 0.03;

/**
 * Knock-limited spark: start at MBT, retard until the end-gas auto-ignition
 * integral stays below 1. Returns the work ratio vs MBT.
 *
 * `hint` (deg, optional): a nearby retard (the previous solve of the same
 * operating point). The root is then bracketed from there in 1–2 extra cycles
 * instead of from [0, max]; the cycle at MBT is skipped when the bracket's
 * low end still knocks (knockIntegralMbt is then NaN). The result does not
 * depend on the hint beyond the stop tolerances below.
 */
export function knockLimitedSpark(
  base: Omit<CycleInputs, 'thetaStart' | 'wantKnock'>,
  burnDeg: number,
  hint?: SparkHint,
): SparkResult {
  const res = knockLimitedSparkImpl(base, burnDeg, hint);
  if (hint) hint.retard = res.retard;
  return res;
}

/** Warm start for knockLimitedSpark (updated in place): last retard and d ln KI / d retard there. */
export interface SparkHint {
  retard: number;
  slope: number;
  /** d pMax / d retard, Pa/deg. */
  pSlope: number;
}

function knockLimitedSparkImpl(base: Omit<CycleInputs, 'thetaStart' | 'wantKnock'>, burnDeg: number, hint?: SparkHint): SparkResult {
  const mbt = mbtSpark(burnDeg);
  const start = (adv: number) => -adv + CAL.delayDeg;
  // All cycles of the retard search share one compression prefix (same charge state).
  const pre = SPARK_PREFIX;
  pre.n = -1;
  const maxRetard = Math.min(40, mbt + 15);
  const ki = (r: number) => runCycle({ ...base, thetaStart: start(mbt - r), wantKnock: true, needWork: false }, pre);
  const lnKi = (k: number) => Math.max(-3, Math.log(Math.max(1e-12, k)));
  let kiMbt = NaN;
  // Bracket [a, b] on retard with ln KI(a) > 0 ≥ ln KI(b) (a = 0 is MBT).
  let a = -1;
  let fa = 0;
  let pA = 0;
  let b = -1;
  let fb = 0;
  let pB = 0;
  if (hint && hint.retard > 0 && hint.retard < maxRetard) {
    // Walk from the hint towards the root until the sign changes: first a
    // Newton step with the last slope (aimed 20 % past the root), then ×4 steps.
    let r = hint.retard;
    let out = ki(r);
    let f = lnKi(out.knockIntegral);
    let step = KNOCK_HINT_STEP_DEG;
    if (hint.slope < 0) {
      const d = -f / hint.slope;
      if (Math.abs(d) <= KNOCK_NEWTON_DEG && f > -3 && r + d > 0 && r + d < maxRetard) {
        // The root is within KNOCK_NEWTON_DEG of the hint: one Newton step with the
        // last bracket's slopes. Error ≈ (slope error) × d + O(d²) ≲ 3e-4°.
        const rr = r + d;
        const pm = out.pMaxPa + hint.pSlope * d;
        return { sparkBtdc: mbt - rr, retard: rr, workRatio: sparkWorkRatio(rr), pMaxBar: pm / 1e5, knockIntegralMbt: kiMbt };
      }
      step = Math.min(2, Math.max(1e-3, 1.2 * Math.abs(d)));
    }
    for (let i = 0; i < 8; i++) {
      if (f > 0) {
        a = r;
        fa = f;
        pA = out.pMaxPa;
      } else {
        b = r;
        fb = f;
        pB = out.pMaxPa;
      }
      if (a >= 0 && b >= 0) break;
      r = f > 0 ? Math.min(maxRetard, r + step) : Math.max(0, r - step);
      if ((f > 0 && r >= maxRetard) || (f <= 0 && r <= 0)) break; // reached an end: full search below
      out = ki(r);
      f = lnKi(out.knockIntegral);
      step *= 4;
    }
  }
  if (b < 0 || a < 0) {
    // No (complete) hint bracket: MBT and maximum retard.
    if (a < 0) {
      const atMbt = ki(0);
      kiMbt = atMbt.knockIntegral;
      if (atMbt.knockIntegral <= 1) {
        return { sparkBtdc: mbt, retard: 0, workRatio: 1, pMaxBar: atMbt.pMaxPa / 1e5, knockIntegralMbt: atMbt.knockIntegral };
      }
      a = 0;
      fa = Math.log(atMbt.knockIntegral);
      pA = atMbt.pMaxPa;
    }
    if (b < 0) {
      const atMax = ki(maxRetard);
      if (atMax.knockIntegral > 1) {
        return { sparkBtdc: mbt - maxRetard, retard: maxRetard, workRatio: sparkWorkRatio(maxRetard), pMaxBar: atMax.pMaxPa / 1e5, knockIntegralMbt: kiMbt };
      }
      b = maxRetard;
      fb = lnKi(atMax.knockIntegral);
      pB = atMax.pMaxPa;
    }
  }
  // Illinois (modified regula falsi) on ln(KI) — ln KI is nearly linear in
  // retard. Stops when |ln KI| < KNOCK_LNKI_TOL or the bracket is narrower
  // than KNOCK_BRACKET_DEG; the returned retard (and pMax) is then the
  // linear interpolation between the final bracket ends, using their true
  // ln KI (not the Illinois-halved weights). Returning an evaluated end
  // instead made the retard a staircase in the inputs (steps up to the old
  // 0.05° stop width); the interpolated root is continuous, and the residual
  // jump where the iteration path changes is O(1e-4°).
  let faT = fa;
  let fbT = fb;
  let side = 0;
  if (Math.abs(fa) >= KNOCK_LNKI_TOL && Math.abs(fb) >= KNOCK_LNKI_TOL)
    for (let i = 0; i < 24 && b - a > KNOCK_BRACKET_DEG; i++) {
      let r = (a * fb - b * fa) / (fb - fa);
      // Guard: fall back to bisection if the secant step stalls near a bracket end.
      if (!(r > a + 0.02 * (b - a) && r < b - 0.02 * (b - a))) r = 0.5 * (a + b);
      const out = ki(r);
      const fr = lnKi(out.knockIntegral);
      if (fr > 0) {
        a = r;
        fa = faT = fr;
        pA = out.pMaxPa;
        if (side === -1) fb /= 2;
        side = -1;
      } else {
        b = r;
        fb = fbT = fr;
        pB = out.pMaxPa;
        if (side === 1) fa /= 2;
        side = 1;
      }
      if (Math.abs(fr) < KNOCK_LNKI_TOL) break;
    }
  const w = faT - fbT > 0 ? faT / (faT - fbT) : 1;
  const retard = a + w * (b - a);
  if (hint && b > a && faT > fbT) {
    hint.slope = (fbT - faT) / (b - a);
    hint.pSlope = (pB - pA) / (b - a);
  }
  const pMaxPa = pA + w * (pB - pA);
  return {
    sparkBtdc: mbt - retard,
    retard,
    workRatio: sparkWorkRatio(retard),
    pMaxBar: pMaxPa / 1e5,
    knockIntegralMbt: kiMbt,
  };
}

/**
 * Indicated work vs retard from MBT (Heywood: torque vs spark timing is
 * parabolic about MBT; ~6 % at 10°, ~24 % at 20°). The single-zone cycle has
 * no heat-transfer/crevice losses so it under-states the curvature; it is used
 * for pressure and knock only.
 */
export function sparkWorkRatio(retardDeg: number): number {
  return Math.max(0.35, 1 - CAL.sparkLossK * retardDeg * retardDeg);
}

/** Exhaust gas temperature, K, from an energy balance per kg of air. */
export function exhaustTemp(
  c: EngineConfig,
  tIvc: number,
  indicatedWorkPerKgAir: number,
  rpm: number,
): number {
  const f = fuelOf(c);
  const e = (f.lhv / f.afr) * Math.min(1, 1 / c.lambda) * 0.98;
  const qWall = wallHeatFraction(c, rpm) * e;
  // Excess fuel (λ<1) absorbs heat: vaporisation, sensible heating, endothermic
  // cracking/water-gas shift — the reason rich mixtures cool the exhaust.
  const excessFuel = Math.max(0, 1 / (f.afr * c.lambda) - 1 / f.afr);
  const richSink = excessFuel * (f.hfg + 7.5e6);
  const exhEnergy = Math.max(0.15 * e, e - indicatedWorkPerKgAir - qWall - richSink);
  const t = tIvc + exhEnergy / ((1 + 1 / (f.afr * c.lambda)) * CP_EXH);
  return Math.min(1500, Math.max(450, t));
}
