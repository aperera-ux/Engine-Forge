/**
 * Airflow submodel: volumetric efficiency, residual fraction and pumping
 * work from the wave-action gas-exchange model (gasExchange.ts) tabulated
 * per cam candidate, ECU cam selection (variable lift, VVT phase), valve
 * float, plus throttle and exhaust pressure losses. Taylor's inlet Mach
 * index is kept as a diagnostic.
 */
import type { EngineConfig } from '../types';
import { CAL, CP_AIR, GAMMA_AIR, P_AMB_PA, R_AIR, R_EXH } from './constants';
import type { Geometry } from './geometry';
import { prepareGxEngine, prepareGxStatic, runGasExchange } from './gasExchange';
import { illinois } from './solve';

export interface CamProfile {
  durI: number;
  durE: number;
  liftI: number;
  liftE: number;
  /** Intake centerline, deg ATDC. */
  icl: number;
  /** Exhaust centerline, deg BTDC (fixed by the grind: 2·LSA − ICL_ground). */
  ecl: number;
}

export interface CamEvents {
  /** Intake closing, deg ABDC @0.050". */
  ivc: number;
  /** Exhaust opening, deg BBDC @0.050". */
  evo: number;
  /** Valve overlap @0.050", deg (may be negative). */
  overlap: number;
}

export function camEvents(p: CamProfile): CamEvents {
  const ivo = p.durI / 2 - p.icl; // BTDC
  const evc = p.durE / 2 - p.ecl; // ATDC
  return {
    ivc: p.icl + p.durI / 2 - 180,
    evo: p.ecl + p.durE / 2 - 180,
    overlap: ivo + evc,
  };
}

/** Candidate cam profiles the ECU can choose from (variable lift × VVT phasing). */
export function camCandidates(c: EngineConfig): CamProfile[] {
  const cam = c.cam;
  const ecl = 2 * cam.lobeSeparationDeg - cam.intakeCenterlineDeg;
  const base: CamProfile = {
    durI: cam.intakeDurationDeg,
    durE: cam.exhaustDurationDeg,
    liftI: cam.intakeLiftMm,
    liftE: cam.exhaustLiftMm,
    icl: cam.intakeCenterlineDeg,
    ecl,
  };
  const profiles: CamProfile[] = [base];
  if (cam.variableLift) {
    // Low-speed lobe: ~45° shorter, ~35% less lift (VTEC / Valvetronic-style).
    profiles.push(lowLobe(base));
  }
  if (!cam.vvt) return profiles;
  const out: CamProfile[] = [];
  const r = CAL.vvtRangeDeg;
  for (const p of profiles) for (const s of [-r, -r / 2, 0, r / 2, r]) out.push({ ...p, icl: p.icl + s });
  return out;
}

/** Peak discharge coefficient (re. valve head area) vs lift/diameter. */
function cdPeak(lOverD: number): number {
  return 0.62 * (1 - Math.exp(-lOverD / 0.12));
}

/** Taylor inlet Mach index Z. */
export function inletMachIndex(g: Geometry, c: EngineConfig, p: CamProfile, sp: number, tMan: number): number {
  const dI = c.intakeValveMm;
  const ci = cdPeak(p.liftI / dI) * CAL.ciProfile * Math.min(1.25, (p.durI + 40) / 270);
  const a = Math.sqrt(GAMMA_AIR * R_AIR * tMan);
  return ((g.pistonArea / g.intakeArea) * sp) / (Math.max(0.05, ci) * a);
}

/** Exhaust-side Mach index (hot gas, blowdown helps; used for pumping loss). */
export function exhaustMachIndex(g: Geometry, c: EngineConfig, p: CamProfile, sp: number, tExh: number): number {
  const ce = cdPeak(p.liftE / c.exhaustValveMm) * CAL.ciProfile * Math.min(1.25, (p.durE + 40) / 270);
  const a = Math.sqrt(1.33 * R_EXH * tExh);
  return ((g.pistonArea / g.exhaustArea) * sp) / (Math.max(0.05, ce) * a);
}

