/**
 * 0-D quasi-steady engine model: simulate(config) → SimResult.
 *
 * Per rpm:  airflow (VE, throttle, exhaust/turbine back-pressure, boost)
 *        →  combustion (Wiebe single-zone cycle, Douaud–Eyzat knock limit,
 *           fuel-air-cycle efficiency)
 *        →  friction (Chen–Flynn + valvetrain + accessories) and pumping
 *        →  brake torque/power, BSFC, EGT, peak pressure.
 * Plus mechanical limits, mass, balance and warnings. See src/sim/model/*.
 */
import type { DynoPoint, EngineConfig, SimCalibration, SimOptions, SimResult } from './types';
import { computeLayout } from './layout';
import { CAL, HP_W, LBFT_PER_NM, P_AMB_PA, R_AIR, RHO_AMB, T_AMB_K } from './model/constants';
import { computeGeometry, maxPistonAccel, meanPistonSpeed, sanitize, type Geometry } from './model/geometry';
import { BreathingModel, chargeWallHeating, exhaustBackPressure, solveThrottle, type VeResult } from './model/airflow';
import { solveSupercharger, solveTurbo, type BoostState, type FlowAt, type SpoolControl, type TurboHint } from './model/boost';
import {
  burnDuration,
  evapCooling,
  exhaustTemp,
  fuelOf,
  indicatedEfficiency,
  knockLimitedSpark,
  lambdaPowerFactor,
  octaneIndex,
  type SparkHint,
} from './model/combustion';
import { mechanicalFmep, pumpingMep } from './model/friction';
import { estimateMassKg, mechanicalLimitRpm, valveFloatRpm } from './model/mechanical';
import { computeBalance } from './model/balance';
import { computeWarnings } from './model/warnings';
import { computeUncertainty } from './model/uncertainty';
import { illinois } from './model/solve';

interface PointCtx {
  c: EngineConfig;
  g: Geometry;
  breathing: BreathingModel;
  vFloat: number;
  cdAThrottle: number;
  evapVe: number;
  evapKnock: number;
  octane: number;
  /** SimOptions.calibration: scale on the gas-exchange VE and on mechanical FMEP (1 = identity). */
  veScale: number;
  fricScale: number;
  /**
   * ECU throttle torque control: manifold-pressure ceiling, Pa absolute
   * (Infinity = wide open). Used only where a torque limit cannot be met by
   * the boost target (NA engines, or boost already at zero).
   */
  pManCap: number;
  /** Turbo spool-branch control at this rpm (spoolCeiling): PR cap, or a forced PR for the scan; null = none. */
  spool: SpoolControl | null;
  /**
   * Warm starts shared by all evaluations of one simulate() call (knock retard,
   * compressor PR / flow fraction, fixed-point Jacobian). They change only the
   * iteration path of the inner solves, not their converged results.
   */
  hints: PointHints;
}

interface PointHints {
  spark: SparkHint;
  turbo: TurboHint;
  /** Broyden Jacobian of the exhaust-state fixed point (null = −I). */
  jac: [number, number, number, number] | null;
}

interface PointOut {
  point: DynoPoint;
  boost: BoostState | null;
  /** EGT computed at this point, K. */
  egtK: number;
  /** Exhaust-pressure state computed at this point (turbo: turbine inlet before the twin-scroll factor), Pa. */
  pExhCyl: number;
  /** The EGT / exhaust-pressure guesses the point was evaluated at (= egtK / pExhCyl at a fixed point). */
  egtIn: number;
  pExhIn: number;
  /** solvePoint: true when the exhaust-state fixed point converged (false = best residual returned). */
  converged?: boolean;
}

function rpmGrid(c: EngineConfig): number[] {
  const start = Math.max(1000, Math.round(c.idleRpm / 50) * 50);
  const span = c.redlineRpm - start;
  const step = Math.min(250, Math.max(100, Math.round(span / 32 / 50) * 50));
  const out: number[] = [];
  for (let r = start; r < c.redlineRpm - step * 0.3; r += step) out.push(r);
  out.push(c.redlineRpm);
  return out;
}

