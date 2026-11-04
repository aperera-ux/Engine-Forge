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
  const msPerDeg = 1000 / (6 * inp.rpm);
  const lnOnFac = Math.log(CAL.knockTauScale * 17.68 * Math.pow(inp.octane / 100, 3.402));
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
      ki += msPerDeg * Math.exp(-(lnOnFac - 1.7 * (lnP - lnAtm) + 3800 / tU));
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
export function octaneIndex(c: EngineConfig): number {
  const f = fuelOf(c);
  let oi = f.ron - CAL.octaneK * (f.ron - f.mon);
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
  return (
    (CAL.burnDeg * head * Math.pow(bs, 0.3) * Math.pow(c.boreMm / 86, CAL.burnBoreExp) * Math.pow(Math.max(500, rpm) / 4000, CAL.burnRpmExp) * lam) /
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
  return ideal * gHeat * gBurn * fuelOf(c).etaFactor;
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
  let lo = 0;
  let hi = maxRetard;
  const last = runCycle({ ...base, thetaStart: start(mbt - hi), wantKnock: true });
  let best = last;
  if (last.knockIntegral > 1) {
    lo = hi;
  } else {
    for (let i = 0; i < 7; i++) {
      const mid = 0.5 * (lo + hi);
      const r = runCycle({ ...base, thetaStart: start(mbt - mid), wantKnock: true });
      if (r.knockIntegral > 1) lo = mid;
      else {
        hi = mid;
        best = r;
      }
    }
  }
  const retard = lo >= maxRetard ? maxRetard : hi;
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