export interface VeInputs {
  rpm: number;
  sp: number;
  /** Manifold temperature, K. */
  tMan: number;
  /** Exhaust (cylinder-side) / intake manifold pressure ratio. */
  peOverPi: number;
  /** Exhaust gas temperature estimate, K (exhaust-valve Mach index). */
  tExh: number;
  valveFloatRpm: number;
}

export interface VeResult {
  /** Trapped fresh charge / (manifold density × swept volume). */
  ve: number;
  /** Taylor inlet / exhaust Mach indices of the chosen profile (diagnostics, pumping). */
  z: number;
  zExh: number;
  overlap: number;
  /** Cam profile the ECU selected (variable-lift lobe, VVT phase). */
  profile: CamProfile;
  /** Trapped residual mass fraction from the gas-exchange model. */
  xr: number;
  /** Gas-exchange pumping MEP / manifold pressure (bar per bar of MAP). */
  pmepRel: number;
  fFloat: number;
}

/** Options for building the breathing table. */
export interface BreathingOpts {
  rpmLo: number;
  rpmHi: number;
  /** Turbo housing in the exhaust path blunts header wave reflections. */
  exhaustWaveFactor: number;
  /** NA: estimated cylinder-side exhaust / manifold pressure ratio vs rpm. */
  peOverPiAt: (rpm: number) => number;
}

/** Ideal-cycle VE dependence on exhaust/intake pressure ratio (residual expansion). */
function residualVe(cr: number, pr: number): number {
  return Math.max(0.3, (cr - Math.pow(Math.max(0.2, pr), 1 / 1.3)) / (cr - 1));
}

/**
 * Tabulated wave-action breathing model. The gas-exchange cycle
 * (gasExchange.ts) is integrated on a log-spaced rpm grid for every cam
 * candidate (variable-lift lobe × VVT phase) and exhaust/intake pressure
 * ratio node; lookups interpolate (Catmull–Rom in log rpm, linear in
 * log pressure ratio). The ECU picks the best lobe and a continuous VVT phase
 * (parabolic optimum over the phaser range).
 */
export class BreathingModel {
  private readonly lobes: CamProfile[];
  private readonly phases: number[];
  private readonly prNodes: number[];
  private readonly k: number;
  private readonly lnR0: number;
  private readonly h: number;
  /** [lobe][phase][prNode][rpmNode] → ve, xr, pm */
  private readonly ve: Float64Array;
  private readonly xr: Float64Array;
  private readonly pm: Float64Array;
  /** NA: the pressure-ratio node used at each rpm node. */
  private readonly prNa: Float64Array | null;
  private readonly cr: number;
  private readonly base: number;
  private readonly g: Geometry;
  private readonly c: EngineConfig;
  private memoRpm = -1;
  private readonly memo: Float64Array;

