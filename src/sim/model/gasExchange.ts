/**
 * Gas-exchange ("breathing") model with wave action.
 *
 * One cylinder's exhaust and intake events are integrated in crank angle from
 * exhaust-valve opening (EVO) to intake-valve closing (IVC):
 *
 *  - Cylinder: open control volume (mass, energy; ideal gas), volume from the
 *    slider-crank, integrated with a linearised-implicit pressure step.
 *  - Valves: quasi-steady orifice flow through the actual lift profile
 *    (curtain area in series with the port throat), with a sonic (choke) cap.
 *  - Intake runner and exhaust primary: linear acoustic delay lines (1-D
 *    plane waves, impedance a/A). A wave leaving the valve returns after the
 *    round trip 2L/a, reflected at the plenum / collector open end with
 *    inversion (R < 0) and at the closed valve without inversion. Harmonic
 *    orders, closed-valve ringing carried into the next cycle (pass 2 uses
 *    pass 1's waves as the previous cycle) and the open-valve (Helmholtz-like)
 *    ram all emerge from the same two lines.
 *  - Log / shared turbine manifolds: the other cylinders' blowdown pulses
 *    reach this valve one firing interval apart (twin-scroll halves the
 *    number of cylinders sharing a manifold).
 *
 * Output per (rpm, cam profile, exhaust/intake pressure ratio): trapped fresh
 * charge relative to manifold density × swept volume (VE), trapped residual
 * fraction, and the gas-exchange (pumping) work between the two BDCs.
 * Everything is normalised to a 1 bar manifold so tables scale with MAP.
 */
import type { EngineConfig } from '../types';
import { CAL } from './constants';
import type { CamProfile } from './airflow';
import type { Geometry } from './geometry';
import { pistonDisplacement } from '../layout';

const GAM = 1.35; // mixed cylinder gas, gas-exchange period
const R_GAS = 288;
const DEG = Math.PI / 180;
/** Sonic mass-flux factor sqrt(γ)·(2/(γ+1))^((γ+1)/(2(γ−1))). */
const CHOKE_AIR = 0.685;
const CHOKE_EXH = 0.67;
const LIFT_REF_MM = 1.27; // 0.050"

/** Seat-to-seat (lift > 0) duration for a given duration at 0.050" and peak lift. */
export function seatDuration(dur050: number, liftMm: number): number {
  const n = CAL.liftShapeExp;
  const r = Math.min(0.9, LIFT_REF_MM / Math.max(LIFT_REF_MM * 1.05, liftMm));
  const x050 = Math.max(0.55, Math.sqrt(1 - Math.pow(r, 1 / n)));
  return Math.min(dur050 + 110, dur050 / x050);
}

/** Lift (mm) at angle φ (crank deg) for a lobe centred at `centre` with seat duration ds. */
function liftAt(phi: number, centre: number, ds: number, lMax: number): number {
  const x = (phi - centre) / (ds / 2);
  if (x <= -1 || x >= 1) return 0;
  return lMax * Math.pow(1 - x * x, CAL.liftShapeExp);
}

/** Effective flow area of one valve (curtain in series with the port throat), m². */
function valveArea(dMm: number, liftMm: number, throatCd: number): number {
  if (liftMm <= 0) return 0;
  const d = dMm / 1000;
  const aCurtain = CAL.valveCurtainCd * Math.PI * d * (liftMm / 1000);
  const aThroat = throatCd * (Math.PI / 4) * d * d;
  return 1 / Math.sqrt(1 / (aCurtain * aCurtain) + 1 / (aThroat * aThroat));
}

/** Per-profile, rpm-independent arrays (geometry, valve areas) on the integration grid. */
export interface GxStatic {
  profile: CamProfile;
  n: number;
  dphi: number;
  phi0: number;
  /** Cylinder volume at grid nodes (n+1), m³. */
  vol: Float64Array;
  /** Effective intake / exhaust flow area over each step (n), m². */
  aI: Float64Array;
  aE: Float64Array;
  /** Index range of the pumping loop (BDC → BDC). */
  kBdc0: number;
  kBdc1: number;
  /** Seat events, crank deg relative to gas-exchange TDC. */
  ivo: number;
  ivc: number;
  evo: number;
  evc: number;
}

export interface GxEngine {
  vdCyl: number;
  vc: number;
  /** Runner cross-section and effective acoustic length (incl. port), m², m. */
  aRunner: number;
  lRunner: number;
  /** Exhaust primary cross-section and effective length (incl. port), m², m. */
  aPrimary: number;
  lPrimary: number;
  /** Open-end reflection coefficients (negative = inverting). */
  rIntake: number;
  rExhaust: number;
  /** Other cylinders sharing the exhaust manifold (log/turbo) and the pulse transmission. */
  nShared: number;
  tShared: number;
  runnerLoss: number;
  tMan: number;
  tExh: number;
}

