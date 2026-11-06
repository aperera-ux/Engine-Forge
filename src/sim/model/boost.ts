/**
 * Forced induction: turbocharger (compressor map approximation, turbine
 * nozzle + power balance, wastegate, choke/surge) and superchargers
 * (positive-displacement and centrifugal, parasitic drive power).
 */
import type { EngineConfig } from '../types';
import { CAL, CP_EXH, GAMMA_EXH, P_AMB_PA, R_EXH, T_AMB_K } from './constants';
import { compressPower, compressTemp } from './airflow';
import { illinois } from './solve';

export interface FlowAt {
  mAir: number;
  mExh: number;
  pMan: number;
  tExh: number;
  /**
   * Pressure the boost controller regulates, Pa: the manifold pressure with the
   * throttle wide open. Equals pMan except when the ECU closes the throttle for
   * torque control (engine.ts › limitThrottle); the wastegate then keeps
   * regulating boost upstream of the throttle instead of spooling up against it.
   */
  pCtl?: number;
}

/**
 * Engine airflow for a given post-intercooler pressure/temperature and exhaust
 * pressure. `mAirLoss` (turbo): the air flow at which the exhaust-manifold
 * loss ahead of the turbine is evaluated (the caller's current flow iterate).
 */
export type FlowFn = (pUp: number, tUp: number, pExhCyl: number, mAirLoss?: number) => FlowAt;

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
  /**
   * The exhaust-pressure state variable of the solve, Pa: the solver's guess
   * argument (p3Guess / pExhGuess) evaluated at this solution. Turbo: turbine-inlet
   * pressure before the twin-scroll factor (pExhCyl = p3 × 0.95 for twin-scroll);
   * supercharger: = pExhCyl. A converged operating point has guess = this.
   */
  pExhState: number;
  compEta: number;
  /** Compressor flow fraction of choke (per compressor). */
  phi: number;
  /** Parasitic drive power (superchargers), W. */
  drivePowerW: number;
  surge: boolean;
  choke: boolean;
  /** Boost limited by turbine power (not yet at target). */
  spoolLimited: boolean;
  /** What stops boost reaching target at this rpm ('none' when at target). */
  limit: 'none' | 'turbine' | 'speed-line' | 'choke' | 'exhaust-pressure' | 'knock' | 'torque' | 'protection';
  flow: FlowAt;
  /**
   * Turbine power surplus with the wastegate shut, (P_turbine − P_compressor) / P_compressor,
   * at this state (turbo only). With SpoolControl.prForce this is the coupled spool margin m(PR).
   */
  spoolMargin?: number;
  /** (top speed-line PR − PR) / PR at this state (turbo only; < 0: the compressor cannot reach this PR). */
  speedMargin?: number;
}

/**
 * Branch control for the spool equilibrium (engine.ts › spoolCeiling).
 *  - prForce: evaluate at this compressor PR with the wastegate shut (no
 *    power balance, no target): one point of the coupled spool-margin curve.
 *  - prCap: upper bound on PR, the lowest root of the COUPLED spool margin
 *    (the equilibrium a turbo spooling up from rest reaches at this rpm);
 *    an extra term of the feasibility margin.
 */
