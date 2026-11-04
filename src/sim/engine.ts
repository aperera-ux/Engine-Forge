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
import type { DynoPoint, EngineConfig, SimResult } from './types';
import { computeLayout } from './layout';
import { CAL, HP_W, LBFT_PER_NM, P_AMB_PA, R_AIR, T_AMB_K } from './model/constants';
import { computeGeometry, maxPistonAccel, meanPistonSpeed, sanitize, type Geometry } from './model/geometry';
import {
  camCandidates,
  chargeWallHeating,
  computeVe,
  exhaustBackPressure,
  prepareProfiles,
  solveThrottle,
  type PreparedProfile,
  type VeResult,
} from './model/airflow';
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

interface PointCtx {
  c: EngineConfig;
  g: Geometry;
  profiles: PreparedProfile[];
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
  const waveFactor = turbo ? (c.turbo.twinScroll ? 0.5 : 0.3) : 1;
  const tExhPort = egtGuessK;
  let lastVe: VeResult | null = null;
  let lastTFresh = T_AMB_K;
  // Turbo exhaust manifold between ports and turbine: friction/dynamic-head loss
  // by manifold type (log manifolds are compact but restrictive at high flow).
  let lastMExh = 0;
  let camChoice: PreparedProfile[] | null = null;
  const manifoldLoss = (mExh: number) => (turbo ? CAL.turboManifoldLossFrac * (exhaustBackPressure(c, mExh, tExhPort) - P_AMB_PA) : 0);

  const flowAt = (pUp: number, tUp: number, pExhTurb: number): FlowAt => {
    const pExhCyl = pExhTurb + manifoldLoss(lastMExh);
    const tFresh = Math.max(200, tUp + chargeWallHeating(rpm, c.itb) - ctx.evapVe);
    // VE depends only weakly on the throttle drop (via pe/pi): one evaluation.
    // The ECU's cam choice (VVT/variable lift) is made once per rpm point.
    const ve = computeVe(g, c, camChoice ?? ctx.profiles, {
      rpm,
      sp,
      tMan: tUp,
      peOverPi: pExhCyl / (0.98 * pUp),
      tExh: tExhPort,
      valveFloatRpm: ctx.vFloat,
      exhaustWaveFactor: waveFactor,
    });
    const demandPerPa = (((ve.ve * tUp) / tFresh) * g.vdTotal * cyclesPerS) / (R_AIR * tUp);
    const pMan = solveThrottle(ctx.cdAThrottle, pUp, tUp, demandPerPa);
    lastVe = ve;
    lastTFresh = tFresh;
    if (!camChoice && ctx.profiles.length > 1) {
      const pp = ctx.profiles.find((x) => x.profile === ve.profile);
      if (pp) camChoice = [pp];
    }
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
  const cr = c.compressionRatio;
  const scav = Math.min(1.3, Math.max(0.5, 1 - 4 * (ve.fExhaust - 1)));
  // Residual fraction: grows with exhaust/intake pressure ratio and overlap;
  // with intake above exhaust pressure, overlap scavenges (blows residuals out).
  const ovlSeat = Math.max(0, ve.overlap + 40);
  const pRatio = pExhCyl / pMan;
  const scavBlow = pRatio < 1 ? Math.exp(-CAL.scavengeK * (1 / pRatio - 1) * (ovlSeat / 40)) : 1;
  // Residual mass fraction (Heywood eq. 6.x): clearance volume at exhaust
  // pressure and residual temperature, relative to the trapped charge.
  const tRes = Math.max(600, 0.85 * egtGuessK);
  const xr = Math.min(
    0.3,
    Math.max(0.01, (1 / cr) * Math.pow(pRatio, 1 / 1.3) * (lastTFresh / tRes) * scav * scavBlow * (1 + Math.max(0, ve.overlap) / 60)),
  );
  const tIvc = lastTFresh + xr * (tRes - lastTFresh) - (ctx.evapKnock - ctx.evapVe);
  const mAirCyl = flow.mAir / (cyclesPerS * c.cylinders);
  const mTrap = mAirCyl * (1 + 1 / afrAct) / (1 - xr);
  const pBdc = (mTrap * R_AIR * tIvc) / g.vol[0];
  const eStoich = (mAirCyl * fuel.lhv) / fuel.afr; // J per cylinder-cycle
  const q = CAL.pressureHeatFrac * eStoich * Math.min(1, 1 / c.lambda);

  const burn = burnDuration(c, rpm);
  const spark = knockLimitedSpark({ g, rpm, pBdc, tIvc, q, burnDeg: burn, octane: octaneIndex(c, pMan / 1e5) }, burn);
  const eta = indicatedEfficiency(c, rpm, burn);
  const lamF = lambdaPowerFactor(c.lambda);
  const wInd = eta * lamF * spark.workRatio * eStoich; // J/cyl-cycle
  const imepBar = wInd / g.vdCyl / 1e5;

  // ── Losses ──
  const fmepMech = mechanicalFmep(c, sp, spark.pMaxBar, rpm);
  const pmep = pumpingMep(pExhCyl / 1e5, pMan / 1e5, ve.z, ve.zExh);
  const driveMep = boost && boost.drivePowerW > 0 ? boost.drivePowerW / (g.vdTotal * cyclesPerS) / 1e5 : 0;
  const fmepBar = fmepMech + pmep + driveMep;
  const bmepBar = imepBar - fmepBar;

  const torqueNm = Math.max(0, (bmepBar * 1e5 * g.vdTotal) / (4 * Math.PI));
  const powerKw = (torqueNm * rpm * 2 * Math.PI) / 60 / 1000;
  const fuelKgS = flow.mAir / afrAct;
  const egtK = exhaustTemp(c, tIvc, (wInd / mAirCyl), rpm);
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
  };
  // Warm start for the next rpm: turbine-inlet pressure for turbos, else exhaust pressure.
  return { point, boost, egtK, pExhCyl: boost && turbo ? boost.pExhCyl : pExhCyl };
}

