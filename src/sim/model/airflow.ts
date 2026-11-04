/**
 * Airflow submodel: volumetric efficiency from valve-flow choking (Taylor's
 * inlet Mach index), cam timing, intake (Helmholtz) and exhaust (wave) tuning,
 * residual/back-pressure effects, valve float, plus throttle and exhaust
 * pressure losses.
 */
import type { EngineConfig } from '../types';
import { CAL, CP_AIR, GAMMA_AIR, P_AMB_PA, R_AIR, R_EXH } from './constants';
import { riseFractionAfterBdc, type Geometry } from './geometry';

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
    profiles.push({
      ...base,
      durI: Math.max(150, base.durI - CAL.lowLobeDurDelta),
      durE: Math.max(150, base.durE - 30),
      liftI: base.liftI * CAL.lowLobeLiftRatio,
      liftE: base.liftE * 0.75,
    });
  }
  if (!cam.vvt) return profiles;
  const out: CamProfile[] = [];
  for (const p of profiles) for (const s of [-24, -12, 0, 12, 24]) out.push({ ...p, icl: p.icl + s });
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
  /** Exhaust gas temperature estimate, K (wave speed). */
  tExh: number;
  valveFloatRpm: number;
  /** Turbo housing in the exhaust path blunts header wave tuning. */
  exhaustWaveFactor: number;
}

export interface VeResult {
  ve: number;
  z: number;
  zExh: number;
  overlap: number;
  profile: CamProfile;
  fChoke: number;
  fCam: number;
  fRunner: number;
  fExhaust: number;
  fResidual: number;
  fFloat: number;
}

/** Per-profile quantities that do not depend on rpm (precomputed once per simulate). */
export interface PreparedProfile {
  profile: CamProfile;
  ev: CamEvents;
  ci: number;
  ce: number;
  zOpt: number;
  backflow: number;
  ovlSeat: number;
  nEx: number;
  exhAmp: number;
}

export function prepareProfiles(g: Geometry, c: EngineConfig, profiles: CamProfile[]): PreparedProfile[] {
  return profiles.map((p) => {
    const ev = camEvents(p);
    const ci = cdPeak(p.liftI / c.intakeValveMm) * CAL.ciProfile * Math.min(1.25, (p.durI + 40) / 270);
    const ce = cdPeak(p.liftE / c.exhaustValveMm) * CAL.ciProfile * Math.min(1.25, (p.durE + 40) / 270);
    const zOpt = Math.max(0.15, CAL.zOptAt43 + CAL.zOptPerDeg * (ev.ivc - 43));
    const backflow = riseFractionAfterBdc(g, Math.min(120, Math.max(0, ev.ivc + CAL.ivcSeatOffset)));
    const ovlSeat = ev.overlap + 40;
    const lenIn = c.headerPrimaryMm / 25.4;
    const nEx = (850 * (180 + ev.evo + 15)) / (lenIn + 3);
    const dOpt = Math.sqrt(g.nExhaust) * c.exhaustValveMm * 1.02;
    const dia = Math.exp(-((Math.log(c.headerDiameterMm / dOpt) / 0.4) ** 2));
    const exhAmp = (CAL.exhAmp[c.exhaust] ?? 0) * Math.min(1, Math.max(0, ovlSeat) / 70) * dia;
    return { profile: p, ev, ci: Math.max(0.05, ci), ce: Math.max(0.05, ce), zOpt, backflow, ovlSeat, nEx, exhAmp };
  });
}

