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
}

export interface CycleOut {
  pMaxPa: number;
  work: number;
  knockIntegral: number;
}

export function runCycle(inp: CycleInputs): CycleOut {
  const { vol, polyStep } = inp.g;
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
  const lnOnFac = Math.log(CAL.knockTauScale * 17.68 * Math.pow(inp.octane / 100, 3.402)) + (CAL.knockPressureExp - 1.7) * Math.log(40);
  // End-gas loses heat to the walls during compression: more time at low rpm.
  const kU = ((GAMMA_UNBURNED - 1) / GAMMA_UNBURNED) * (1 - CAL.endGasHeatLoss * (1000 / Math.max(300, inp.rpm)));
  const lnP0 = Math.log(p0);
  const lnAtm = Math.log(101325);
  const invBurn = 1 / inp.burnDeg;
  // Compression before combustion is pure polytropic: skip straight to it.
  const iStart = Math.max(0, Math.min(359, Math.floor(inp.thetaStart + 180) - 1));
  const kStart = inp.wantKnock ? Math.min(iStart, 119) : iStart; // knock integral from 60° BTDC
  for (let i = 0; i < kStart; i++) {
    const pNew = p * polyStep[i];
    work += 0.5 * (p + pNew) * (vol[i + 1] - vol[i]);
    p = pNew;
  }
  for (let i = kStart; i < 360; i++) {
    const th1 = i + 1 - 180;
    const v1 = vol[i + 1];
    let xb = xbPrev;
    if (xbPrev < 0.99999) {
      const u = (th1 - inp.thetaStart) * invBurn;
      xb = u > 0 ? 1 - Math.exp(-WIEBE_A * u * u * u) : 0;
    }
    const dq = (xb - xbPrev) * inp.q;
    xbPrev = xb;
    const pNew = p * polyStep[i] + ((GAMMA_CYL - 1) * dq) / v1;
    work += 0.5 * (p + pNew) * (v1 - vol[i]);
    p = pNew;
    if (p > pMax) pMax = p;
    if (inp.wantKnock && xb < 0.95) {
      // Douaud–Eyzat: τ = 17.68 (ON/100)^3.402 p^-1.7 exp(3800/T), end gas compressed isentropically.
      const lnP = Math.log(p);
      const tU = inp.tIvc * Math.exp(kU * (lnP - lnP0));
      ki += msPerDeg * Math.exp(-(lnOnFac - CAL.knockPressureExp * (lnP - lnAtm) + 3800 / tU));
    } else if (!inp.wantKnock && xb >= 0.99999 && th1 > 120) {
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
  knockIntegralMbt: number;
}

/**
 * Knock-limited spark: start at MBT, retard until the end-gas auto-ignition
 * integral stays below 1. Returns the work ratio vs MBT.
 */
export function knockLimitedSpark(
  base: Omit<CycleInputs, 'thetaStart' | 'wantKnock'>,
  burnDeg: number,
): SparkResult {
  const mbt = mbtSpark(burnDeg);
  const start = (adv: number) => -adv + CAL.delayDeg;
  const atMbt = runCycle({ ...base, thetaStart: start(mbt), wantKnock: true });
  if (atMbt.knockIntegral <= 1) {
    return { sparkBtdc: mbt, retard: 0, workRatio: 1, pMaxBar: atMbt.pMaxPa / 1e5, knockIntegralMbt: atMbt.knockIntegral };
  }
  const maxRetard = Math.min(40, mbt + 15);
  const ki = (r: number) => runCycle({ ...base, thetaStart: start(mbt - r), wantKnock: true });
  let retard = maxRetard;
  let best = ki(maxRetard);
  if (best.knockIntegral <= 1) {
    // Illinois (modified regula falsi) on ln(KI) — ln KI is nearly linear in
    // retard, so this converges to ~0.01° in a few cycles and keeps curves smooth.
    let a = 0;
    let fa = Math.log(atMbt.knockIntegral);
    let b = maxRetard;
    let fb = Math.max(-3, Math.log(Math.max(1e-12, best.knockIntegral)));
    let side = 0;
    for (let i = 0; i < 24 && b - a > 0.05; i++) {
      let r = (a * fb - b * fa) / (fb - fa);
      // Guard: fall back to bisection if the secant step stalls near a bracket end.
      if (!(r > a + 0.02 * (b - a) && r < b - 0.02 * (b - a))) r = 0.5 * (a + b);
      const out = ki(r);
      const fr = Math.max(-3, Math.log(Math.max(1e-12, out.knockIntegral)));
      if (fr > 0) {
        a = r;
        fa = fr;
        if (side === -1) fb /= 2;
        side = -1;
      } else {
        b = r;
        fb = fr;
        best = out;
        if (side === 1) fa /= 2;
        side = 1;
      }
      if (Math.abs(fr) < 5e-3) {
        b = r;
        best = out;
        break;
      }
    }
    retard = b;
  }
  return {
    sparkBtdc: mbt - retard,
    retard,
    workRatio: sparkWorkRatio(retard),
    pMaxBar: best.pMaxPa / 1e5,
    knockIntegralMbt: atMbt.knockIntegral,
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
