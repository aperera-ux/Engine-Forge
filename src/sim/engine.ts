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
import type { DynoPoint, EngineConfig, SimOptions, SimResult } from './types';
import { computeLayout } from './layout';
import { CAL, HP_W, LBFT_PER_NM, P_AMB_PA, R_AIR, RHO_AMB, T_AMB_K } from './model/constants';
import { computeGeometry, maxPistonAccel, meanPistonSpeed, sanitize, type Geometry } from './model/geometry';
import { BreathingModel, chargeWallHeating, exhaustBackPressure, solveThrottle, type VeResult } from './model/airflow';
import { solveSupercharger, solveTurbo, type BoostState, type FlowAt } from './model/boost';
import {
  burnDuration,
  evapCooling,
  exhaustTemp,
  fuelOf,
  indicatedEfficiency,
  knockLimitedSpark,
  lambdaPowerFactor,
  octaneIndex,
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
}

interface PointOut {
  point: DynoPoint;
  boost: BoostState | null;
  egtK: number;
  pExhCyl: number;
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

  const flowAt = (pUp: number, tUp: number, pExhTurb: number): FlowAt => {
    const pExhCyl = pExhTurb + manifoldLoss(lastMExh);
    const tFresh = Math.max(200, tUp + chargeWallHeating(rpm, c.itb, tUp) - ctx.evapVe);
    // VE depends only weakly on the throttle drop (via pe/pi): one evaluation.
    // The ECU's cam choice (VVT phase / variable lift) is made inside the lookup.
    const ve = ctx.breathing.lookup({
      rpm,
      sp,
      tMan: tUp,
      peOverPi: pExhCyl / (0.98 * pUp),
      tExh: tExhPort,
      valveFloatRpm: ctx.vFloat,
    });
    const demandPerPa = (((ve.ve * tUp) / tFresh) * g.vdTotal * cyclesPerS) / (R_AIR * tUp);
    let pUpEff = pUp;
    if (c.induction === 'na' && c.intakeSystem !== 'open' && CAL.intakeSysZeta > 0) {
      // Production airbox / filter / duct: total-pressure loss ζ·ṁ²/(2ρA²), A = throttle-body area.
      const m0 = demandPerPa * solveThrottle(ctx.cdAThrottle, pUp, tUp, demandPerPa);
      const aDuct = (Math.PI / 4) * (c.throttleMm / 1000) ** 2;
      pUpEff = pUp - (CAL.intakeSysZeta * m0 * m0 * R_AIR * tUp) / (2 * pUp * aDuct * aDuct);
    }
    const pMan = solveThrottle(ctx.cdAThrottle, pUpEff, tUp, demandPerPa);
    lastVe = ve;
    lastTFresh = tFresh;
    const mAir = demandPerPa * pMan;
    lastMExh = mAir * (1 + 1 / afrAct);
    return { mAir, mExh: lastMExh, pMan, tExh: turbo ? tExhPort - 40 : tExhPort };
  };