export interface SpoolControl {
  prForce?: number;
  /** Infinity = no spool root below the target (the turbine can supply the compressor). */
  prCap?: number;
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
export function compressorMaxPr(phi: number, inducerMm = 50): number {
  // Larger (modern billet, high-trim) wheels reach somewhat higher PR at their tip-speed limit.
  const prTop = Math.min(4.5, Math.max(3.0, CAL.compPrMax + CAL.compPrMaxPerMm * (inducerMm - 50)));
  const x = Math.min(1, Math.max(0, (phi - CAL.compSpeedLineKnee) / (1.05 - CAL.compSpeedLineKnee)));
  return 1 + (prTop - 1) * (1 - x * x);
}

export function surgePr(phi: number): number {
  return 1 + 5 * Math.pow(Math.max(0, phi), 0.9);
}

/** PR scan step (relative) for a lower spool equilibrium when the turbine-power term binds. */
const SPOOL_SCAN = 0.04;

/** Choking pressure ratio and sonic flow function of the exhaust gas (constants). */
const CRIT_EXH = Math.pow(2 / (GAMMA_EXH + 1), GAMMA_EXH / (GAMMA_EXH - 1));
const PSI_CRIT_EXH = Math.sqrt(
  ((2 * GAMMA_EXH) / (GAMMA_EXH - 1)) * (Math.pow(CRIT_EXH, 2 / GAMMA_EXH) - Math.pow(CRIT_EXH, (GAMMA_EXH + 1) / GAMMA_EXH)),
);

/** Turbine-inlet pressure that passes mExh through an effective nozzle area. */
export function turbineInletPressure(cdA: number, mExh: number, t3: number, p4: number): number {
  // Lower bound: the pressure that passes mExh at sonic (choked) conditions.
  const crit = CRIT_EXH;
  const pCh = (mExh * Math.sqrt(R_EXH * t3)) / (Math.max(1e-9, cdA) * PSI_CRIT_EXH);
  if (p4 / pCh <= crit) return pCh; // choked: exact
  // Subsonic: closed-form inverse of the orifice equation. With x = p4/p3 and
  // y = x^((1−γ)/γ): (p3·ψ/p4)² = k·(y² − y), k = 2γ/(γ−1), so
  // y = (1 + √(1 + 4K²/k))/2 with K = ṁ√(RT)/(CdA·p4), and p3 = p4·y^(γ/(γ−1)).
  const kq = (2 * GAMMA_EXH) / (GAMMA_EXH - 1);
  const K = (mExh * Math.sqrt(R_EXH * t3)) / (Math.max(1e-9, cdA) * p4);
  const y = 0.5 * (1 + Math.sqrt(1 + (4 * K * K) / kq));
  return Math.min(p4 / crit, p4 * Math.pow(y, GAMMA_EXH / (GAMMA_EXH - 1)));
}

/** Exhaust-manifold pulse-energy factor on turbine work (log = small volume, best pulses). */
const PULSE: Record<string, number> = { log: 1.08, shorty: 1.04, 'long-tube': 1.0, 'tuned-equal': 0.98 };

function turbinePower(c: EngineConfig, mExh: number, t3: number, p3: number, p4: number, phi = 0.6): number {
  // Pulse energy matters most at low flow (spool); twin-scroll keeps pulses separated.
  const low = Math.max(0, 1 - phi / 0.6);
  const pulse = 1 + ((PULSE[c.exhaust] ?? 1) - 1) * (0.5 + low) + (c.turbo.twinScroll ? CAL.twinScrollPulse * low + 0.03 : 0);
  const eta = CAL.turbineEta * pulse;
  const k = (GAMMA_EXH - 1) / GAMMA_EXH;
  return eta * mExh * CP_EXH * t3 * (1 - Math.pow(p4 / Math.max(p4, p3), k));
}

function intercool(t2: number, eff: number): number {
  return t2 - eff * (t2 - T_AMB_K);
}

/** Warm start for solveTurbo from a previous solve of a nearby operating point (updated in place). */
export interface TurboHint {
  pr: number;
  phi: number;
  /** d margin / d PR near the last root (NaN = unknown). */
  slope: number;
}

/**
 * Turbo operating point at a given turbine-inlet pressure guess. `hint` only
 * changes the iteration path (bracketing the PR root from the previous
 * solution); the result is the same root to the solve tolerance.
 */
/**
 * `exhScale`: SimCalibration.exhaustRestrictionScale on the post-turbine
 * system's pressure drop (p4 − ambient); 1 = the model value.
 */
export function solveTurbo(c: EngineConfig, flowAt: FlowFn, p3Guess: number, hint?: TurboHint, spool?: SpoolControl | null, exhScale = 1): BoostState {
  const t = c.turbo;
  const n = t.count;
  const mChokeEach = compressorChokeFlow(c);
  // Turbine frame grows with compressor size, but less than the wheel area.
  const at = CAL.turbineAreaPerARmm2 * t.turbineAR * 2500 * Math.pow(t.compressorInducerMm / 50, CAL.turbineFrameExp) * n;
  const pTarget = P_AMB_PA + t.targetBoostBar * 1e5;
  // Charge-air piping + intercooler core loss: continuous in core size (effectiveness).
  const icDrop = (phi: number) => (0.04 + 0.08 * Math.min(1.2, t.intercoolerEffectiveness / 0.75)) * 1e5 * phi * phi;
  const twin = t.twinScroll ? 0.95 : 1;
  // Turbocharger mechanical (bearing) loss, W, all turbos. Hydrodynamic journal
  // and thrust bearings dissipate ∝ μ·N² (Petroff); along the operating line
  // the shaft speed N² ∝ compressor isentropic work Δh_is ∝ PR^((γ−1)/γ) − 1,
  // and for geometrically similar bearings the loss at a given tip speed
  // scales with wheel size (∝ D). CAL.turboBearingLossW is the loss of one
  // 50 mm-inducer turbo at PR 2. It is a small fraction of compressor power at
  // rated flow (~3–5 %) but a large one in the spool region (~10–20 %), where
  // the compressor absorbs only a few kW.
  const kAir = 0.2857;
  const bearingRef = Math.pow(2, kAir) - 1;
  const bearingLoss = (pr: number) => (CAL.turboBearingLossW * n * (t.compressorInducerMm / 50) * Math.max(0, Math.pow(pr, kAir) - 1)) / bearingRef;

  // Compressor flow fraction φ: the compressor efficiency and the charge-air
  // pressure loss depend on φ, and φ on the engine flow they produce, so each
  // PR evaluation is solved to a fixed point in φ (secant-accelerated, from the
  // previous evaluation's φ). With a single lagged pass (the former
  // turboFlowPasses = 1) the margin seen by the PR search depended on the
  // previous PR iterate, not only on PR, and the search could settle on a
  // spurious root (B58 6800 rpm: PR 1.611 instead of 1.652).
  let phiWarm = 0.5;
  // Start φ from the last two evaluations, extrapolated linearly in PR.
  let prA = NaN;
  let phiA = NaN;
  let prB = NaN;
  const evalPr = (pr: number, p3: number) => {
    let phi = phiWarm;
    if (Math.abs(prB - prA) > 1e-9) phi = Math.min(2, Math.max(0, phiWarm + ((pr - prB) * (phiWarm - phiA)) / (prB - prA)));
    let eta = compressorEta(phi, pr);
    let flow: FlowAt = { mAir: 0, mExh: 0, pMan: P_AMB_PA, tExh: 1100 };
    let t2 = T_AMB_K;
    let tc = T_AMB_K;
    let pUp = P_AMB_PA;
    let xPrev = NaN;
    let gPrev = NaN;
    for (let k = 0; k < CAL.turboPhiMaxPasses; k++) {
      eta = compressorEta(phi, pr);
      t2 = compressTemp(T_AMB_K, pr, eta);
      tc = intercool(t2, t.intercoolerEffectiveness);
      pUp = Math.max(0.5 * P_AMB_PA, P_AMB_PA * pr - icDrop(phi));
      flow = flowAt(pUp, tc, Math.max(p3 * twin, P_AMB_PA), phi * n * mChokeEach);
      const g = flow.mAir / n / mChokeEach;
      if (Math.abs(g - phi) <= CAL.turboPhiTol) {
        phi = g;
        break;
      }
      const s = (g - gPrev) / (phi - xPrev);
      const next = k > 0 && Number.isFinite(s) && Math.abs(s) < 0.9 ? phi + (g - phi) / (1 - s) : g;
      xPrev = phi;
      gPrev = g;
      phi = k === CAL.turboPhiMaxPasses - 1 ? g : Math.max(0, next);
    }
    eta = compressorEta(phi, pr);
    prA = prB;
    phiA = phiWarm;
    prB = pr;
    phiWarm = phi;
    // Shaft power the turbine must supply: compressor work plus the turbo's
    // bearing (journal + thrust) friction loss.
    const pc = compressPower(flow.mAir, T_AMB_K, pr, eta) + bearingLoss(pr);
    const p4 = P_AMB_PA + 0.05e5 * Math.min(2, phi) ** 2 * exhScale;
    const p3c = turbineInletPressure(at, flow.mExh, flow.tExh, p4);
    const ptc = turbinePower(c, flow.mExh, flow.tExh, p3c, p4, phi);
    // Exhaust pressure with the wastegate open (lower bound on the operating p3).
    const p3wg = turbineInletPressure(at * CAL.wastegateAreaFactor, flow.mExh, flow.tExh, p4);
    return { pr, phi, eta, flow, t2, tc, pUp, pc, p3c, ptc, p4, p3wg };
  };

  if (spool?.prForce !== undefined) {
    // One point of the coupled spool-margin curve: PR imposed, wastegate shut.
    const r = evalPr(spool.prForce, p3Guess);
    return {
      pr: r.pr,
      tComp: r.t2,
      tCharge: r.tc,
      pUp: r.pUp,
      pExhCyl: Math.max(P_AMB_PA, r.p3c * twin),
      pExhState: r.p3c,
      compEta: r.eta,
      phi: r.phi,
      drivePowerW: 0,
      surge: r.pr > surgePr(r.phi),
      choke: false,
      spoolLimited: true,
      limit: 'turbine',
      flow: r.flow,
      spoolMargin: (r.ptc - r.pc) / Math.max(r.pc, 100),
      speedMargin: (compressorMaxPr(r.phi, t.compressorInducerMm) - r.pr) / r.pr,
    };
  }
  // With a SpoolControl the coupled spool equilibrium is already known (prCap,
  // Infinity = the turbine can drive the compressor up to the target): the
  // frozen-exhaust-state turbine term and its lowest-root scan are replaced by it.
  const spoolSet = !!spool && spool.prCap !== undefined;
  const prCap = spool?.prCap ?? Infinity;

  // p3 is warm-started from the previous rpm point, so one pass suffices.
  let p3 = p3Guess;
  let limit: BoostState['limit'] | null = 'none';
  let probe: () => BoostState['limit'] = () => 'none';
  let res: ReturnType<typeof evalPr>;
  {
    const prMax = Math.max(1.0001, (pTarget / P_AMB_PA) * 1.35);
    const p3Max = CAL.turbineInletMaxBar * 1e5;
    // Feasibility margin (≥ 0 = feasible): the turbine can drive the compressor,
    // the compressor is inside its maximum wheel-speed (tip-speed) line, boost
    // is at or below target, and boost control keeps the turbine-inlet pressure
    // below its limit. Each term falls with PR, so the highest feasible PR is
    // the root of the (continuous) margin — found by Illinois, not bisection.
    const margin = (r: ReturnType<typeof evalPr>) =>
      Math.min(
        spoolSet ? Infinity : (r.ptc - r.pc) / Math.max(r.pc, 100),
        (compressorMaxPr(r.phi, t.compressorInducerMm) - r.pr) / r.pr,
        (pTarget - (r.flow.pCtl ?? r.flow.pMan)) / pTarget,
        (p3Max - Math.min(r.p3c, r.p3wg)) / p3Max,
        (prCap - r.pr) / r.pr,
      );
    // Root of the margin on [lo, hi]; reuses illinois' last evaluation when it is the root.
    const root = (lo: number, hi: number, mL: number, mH: number) => {
      let last: ReturnType<typeof evalPr> | null = null;
      const x = illinois(
        (pr) => margin((last = evalPr(pr, p3))),
        lo,
        hi,
        CAL.turboPrMaxIters,
        CAL.turboPrRelTol,
        mL,
        mH,
        false,
        CAL.turboPrRelTol,
      );
      return last !== null && (last as ReturnType<typeof evalPr>).pr === x ? (last as ReturnType<typeof evalPr>) : evalPr(x, p3);
    };
    let found: ReturnType<typeof evalPr> | null = null;
    if (hint && hint.pr > 1 && hint.pr < prMax) {
      // Bracket the root from the previous solve of this operating point: step
      // ×4 from the hint until the margin changes sign (normally 1–2 steps).
      phiWarm = hint.phi;
      prB = NaN;
      let x = hint.pr;
      let last = evalPr(x, p3);
      let m = margin(last);
      if (Math.abs(m) <= CAL.turboPrRelTol) found = last;
      let lo = NaN;
      let mL = 0;
      let hi = NaN;
      let mH = 0;
      let step = 2e-3 * x;
      // First step: Newton with the last bracket's slope, aimed 20 % past the root.
      if (hint.slope < 0) step = Math.min(0.2 * x, Math.max(1e-6 * x, (1.2 * Math.abs(m)) / -hint.slope));
      for (let i = 0; i < 8 && !found; i++) {
        if (m > 0) {
          lo = x;
          mL = m;
        } else {
          hi = x;
          mH = m;
        }
        if (lo === lo && hi === hi) break;
        x = m > 0 ? Math.min(prMax, x + step) : Math.max(1, x - step);
        if ((m > 0 && x >= prMax) || (m <= 0 && x <= 1)) break;
        last = evalPr(x, p3);
        m = margin(last);
        if (Math.abs(m) <= CAL.turboPrRelTol) found = last;
        step *= 4;
      }
      if (!found && lo === lo && hi === hi) {
        if (mH < mL) hint.slope = (mH - mL) / (hi - lo);
        found = root(lo, hi, mL, mH);
      }
    }
    if (!found) {
      let best = evalPr(1, p3);
      const top = evalPr(prMax, p3);
      const mTop = margin(top);
      const mLo = margin(best);
      if (mTop >= 0) best = top;
      else if (mLo > 0) {
        best = root(1, prMax, mLo, mTop);
        if (hint) hint.slope = NaN;
      }
      found = best;
    }
    // The turbine-power term of the margin is not monotone in PR when the turbo
    // is spool-limited (more boost → lower exhaust/intake pressure ratio →
    // more VE → more turbine power), so the margin can have several roots: a
    // low and a high spool equilibrium (e.g. Audi 2.7T at 1600 rpm: PR 1.23
    // and 1.49). The operating point is the LOWEST one: spooling up from rest
    // the turbo accelerates while turbine power exceeds compressor power and
    // stops at the first PR where they balance (the stable equilibrium a WOT
    // pull reaches). Which root a local search finds depends on where it
    // starts, so when the turbine term binds, PR is scanned downward in
    // SPOOL_SCAN steps for an infeasible point below the root, and the search
    // continues there. (Choosing the highest root instead leaves the coupled
    // exhaust-state fixed point without a solution: the high root exists only
    // at a back-pressure lower than the one it produces.)
    for (let guard = 0; guard < 3 && !spoolSet; guard++) {
      const r0 = found as ReturnType<typeof evalPr>;
      if (r0.pr <= 1 || (r0.ptc - r0.pc) / Math.max(r0.pc, 100) > margin(r0) + 1e-9) break; // turbine term not binding
      let hiX = r0.pr;
      let hiM = margin(r0);
      let loX = NaN;
      let loM = 0;
      for (let x = r0.pr, k = 0; k < 60 && x > 1; k++) {
        const y = Math.max(1, x / (1 + SPOOL_SCAN));
        const my = margin(evalPr(y, p3));
        if (my <= 0) {
          // Infeasible below the root: the lowest root is under y. Walk on down to
          // the feasible side, then solve on [feasible, infeasible].
          hiX = y;
          hiM = my;
          for (let j = 0; j < 60 && hiX > 1; j++) {
            const z = Math.max(1, hiX / (1 + SPOOL_SCAN));
            const mz = margin(evalPr(z, p3));
            if (mz > 0) {
              loX = z;
              loM = mz;
              break;
            }
            hiX = z;
            hiM = mz;
          }
          break;
        }
        x = y;
      }
      if (loX !== loX) break;
      found = root(loX, hiX, loM, hiM);
      if (hint) hint.slope = NaN;
    }
    res = found;
    if (hint) {
      hint.pr = res.pr;
      hint.phi = res.phi;
    }
  }
  const atTarget = (res.flow.pCtl ?? res.flow.pMan) >= pTarget - 0.03e5;
  const spoolLimited = !atTarget && res.ptc < res.pc * 1.05;
  // Genuinely past choke: flow pinned at the speed line with collapsed efficiency.
  const choke = res.phi > 0.97 && res.eta < 0.58;
  {
    const prMax = Math.max(1.0001, (pTarget / P_AMB_PA) * 1.35);
    // What stops boost short of target, from a probe 3 % above the solved PR.
    // A diagnostic label only (no effect on the solution), so it is evaluated
    // lazily: the ECU solves evaluate many operating points per rpm and read it
    // for the final one only.
    if (!atTarget) {
      const p3s = p3;
      limit = null;
      probe = () => {
        if (res.pr >= prCap * (1 - 1e-6)) return 'turbine';
        const up = evalPr(Math.min(prMax, res.pr * 1.03), p3s);
        return up.ptc < up.pc ? 'turbine' : up.pr > compressorMaxPr(up.phi, t.compressorInducerMm) ? (up.phi > 0.9 ? 'choke' : 'speed-line') : Math.min(up.p3c, up.p3wg) > CAL.turbineInletMaxBar * 1e5 ? 'exhaust-pressure' : 'none';
      };
    }
    {
      // Wastegate: the turbine only has to supply compressor power, so the gate
      // opens until it does (hi3). When the turbine cannot even with the gate
      // shut (spool-limited), hi3 = p3c and the gate stays shut. Formerly a
      // switch on ptc < 1.05·pc chose p3c or the regulated value, which made
      // p3 jump by the 5 % power margin there (EA888 gen 3 near choke).
      const hi3 = illinois(
        (p) => turbinePower(c, res.flow.mExh, res.flow.tExh, p, res.p4, res.phi) - res.pc,
        res.p4,
        Math.max(res.p3c, res.p4 * 1.0001),
        40,
        1e-6,
        undefined,
        undefined,
        true,
      );
      // Wastegate port + turbine nozzle together still restrict flow.
      p3 = Math.min(res.p3c, Math.max(hi3, res.p3wg));
    }
  }
  return {
    pr: res.pr,
    tComp: res.t2,
    tCharge: res.tc,
    pUp: res.pUp,
    pExhCyl: Math.max(P_AMB_PA, p3 * twin),
    pExhState: p3,
    compEta: res.eta,
    phi: res.phi,
    drivePowerW: 0,
    surge: res.pr > surgePr(res.phi),
    choke,
    spoolLimited,
    get limit(): BoostState['limit'] {
      if (limit === null) limit = probe();
      return limit;
    },
    set limit(v: BoostState['limit']) {
      limit = v;
    },
    flow: res.flow,
    spoolMargin: (res.ptc - res.pc) / Math.max(res.pc, 100),
    speedMargin: (compressorMaxPr(res.phi, t.compressorInducerMm) - res.pr) / res.pr,
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
  // Blower speed = crank speed × fixed pulley ratio, sized so target boost is
  // reached at the reference crank speed. The rev limiter only truncates the curve.
  const refRpm = s.referenceRpm && s.referenceRpm > 1000 ? s.referenceRpm : CAL.scReferenceRpm;
  // Blower tip-speed limit: boost stops rising ~25 % above the reference speed.
  const x = Math.min(1.25, rpm / refRpm);
  const boost =
    s.type === 'centrifugal'
      ? s.targetBoostBar * x * x
      : s.targetBoostBar * (0.82 + 0.18 * x) * (1 - Math.exp(-rpm / 900));
  const eta = s.type === 'roots' ? 0.55 : s.type === 'twin-screw' ? 0.7 : 0.72;
  const icDrop = (0.02 + 0.06 * Math.min(1.2, s.intercoolerEffectiveness / 0.7)) * 1e5 * Math.min(1, boost / 1);
  const pr = (P_AMB_PA + boost * 1e5 + icDrop) / P_AMB_PA;
  const t2 = compressTemp(T_AMB_K, pr, eta);
  const tc = intercool(t2, s.intercoolerEffectiveness);
  const pUp = P_AMB_PA * pr - icDrop;
  let pe = pExhGuess;
  let flow = flowAt(pUp, tc, pe);
  pe = pExhOf(flow.mExh, flow.tExh);
  flow = flowAt(pUp, tc, pe);
  const dispL = (c.cylinders * Math.PI * (c.boreMm / 10) ** 2 * (c.strokeMm / 10)) / 4000;
  // Drive losses: belt/gears (η ≈ 0.92) plus rotor/bearing drag that grows with blower speed.
  const drag = (s.type === 'centrifugal' ? 0.3 : 0.8) * (rpm / 1000) * Math.sqrt(dispL) * 1000;
  const drive = compressPower(flow.mAir, T_AMB_K, pr, eta) / 0.92 + drag;
  return {
    pr,
    tComp: t2,
    tCharge: tc,
    pUp,
    pExhCyl: pe,
    pExhState: pe,
    compEta: eta,
    phi: 0.5,
    drivePowerW: drive,
    surge: false,
    choke: false,
    spoolLimited: false,
    limit: 'none',
    flow,
  };
}