export function prepareGxEngine(g: Geometry, c: EngineConfig, exhaustWaveFactor: number): GxEngine {
  const aRunner = CAL.runnerAreaRatio * g.intakeArea;
  const dR = Math.sqrt((4 * aRunner) / Math.PI);
  const lRunner = c.intakeRunnerMm / 1000 + CAL.intakePortLenBore * g.bore + 0.6 * (dR / 2);
  const dP = c.headerDiameterMm / 1000;
  const nPorts = 1; // siamesed into one primary per cylinder
  const aPrimary = nPorts * (Math.PI / 4) * dP * dP;
  const lPrimary = c.headerPrimaryMm / 1000 + CAL.exhaustPortLenBore * g.bore + 0.6 * (dP / 2);
  const banks = c.layout === 'inline' ? 1 : 2;
  const turbo = c.induction === 'turbo';
  let groups = banks;
  if (turbo) groups = Math.max(banks, c.turbo.count) * (c.turbo.twinScroll ? 2 : 1);
  // Cylinders whose blowdown pulses reach this valve through a common
  // manifold / collector (per bank; twin-scroll and twin turbos split it).
  const nShared = Math.max(1, Math.round(c.cylinders / groups));
  const boosted = c.induction !== 'na';
  return {
    vdCyl: g.vdCyl,
    vc: g.vc,
    aRunner,
    lRunner,
    aPrimary,
    lPrimary,
    rIntake: -(c.itb ? CAL.intakeReflectItb : CAL.intakeReflect),
    rExhaust: -(CAL.exhReflect[c.exhaust] ?? 0.5) * exhaustWaveFactor,
    nShared,
    // Transmission of the other cylinders' pulses: strongest for a log / shared
    // turbine manifold, weak for headers that merge far downstream.
    tShared: (CAL.sharedPulseTransmit[c.exhaust] ?? 0) * (turbo ? CAL.turboPulseTransmitFactor : 1),
    runnerLoss: c.itb ? CAL.runnerLossItb : CAL.runnerLoss,
    tMan: boosted ? 320 : 305,
    tExh: CAL.gxExhaustTempK,
  };
}

export function prepareGxStatic(g: Geometry, c: EngineConfig, p: CamProfile): GxStatic {
  const dsI = seatDuration(p.durI, p.liftI);
  const dsE = seatDuration(p.durE, p.liftE);
  const ivo = p.icl - dsI / 2;
  const ivc = p.icl + dsI / 2;
  const evo = -p.ecl - dsE / 2;
  const evc = -p.ecl + dsE / 2;
  const phi0 = evo - 1;
  const phi1 = ivc + 1;
  const n = CAL.gxSteps;
  const dphi = (phi1 - phi0) / n;
  const vol = new Float64Array(n + 1);
  const aI = new Float64Array(n);
  const aE = new Float64Array(n);
  const nI = g.nIntake;
  const nE = g.nExhaust;
  for (let k = 0; k <= n; k++) {
    const phi = phi0 + k * dphi;
    vol[k] = g.vc + g.pistonArea * pistonDisplacement(phi * DEG, g.r, g.l);
  }
  for (let k = 0; k < n; k++) {
    const phi = phi0 + (k + 0.5) * dphi;
    aI[k] = nI * valveArea(c.intakeValveMm, liftAt(phi, p.icl, dsI, p.liftI), CAL.intakeThroatCd);
    aE[k] = nE * valveArea(c.exhaustValveMm, liftAt(phi, -p.ecl, dsE, p.liftE), CAL.exhaustThroatCd);
  }
  const kBdc0 = Math.max(0, Math.min(n, Math.round((-180 - phi0) / dphi)));
  const kBdc1 = Math.max(0, Math.min(n, Math.round((180 - phi0) / dphi)));
  return { profile: p, n, dphi, phi0, vol, aI, aE, kBdc0, kBdc1, ivo, ivc, evo, evc };
}

export interface GxOut {
  /** Trapped fresh charge / (manifold density × swept volume). */
  ve: number;
  /** Residual (burned) mass fraction of the trapped charge. */
  xr: number;
  /** Gas-exchange (pumping) MEP, BDC → BDC, relative to manifold pressure (bar per bar). */
  pmepRel: number;
}

/** Interpolate a wave history with linear interpolation at fractional index q. */
function interp(a: Float64Array, q: number): number {
  const i = Math.floor(q);
  const f = q - i;
  return a[i] + f * (a[i + 1] - a[i]);
}

/**
 * Previous-cycle value of an outgoing wave at (current-cycle) index q < 0:
 * shift one cycle (720°) forward; beyond the integrated window the valve is
 * closed and the line simply rings (g = f = R·g(t − t_rt)).
 */