  let boost: BoostState | null = null;
  let flow: FlowAt;
  let pExhCyl: number;
  let tCharge = T_AMB_K;
  if (turbo) {
    boost = solveTurbo(c, flowAt, pExhGuess);
    // Re-evaluate at the converged state so lastVe matches.
    flow = flowAt(boost.pUp, boost.tCharge, boost.pExhCyl);
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
  const spark = knockLimitedSpark({ g, rpm, pBdc, tIvc, q, burnDeg: burn, octane: octaneIndex(c, pMan / 1e5), residual: xr }, burn);
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
  const fmepMech = mechanicalFmep(c, sp, spark.pMaxBar, rpm);
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
  // Warm start for the next rpm: turbine-inlet pressure for turbos, else exhaust pressure.
  return { point, boost, egtK, pExhCyl: boost && turbo ? boost.pExhCyl : pExhCyl };
}

/**
 * Breathing (gas-exchange) tables cached per configuration. The table is a
 * pure function of the sanitised config and the global calibration CAL; the
 * key is both serialised, minus config fields the breathing model provably
 * never reads (BREATHING_IRRELEVANT; guarded by src/sim/__tests__/breathingCache.test.ts, which
 * perturbs each and checks cached == uncached results). So boost target, ECU
 * limits, intercooler, turbo sizing, throttle, fuel-system and bottom-end
 * edits reuse the table. Small LRU.
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

export function simulate(config: EngineConfig, opts: SimOptions = {}): SimResult {
  const applyOem = opts.applyOemLimits !== false;
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
  // Re-evaluate one rpm point at a different boost target (wastegate / bypass valve).
  const targets = new WeakMap<PointOut, number>();
  const atBoost = (rpm: number, bar: number, from: PointOut): PointOut => {
    const cc: EngineConfig =
      c.induction === 'turbo' ? { ...c, turbo: { ...c.turbo, targetBoostBar: bar } } : { ...c, supercharger: { ...c.supercharger, targetBoostBar: bar } };
    const out = evalPoint({ ...ctx, c: cc }, rpm, from.egtK, from.pExhCyl);
    targets.set(out, bar);
    return out;
  };
  const boostTargetOf = (p: PointOut) => targets.get(p) ?? (c.induction === 'turbo' ? c.turbo.targetBoostBar : c.supercharger.targetBoostBar);
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
   *  - then Illinois (modified regula falsi), bisection if a step leaves the
   *    bracket.
   * Stops at the first point with |F| ≤ ecuTorqueTolNm. If the iteration cap is
   * hit, returns lo (F ≤ 0). So a limited point always has torque ≤ limit + tol,
   * except when even t = 0 is above the limit (limit below the unboosted torque:
   * a real ECU would then pull throttle/spark, which is not modelled); then the
   * t = 0 point is returned.
   * Every step is a function of evaluated (target, torque) pairs only, so the
   * result is a piecewise-smooth function of the inputs; it can jump by at most
   * the tolerance where the iterate that first enters the band changes.
   */
  const limitTorque = (rpm: number, r0: PointOut, limit: number): PointOut => {
    const tol = CAL.ecuTorqueTolNm;
    type P = { t: number; rr: PointOut; f: number };
    const evalT = (t: number): P => {
      const rr = atBoost(rpm, t, r0);
      return { t, rr, f: rr.point.torqueNm - limit };
    };
    let hi: P = { t: boostTargetOf(r0), rr: r0, f: r0.point.torqueNm - limit };
    let prevHi: P | null = null;
    let lo: P | null = null;
    let fLo = 0;
    let fHi = hi.f;
    let side = 0;
    for (let it = 0, tries = 0; it < CAL.ecuTorqueMaxIters; it++) {
      let t: number;
      if (!lo) {
        // Bracketing phase: every iterate so far is above the limit.
        if (tries < 4 && hi.t > 0) {
          t = NaN;
          // Secant through the last two over-limit points, aimed at −tol/2 so it
          // lands in the band or just below it (the torque model alone under-steps:
          // retard falls as boost falls, so torque falls less than proportionally).
          if (prevHi && prevHi.t > hi.t && prevHi.f > hi.f) t = hi.t - ((hi.f + 0.5 * tol) * (prevHi.t - hi.t)) / (prevHi.f - hi.f);
          if (!(t >= 0 && t < hi.t)) {
            // ECU torque model from the hi point: required achieved boost, converted
            // to a target with the observed target−achieved offset (capped: a
            // spool-limited point's offset says nothing about where the target bites).
            const p = hi.rr.point;
            const tFric = (p.fmepBar * 1e5 * g.vdTotal) / (4 * Math.PI);
            const bReq = Math.max(0, p.mapBar * ((limit + tFric) / (p.torqueNm + tFric)) - P_AMB_PA / 1e5);
            t = Math.min(hi.t, bReq + Math.min(0.05, Math.max(0, hi.t - p.boostBar)));
            if (!(t < hi.t)) t = 0.5 * hi.t;
          }
          tries++;
        } else if (hi.t > 0) t = 0;
        else break;
      } else {
        t = (lo.t * fHi - hi.t * fLo) / (fHi - fLo);
        if (!(t > lo.t && t < hi.t)) t = 0.5 * (lo.t + hi.t);
      }
      const p = evalT(t);
      if (Math.abs(p.f) <= tol) return p.rr;
      if (p.f > 0) {
        prevHi = hi;
        hi = p;
        fHi = p.f;
        if (side === 1) fLo /= 2;
        side = 1;
      } else {
        const first = !lo;
        lo = p;
        fLo = p.f;
        if (side === -1) fHi /= 2;
        side = first ? 0 : -1;
      }
      if (lo && hi.t - lo.t <= 1e-7) break;
    }
    return lo ? lo.rr : hi.rr;
  };
  let knockSens = 0.03;
  let shortfall: { ratio: number; rpm: number; reason: string; reachedAnywhere: boolean } | null = null;
  for (const rpm of grid) {
    // EGT / exhaust pressure warm-started from the previous rpm point; the
    // first point is iterated so the sweep starts self-consistent.
    let r = evalPoint(ctx, rpm, egt, pExh);
    if (curve.length === 0) r = evalPoint(ctx, rpm, r.egtK, r.pExhCyl);
    // ── ECU at WOT (boosted engines) ──
    // Effective ECU torque limit at this rpm: torque limit and/or rated-power limit (P/ω).
    const tqFromPower = powerLimitW > 0 ? powerLimitW / ((rpm * 2 * Math.PI) / 60) : 0;
    const torqueLimit = torqueLimitNm > 0 && tqFromPower > 0 ? Math.min(torqueLimitNm, tqFromPower) : Math.max(torqueLimitNm, tqFromPower);
    if (boosted) {
      // Boost schedule (turbo) — evaluate at the scheduled target if it differs.
      const tgt0 = boostTargetAt(rpm);
      if (c.induction === 'turbo' && Math.abs(tgt0 - c.turbo.targetBoostBar) > 1e-9) r = atBoost(rpm, tgt0, r);
      // 1) Torque management ("torque structure"): the ECU converts the torque
      //    limit into a required air charge, using its torque model (indicated
      //    torque ∝ air charge at the current spark efficiency, minus friction),
      //    and lowers the boost target to it (limitTorque: bracketed solve on the target).
      if (torqueLimit > 0 && r.point.torqueNm > torqueLimit && r.point.boostBar > 0.01) {
        r = limitTorque(rpm, r, torqueLimit);
        if (r.boost) r.boost.limit = 'torque';
      }
      // 2) Knock-aware boost control: when holding the target would need more
      //    than the accepted retard, the boost target is lowered until the
      //    retard is back at that limit. The trim is partial (a torque-based
      //    ECU balances retard against boost): the accepted retard still rises
      //    slowly with knock severity. Fixed number of secant steps (no early
      //    exit) so the result is a continuous function of every input.
      if (r.point.knockRetardDeg > maxRetard && r.point.boostBar > 0.05) {
        const bA0 = r.point.boostBar;
        // Turbo: scale the achieved boost (a target above it would not bite when spool-limited).
        const tgtA = c.induction === 'turbo' ? bA0 : boostTargetOf(r);
        const k0 = r.point.knockRetardDeg;
        // Accepted retard: rises softly with knock severity, but never more than
        // ecuRetardSoftCapDeg above the nominal limit.
        const lim = maxRetard + CAL.ecuRetardSoftCapDeg * Math.tanh((CAL.ecuRetardSoft * (k0 - maxRetard)) / CAL.ecuRetardSoftCapDeg);
        // Bracketed secant (Illinois) on the boost scale x ∈ [xMin, 1]: retard is
        // monotone in boost but saturates at the retard limit, so an unguarded
        // secant can run away. Tolerance 0.05° → results continuous in the inputs.
        const xMin = 0.02;
        const evalX = (x: number) => {
          const rr = atBoost(rpm, tgtA * x, r);
          return { x, rr, g: rr.point.knockRetardDeg - lim };
        };
        let hi = { x: 1, rr: r, g: k0 - lim };
        let lo: { x: number; rr: PointOut; g: number } | null = null;
        let cur = evalX(Math.min(0.999, Math.max(0.3, 1 - (k0 - lim) * knockSens)));
        if (cur.g > 0) hi = cur;
        else lo = cur;
        if (!lo) {
          lo = evalX(xMin);
          if (lo.g > 0) cur = lo; // knock-limited even with no boost: run at minimum boost
        }
        let side = 0;
        let gLo = lo.g;
        let gHi = hi.g;
        for (let it = 0; it < CAL.ecuKnockIters && lo.g <= 0 && Math.abs(cur.g) > 0.1; it++) {
          let x = (lo.x * gHi - hi.x * gLo) / (gHi - gLo);
          if (!(x > lo.x && x < hi.x)) x = 0.5 * (lo.x + hi.x);
          cur = evalX(x);
          if (cur.g > 0) {
            hi = cur;
            gHi = cur.g;
            if (side === 1) gLo /= 2;
            side = 1;
          } else {
            lo = cur;
            gLo = cur.g;
            if (side === -1) gHi /= 2;
            side = -1;
          }
        }
        // Prefer the bracket end at or below the accepted retard.
        const rB = cur.g <= 0.1 ? cur.rr : lo.g <= 0 ? lo.rr : cur.rr;
        const kB = rB.point.knockRetardDeg;
        if (k0 - kB > 0.5) knockSens = Math.min(0.2, Math.max(0.005, (1 - rB.point.boostBar / bA0) / (k0 - kB)));
        r = rB;
        if (r.boost) r.boost.limit = 'knock';
      }
    }
    // 3) Component protection (boosted): even at the richest allowed mixture and the
    //    accepted retard, the ECU cuts boost when EGT would exceed the turbine /
    //    exhaust-valve limit or peak cylinder pressure the absolute ceiling.
    //    Fixed-iteration bisection on the boost scale (continuous in the inputs).
    if (boosted && r.point.boostBar > 0.05) {
      const excess = (pt: DynoPoint) =>
        Math.max((pt.egtC - CAL.ecuEgtMaxC) / 100, (pt.peakCylinderPressureBar - CAL.ecuPmaxCapBar) / 100);
      if (excess(r.point) > 0) {
        const tgtP = c.induction === 'turbo' ? r.point.boostBar : boostTargetOf(r);
        let lo = 0.02;
        let hi = 1;
        let best: PointOut | null = null;
        for (let it = 0; it < 9; it++) {
          const x = 0.5 * (lo + hi);
          const rr = atBoost(rpm, tgtP * x, r);
          if (excess(rr.point) <= 0) {
            lo = x;
            best = rr;
          } else hi = x;
        }
        r = best ?? atBoost(rpm, tgtP * lo, r);
        if (r.boost) r.boost.limit = 'protection';
      }
    }
    // 4) The torque limit is the final arbiter. Steps 2–3 re-solve the point from
    //    a different exhaust-state warm start (EGT / back-pressure of the limited
    //    point), which changes knock retard at the same boost, so they can land
    //    above the limit (up to 1.5 N·m on the B58 at 1400–1600 rpm). Re-limit.
    if (torqueLimit > 0 && r.point.torqueNm > torqueLimit + CAL.ecuTorqueTolNm && r.point.boostBar > 0.01) {
      r = limitTorque(rpm, r, torqueLimit);
      if (r.boost) r.boost.limit = 'torque';
    }
    egt = r.egtK;
    pExh = r.pExhCyl;
    curve.push(r.point);
    limitedBy.push(r.boost?.limit === 'torque' ? (torqueLimitNm > 0 && torqueLimit === torqueLimitNm ? 'torque' : 'power') : null);
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
  const plateauStart = (inBand: (i: number) => boolean, kind: 'torque' | 'power', argmaxRpm: number) => {
    if (!curve.some((_, i) => inBand(i) && limitedBy[i] === kind)) return argmaxRpm;
    return curve[curve.findIndex((_, i) => inBand(i))].rpm;
  };
  const tqRpm = plateauStart(inTq, 'torque', tq.rpm);
  const pkRpm = plateauStart(inPk, 'power', pk.rpm);
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
    unlimited: opts.includeUnlimited ? (limitPresent && applyOem ? simulate(config, { applyOemLimits: false }).curve : curve) : undefined,
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
    uncertainty: computeUncertainty(c, curve, pkRpm, tqRpm),
  };
}
