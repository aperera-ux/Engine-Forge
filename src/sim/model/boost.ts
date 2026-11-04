/**
 * Forced induction: turbocharger (compressor map approximation, turbine
 * nozzle + power balance, wastegate, choke/surge) and superchargers
 * (positive-displacement and centrifugal, parasitic drive power).
 */
import type { EngineConfig } from '../types';
import { CAL, CP_EXH, GAMMA_EXH, P_AMB_PA, R_EXH, T_AMB_K } from './constants';
import { compressPower, compressTemp, orificeFlow } from './airflow';

export interface FlowAt {
  mAir: number;
  mExh: number;
  pMan: number;
  tExh: number;
}

/** Engine airflow for a given post-intercooler pressure/temperature and exhaust pressure. */
export type FlowFn = (pUp: number, tUp: number, pExhCyl: number) => FlowAt;

export interface BoostState {
  /** Compressor pressure ratio. */
  pr: number;
  /** Temperature after compressor (before intercooler), K. */
  tComp: number;
  /** Charge temperature after intercooler, K. */
  tCharge: number;
  /** Pressure upstream of throttle, Pa. */
  pUp: number;
  /** Cylinder-side exhaust pressure (turbine inlet for turbos), Pa. */
  pExhCyl: number;
  compEta: number;
  /** Compressor flow fraction of choke (per compressor). */
  phi: number;
  /** Parasitic drive power (superchargers), W. */
  drivePowerW: number;
  surge: boolean;
  choke: boolean;
  /** Boost limited by turbine power (not yet at target). */
  spoolLimited: boolean;
  flow: FlowAt;
}

export function compressorChokeFlow(c: EngineConfig): number {
  const d = c.turbo.compressorInducerMm;
  return CAL.compChokePerMm2 * d * d;
}

export function compressorEta(phi: number, pr: number): number {
  const peak = CAL.compEtaPeak;
  const opt = 0.6;
  let e = phi < opt ? peak - 0.3 * ((opt - phi) / opt) ** 2 : peak - 0.15 * ((phi - opt) / 0.4) ** 2;
  if (pr > 2.2) e -= 0.02 * (pr - 2.2);
  if (phi > 1) e -= 0.5 * (phi - 1);
  return Math.max(0.45, e);
}

/**
 * Maximum pressure ratio on the compressor's top wheel-speed line vs flow
 * fraction: flat up to the efficiency island, then rolling off into choke.
 */
export function compressorMaxPr(phi: number): number {
  const x = Math.min(1, Math.max(0, (phi - CAL.compSpeedLineKnee) / (1.05 - CAL.compSpeedLineKnee)));
  return 1 + (CAL.compPrMax - 1) * (1 - x * x);
}

export function surgePr(phi: number): number {
  return 1 + 5 * Math.pow(Math.max(0, phi), 0.9);
}