  constructor(g: Geometry, c: EngineConfig, opts: BreathingOpts) {
    this.g = g;
    this.c = c;
    const cam = c.cam;
    const ecl = 2 * cam.lobeSeparationDeg - cam.intakeCenterlineDeg;
    const base: CamProfile = {
      durI: cam.intakeDurationDeg,
      durE: cam.exhaustDurationDeg,
      liftI: cam.intakeLiftMm,
      liftE: cam.exhaustLiftMm,
      icl: cam.intakeCenterlineDeg,
      ecl,
    };
    this.lobes = [base];
    if (cam.variableLift) this.lobes.push(lowLobe(base));
    this.phases = cam.vvt ? [-CAL.vvtRangeDeg, 0, CAL.vvtRangeDeg] : [0];
    this.prNodes = c.induction === 'na' ? [1] : c.induction === 'supercharger' ? [0.55, 1.1] : [0.85, 1.9];
    this.cr = c.compressionRatio;
    let b = CAL.gxVeScale;
    if (c.valvesPerCylinder === 2) b -= CAL.ve2ValvePenalty;
    this.base = b;

    // Fixed absolute log-rpm lattice (independent of idle/redline, so moving the
    // rev limiter never changes the curve below it); only the nodes needed to
    // cover [rpmLo, rpmHi] (+ one each side) are integrated.
    const h = Math.log(CAL.gxRpmNodeRatio);
    const iLo = Math.floor(Math.log(Math.max(300, opts.rpmLo) / 500) / h) - 1;
    const iHi = Math.ceil(Math.log(Math.max(opts.rpmLo * 1.5, opts.rpmHi) / 500) / h) + 1;
    const k = iHi - iLo + 1;
    this.k = k;
    this.lnR0 = Math.log(500) + iLo * h;
    this.h = h;
    const nL = this.lobes.length;
    const nP = this.phases.length;
    const nQ = this.prNodes.length;
    const size = nL * nP * nQ * k;
    this.ve = new Float64Array(size);
    this.xr = new Float64Array(size);
    this.pm = new Float64Array(size);
    this.prNa = c.induction === 'na' ? new Float64Array(k) : null;
    this.memo = new Float64Array(3 * nL * nP * nQ);
    const ge = prepareGxEngine(g, c, opts.exhaustWaveFactor);
    const rpms: number[] = [];
    for (let i = 0; i < k; i++) rpms.push(Math.exp(this.lnR0 + i * this.h));
    if (this.prNa) for (let i = 0; i < k; i++) this.prNa[i] = opts.peOverPiAt(rpms[i]);
    for (let l = 0; l < nL; l++) {
      for (let s = 0; s < nP; s++) {
        const st = prepareGxStatic(g, c, { ...this.lobes[l], icl: this.lobes[l].icl + this.phases[s] });
        for (let q = 0; q < nQ; q++) {
          for (let i = 0; i < k; i++) {
            const pr = this.prNa ? this.prNa[i] : this.prNodes[q];
            const o = runGasExchange(st, ge, rpms[i], pr);
            const idx = ((l * nP + s) * nQ + q) * k + i;
            this.ve[idx] = o.ve;
            this.xr[idx] = o.xr;
            this.pm[idx] = o.pmepRel;
          }
        }
      }
    }
    // Wave-tuning smear: cylinder-to-cylinder runner/primary differences,
    // plenum cross-talk and cycle-to-cycle variation spread each tuning peak
    // over a band of rpm. Light binomial smoothing along log-rpm (weight
    // CAL.gxRpmSmear on each neighbour).
    const w = CAL.gxRpmSmear;
    if (w > 0 && k > 2) {
      const tmp = new Float64Array(k);
      for (const a of [this.ve, this.xr, this.pm]) {
        for (let off = 0; off < size; off += k) {
          for (let i = 0; i < k; i++) {
            const lo = a[off + Math.max(0, i - 1)];
            const hi = a[off + Math.min(k - 1, i + 1)];
            tmp[i] = (1 - 2 * w) * a[off + i] + w * (lo + hi);
          }
          for (let i = 0; i < k; i++) a[off + i] = tmp[i];
        }
      }
    }
  }

  /** Catmull–Rom in log rpm on one table row starting at `off`. */
  private row(a: Float64Array, off: number, t: number, i: number): number {
    const k = this.k;
    const y1 = a[off + i];
    const y2 = a[off + i + 1];
    const y0 = i > 0 ? a[off + i - 1] : 2 * y1 - y2;
    const y3 = i + 2 < k ? a[off + i + 2] : 2 * y2 - y1;
    const u = t;
    return y1 + 0.5 * u * (y2 - y0 + u * (2 * y0 - 5 * y1 + 4 * y2 - y3 + u * (3 * (y1 - y2) + y3 - y0)));
  }