function evalPoint(ctx: PointCtx, rpm: number, egtGuessK: number, pExhGuess: number): PointOut {
  const { c, g } = ctx;
  const fuel = fuelOf(c);
  const sp = meanPistonSpeed(g.stroke, rpm);
  const cyclesPerS = rpm / 120;
  const afrAct = fuel.afr * c.lambda;
  const turbo = c.induction === 'turbo';
  const tExhPort = egtGuessK;
  let lastVe: VeResult | null = null;
  let lastTFresh = T_AMB_K;
  // Turbo exhaust manifold between ports and turbine: friction/dynamic-head loss
  // by manifold type (log manifolds are compact but restrictive at high flow).
  let lastMExh = 0;
  const manifoldLoss = (mExh: number) => (turbo ? CAL.turboManifoldLossFrac * (exhaustBackPressure(c, mExh, tExhPort) - P_AMB_PA) : 0);

  const flowAt1 = (pUp: number, tUp: number, pExhTurb: number, mLoss: number): FlowAt => {
    const pExhCyl = pExhTurb + manifoldLoss(mLoss);
    const tFresh = Math.max(200, tUp + chargeWallHeating(rpm, c.itb, tUp) - ctx.evapVe);
    // VE depends only weakly on the throttle drop (via pe/pi): one evaluation.
    // The ECU's cam choice (VVT phase / variable lift) is made inside the lookup.
    // With a throttle torque-control ceiling (pManCap < ∞) the manifold sits at
    // the ceiling, so the gas exchange sees that intake pressure (back-flow,
    // residual, pumping); Infinity leaves the wide-open lookup unchanged.
    const ve = ctx.breathing.lookup({
      rpm,
      sp,
      tMan: tUp,
      peOverPi: pExhCyl / Math.min(0.98 * pUp, ctx.pManCap),
      tExh: tExhPort,
      valveFloatRpm: ctx.vFloat,
    });
    // SimOptions.calibration.veScale scales the trapped air per unit manifold density.
    const demandPerPa = ((((ve.ve * tUp) / tFresh) * g.vdTotal * cyclesPerS) / (R_AIR * tUp)) * ctx.veScale;
    let pUpEff = pUp;
    if (c.induction === 'na' && c.intakeSystem !== 'open' && CAL.intakeSysZeta > 0) {
      // Production airbox / filter / duct: total-pressure loss ζ·ṁ²/(2ρA²), A = throttle-body area.
      const m0 = demandPerPa * Math.min(solveThrottle(ctx.cdAThrottle, pUp, tUp, demandPerPa), ctx.pManCap);
      const aDuct = (Math.PI / 4) * (c.throttleMm / 1000) ** 2;
      pUpEff = pUp - (CAL.intakeSysZeta * m0 * m0 * R_AIR * tUp) / (2 * pUp * aDuct * aDuct);
    }
    const pManWot = solveThrottle(ctx.cdAThrottle, pUpEff, tUp, demandPerPa);
    const pMan = Math.min(pManWot, ctx.pManCap);
    lastVe = ve;
    lastTFresh = tFresh;
    const mAir = demandPerPa * pMan;
    lastMExh = mAir * (1 + 1 / afrAct);
    return { mAir, mExh: lastMExh, pMan, tExh: turbo ? tExhPort - 40 : tExhPort, pCtl: pManWot };
  };
  // The manifold loss is evaluated at the exhaust flow mAirLoss·(1 + 1/AFR)
  // the caller passes (solveTurbo: the flow implied by its compressor
  // flow-fraction iterate φ, which converges with φ). It was lagged by one
  // flowAt call, which made the result depend on the call history inside
  // solveTurbo (up to ~1e3 Pa at 5800 rpm on the B58), so the exhaust-state
  // fixed point could stall without converging.
  const flowAt = (pUp: number, tUp: number, pExhTurb: number, mAirLoss?: number): FlowAt =>
    flowAt1(pUp, tUp, pExhTurb, turbo ? (mAirLoss ?? lastMExh / (1 + 1 / afrAct)) * (1 + 1 / afrAct) : 0);

  let boost: BoostState | null = null;
  let flow: FlowAt;
  let pExhCyl: number;
  let tCharge = T_AMB_K;
  if (turbo) {
    boost = solveTurbo(c, flowAt, pExhGuess, ctx.hints.turbo, ctx.spool);
    // Re-evaluate at the converged state so lastVe matches.
    flow = flowAt(boost.pUp, boost.tCharge, boost.pExhCyl, boost.flow.mAir);
    pExhCyl = boost.pExhCyl + manifoldLoss(flow.mExh);
    tCharge = boost.tCharge;
  } else if (c.induction === 'supercharger') {
    boost = solveSupercharger(c, rpm, flowAt, (m, t) => exhaustBackPressure(c, m, t), pExhGuess);
    flow = flowAt(boost.pUp, boost.tCharge, boost.pExhCyl);
    pExhCyl = boost.pExhCyl;
    tCharge = boost.tCharge;
  } else {
    const tUp = T_AMB_K + 3; // intake tract pickup
    pExhCyl = pExhGuess;
    flow = flowAt(P_AMB_PA, tUp, pExhCyl);
    pExhCyl = exhaustBackPressure(c, flow.mExh, tExhPort);
    flow = flowAt(P_AMB_PA, tUp, pExhCyl);
    tCharge = tUp;
  }
  const ve = lastVe as unknown as VeResult;
  const pMan = flow.pMan;

  // ── Trapped charge state ──
  // Residual mass fraction from the gas-exchange model (back-pressure,
  // overlap, exhaust-wave scavenging, shared-manifold pulse interference).
  const tRes = Math.max(600, 0.85 * egtGuessK);
  const xr = Math.min(0.3, Math.max(0.01, ve.xr));
  const tIvc = lastTFresh + xr * (tRes - lastTFresh) - (ctx.evapKnock - ctx.evapVe);
  const mAirCyl = flow.mAir / (cyclesPerS * c.cylinders);
  const mTrap = mAirCyl * (1 + 1 / afrAct) / (1 - xr);
  const pBdc = (mTrap * R_AIR * tIvc) / g.vol[0];
  const eStoich = (mAirCyl * fuel.lhv) / fuel.afr; // J per cylinder-cycle
  const q = CAL.pressureHeatFrac * eStoich * Math.min(1, 1 / c.lambda);

  const burn = burnDuration(c, rpm);
  const spark = knockLimitedSpark({ g, rpm, pBdc, tIvc, q, burnDeg: burn, octane: octaneIndex(c, pMan / 1e5), residual: xr }, burn, ctx.hints.spark);
  const eta = indicatedEfficiency(c, rpm, burn);
  // ECU component protection: if the exhaust would exceed the EGT limit at the
  // requested lambda (e.g. under heavy knock retard), the ECU enriches — the
  // excess fuel absorbs heat (vaporisation, cracking). Lambda is solved so that
  // EGT sits at the limit (never leaner than requested, never below 0.7).
  const egtAt = (lam: number) =>
    exhaustTemp({ ...c, lambda: lam }, tIvc, (eta * lambdaPowerFactor(lam) * spark.workRatio * eStoich) / mAirCyl, rpm);
  let lam = c.lambda;
  const egtLimK = CAL.ecuEgtLimitC + 273.15;
  if (CAL.ecuEgtLimitC > 0 && egtAt(lam) > egtLimK) {
    const lamMin = Math.min(c.lambda, CAL.ecuLambdaMin);
    lam = egtAt(lamMin) > egtLimK ? lamMin : illinois((x) => egtAt(x) - egtLimK, lamMin, c.lambda, 20, 1e-5, undefined, undefined, true);
  }
  const lamF = lambdaPowerFactor(lam);
  const wInd = eta * lamF * spark.workRatio * eStoich; // J/cyl-cycle
  const imepBar = wInd / g.vdCyl / 1e5;

  // ── Losses ──
  const fmepMech = mechanicalFmep(c, sp, spark.pMaxBar, rpm) * ctx.fricScale;
  const pmep = CAL.gxPumpingFromCycle ? ve.pmepRel * (pMan / 1e5) : pumpingMep(pExhCyl / 1e5, pMan / 1e5, ve.z, ve.zExh);
  const driveMep = boost && boost.drivePowerW > 0 ? boost.drivePowerW / (g.vdTotal * cyclesPerS) / 1e5 : 0;
  const fmepBar = fmepMech + pmep + driveMep;
  const bmepBar = imepBar - fmepBar;

  const torqueNm = Math.max(0, (bmepBar * 1e5 * g.vdTotal) / (4 * Math.PI));
  const powerKw = (torqueNm * rpm * 2 * Math.PI) / 60 / 1000;
  const fuelKgS = flow.mAir / (fuel.afr * lam);
  const egtK = exhaustTemp(lam === c.lambda ? c : { ...c, lambda: lam }, tIvc, wInd / mAirCyl, rpm);
  // BSFC is meaningless near zero brake power: report 0 (no value) below 1 kW.
  const bsfc = powerKw >= 1 ? (fuelKgS * 3.6e6) / powerKw : 0;
  const bte = fuelKgS > 0 ? Math.min(0.6, (powerKw * 1000) / (fuelKgS * fuel.lhv)) : 0;

  const point: DynoPoint = {
    rpm,
    torqueNm,
    powerKw,
    hp: (powerKw * 1000) / HP_W,
    torqueLbFt: torqueNm * LBFT_PER_NM,
    bmepBar: Math.max(0, bmepBar),
    imepBar,
    fmepBar,
    volumetricEfficiency: flow.mAir / (cyclesPerS * g.vdTotal * (P_AMB_PA / (R_AIR * T_AMB_K))),
    mapBar: pMan / 1e5,
    boostBar: c.induction === 'na' ? 0 : Math.max(0, (pMan - P_AMB_PA) / 1e5),
    airFlowKgS: flow.mAir,
    fuelFlowKgH: fuelKgS * 3600,
    bsfcGkWh: bsfc,
    thermalEfficiency: Math.max(0, bte),
    sparkAdvanceDeg: spark.sparkBtdc,
    knockRetardDeg: spark.retard,
    egtC: egtK - 273.15,
    chargeTempC: tCharge - 273.15,
    meanPistonSpeedMs: sp,
    peakCylinderPressureBar: spark.pMaxBar,
    exhaustPressureBar: pExhCyl / 1e5,
    pmepBar: pmep,
    lambda: lam,
  };
  // Exhaust-pressure state, in the same variable as the pExhGuess argument:
  // turbine-inlet pressure for turbos (before the twin-scroll factor), else exhaust pressure.
  return { point, boost, egtK, pExhCyl: boost ? boost.pExhState : pExhCyl, egtIn: egtGuessK, pExhIn: pExhGuess };
}

/** Fixed-point iteration counts of the last simulate() call (diagnostics / tests). */
export const pointSolveStats = { solves: 0, evals: 0, maxIters: 0, unconverged: 0, maxEgtResK: 0, maxPExhResRel: 0, ecuUnconverged: 0, spoolEvals: 0, spoolCapped: 0, spoolUnconverged: 0 };