/** Turbine-inlet pressure that passes mExh through an effective nozzle area. */
function turbineInletPressure(cdA: number, mExh: number, t3: number, p4: number): number {
  let lo = p4;
  let hi = 20 * P_AMB_PA;
  for (let i = 0; i < 26; i++) {
    const mid = 0.5 * (lo + hi);
    if (orificeFlow(cdA, mid, t3, p4, GAMMA_EXH, R_EXH) < mExh) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

function turbinePower(c: EngineConfig, mExh: number, t3: number, p3: number, p4: number): number {
  const eta = CAL.turbineEta * (c.turbo.twinScroll ? 1.1 : 1.0);
  const k = (GAMMA_EXH - 1) / GAMMA_EXH;
  return eta * mExh * CP_EXH * t3 * (1 - Math.pow(p4 / Math.max(p4, p3), k));
}

function intercool(t2: number, eff: number): number {
  return t2 - eff * (t2 - T_AMB_K);
}

export function solveTurbo(c: EngineConfig, flowAt: FlowFn, p3Guess: number): BoostState {
  const t = c.turbo;
  const n = t.count;
  const mChokeEach = compressorChokeFlow(c);
  const at = CAL.turbineAreaPerARmm2 * t.turbineAR * t.compressorInducerMm ** 2 * n;
  const pTarget = P_AMB_PA + t.targetBoostBar * 1e5;
  const icDrop = (phi: number) => (t.intercoolerEffectiveness > 0 ? 0.12e5 : 0.04e5) * phi * phi;
  const twin = t.twinScroll ? 0.95 : 1;

  const evalPr = (pr: number, p3: number) => {
    let phi = 0.5;
    let eta = compressorEta(phi, pr);
    let flow: FlowAt = { mAir: 0, mExh: 0, pMan: P_AMB_PA, tExh: 1100 };
    let t2 = T_AMB_K;
    let tc = T_AMB_K;
    let pUp = P_AMB_PA;
    for (let k = 0; k < 2; k++) {
      t2 = compressTemp(T_AMB_K, pr, eta);
      tc = intercool(t2, t.intercoolerEffectiveness);
      pUp = Math.max(0.5 * P_AMB_PA, P_AMB_PA * pr - icDrop(phi));
      flow = flowAt(pUp, tc, Math.max(p3 * twin, P_AMB_PA));
      phi = flow.mAir / n / mChokeEach;
      eta = compressorEta(phi, pr);
    }
    const pc = compressPower(flow.mAir, T_AMB_K, pr, eta);
    const p4 = P_AMB_PA + 0.05e5 * Math.min(2, phi) ** 2;
    const p3c = turbineInletPressure(at, flow.mExh, flow.tExh, p4);
    const ptc = turbinePower(c, flow.mExh, flow.tExh, p3c, p4);
    // Exhaust pressure with the wastegate open (lower bound on the operating p3).
    const p3wg = turbineInletPressure(at * CAL.wastegateAreaFactor, flow.mExh, flow.tExh, p4);
    return { pr, phi, eta, flow, t2, tc, pUp, pc, p3c, ptc, p4, p3wg };
  };

  let p3 = p3Guess;
  let res = evalPr(1, p3);
  let spoolLimited = false;
  let choke = false;
  // p3 is warm-started from the previous rpm point, so one refinement pass suffices.
  for (let pass = 0; pass < 1; pass++) {
    const prMax = Math.max(1.0001, (pTarget / P_AMB_PA) * 1.35);
    // Feasible: turbine can drive the compressor, the compressor is inside its
    // maximum wheel-speed (tip-speed) line, and boost control keeps the
    // turbine-inlet pressure below its limit (ECU/wastegate strategy).
    const feasible = (r: ReturnType<typeof evalPr>) =>
      r.ptc >= r.pc && r.pr <= compressorMaxPr(r.phi) && r.flow.pMan <= pTarget && Math.min(r.p3c, r.p3wg) <= CAL.turbineInletMaxBar * 1e5;
    let lo = 1;
    let hi = prMax;
    let best = evalPr(1, p3);
    const top = evalPr(hi, p3);
    if (feasible(top)) best = top;
    else {
      for (let i = 0; i < 11; i++) {
        const mid = 0.5 * (lo + hi);
        const r = evalPr(mid, p3);
        if (feasible(r)) {
          lo = mid;
          best = r;
        } else hi = mid;
      }
    }
    res = best;
    const atTarget = res.flow.pMan >= pTarget - 0.03e5;
    spoolLimited = !atTarget && res.ptc < res.pc * 1.05;
    // Genuinely past choke: flow pinned at the speed line with collapsed efficiency.
    choke = res.phi > 0.97 && res.eta < 0.58;
    if (atTarget || !spoolLimited) {
      // Wastegate regulating: turbine only has to supply compressor power.
      let lo3 = res.p4;
      let hi3 = Math.max(res.p3c, res.p4 * 1.0001);
      for (let i = 0; i < 20; i++) {
        const mid = 0.5 * (lo3 + hi3);
        if (turbinePower(c, res.flow.mExh, res.flow.tExh, mid, res.p4) < res.pc) lo3 = mid;
        else hi3 = mid;
      }
      // Wastegate port + turbine nozzle together still restrict flow.
      p3 = Math.min(res.p3c, Math.max(hi3, res.p3wg));
    } else {
      p3 = res.p3c;
    }
  }
  return {
    pr: res.pr,
    tComp: res.t2,
    tCharge: res.tc,
    pUp: res.pUp,
    pExhCyl: Math.max(P_AMB_PA, p3 * twin),
    compEta: res.eta,
    phi: res.phi,
    drivePowerW: 0,
    surge: res.pr > surgePr(res.phi),
    choke,
    spoolLimited,
    flow: res.flow,
  };
}

export function solveSupercharger(
  c: EngineConfig,
  rpm: number,
  flowAt: FlowFn,
  pExhOf: (mExh: number, tExh: number) => number,
  pExhGuess: number,
): BoostState {
  const s = c.supercharger;
  const x = Math.min(1.2, rpm / c.redlineRpm);
  const boost =
    s.type === 'centrifugal'
      ? s.targetBoostBar * x * x
      : s.targetBoostBar * (0.82 + 0.18 * x) * (1 - Math.exp(-rpm / 900));
  const eta = s.type === 'roots' ? 0.55 : s.type === 'twin-screw' ? 0.7 : 0.72;
  const icDrop = s.intercoolerEffectiveness > 0 ? 0.08e5 * Math.min(1, boost / 1) : 0.02e5;
  const pr = (P_AMB_PA + boost * 1e5 + icDrop) / P_AMB_PA;
  const t2 = compressTemp(T_AMB_K, pr, eta);
  const tc = intercool(t2, s.intercoolerEffectiveness);
  const pUp = P_AMB_PA * pr - icDrop;
  let pe = pExhGuess;
  let flow = flowAt(pUp, tc, pe);
  pe = pExhOf(flow.mExh, flow.tExh);
  flow = flowAt(pUp, tc, pe);
  const dispL = (c.cylinders * Math.PI * (c.boreMm / 10) ** 2 * (c.strokeMm / 10)) / 4000;
  const drag = (s.type === 'centrifugal' ? 0.25 : 0.55) * (rpm / 1000) * Math.sqrt(dispL) * 1000;
  const drive = compressPower(flow.mAir, T_AMB_K, pr, eta) / 0.95 + drag;
  return {
    pr,
    tComp: t2,
    tCharge: tc,
    pUp,
    pExhCyl: pe,
    compEta: eta,
    phi: 0.5,
    drivePowerW: drive,
    surge: false,
    choke: false,
    spoolLimited: false,
    flow,
  };
}