export function simulate(config: EngineConfig): SimResult {
  const c = sanitize(config);
  const g = computeGeometry(c);
  const lay = computeLayout(c);
  const vFloat = valveFloatRpm(c);
  const ctx: PointCtx = {
    c,
    g,
    profiles: prepareProfiles(g, c, camCandidates(c)),
    vFloat,
    cdAThrottle: CAL.throttleCd * (Math.PI / 4) * (c.throttleMm / 1000) ** 2,
    evapVe: evapCooling(c, c.directInjection ? 0.22 : 0.1),
    evapKnock: evapCooling(c, c.directInjection ? CAL.evapDi : CAL.evapPfi),
    octane: octaneIndex(c),
  };

  const curve: DynoPoint[] = [];
  let egt = 1050;
  let pExh = P_AMB_PA * 1.05;
  let surgeRpm: number | null = null;
  let chokeRpm: number | null = null;
  let spoolRpm: number | null = null;
  let trimPrev = 0.75;
  let shortfall: { ratio: number; rpm: number; reason: string; reachedAnywhere: boolean } | null = null;
  for (const rpm of rpmGrid(c)) {
    // EGT / exhaust pressure warm-started from the previous rpm point; the
    // first point is iterated so the sweep starts self-consistent.
    let r = evalPoint(ctx, rpm, egt, pExh);
    if (curve.length === 0) r = evalPoint(ctx, rpm, r.egtK, r.pExhCyl);
    // Knock-aware boost control (as OEM ECUs do): when holding target boost
    // would need more than ecuMaxRetardDeg of retard, the wastegate target is
    // lowered until the retard is back at that limit (secant on boost).
    // The trim is partial (as a torque-based ECU balances retard against boost):
    // the accepted retard still rises slowly with the knock severity.
    if (c.induction === 'turbo' && r.point.knockRetardDeg > CAL.ecuMaxRetardDeg && r.point.boostBar > 0.05) {
      const b0 = r.point.boostBar;
      const k0 = r.point.knockRetardDeg;
      const lim = CAL.ecuMaxRetardDeg + CAL.ecuRetardSoft * (k0 - CAL.ecuMaxRetardDeg);
      const at = (bar: number) => evalPoint({ ...ctx, c: { ...c, turbo: { ...c.turbo, targetBoostBar: bar } } }, rpm, r.egtK, r.pExhCyl);
      // Secant iterations on boost (retard is smooth and monotone in boost).
      let bA = b0;
      let kA = k0;
      // Warm start from the previous rpm point's trim ratio.
      let bB = Math.min(0.97, Math.max(0.3, trimPrev)) * b0;
      let rB = at(bB);
      let kB = rB.point.knockRetardDeg;
      for (let it = 0; it < 2 && Math.abs(kB - lim) > 0.4; it++) {
        const bN = Math.min(b0, Math.max(0.05 * b0, Math.abs(kA - kB) > 0.05 ? bB - ((kB - lim) * (bB - bA)) / (kB - kA) : 0.5 * bB));
        const rN = at(bN);
        bA = bB;
        kA = kB;
        bB = bN;
        rB = rN;
        kB = rN.point.knockRetardDeg;
      }
      r = rB;
      trimPrev = bB / b0;
      if (r.boost) r.boost.limit = 'knock';
    }
    egt = r.egtK;
    pExh = r.pExhCyl;
    curve.push(r.point);
    const b = r.boost;
    if (b && c.induction === 'turbo' && rpm >= 0.5 * c.redlineRpm && c.turbo.targetBoostBar > 0.05) {
      const ratio = r.point.boostBar / c.turbo.targetBoostBar;
      if (!shortfall || ratio < shortfall.ratio) shortfall = { ratio, rpm, reason: b.limit, reachedAnywhere: false };
    }
    if (b && c.induction === 'turbo') {
      if (b.surge) surgeRpm = rpm;
      if (b.choke && chokeRpm === null) chokeRpm = rpm;
      if (spoolRpm === null && r.point.boostBar >= c.turbo.targetBoostBar * 0.95) spoolRpm = rpm;
    }
  }

  const pk = curve.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
  const tq = curve.reduce((a, b) => (b.torqueNm > a.torqueNm ? b : a));
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
    displacementCc: dispL * 1000,
    displacementL: dispL,
    cylinderCc: g.vdCyl * 1e6,
    boreStrokeRatio: c.boreMm / c.strokeMm,
    rodStrokeRatio: c.rodLengthMm / c.strokeMm,
    peakPowerKw: pk.powerKw,
    peakHp: pk.hp,
    peakPowerRpm: pk.rpm,
    peakTorqueNm: tq.torqueNm,
    peakTorqueLbFt: tq.torqueLbFt,
    peakTorqueRpm: tq.rpm,
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
  };
}