/**
 * Self-consistent operating point. evalPoint takes the exhaust state x =
 * (EGT, exhaust pressure) as an input (EGT sets the residual-gas temperature
 * and the turbine-inlet temperature; the pressure sets back-flow, pumping and
 * the turbine pressure ratio) and returns the state G(x) it produces. The
 * operating point is the fixed point x = G(x), solved as F(x) = G(x) − x = 0
 * by Broyden's method in 2-D (pressure scaled by PEXH_SCALE Pa per K). The
 * Jacobian starts from the previous solve's (a nearby operating point), else
 * −I (a plain fixed-point step). The coupling matters: when the turbo is
 * spool-limited, EGT → turbine power → boost → EGT is a positive feedback
 * with loop gain near 1, and back-pressure → engine flow → turbine power is a
 * negative one with gain down to about −4; a plain or per-component
 * iteration stalls, oscillates or diverges there. Steps are capped and kept
 * inside a search box (EGT 400–1600 K, 0.5–30 bar); a step that increases the
 * residual is rejected (the Jacobian still learns from it), and after four
 * rejections in a row the Jacobian restarts from −I. A failed solve returns
 * its lowest-residual evaluation and does not pass its Jacobian on. Converged when the residual is within 2× and the next
 * quasi-Newton step within 1× the tolerances CAL.pointEgtTolK and
 * CAL.pointPExhTolRel · p. Normally 2–3 evaluations from a warm start.
 * The result depends on the warm start (previous rpm / boost iterate) only
 * within those tolerances, ≈ 1e-6 relative in torque.
 */
const PEXH_SCALE = 100;
function solvePoint(ctx: PointCtx, rpm: number, egt0: number, p0: number, tolScale = 1): PointOut {
  const tolE = CAL.pointEgtTolK * tolScale;
  const tolP = CAL.pointPExhTolRel * tolScale;
  // Search box: evalPoint clamps EGT to [450, 1500] K; exhaust state 0.5–30 bar.
  const pMin = (0.5 * P_AMB_PA) / PEXH_SCALE;
  const pMax = 30e5 / PEXH_SCALE;
  const eMin = 400;
  const eMax = 1600;
  const box0 = (e: number) => (Number.isFinite(e) ? Math.min(eMax, Math.max(eMin, e)) : 1050);
  const box1 = (p: number) => (Number.isFinite(p) ? Math.min(pMax, Math.max(pMin, p)) : (1.05 * P_AMB_PA) / PEXH_SCALE);
  let x0 = box0(egt0);
  let x1 = box1(p0 / PEXH_SCALE);
  // Broyden estimate of the Jacobian of F (2×2): the last solve's (a nearby
  // operating point), else −I.
  const jh = ctx.hints.jac;
  let j00 = jh ? jh[0] : -1;
  let j01 = jh ? jh[1] : 0;
  let j10 = jh ? jh[2] : 0;
  let j11 = jh ? jh[3] : -1;
  const resetJ = () => {
    j00 = -1;
    j01 = 0;
    j10 = 0;
    j11 = -1;
  };
  let r = evalPoint(ctx, rpm, x0, x1 * PEXH_SCALE);
  let f0 = r.egtK - x0;
  let f1 = r.pExhCyl / PEXH_SCALE - x1;
  /** Residual normalised by the tolerances (≤ 1 = converged). */
  const norm = (a: number, b: number, p: number) => Math.max(Math.abs(a) / tolE, Math.abs(b) / ((tolP * p) / PEXH_SCALE));
  let n = norm(f0, f1, x1 * PEXH_SCALE);
  let best = r;
  let bestN = n;
  let rejects = 0;
  const bestHist: number[] = [];
  pointSolveStats.solves++;
  for (let it = 1; ; it++) {
    if (n < bestN) {
      bestN = n;
      best = r;
    }
    // Quasi-Newton step J·d = −F. Its length estimates the distance to the
    // fixed point (|F| alone under-states it where the loop gain is near 1).
    let det = j00 * j11 - j01 * j10;
    if (!(Math.abs(det) > 1e-3)) {
      resetJ();
      det = 1;
    }
    let d0 = (-f0 * j11 + f1 * j01) / det;
    let d1 = (-f1 * j00 + f0 * j10) / det;
    const conv = n <= 2 && norm(d0, d1, x1 * PEXH_SCALE) <= 1;
    // Give up early when the best residual has not moved at all (< 1 % in 12
    // evaluations): degenerate points (e.g. zero brake torque on absurd configs)
    // where no fixed point is near; slow but steady progress may use the full cap.
    bestHist.push(bestN);
    const stalled = it >= 16 && bestN > 0.99 * bestHist[it - 13];
    if (conv || stalled || it >= CAL.pointMaxIters) {
      pointSolveStats.evals += it;
      ctx.hints.jac = conv ? [j00, j01, j10, j11] : null;
      const out = conv ? r : best;
      out.converged = conv;
      // Spool-scan points (forced PR) are not operating points: stats for those are kept by spoolCeiling.
      if (ctx.spool?.prForce === undefined) {
        pointSolveStats.maxIters = Math.max(pointSolveStats.maxIters, it);
        if (!conv) pointSolveStats.unconverged++;
        pointSolveStats.maxEgtResK = Math.max(pointSolveStats.maxEgtResK, Math.abs(out.egtK - out.egtIn));
        pointSolveStats.maxPExhResRel = Math.max(pointSolveStats.maxPExhResRel, Math.abs(out.pExhCyl - out.pExhIn) / out.pExhIn);
      }
      return out;
    }
    // Cap the step at 150 K / 30 % of the pressure.
    const cap = Math.max(1, Math.abs(d0) / 150, Math.abs(d1) / (0.3 * x1));
    d0 /= cap;
    d1 /= cap;
    const t0 = box0(x0 + d0);
    const t1 = box1(x1 + d1);
    d0 = t0 - x0;
    d1 = t1 - x1;
    const rt = evalPoint(ctx, rpm, t0, t1 * PEXH_SCALE);
    const g0 = rt.egtK - t0;
    const g1 = rt.pExhCyl / PEXH_SCALE - t1;
    const nt = norm(g0, g1, t1 * PEXH_SCALE);
    // "Good" Broyden update with every evaluation, accepted step or not:
    // J += (ΔF − J·d)·dᵀ / (dᵀd).
    const dd = d0 * d0 + d1 * d1;
    if (dd > 0 && Number.isFinite(nt)) {
      const y0 = g0 - f0 - (j00 * d0 + j01 * d1);
      const y1 = g1 - f1 - (j10 * d0 + j11 * d1);
      j00 += (y0 * d0) / dd;
      j01 += (y0 * d1) / dd;
      j10 += (y1 * d0) / dd;
      j11 += (y1 * d1) / dd;
    }
    if (nt > n && ++rejects > 3) {
      // Repeated rejections: the Jacobian estimate is poor here; restart it from −I
      // (a plain fixed-point step) instead of walking away from the best point.
      rejects = 0;
      resetJ();
    }
    if (nt <= n) {
      // Residual decreased: take the step.
      rejects = 0;
      x0 = t0;
      x1 = t1;
      f0 = g0;
      f1 = g1;
      n = nt;
      r = rt;
    } else if (nt < bestN) {
      bestN = nt;
      best = rt;
    }
  }
}

/**
 * Breathing (gas-exchange) tables cached per configuration. The table is a
 * pure function of the sanitised config and the global calibration CAL; the
 * key is both serialised, minus config fields the breathing model provably
 * never reads (BREATHING_IRRELEVANT; guarded by src/sim/__tests__/breathingCache.test.ts, which
 * perturbs each and checks cached == uncached results). So boost target, ECU
 * limits, intercooler, turbo sizing, throttle, fuel-system and bottom-end
 * edits reuse the table. Small LRU.
 * The table depends on nothing else: in particular no SimOptions field reaches
 * it (calibration.veScale multiplies the looked-up VE, the torque cap acts
 * through the ECU), so options are deliberately not in the key (guarded by
 * the same test). Anything that is ever made to affect the table must be added
 * to breathingKey.
 */