  lookup(inp: VeInputs): VeResult {
    const k = this.k;
    let t = (Math.log(Math.max(100, inp.rpm)) - this.lnR0) / this.h;
    t = Math.min(k - 1, Math.max(0, t));
    const i = Math.min(k - 2, Math.floor(t));
    const u = t - i;
    const nP = this.phases.length;
    const nQ = this.prNodes.length;
    // Pressure-ratio interpolation weights (clamped to the node range; the rest is analytic).
    const pr = Math.max(0.2, inp.peOverPi);
    let q0 = 0;
    let wq = 0;
    let prRef: number;
    if (this.prNa) {
      prRef = this.prNa[i] + u * (this.prNa[i + 1] - this.prNa[i]);
    } else if (nQ === 1) {
      prRef = this.prNodes[0];
    } else {
      const lo = this.prNodes[0];
      const hi = this.prNodes[nQ - 1];
      const prc = Math.min(hi, Math.max(lo, pr));
      wq = Math.log(prc / lo) / Math.log(hi / lo);
      q0 = 0;
      prRef = prc;
    }
    // rpm interpolation of every table row, memoised per rpm (the boost and
    // throttle solvers call the lookup many times at one rpm).
    const nL = this.lobes.length;
    if (inp.rpm !== this.memoRpm) {
      const tabs = [this.ve, this.xr, this.pm];
      for (let o = 0; o < 3; o++)
        for (let l = 0; l < nL; l++)
          for (let s = 0; s < nP; s++)
            for (let q = 0; q < nQ; q++) this.memo[((o * nL + l) * nP + s) * nQ + q] = this.row(tabs[o], ((l * nP + s) * nQ + q) * k, u, i);
      this.memoRpm = inp.rpm;
    }
    const memo = this.memo;
    const at = (o: number, l: number, s: number) => {
      const b = ((o * nL + l) * nP + s) * nQ + q0;
      const v0 = memo[b];
      return wq === 0 ? v0 : v0 + wq * (memo[b + 1] - v0);
    };
    let best = { ve: -1, xr: 0, pm: 0, l: 0, s: 0 };
    for (let l = 0; l < this.lobes.length; l++) {
      let ve: number;
      let xr: number;
      let pm: number;
      let ph = 0;
      if (nP === 1) {
        ve = at(0, l, 0);
        xr = at(1, l, 0);
        pm = at(2, l, 0);
      } else {
        const r = this.phases[2];
        const w = CAL.ecuResidualWeight;
        const vm = at(0, l, 0);
        const v0 = at(0, l, 1);
        const vp = at(0, l, 2);
        const xm = at(1, l, 0);
        const x0 = at(1, l, 1);
        const xp = at(1, l, 2);
        // ECU objective (trapped charge, residual penalised), parabolic in phase.
        const kp = 1 / CAL.ecuImepPerVe;
        const pmm = at(2, l, 0);
        const pm0 = at(2, l, 1);
        const pmp = at(2, l, 2);
        const ym = vm - w * xm - kp * pmm;
        const y0 = v0 - w * x0 - kp * pm0;
        const yp = vp - w * xp - kp * pmp;
        const a2 = (yp + ym - 2 * y0) / (2 * r * r);
        const b1 = (yp - ym) / (2 * r);
        ph = a2 < 0 ? Math.min(r, Math.max(-r, -b1 / (2 * a2))) : yp >= ym ? r : -r;
        // Lagrange weights at the chosen phase for the outputs.
        const x = ph / r;
        const wm = 0.5 * x * (x - 1);
        const w0 = 1 - x * x;
        const wp = 0.5 * x * (x + 1);
        ve = wm * vm + w0 * v0 + wp * vp;
        xr = wm * xm + w0 * x0 + wp * xp;
        pm = wm * pmm + w0 * pm0 + wp * pmp;
      }
      // ECU torque model: brake MEP ∝ trapped charge × (imep per unit VE) − pumping.
      const obj = (v: number, x: number, q: number) => v - CAL.ecuResidualWeight * x - q / CAL.ecuImepPerVe;
      if (best.ve < 0 || obj(ve, xr, pm) > obj(best.ve, best.xr, best.pm)) best = { ve, xr, pm, l, s: ph };
    }
    // Analytic correction from the tabulated to the actual pressure ratio.
    if (Math.abs(pr - prRef) > 1e-6) {
      best.ve *= residualVe(this.cr, pr) / residualVe(this.cr, prRef);
      best.xr *= Math.pow(pr / prRef, 1 / 1.3);
      best.pm += pr - prRef;
    }
    const lobe = this.lobes[best.l];
    const profile: CamProfile = { ...lobe, icl: lobe.icl + best.s };
    const ev = camEvents(profile);

    // Valve float: control of the valve is lost, VE collapses.
    const xf = inp.rpm / inp.valveFloatRpm - 1;
    // Past float the valves bounce and close late: steep but bounded loss
    // (≈45 % by 25 % over float, floor 45 %).
    const fFloat = xf > 0 ? Math.max(0.45, 1 - 0.45 * Math.pow(Math.min(1.5, xf / 0.25), 1.5)) : 1;
    return {
      ve: this.base * Math.max(0.05, best.ve) * fFloat,
      z: inletMachIndex(this.g, this.c, profile, inp.sp, inp.tMan),
      zExh: exhaustMachIndex(this.g, this.c, profile, inp.sp, inp.tExh),
      overlap: ev.overlap,
      profile,
      xr: Math.min(0.35, Math.max(0.005, best.xr)),
      pmepRel: best.pm,
      fFloat,
    };
  }
}