function prevCycle(hist: Float64Array | null, q: number, period: number, n: number, trt: number, refl: number): number {
  if (!hist) return 0;
  let qq = q + period;
  let fac = 1;
  let guard = 0;
  while (qq > n && guard < 64) {
    qq -= trt;
    fac *= refl;
    guard++;
  }
  if (qq < 0 || guard >= 64) return 0;
  return fac * interp(hist, Math.min(n - 1e-9, qq));
}

/**
 * Integrate one gas-exchange period. `peOverPi`: mean exhaust (cylinder-side)
 * over intake manifold pressure. Two passes: the second uses the first pass's
 * waves as the previous cycle (periodic steady state).
 */
export function runGasExchange(st: GxStatic, e: GxEngine, rpm: number, peOverPi: number): GxOut {
  const p0 = 1e5;
  const t0 = e.tMan;
  const tX = e.tExh;
  const pe = p0 * peOverPi;
  const rho0 = p0 / (R_GAS * t0);
  const a0 = Math.sqrt(1.4 * 287 * t0);
  const aX = Math.sqrt(1.33 * 290 * tX);
  const rhoX = pe / (290 * tX);
  const zI = a0 / e.aRunner;
  const zE = aX / e.aPrimary;
  const kRun = (e.runnerLoss / (2 * rho0 * e.aRunner * e.aRunner));
  const n = st.n;
  const dt = st.dphi / (6 * rpm);
  const trtI = Math.max(1, (2 * e.lRunner) / a0 / dt);
  const trtE = Math.max(1, (2 * e.lPrimary) / aX / dt);
  const period = 720 / st.dphi;
  const shiftSteps = e.nShared > 1 ? 720 / e.nShared / st.dphi : 0;
  const cpMul = GAM * R_GAS;
  // "Mean" = slower than the engine's own cycle: the time constant is a
  // fraction of the cycle period (bounded by the fixed value at low speed).
  const tauMean = Math.min(CAL.waveMeanTauMs / 1000, CAL.waveMeanCycleFrac * (120 / rpm));
  const aLp = Math.min(1, dt / tauMean);
  const vol = st.vol;
  const aIa = st.aI;
  const aEa = st.aE;

  let gIprev: Float64Array | null = null;
  let gEprev: Float64Array | null = null;
  let veGuess = 0.95;
  let out: GxOut = { ve: 0.9, xr: 0.05, pmepRel: 0 };
  // Previous-cycle wave carry-over (closed-valve ringing into the next event).
  // Pass 1 starts at rest; pass 2 uses pass 1 as the previous cycle.
  const carry = CAL.gxRingCarry;
  const passes = carry > 0 ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    const gI = new Float64Array(n + 1);
    const gE = new Float64Array(n + 1);
    // State at EVO: trapped charge expanded to the EVO volume.
    const tEvo = CAL.gxEvoTempFactor * tX;
    const mTrap = (rho0 * e.vdCyl * veGuess * 1.07) / (1 - 0.06);
    let m = mTrap;
    let p = (m * R_GAS * tEvo) / vol[0];
    let xf = 0; // fresh (unburned, this cycle) mass in cylinder
    let buf = 0; // intake-runner backflow buffer, kg
    let bufFresh = 1;
    let wPump = 0;
    let mI = 0; // running mean of the returning intake / exhaust waves
    let mE = 0;
    // Initial outgoing waves: from the previous cycle (pass 2), else at rest.
    gI[0] = prevCycle(gIprev, 0, period, n, trtI, e.rIntake);
    gE[0] = prevCycle(gEprev, 0, period, n, trtE, e.rExhaust);
    for (let k = 0; k < n; k++) {
      const v0 = vol[k];
      const v1 = vol[k + 1];
      const dV = v1 - v0;
      // Incoming waves at the valves (reflections of earlier outgoing waves).
      // The plenum / collector holds its mean pressure: the slow (mean) part of
      // a returning wave is reflected fully inverted (R = −1), the pulsating
      // part with the lossy coefficient R (radiation, area change, friction).
      const qI = k - trtI;
      const gdI = qI >= 0 ? interp(gI, qI) : prevCycle(gIprev, qI, period, n, trtI, e.rIntake);
      mI += aLp * (gdI - mI);
      const fI = -mI + e.rIntake * (gdI - mI);
      const qE = k - trtE;
      const gdE = qE >= 0 ? interp(gE, qE) : prevCycle(gEprev, qE, period, n, trtE, e.rExhaust);
      mE += aLp * (gdE - mE);
      let fE = -mE + e.rExhaust * (gdE - mE);
      if (shiftSteps > 0) {
        for (let j = 1; j < e.nShared; j++) {
          const q = k - j * shiftSteps;
          fE += e.tShared * (q >= 0 ? interp(gE, q) : prevCycle(gEprev, q, period, n, trtE, e.rExhaust));
        }
      }
      const tc = (p * v0) / (m * R_GAS);
      const rhoC = p / (R_GAS * tc);

      // ── intake valve flow (positive into the cylinder) ──
      const aIv = aIa[k];
      let mi = 0;
      let dmi = 0; // d mi / d p_cyl
      if (aIv > 1e-9) {
        const pUp = p0 + 2 * fI;
        const dI = pUp - p;
        const rhoUp = dI >= 0 ? rho0 : rhoC;
        // Compressibility: nozzle expansibility Y ≈ 1 − 0.62·(1 − p_down/p_up) (exact to ~1 % down to choke).
        const yI = 1 - 0.62 * (1 - Math.max(0.53, dI >= 0 ? p / Math.max(1, pUp) : pUp / p));
        const kI = 1 / (2 * rhoUp * aIv * aIv * yI * yI) + kRun;
        const s = Math.sqrt(zI * zI + 4 * kI * Math.abs(dI));
        mi = (2 * dI) / (zI + s);
        dmi = -1 / s;
        const mMax = dI >= 0 ? (CHOKE_AIR * aIv * Math.max(0, pUp)) / Math.sqrt(R_GAS * t0) : (CHOKE_AIR * aIv * p) / Math.sqrt(R_GAS * tc);
        if (Math.abs(mi) > mMax) {
          mi = Math.sign(mi) * mMax;
          dmi = dI >= 0 ? 0 : -mMax / p;
        }
      }
      // ── exhaust valve flow (positive out of the cylinder) ──
      const aEv = aEa[k];
      let me = 0;
      let dme = 0;
      if (aEv > 1e-9) {
        const pDn = pe + 2 * fE;
        const dE = p - pDn;
        const rhoUp = dE >= 0 ? rhoC : rhoX;
        const yE = 1 - 0.62 * (1 - Math.max(0.54, dE >= 0 ? pDn / p : p / Math.max(1, pDn)));
        const kE = 1 / (2 * rhoUp * aEv * aEv * yE * yE);
        const s = Math.sqrt(zE * zE + 4 * kE * Math.abs(dE));
        me = (2 * dE) / (zE + s);
        dme = 1 / s;
        const mMax = dE >= 0 ? (CHOKE_EXH * aEv * p) / Math.sqrt(R_GAS * tc) : (CHOKE_EXH * aEv * Math.max(0, pDn)) / Math.sqrt(290 * tX);
        if (Math.abs(me) > mMax) {
          me = Math.sign(me) * mMax;
          dme = dE >= 0 ? mMax / p : 0;
        }
      }
      // Enthalpy flux (Σ T·ṁ, signed) and its sensitivity to cylinder pressure.
      const tIn = mi >= 0 ? t0 : tc;
      const tOut = me >= 0 ? tc : tX;
      const h = tIn * mi - tOut * me;
      const dh = tIn * dmi - tOut * dme;
      const dp = (cpMul * dt * h - GAM * p * dV) / (v1 + GAM * dV - cpMul * dt * dh);
      const pNew = Math.max(0.05 * p0, p + dp);
      const dpa = pNew - p;
      mi += dmi * dpa;
      me += dme * dpa;
      // Outgoing waves.
      gI[k + 1] = fI - zI * mi;
      gE[k + 1] = fE + zE * me;
      // Mass and fresh-charge bookkeeping.
      const dmIn = mi * dt;
      const dmOut = me * dt;
      const xFrac = m > 0 ? Math.min(1, Math.max(0, xf / m)) : 0;
      if (dmIn >= 0) {
        const fromBuf = Math.min(buf, dmIn);
        xf += dmIn - fromBuf + fromBuf * bufFresh;
        buf -= fromBuf;
      } else {
        const back = -dmIn;
        bufFresh = (bufFresh * buf + xFrac * back) / (buf + back);
        buf += back;
        xf -= xFrac * back;
      }
      if (dmOut > 0) xf -= xFrac * dmOut;
      m = Math.max(1e-9, m + dmIn - dmOut);
      xf = Math.min(m, Math.max(0, xf));
      if (k >= st.kBdc0 && k < st.kBdc1) wPump += 0.5 * (p + pNew) * dV;
      p = pNew;
    }
    const ve = xf / (rho0 * e.vdCyl);
    out = { ve, xr: Math.min(0.6, Math.max(0, 1 - xf / m)), pmepRel: -wPump / e.vdCyl / p0 };
    veGuess = Math.max(0.3, Math.min(1.6, ve));
    if (carry !== 1) {
      for (let k = 0; k <= n; k++) {
        gI[k] *= carry;
        gE[k] *= carry;
      }
    }
    gIprev = gI;
    gEprev = gE;
  }
  return out;
}