const BREATHING_CACHE = new Map<string, BreathingModel>();
const BREATHING_CACHE_MAX = 12;
let breathingCacheEnabled = true;
/** Config fields the breathing model never reads (top level, and inside `turbo`). */
export const BREATHING_IRRELEVANT = {
  top: ['name', 'ecu', 'throttleMm', 'intakeSystem', 'directInjection', 'blockMaterial', 'pistons', 'rods', 'crank', 'supercharger'] as const,
  turbo: ['targetBoostBar', 'compressorInducerMm', 'turbineAR', 'intercoolerEffectiveness'] as const,
};
/** Test/benchmark hook: disable (and clear) the breathing-table cache. */
export function setBreathingCache(on: boolean): void {
  breathingCacheEnabled = on;
  BREATHING_CACHE.clear();
}
function breathingKey(c: EngineConfig): string {
  const k: Record<string, unknown> = { ...c };
  for (const f of BREATHING_IRRELEVANT.top) delete k[f];
  const t: Record<string, unknown> = { ...c.turbo };
  for (const f of BREATHING_IRRELEVANT.turbo) delete t[f];
  k.turbo = t;
  return JSON.stringify(k) + '\u0000' + JSON.stringify(CAL);
}
function breathingFor(c: EngineConfig, build: () => BreathingModel): BreathingModel {
  if (!breathingCacheEnabled) return build();
  const key = breathingKey(c);
  const hit = BREATHING_CACHE.get(key);
  if (hit) {
    BREATHING_CACHE.delete(key);
    BREATHING_CACHE.set(key, hit);
    return hit;
  }
  const bm = build();
  BREATHING_CACHE.set(key, bm);
  if (BREATHING_CACHE.size > BREATHING_CACHE_MAX) BREATHING_CACHE.delete(BREATHING_CACHE.keys().next().value as string);
  return bm;
}

/**
 * Band that defines peakTorqueRpm / peakPowerRpm on an ECU-limited plateau:
 * the lowest rpm within this many N·m of the peak torque (power: this torque
 * equivalent × ω). 2 × ecuTorqueTolNm (CAL default 0.05), so it spans the
 * limit ± tolerance band every limited point is solved into.
 */
export const PEAK_PLATEAU_BAND_NM = 0.1;

/** SimOptions.calibration, validated: identity (1, 1, no cap) for anything omitted or not finite. */
function calibrationOf(o: SimCalibration | undefined): { veScale: number; fricScale: number; capNm: number } {
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 1);
  const cap = o?.torqueCapNm;
  return {
    veScale: num(o?.veScale, 0.5, 1.5),
    fricScale: num(o?.frictionScale, 0.3, 3),
    capNm: typeof cap === 'number' && Number.isFinite(cap) && cap > 0 ? cap : 0,
  };
}