/** Variable-lift low-speed lobe: shorter, lower (VTEC / Valvetronic-style). */
function lowLobe(base: CamProfile): CamProfile {
  return {
    ...base,
    durI: Math.max(150, base.durI - CAL.lowLobeDurDelta),
    durE: Math.max(150, base.durE - 30),
    liftI: base.liftI * CAL.lowLobeLiftRatio,
    liftE: base.liftE * 0.75,
  };
}

/** Compressible orifice mass flow, kg/s. */
export function orificeFlow(cdA: number, pUp: number, tUp: number, pDown: number, gamma = GAMMA_AIR, R = R_AIR): number {
  const pr = Math.min(1, Math.max(0, pDown / pUp));
  const crit = Math.pow(2 / (gamma + 1), gamma / (gamma - 1));
  const prE = Math.max(pr, crit);
  const psi = Math.sqrt(((2 * gamma) / (gamma - 1)) * (Math.pow(prE, 2 / gamma) - Math.pow(prE, (gamma + 1) / gamma)));
  return (cdA * pUp * psi) / Math.sqrt(R * tUp);
}

/**
 * Manifold pressure where engine demand equals throttle flow.
 * demandPerPa: engine mass flow per Pa of manifold pressure (kg/s/Pa).
 */
export function solveThrottle(cdA: number, pUp: number, tUp: number, demandPerPa: number): number {
  const f = (pm: number) => demandPerPa * pm - orificeFlow(cdA, pUp, tUp, pm);
  // Narrow bracket from the incompressible estimate of the throttle drop (WOT: small).
  const rho = pUp / (R_AIR * tUp);
  const m0 = demandPerPa * pUp;
  const dp0 = (m0 * m0) / (2 * rho * cdA * cdA);
  const lo = Math.max(0.1 * pUp, pUp - 2.5 * dp0);
  const fLo = f(lo);
  if (lo > 0.1 * pUp && fLo < 0) return illinois(f, lo, pUp, 40, 1e-8, fLo);
  return illinois(f, 0.1 * pUp, pUp, 40, 1e-8);
}

/**
 * Wall heating of the fresh charge, K: heat transfer from the ports/valves at
 * CAL.intakeWallTempK, proportional to the wall–charge temperature difference
 * (an already hot, un-intercooled charge picks up little); more residence time
 * at low rpm; a plenum adds surface (ITBs less).
 */
export function chargeWallHeating(rpm: number, itb: boolean, tCharge = 301): number {
  const eff = CAL.chargeHeatEff * (itb ? 0.6 : 1) * Math.pow(3000 / Math.max(300, rpm), 0.4);
  return eff * Math.max(0, CAL.intakeWallTempK - tCharge);
}

/** Exhaust-side mean pressure for an NA/supercharged engine, Pa. */
export function exhaustBackPressure(c: EngineConfig, mExh: number, tExh: number): number {
  const aP = (Math.PI / 4) * (c.headerDiameterMm / 1000) ** 2;
  const rho = P_AMB_PA / (R_EXH * tExh);
  const v = mExh / c.cylinders / (rho * aP);
  // Pulsating flow: dynamic head of the blowdown pulse ~ (pulse factor)² × mean.
  const zeta = CAL.exhZeta[c.exhaust] ?? 3;
  return P_AMB_PA + zeta * 0.5 * rho * v * v;
}

/** Isentropic compression temperature rise helper, returns T2 (K). */
export function compressTemp(t1: number, pr: number, eta: number): number {
  return t1 * (1 + (Math.pow(Math.max(1, pr), (GAMMA_AIR - 1) / GAMMA_AIR) - 1) / Math.max(0.2, eta));
}

/** Isentropic compression power, W. */
export function compressPower(m: number, t1: number, pr: number, eta: number): number {
  return (m * CP_AIR * (compressTemp(t1, pr, eta) - t1));
}