/** Cam/valve-dependent part of VE for one profile. */
function profileVe(g: Geometry, c: EngineConfig, pp: PreparedProfile, inp: VeInputs) {
  const ev = pp.ev;
  const aI = Math.sqrt(GAMMA_AIR * R_AIR * inp.tMan);
  const z = ((g.pistonArea / g.intakeArea) * inp.sp) / (pp.ci * aI);
  const fChoke = 1 / Math.sqrt(1 + Math.pow(z / CAL.zChoke, CAL.zChokeExp));

  // Cam filling: IVC sets the inlet Mach index at which inertia ram fills best.
  const s = z / pp.zOpt;
  let fCam = s < 1 ? 1 - pp.backflow * Math.pow(1 - s, CAL.backflowExp) : 1 / (1 + CAL.camHighLoss * (s - 1) * (s - 1));

  // Overlap reversion at low speed (worse with exhaust pressure above intake).
  const sub = Math.max(0, 1 - Math.min(1, s));
  fCam *= 1 - 0.0012 * Math.max(0, ev.overlap + 15) * sub * sub * Math.max(0.5, inp.peOverPi);

  // Exhaust wave scavenging (needs overlap, tuned primary length & diameter).
  const amp = pp.exhAmp * inp.exhaustWaveFactor;
  const lx = Math.log(inp.rpm / pp.nEx);
  const lx2 = Math.log(inp.rpm / (0.62 * pp.nEx));
  const fExhaust = 1 + amp * (Math.exp(-((lx / 0.3) ** 2)) - 0.3 * Math.exp(-((lx2 / 0.15) ** 2)));

  // Residual gas / back-pressure (ideal-cycle volumetric efficiency term).
  const cr = c.compressionRatio;
  const pr = Math.max(0.3, inp.peOverPi);
  let dev = (cr - Math.pow(pr, 1 / 1.3)) / (cr - 1) - 1;
  dev *= 1 + Math.max(0, pp.ovlSeat) / 80;
  const fResidual = Math.min(1.06, Math.max(0.6, 1 + dev));

  const aE = Math.sqrt(1.33 * R_EXH * inp.tExh);
  const zExh = ((g.pistonArea / g.exhaustArea) * inp.sp) / (pp.ce * aE);
  const fExhValve = 1 / Math.sqrt(1 + Math.pow(zExh, 5));

  return {
    score: fChoke * fCam * fExhaust * fResidual * fExhValve,
    z,
    zExh,
    overlap: ev.overlap,
    fChoke,
    fCam,
    fExhaust,
    fResidual: fResidual * fExhValve,
  };
}

export function computeVe(g: Geometry, c: EngineConfig, profiles: PreparedProfile[], inp: VeInputs): VeResult {
  let best = profileVe(g, c, profiles[0], inp);
  let bestP = profiles[0].profile;
  for (let i = 1; i < profiles.length; i++) {
    const r = profileVe(g, c, profiles[i], inp);
    if (r.score > best.score) {
      best = r;
      bestP = profiles[i].profile;
    }
  }

  // Intake runner Helmholtz tuning.
  const runnerArea = 0.9 * g.intakeArea;
  const dR = Math.sqrt((4 * runnerArea) / Math.PI);
  const lEff = c.intakeRunnerMm / 1000 + 0.8 * g.bore + 0.6 * dR;
  const cr = c.compressionRatio;
  const vEff = (g.vdCyl * (cr + 1)) / (2 * (cr - 1));
  const a = Math.sqrt(GAMMA_AIR * R_AIR * inp.tMan);
  const fH = (a / (2 * Math.PI)) * Math.sqrt(runnerArea / (lEff * vEff));
  const nT = (60 * fH) / CAL.helmholtzK;
  const ampR = c.itb ? CAL.runnerAmpItb : CAL.runnerAmp;
  const l1 = Math.log(inp.rpm / nT);
  const l2 = Math.log(inp.rpm / (0.68 * nT));
  const l3 = Math.log(inp.rpm / (1.5 * nT));
  const fRunner =
    1 + ampR * (Math.exp(-((l1 / 0.28) ** 2)) + 0.35 * Math.exp(-((l2 / 0.12) ** 2)) - CAL.runnerOffTune * Math.exp(-((l3 / 0.2) ** 2)));

  // Valve float: control of the valve is lost, VE collapses.
  const xf = inp.rpm / inp.valveFloatRpm - 1;
  // Past float the valves bounce and close late: steep but bounded loss
  // (≈50 % by 15 % over float, floor 45 %).
  const fFloat = xf > 0 ? Math.max(0.45, 1 - 0.5 * Math.pow(Math.min(1, xf / 0.15), 1.5)) : 1;

  let base = CAL.veBase[c.valvetrain];
  if (c.valvesPerCylinder === 2) base -= CAL.ve2ValvePenalty;
  if (c.itb) base += 0.015;

  return {
    ve: base * best.score * fRunner * fFloat,
    z: best.z,
    zExh: best.zExh,
    overlap: best.overlap,
    profile: bestP,
    fChoke: best.fChoke,
    fCam: best.fCam,
    fRunner,
    fExhaust: best.fExhaust,
    fResidual: best.fResidual,
    fFloat,
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
  let lo = 0.1 * pUp;
  let hi = pUp;
  for (let i = 0; i < 24; i++) {
    const pm = 0.5 * (lo + hi);
    if (demandPerPa * pm > orificeFlow(cdA, pUp, tUp, pm)) hi = pm;
    else lo = pm;
  }
  return 0.5 * (lo + hi);
}

/** Wall heating of the fresh charge, K (more time at low rpm; plenum adds). */
export function chargeWallHeating(rpm: number, itb: boolean): number {
  return (itb ? 9 : 15) * Math.pow(3000 / Math.max(300, rpm), 0.4);
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