export function simulate(config: EngineConfig, opts: SimOptions = {}): SimResult {
  const applyOem = opts.applyOemLimits !== false;
  const cal = calibrationOf(opts.calibration);
  for (const k of Object.keys(pointSolveStats) as (keyof typeof pointSolveStats)[]) pointSolveStats[k] = 0;
  const c = sanitize(config);
  const g = computeGeometry(c);
  const lay = computeLayout(c);
  const grid = rpmGrid(c);
  const vFloat = valveFloatRpm(c);
  const ctx: PointCtx = {
    c,
    g,
    breathing: breathingFor(c, () =>
      new BreathingModel(g, c, {
        rpmLo: Math.min(...grid),
        rpmHi: c.redlineRpm,
        exhaustWaveFactor: c.induction === 'turbo' ? (c.turbo.twinScroll ? 0.5 : 0.3) : 1,
        peOverPiAt: (rpm) => {
          // NA: mean exhaust back pressure at a typical trapped flow (VE ≈ 0.95).
          const mExh = 0.95 * RHO_AMB * g.vdTotal * (rpm / 120) * (1 + 1 / (fuelOf(c).afr * c.lambda));
          return exhaustBackPressure(c, mExh, 1100) / (0.97 * P_AMB_PA);
        },
      }),
    ),
    vFloat,
    cdAThrottle: CAL.throttleCd * (Math.PI / 4) * (c.throttleMm / 1000) ** 2,
    evapVe: evapCooling(c, c.directInjection ? 0.22 : 0.1),
    evapKnock: evapCooling(c, c.directInjection ? CAL.evapDi : CAL.evapPfi),
    octane: octaneIndex(c),
    veScale: cal.veScale,
    fricScale: cal.fricScale,
    pManCap: Infinity,
    spool: null,
    hints: { spark: { retard: -1, slope: NaN, pSlope: 0 }, turbo: { pr: NaN, phi: 0.5, slope: NaN }, jac: null },
  };

  const curve: DynoPoint[] = [];
  /** Per curve point: which ECU limit is binding (null = none). */
  const limitedBy: ('torque' | 'power' | null)[] = [];
  let egt = 1050;
  let pExh = P_AMB_PA * 1.05;
  let surgeRpm: number | null = null;
  let chokeRpm: number | null = null;
  let spoolRpm: number | null = null;
  const boosted = c.induction !== 'na';
  const ecu = c.ecu ?? {};
  const limitPresent = boosted && ((ecu.torqueLimitNm ?? 0) > 0 || (ecu.powerLimitKw ?? 0) > 0);
  const torqueLimitNm = boosted && applyOem ? (ecu.torqueLimitNm ?? 0) : 0;
  // Constant torque limit in force: the OEM limit (if applied) and/or the calibration cap, the lower of the two.
  const tqLimNm = torqueLimitNm > 0 && cal.capNm > 0 ? Math.min(torqueLimitNm, cal.capNm) : Math.max(torqueLimitNm, cal.capNm);
  const powerLimitW = boosted && applyOem ? (ecu.powerLimitKw ?? 0) * 1000 : 0;
  const maxRetard = ecu.maxKnockRetardDeg ?? CAL.ecuMaxRetardDeg;
  const sched = c.induction === 'turbo' ? ecu.boostSchedule : undefined;
  const boostTargetAt = (rpm: number): number => {
    if (c.induction !== 'turbo') return c.supercharger.targetBoostBar;
    if (!sched) return c.turbo.targetBoostBar;
    if (rpm <= sched[0].rpm) return sched[0].bar;
    for (let i = 1; i < sched.length; i++)
      if (rpm <= sched[i].rpm) return sched[i - 1].bar + ((rpm - sched[i - 1].rpm) * (sched[i].bar - sched[i - 1].bar)) / Math.max(1e-9, sched[i].rpm - sched[i - 1].rpm);
    return sched[sched.length - 1].bar;
  };
  // Converged operating point at one rpm and boost TARGET (wastegate / bypass
  // set-point). Warm start (only the iteration count depends on it; the point
  // is a fixed point, see solvePoint):
  //  - first solve at an rpm: the first solves of the previous two rpms, extrapolated in rpm;
  //  - second: the first, moved along d(state)/d(target) from the previous rpm;
  //  - later: linear in the target through the two nearest states at this rpm.
  const targets = new WeakMap<PointOut, number>();
  let hist: { t: number; e: number; p: number }[] = [];
  const firsts: { rpm: number; e: number; p: number }[] = [];
  let slope = { e: 0, p: 0 };
  const firstGuess = (rpm: number): [number, number] => {
    const n = firsts.length;
    if (n === 0) return [egt, pExh];
    const v = firsts[n - 1];
    if (n === 1) return [v.e, v.p];
    const u = firsts[n - 2];
    const w = Math.min(1.5, (rpm - v.rpm) / (v.rpm - u.rpm));
    return [v.e + w * (v.e - u.e), Math.max(P_AMB_PA, v.p + w * (v.p - u.p))];
  };
  const solveFirst = (rpm: number, cc: PointCtx): PointOut => {
    const [e0, p0] = firstGuess(rpm);
    const out = solvePoint(cc, rpm, e0, p0);
    firsts.push({ rpm, e: out.egtIn, p: out.pExhIn });
    return out;
  };
  const atBoost = (rpm: number, bar: number): PointOut => {
    const cc: EngineConfig =
      c.induction === 'turbo' ? { ...c, turbo: { ...c.turbo, targetBoostBar: bar } } : { ...c, supercharger: { ...c.supercharger, targetBoostBar: bar } };
    let out: PointOut;
    if (hist.length === 0) out = solveFirst(rpm, { ...ctx, c: cc });
    else {
      let e0: number;
      let p0: number;
      if (hist.length === 1) {
        e0 = hist[0].e + slope.e * (bar - hist[0].t);
        p0 = hist[0].p + slope.p * (bar - hist[0].t);
      } else {
        const [a, b] = [...hist].sort((u, v) => Math.abs(u.t - bar) - Math.abs(v.t - bar));
        const w = Math.abs(b.t - a.t) > 1e-6 ? Math.min(2, Math.max(-1, (bar - a.t) / (b.t - a.t))) : 0;
        e0 = a.e + w * (b.e - a.e);
        p0 = a.p + w * (b.p - a.p);
      }
      out = solvePoint({ ...ctx, c: cc }, rpm, e0, Math.max(0.5 * P_AMB_PA, p0));
    }
    targets.set(out, bar);
    const h = { t: bar, e: out.egtIn, p: out.pExhIn };
    if (hist.length > 0 && Math.abs(bar - hist[0].t) > 1e-3) slope = { e: (h.e - hist[0].e) / (bar - hist[0].t), p: (h.p - hist[0].p) / (bar - hist[0].t) };
    hist.push(h);
    return out;
  };
  const boostTargetOf = (p: PointOut) => targets.get(p) ?? (c.induction === 'turbo' ? c.turbo.targetBoostBar : c.supercharger.targetBoostBar);
  /**
   * Root of a function of one ECU actuator on a bracket, by Illinois (modified
   * regula falsi) with bisection when a step leaves the bracket. Every
   * evaluation is a converged operating point. Needs f(lo) ≤ 0 < f(hi).
   * Stops at the first point with |f| ≤ tol; if the cap is hit returns lo
   * (f ≤ 0: the constraint holds).
   */
  type Pt = { t: number; rr: PointOut; f: number };
  const bracketRoot = (evalT: (t: number) => Pt, lo: Pt, hi: Pt, tol: number, maxIters: number): Pt => {
    let fLo = lo.f;
    let fHi = hi.f;
    let side = 0;
    for (let it = 0; it < maxIters && hi.t - lo.t > 1e-9; it++) {
      let t = (lo.t * fHi - hi.t * fLo) / (fHi - fLo);
      if (!(t > lo.t && t < hi.t)) t = 0.5 * (lo.t + hi.t);
      const p = evalT(t);
      if (Math.abs(p.f) <= tol) return p;
      if (p.f > 0) {
        hi = p;
        fHi = p.f;
        if (side === 1) fLo /= 2;
        side = 1;
      } else {
        lo = p;
        fLo = p.f;
        if (side === -1) fHi /= 2;
        side = -1;
      }
    }
    pointSolveStats.ecuUnconverged++;
    return lo;
  };
  /**
   * ECU torque management at one rpm point: find the boost TARGET t (the
   * wastegate / bypass set-point, the one variable the ECU actually commands)
   * at which brake torque meets the limit. F(t) = torque(t) − limit is solved
   * on a bracket [lo, hi] with F(lo) ≤ 0 < F(hi):
   *  - hi starts at the current target (F > 0 by the caller's test);
   *  - lo is searched for with the ECU's torque model (indicated torque ∝ air
   *    charge, minus friction → required achieved boost → target), then a
   *    secant through the two lowest over-limit points aimed just below the
   *    limit; after 4 such tries t = 0 (wastegate / bypass fully open);
   *  - then Illinois (bracketRoot).
   * Stops at the first point with |F| ≤ ecuTorqueSolveTolNm. If the iteration
   * cap is hit, returns lo (F ≤ 0). So a limited point always has torque ≤
   * limit + ecuTorqueSolveTolNm (inside the guaranteed ecuTorqueTolNm), except
   * when even t = 0 is above the limit (limit below the unboosted torque: a
   * real ECU would then pull throttle/spark, which is not modelled); then the
   * t = 0 point is returned.
   */
  /** d torque / d target at the last torque-limited rpm (N·m/bar; 0 = unknown). */
  let tqSlope = 0;
  const limitTorque = (rpm: number, limit: number, hi0: Pt, lo0: Pt | null): PointOut => {
    const tol = CAL.ecuTorqueSolveTolNm;
    const evalT = (t: number): Pt => {
      const rr = atBoost(rpm, t);
      return { t, rr, f: rr.point.torqueNm - limit };
    };
    let hi = hi0;
    let prevHi: Pt | null = null;
    let lo = lo0;
    let it = 0;
    for (let tries = 0; !lo && it < CAL.ecuTorqueMaxIters; it++) {
      // Bracketing phase: every iterate so far is above the limit.
      let t: number;
      if (tries < 4 && hi.t > 0) {
        t = NaN;
        // Secant through the last two over-limit points (first try: with the
        // slope of the previous rpm), aimed at −tol/2 so it lands in the band or
        // just below it.
        if (prevHi && prevHi.t > hi.t && prevHi.f > hi.f) t = hi.t - ((hi.f + 0.5 * tol) * (prevHi.t - hi.t)) / (prevHi.f - hi.f);
        else if (tries === 0 && tqSlope > 0) t = hi.t - (hi.f + 0.5 * tol) / tqSlope;
        if (!(t >= 0 && t < hi.t)) {
          // ECU torque model from the hi point: required achieved boost, converted
          // to a target with the observed target−achieved offset (capped: a
          // spool-limited point's offset says nothing about where the target bites).
          // (The torque model alone under-steps: retard falls as boost falls, so
          // torque falls less than proportionally.)
          const p = hi.rr.point;
          const tFric = (p.fmepBar * 1e5 * g.vdTotal) / (4 * Math.PI);
          const bReq = Math.max(0, p.mapBar * ((limit + tFric) / (p.torqueNm + tFric)) - P_AMB_PA / 1e5);
          t = Math.min(hi.t, bReq + Math.min(0.05, Math.max(0, hi.t - p.boostBar)));
          if (!(t < hi.t)) t = 0.5 * hi.t;
        }
        tries++;
      } else if (hi.t > 0) t = 0;
      else break;
      const p = evalT(t);
      if (Math.abs(p.f) <= tol) return p.rr;
      if (p.f > 0) {
        prevHi = hi;
        hi = p;
      } else lo = p;
    }
    if (!lo) return hi.rr;
    if (hi.t > lo.t) tqSlope = (hi.f - lo.f) / (hi.t - lo.t);
    return bracketRoot(evalT, lo, hi, tol, CAL.ecuTorqueMaxIters - it).rr;
  };
  /**
   * ECU throttle torque control: where the torque limit cannot be met by the
   * boost target (NA engines with a calibration torque cap; boosted engines
   * whose limit is below the torque at zero boost), the ECU closes the
   * throttle. The actuator is the manifold-pressure ceiling pManCap (a
   * drive-by-wire ECU commands an air charge, i.e. MAP): torque(pManCap) =
   * limit, bracketed below the wide-open MAP, Illinois to ecuTorqueSolveTolNm
   * on converged operating points (as limitTorque). Returns the lower bracket
   * end (torque ≤ limit) if the cap is hit.
   */
  const limitThrottle = (rpm: number, limit: number, r0: PointOut): PointOut => {
    const tol = CAL.ecuTorqueSolveTolNm;
    const bar = boostTargetOf(r0);
    const cc: EngineConfig =
      c.induction === 'turbo'
        ? { ...c, turbo: { ...c.turbo, targetBoostBar: bar } }
        : c.induction === 'supercharger'
          ? { ...c, supercharger: { ...c.supercharger, targetBoostBar: bar } }
          : c;
    let warm = r0;
    const evalP = (pm: number): Pt => {
      const rr = solvePoint({ ...ctx, c: cc, pManCap: pm }, rpm, warm.egtIn, warm.pExhIn);
      warm = rr;
      return { t: pm, rr, f: rr.point.torqueNm - limit };
    };
    const pLo = 0.05 * P_AMB_PA;
    let hi: Pt = { t: r0.point.mapBar * 1e5, rr: r0, f: r0.point.torqueNm - limit };
    let prevHi: Pt | null = null;
    let lo: Pt | null = null;
    let it = 0;
    for (; !lo && it < 8; it++) {
      // Secant through the last two over-limit points, else the ECU torque model
      // (air charge ∝ torque + friction torque), aimed just below the limit.
      let t = NaN;
      if (prevHi && prevHi.t > hi.t && prevHi.f > hi.f) t = hi.t - ((hi.f + 0.5 * tol) * (prevHi.t - hi.t)) / (prevHi.f - hi.f);
      if (!(t > pLo && t < hi.t)) {
        const p = hi.rr.point;
        const tFric = (p.fmepBar * 1e5 * g.vdTotal) / (4 * Math.PI);
        t = hi.t * ((limit + tFric) / (p.torqueNm + tFric));
      }
      if (!(t < hi.t)) t = 0.5 * hi.t;
      t = it >= 6 ? pLo : Math.max(pLo, t);
      const q = evalP(t);
      if (Math.abs(q.f) <= tol) return q.rr;
      if (q.f > 0) {
        prevHi = hi;
        hi = q;
        if (t <= pLo) break;
      } else lo = q;
    }
    if (!lo) return hi.rr;
    return bracketRoot(evalP, lo, hi, tol, CAL.ecuTorqueMaxIters).rr;
  };
  /**
   * Spool branch (turbo). With the wastegate shut, turbine power and
   * compressor power both depend on the compressor PR through the engine
   * flow, back-pressure and EGT; their coupled balance m(PR) = (P_t − P_c)/P_c,
   * each point a converged exhaust-state fixed point at that PR, can have
   * several roots at low rpm (positive spool feedback through VE and EGT). A
   * turbo spooling up from rest at WOT accelerates while m > 0 and stops at
   * the LOWEST root, unless the boost target (wastegate opens), the speed line
   * or the exhaust-pressure limit stops it first. That root does not depend on
   * the boost target (the gate is shut below it), so it is found once per rpm
   * and imposed on every operating point at that rpm as a PR cap (SpoolControl.prCap).
   * Without it the per-point solve picks a root at the FROZEN exhaust state of
   * each iterate, which is discontinuous in that state near a fold of m: the
   * fixed point then fails to converge or lands on either branch depending on
   * the warm start (B58 at 1000 rpm with VE ×1.05: 30 unconverged solves).
   *
   * Scan: m at PR = SPOOL_GRID^k (fixed grid, so the result does not depend on
   * the warm start), k = 1, 2, …, until m ≤ 0 (root bracketed → Illinois), the
   * scheduled target is reached, the speed line is passed or PR exceeds the
   * solver's ceiling. Dips between grid nodes: at every sampled local minimum
   * of m below SPOOL_DIP, m is minimised by golden section; a negative minimum
   * brackets the lowest root on its left. Returns Infinity when no root exists
   * below the target (the common case) and the minimum sampled margin, which
   * gates the scan off for the rest of the curve once it is large.
   */
  const SPOOL_GRID = 1.08;
  const SPOOL_DIP = 0.12;
  const SPOOL_SAFE = 0.5;
  /** PR up to which m > 0 is established at a lower rpm (m rises with rpm at fixed PR), and the scan's warm state. */
  let spoolOk = 1;
  let spoolWarm: [number, number] | null = null;
  /** Lowest sampled m of the last scan that found no root. */
  let spoolMinM = -Infinity;
  const spoolHints: PointHints = { spark: { retard: -1, slope: NaN, pSlope: 0 }, turbo: { pr: NaN, phi: 0.5, slope: NaN }, jac: null };
  const spoolCeiling = (rpm: number, tgt: number): number => {
    const sctx: PointCtx = { ...ctx, c: { ...c, turbo: { ...c.turbo, targetBoostBar: tgt } }, spool: { prForce: 1 }, hints: spoolHints };
    const pT = P_AMB_PA + tgt * 1e5;
    const prTop = Math.max(1.0001, (pT / P_AMB_PA) * 1.35);
    let [e, p] = spoolWarm ?? firstGuess(rpm);
    type S = { pr: number; m: number; o: PointOut };
    // tolScale < 1 for the root refinement: m carries the fixed-point
    // tolerance as noise (∂m/∂EGT ≈ 1/EGT, so 0.01 K → 1e-5 in m), which the
    // root would turn into PR noise of order 1e-5 / (∂m/∂PR).
    const at = (pr: number, tolScale = 1): S => {
      sctx.spool = { prForce: pr };
      const o = solvePoint(sctx, rpm, e, p, tolScale);
      if (o.converged) {
        e = o.egtIn;
        p = o.pExhIn;
      } else pointSolveStats.spoolUnconverged++; // the scan then stops (spoolCeiling returns NaN)
      pointSolveStats.spoolEvals++;
      return { pr, m: o.boost?.spoolMargin ?? 1, o };
    };
    const rootIn = (lo: S, hi: S): number => illinois((x) => at(x, 0.01).m, lo.pr, hi.pr, 40, 1e-9, lo.m, hi.m, false, 1e-8);
    const smp: S[] = [];
    // Grid nodes strictly above spoolOk (a fixed grid: the result does not depend on warm starts).
    for (let k = Math.floor(Math.log(spoolOk) / Math.log(SPOOL_GRID) + 1e-9) + 1; ; k++) {
      const s = at(Math.min(prTop, SPOOL_GRID ** k));
      if (!s.o.converged) return NaN; // no margin information: leave the per-point turbine term in charge
      if (s.m <= 0) {
        const lo = smp.length ? smp[smp.length - 1] : at(spoolOk);
        if (lo.m <= 0 || !lo.o.converged) return spoolOk; // root at the established bound itself (or no information below)
        return rootIn(lo, s);
      }
      smp.push(s);
      spoolWarm = [e, p];
      const pc = s.o.boost?.flow.pCtl ?? s.o.boost?.flow.pMan ?? 0;
      if (pc >= pT || (s.o.boost?.speedMargin ?? 1) < 0 || s.pr >= prTop) break;
    }
    // Narrow dips between grid nodes: minimise m (golden section) around every
    // sampled interior local minimum below SPOOL_DIP.
    for (let i = 1; i < smp.length - 1; i++) {
      if (!(smp[i].m < SPOOL_DIP && smp[i].m <= smp[i - 1].m && smp[i].m <= smp[i + 1].m)) continue;
      const g = (Math.sqrt(5) - 1) / 2;
      let a = smp[i - 1];
      let b = smp[i + 1];
      let x1 = at(b.pr - g * (b.pr - a.pr));
      let x2 = at(a.pr + g * (b.pr - a.pr));
      for (let it = 0; it < 30 && b.pr - a.pr > 1e-5 * b.pr && Math.min(x1.m, x2.m) > 0; it++) {
        if (x1.m < x2.m) {
          b = x2;
          x2 = x1;
          x1 = at(b.pr - g * (b.pr - a.pr));
        } else {
          a = x1;
          x1 = x2;
          x2 = at(a.pr + g * (b.pr - a.pr));
        }
      }
      const lo = x1.m < x2.m ? x1 : x2;
      if (lo.m <= 0) return rootIn(smp[i - 1], lo);
    }
    if (smp.length) spoolOk = Math.max(spoolOk, smp[smp.length - 1].pr);
    spoolMinM = Math.min(...smp.map((x) => x.m));
    return Infinity;
  };
  /** Torque-limited boost targets of the previous rpm points (warm start). */
  const limT: { rpm: number; t: number }[] = [];
  let knockSens = 0.03;
  let shortfall: { ratio: number; rpm: number; reason: string; reachedAnywhere: boolean } | null = null;
  let spoolScan = c.induction === 'turbo';
  const unconverged: NonNullable<SimResult['solverUnconverged']> = [];
  for (const rpm of grid) {
    hist = [];
    const ecuUnc0 = pointSolveStats.ecuUnconverged;
    if (!spoolScan) ctx.spool = null;
    else {
      spoolMinM = -Infinity;
      const cap = spoolCeiling(rpm, boostTargetAt(rpm));
      ctx.spool = cap === cap ? { prCap: cap } : null;
      if (cap < Infinity) {
        pointSolveStats.spoolCapped++;
        spoolOk = Math.max(spoolOk, cap);
      } else if (spoolMinM >= SPOOL_SAFE) spoolScan = false;
    }
    // Each operating point is a converged fixed point in EGT / exhaust
    // pressure (solvePoint); the previous rpm's state is only the warm start.
    const tgt0 = c.induction === 'turbo' ? boostTargetAt(rpm) : c.supercharger.targetBoostBar;
    // Effective ECU torque limit at this rpm: torque limit and/or rated-power limit (P/ω).
    const tqFromPower = powerLimitW > 0 ? powerLimitW / ((rpm * 2 * Math.PI) / 60) : 0;
    const torqueLimit = tqLimNm > 0 && tqFromPower > 0 ? Math.min(tqLimNm, tqFromPower) : Math.max(tqLimNm, tqFromPower);
    // Warm start for the torque limit: the limited target of the previous rpm
    // points, extrapolated. Torque rises with the target, so if the point at
    // that prediction is already above the limit, the limit binds at the
    // scheduled target too and the solve can start from it (one operating
    // point fewer); otherwise the scheduled target is evaluated as usual.
    let r: PointOut;
    let limited = false;
    const nl = limT.length;
    const grid1 = grid.indexOf(rpm) - 1;
    let tPred = NaN;
    if (boosted && torqueLimit > 0 && nl > 0 && limT[nl - 1].rpm === grid[grid1]) {
      const v = limT[nl - 1];
      tPred = v.t;
      if (nl > 1 && limT[nl - 2].rpm === grid[grid1 - 1]) {
        const u = limT[nl - 2];
        tPred = v.t + ((v.t - u.t) * (rpm - v.rpm)) / (v.rpm - u.rpm);
      }
      if (!(tPred > 0 && tPred < tgt0 - 1e-6)) tPred = NaN;
    }
    if (tPred === tPred) {
      const rp = atBoost(rpm, tPred);
      const pp: Pt = { t: tPred, rr: rp, f: rp.point.torqueNm - torqueLimit };
      if (pp.f > 0 && rp.point.boostBar > 0.01) {
        r = limitTorque(rpm, torqueLimit, pp, null);
        limited = true;
      } else {
        r = atBoost(rpm, tgt0);
        if (r.point.torqueNm > torqueLimit && r.point.boostBar > 0.01) {
          const hiP: Pt = { t: tgt0, rr: r, f: r.point.torqueNm - torqueLimit };
          r = Math.abs(pp.f) <= CAL.ecuTorqueSolveTolNm ? rp : limitTorque(rpm, torqueLimit, hiP, pp);
          limited = true;
        }
      }
    } else r = boosted ? atBoost(rpm, tgt0) : solveFirst(rpm, ctx);
    // ── ECU at WOT (boosted engines) ──
    // The ECU's boost target is the lowest of: the schedule, the torque
    // limit, the knock-aware trim and component protection. Each is solved
    // on converged operating points (one function of the target), and each
    // step can only lower the target from the previous one, so a constraint
    // already met stays met (torque rises with boost). The torque limit
    // therefore needs no re-application after steps 2–3.
    if (boosted) {
      // 1) Torque management ("torque structure"): the ECU converts the torque
      //    limit into a required air charge, using its torque model (indicated
      //    torque ∝ air charge at the current spark efficiency, minus friction),
      //    and lowers the boost target to it (limitTorque: bracketed solve on the target).
      if (!limited && torqueLimit > 0 && r.point.torqueNm > torqueLimit && r.point.boostBar > 0.01) {
        r = limitTorque(rpm, torqueLimit, { t: boostTargetOf(r), rr: r, f: r.point.torqueNm - torqueLimit }, null);
        limited = true;
      }
      if (limited) {
        if (r.boost) r.boost.limit = 'torque';
        limT.push({ rpm, t: boostTargetOf(r) });
      }
      // 2) Knock-aware boost control: when holding the target would need more
      //    than the accepted retard, the boost target is lowered until the
      //    retard is back at that limit. The trim is partial (a torque-based
      //    ECU balances retard against boost): the accepted retard still rises
      //    slowly with knock severity. Solved to |retard − accepted| ≤
      //    ecuKnockTolDeg (bracketed Illinois on the boost scale), so the trim
      //    is a continuous function of every input (no stop-width stair-steps).
      if (r.point.knockRetardDeg > maxRetard && r.point.boostBar > 0.05) {
        const bA0 = r.point.boostBar;
        // Turbo: scale the achieved boost (a target above it would not bite when spool-limited).
        const tgtA = c.induction === 'turbo' ? bA0 : boostTargetOf(r);
        const k0 = r.point.knockRetardDeg;
        // Accepted retard: rises softly with knock severity, but never more than
        // ecuRetardSoftCapDeg above the nominal limit.
        const lim = maxRetard + CAL.ecuRetardSoftCapDeg * Math.tanh((CAL.ecuRetardSoft * (k0 - maxRetard)) / CAL.ecuRetardSoftCapDeg);
        // Boost scale x ∈ [xMin, 1]: retard is monotone in boost but saturates at
        // the retard limit, so the root is bracketed before Illinois.
        const xMin = 0.02;
        const evalX = (x: number): Pt => {
          const rr = atBoost(rpm, tgtA * x);
          return { t: x, rr, f: rr.point.knockRetardDeg - lim };
        };
        const tolK = CAL.ecuKnockTolDeg;
        let hi: Pt = { t: 1, rr: r, f: k0 - lim };
        let lo: Pt | null = null;
        let res: Pt | null = null;
        // First guess from the previous rpm's retard-per-boost sensitivity (affects the iteration count only).
        const cur = evalX(Math.min(0.999, Math.max(0.3, 1 - (k0 - lim) * knockSens)));
        if (Math.abs(cur.f) <= tolK) res = cur;
        else if (cur.f > 0) hi = cur;
        else lo = cur;
        if (!res && !lo) {
          lo = evalX(xMin);
          if (lo.f > 0) res = lo; // knock-limited even with no boost: run at minimum boost
        }
        if (!res) res = bracketRoot(evalX, lo as Pt, hi, tolK, CAL.ecuKnockMaxIters);
        const rB = res.rr;
        const kB = rB.point.knockRetardDeg;
        if (k0 - kB > 0.5) knockSens = Math.min(0.2, Math.max(0.005, (1 - rB.point.boostBar / bA0) / (k0 - kB)));
        r = rB;
        if (r.boost) r.boost.limit = 'knock';
      }
    }
    // 3) Component protection (boosted): even at the richest allowed mixture and the
    //    accepted retard, the ECU cuts boost when EGT would exceed the turbine /
    //    exhaust-valve limit or peak cylinder pressure the absolute ceiling.
    //    Bracketed Illinois on the boost scale to |excess| ≤ ecuProtectTol
    //    (continuous in the inputs; was a 9-step bisection, a staircase of 1/512 steps).
    if (boosted && r.point.boostBar > 0.05) {
      const excess = (pt: DynoPoint) =>
        Math.max((pt.egtC - CAL.ecuEgtMaxC) / 100, (pt.peakCylinderPressureBar - CAL.ecuPmaxCapBar) / 100);
      if (excess(r.point) > 0) {
        const tgtP = c.induction === 'turbo' ? r.point.boostBar : boostTargetOf(r);
        const evalX = (x: number): Pt => {
          const rr = atBoost(rpm, tgtP * x);
          return { t: x, rr, f: excess(rr.point) };
        };
        const lo = evalX(0.02);
        r = lo.f > 0 ? lo.rr : bracketRoot(evalX, lo, { t: 1, rr: r, f: excess(r.point) }, CAL.ecuProtectTol, CAL.ecuProtectMaxIters).rr;
        if (r.boost) r.boost.limit = 'protection';
      }
    }
    // 4) Throttle torque control: a torque limit the boost target cannot meet
    //    (NA engine with a calibration torque cap, or boost already at zero).
    let thrLimited = false;
    if (torqueLimit > 0 && r.point.torqueNm > torqueLimit + CAL.ecuTorqueSolveTolNm) {
      r = limitThrottle(rpm, torqueLimit, r);
      thrLimited = true;
      if (r.boost) r.boost.limit = 'torque';
    }
    egt = r.egtK;
    pExh = r.pExhCyl;
    // Flag, never hide, a point whose solve did not converge.
    if (r.converged === false) unconverged.push({ rpm, kind: 'operating-point', egtResidualK: r.egtK - r.egtIn, pExhResidualRel: (r.pExhCyl - r.pExhIn) / r.pExhIn });
    else if (pointSolveStats.ecuUnconverged > ecuUnc0) unconverged.push({ rpm, kind: 'ecu' });
    curve.push(r.point);
    limitedBy.push(thrLimited || r.boost?.limit === 'torque' ? (tqLimNm > 0 && torqueLimit === tqLimNm ? 'torque' : 'power') : null);
    const b = r.boost;
    if (b && c.induction === 'turbo' && b.limit !== 'torque' && rpm >= 0.5 * c.redlineRpm && boostTargetAt(rpm) > 0.05) {
      const ratio = r.point.boostBar / boostTargetAt(rpm);
      if (!shortfall || ratio < shortfall.ratio) shortfall = { ratio, rpm, reason: b.limit, reachedAnywhere: false };
    }
    if (b && c.induction === 'turbo') {
      if (b.surge) surgeRpm = rpm;
      if (b.choke && chokeRpm === null) chokeRpm = rpm;
      if (spoolRpm === null && (b.limit === 'torque' || r.point.boostBar >= boostTargetAt(rpm) * 0.95)) spoolRpm = rpm;
    }
  }

  const pk = curve.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
  const tq = curve.reduce((a, b) => (b.torqueNm > a.torqueNm ? b : a));
  // Peak rpm on an ECU-limited plateau / power band. There every point sits at
  // the limit ± the solver tolerance, so the argmax is decided by sub-0.01 %
  // noise. OEMs quote such a peak as a range ("450 N·m @ 1380–5000 rpm"), whose
  // single-number form is its start ("from 1380 rpm"). So: if any point within
  // PEAK_PLATEAU_BAND_NM of the peak torque is held by the torque limit,
  // peakTorqueRpm = the LOWEST rpm within that band; likewise peakPowerRpm for
  // the power limit (band × ω in power). Otherwise (NA, unlimited, or a peak
  // the hardware sets) it is the plain argmax, unchanged.
  const band = PEAK_PLATEAU_BAND_NM;
  const omega = (rpm: number) => (rpm * 2 * Math.PI) / 60;
  const inTq = (i: number) => curve[i].torqueNm >= tq.torqueNm - band;
  const inPk = (i: number) => (pk.powerKw - curve[i].powerKw) * 1000 <= band * omega(curve[i].rpm);
  const plateau = (inBand: (i: number) => boolean, kind: 'torque' | 'power', argmaxRpm: number): [number, number] => {
    if (!curve.some((_, i) => inBand(i) && limitedBy[i] === kind)) return [argmaxRpm, argmaxRpm];
    const idx = curve.map((_, i) => i).filter(inBand);
    return [curve[idx[0]].rpm, curve[idx[idx.length - 1]].rpm];
  };
  const tqRange = plateau(inTq, 'torque', tq.rpm);
  const pkRange = plateau(inPk, 'power', pk.rpm);
  const tqRpm = tqRange[0];
  const pkRpm = pkRange[0];
  const dispL = g.vdTotal * 1000;
  const massKg = estimateMassKg(c);
  const mechLimit = mechanicalLimitRpm(c, g);
  const spRed = meanPistonSpeed(g.stroke, c.redlineRpm);
  const { warnings, reliabilityScore } = computeWarnings({
    c,
    curve,
    meanPistonSpeedRedline: spRed,
    valveFloatRpm: vFloat,
    mechanicalLimitRpm: mechLimit,
    surgeRpm,
    chokeRpm,
    spoolRpm: c.induction === 'turbo' ? spoolRpm ?? c.redlineRpm : null,
    boostShortfall: shortfall
      ? { ...shortfall, reachedAnywhere: Math.max(...curve.map((p) => p.boostBar)) >= 0.8 * c.turbo.targetBoostBar }
      : null,
  });
  if (unconverged.length)
    warnings.push({
      severity: 'warn',
      code: 'solver-unconverged',
      message: `The operating-point solve did not converge at ${unconverged.map((u) => u.rpm).join(', ')} rpm (${unconverged.some((u) => u.kind === 'operating-point') ? 'exhaust-state fixed point' : 'ECU target solve stopped at its iteration cap; the constraint holds'}). Those points are the best iterate found and are less accurate than the rest of the curve.`,
    });

  return {
    config,
    curve,
    oemLimits: {
      applied: limitPresent && applyOem,
      present: limitPresent,
      torqueLimitNm: ecu.torqueLimitNm,
      powerLimitKw: ecu.powerLimitKw,
      source: limitPresent ? ecu.limitSource ?? 'hardware' : undefined,
    },
    // Unlimited: no OEM limit and no calibration torque cap (the VE / friction scales stay).
    unlimited: opts.includeUnlimited
      ? (limitPresent && applyOem) || cal.capNm > 0
        ? simulate(config, { applyOemLimits: false, calibration: opts.calibration && { ...opts.calibration, torqueCapNm: undefined } }).curve
        : curve
      : undefined,
    displacementCc: dispL * 1000,
    displacementL: dispL,
    cylinderCc: g.vdCyl * 1e6,
    boreStrokeRatio: c.boreMm / c.strokeMm,
    rodStrokeRatio: c.rodLengthMm / c.strokeMm,
    peakPowerKw: pk.powerKw,
    peakHp: pk.hp,
    peakPowerRpm: pkRpm,
    peakTorqueNm: tq.torqueNm,
    peakTorqueLbFt: tq.torqueLbFt,
    peakTorqueRpm: tqRpm,
    peakTorqueRpmRange: tqRange,
    peakPowerRpmRange: pkRange,
    specificOutputHpL: pk.hp / dispL,
    meanPistonSpeedRedlineMs: spRed,
    maxPistonAccelRedline: maxPistonAccel(g, c.redlineRpm),
    valveFloatRpm: vFloat,
    mechanicalLimitRpm: mechLimit,
    massKg,
    hpPerKg: pk.hp / massKg,
    firingOrder: lay.firingOrder.join('-'),
    evenFiring: lay.evenFiring,
    balance: computeBalance(c, lay),
    reliabilityScore,
    warnings,
    ...(unconverged.length ? { solverUnconverged: unconverged } : {}),
    uncertainty: computeUncertainty(c, curve, pkRpm, tqRpm, tqRange),
  };
}
