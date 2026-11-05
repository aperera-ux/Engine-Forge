import { EIGHTH_MILE_M, FOOT_M, MPH, QUARTER_MILE_M } from './globals';
import {
  resolve,
  resistance,
  rpmFromSpeed,
  tractionCap,
  msToMph,
  type Resolved,
} from './physics';
import { defaultLaunchRpm, torqueAt } from './torqueCurve';
import type { AccelResult, RunOptions, TimeSeries, TorqueCurve, VehicleSpec } from './types';

const TRAP_WINDOW_M = 66 * FOOT_M;
const V60 = 60 * MPH;
const V100K = 100 / 3.6;
const V130 = 130 * MPH;

/**
 * Time-stepped longitudinal point-mass run from rest on a level road.
 *
 * Per step: engine rpm follows wheel speed (locked clutch) except during the
 * launch, where the clutch/converter holds `launchRpm` and passes the engine
 * torque at that rpm (ramped in over clutchRampS). Wheel force =
 * T(rpm) * overallRatio * eta / r, capped by the tyre-grip limit with
 * longitudinal weight transfer (physics.tractionCap). Net force accelerates
 * m + wheel inertia + (locked) engine inertia * ratio^2 / r^2. Shifts remove
 * all drive torque for shiftTimeS; the car coasts against drag meanwhile.
 */
export function runAcceleration(spec: VehicleSpec, engine: TorqueCurve, opts: RunOptions = {}): AccelResult {
  const R = resolve(spec, engine, opts);
  const dt = opts.dt ?? 0.001;
  const rollout = opts.rollout ?? true;
  const strategy = opts.shiftStrategy ?? 'optimal';
  const shiftFrac = opts.shiftRpmFraction ?? 1.0;
  const stopDist = opts.stopDistanceM ?? QUARTER_MILE_M;
  const stopSpeed = (opts.stopSpeedMph ?? 0) * MPH;
  const maxT = opts.maxTimeS ?? 60;
  const sampleDt = opts.sampleDt ?? 0.01;
  const redline = engine.redlineRpm;
  const nG = R.ratios.length;
  const tr = spec.transmission;
  const limiter = spec.speedLimiterMph ? spec.speedLimiterMph * MPH : Infinity;
  const stall = tr.type === 'automatic' ? (tr.converterStallRatio ?? 1) : 1;
  const x0 = rollout ? FOOT_M : 0;
  const launchRpm = tr.launchRpm ?? defaultLaunchRpm(engine);

  let t = 0;
  let x = 0;
  let v = 0;
  let gi = 0;
  let phase: 'launch' | 'drive' | 'shift' = launchRpm > 0 ? 'launch' : 'drive';
  let shiftLeft = 0;
  let tLaunch = 0;

  // event times
  let tStart: number | null = rollout ? null : 0;
  let t60: number | null = null;
  let t100k: number | null = null;
  let t130: number | null = null;
  let tEighth: number | null = null;
  let vEighth: number | null = null;
  let tQuarter: number | null = null;
  let vQuarter: number | null = null;
  let tTrap0: number | null = null;
  const xTrap0 = QUARTER_MILE_M - TRAP_WINDOW_M;
  const shifts: AccelResult['shifts'] = [];

  const cap = sampleDt > 0 ? Math.ceil(maxT / sampleDt) + 2 : 0;
  const ser = cap
    ? {
        t: new Float64Array(cap),
        v: new Float64Array(cap),
        a: new Float64Array(cap),
        gear: new Int8Array(cap),
        rpm: new Float64Array(cap),
        distance: new Float64Array(cap),
        tractionLimited: new Uint8Array(cap),
      }
    : null;
  let ns = 0;
  let nextSample = 0;

  const muLaunch = R.mu * R.g.launchTractionUtilization;
  const capLaunch = tractionCap(R, muLaunch);
  const capFull = tractionCap(R, R.mu);
  const mBase = R.mass + R.mWheels;
  const ratioSq = R.ratios.map((k) => (k * k) / (R.r * R.r));

  while (t < maxT) {
    const Fres = resistance(R, v);
    let Ftr = 0;
    let rpm = rpmFromSpeed(R, v, gi);
    let meff = mBase;
    let gripLimited = false;

    if (phase === 'launch') {
      if (rpm >= launchRpm) {
        phase = 'drive';
      } else {
        const ramp = R.clutchRampS > 0 ? Math.min(1, tLaunch / R.clutchRampS) : 1;
        const sr = rpm / launchRpm;
        const mult = stall > 1 && sr < 0.85 ? 1 + (stall - 1) * (1 - sr / 0.85) : 1;
        rpm = launchRpm;
        Ftr = (torqueAt(engine, rpm) * R.ratios[gi] * R.eta * ramp * mult) / R.r;
        tLaunch += dt;
        if (Ftr > capLaunch) {
          Ftr = capLaunch;
          gripLimited = true;
        }
      }
    }
    if (phase === 'drive') {
      if (strategy === 'redline' ? rpm >= redline * shiftFrac && gi < nG - 1 : false) {
        phase = 'shift';
      } else if (strategy === 'optimal' && gi < nG - 1) {
        const rpmN = (rpm * R.ratios[gi + 1]) / R.ratios[gi];
        if (rpm >= redline - 1 || torqueAt(engine, rpmN) * R.ratios[gi + 1] >= torqueAt(engine, rpm) * R.ratios[gi]) {
          phase = 'shift';
        }
      }
      if (phase === 'shift') {
        shiftLeft = R.shiftTimeS;
        shifts.push({ t, from: gi + 1, to: gi + 2, v });
      } else {
        const Fe = (torqueAt(engine, rpm) * R.ratios[gi] * R.eta) / R.r;
        const c = gi === 0 ? capLaunch : capFull;
        Ftr = Fe;
        if (Ftr > c) {
          Ftr = c;
          gripLimited = true;
          meff = mBase;
        } else {
          meff = mBase + R.iEng * ratioSq[gi];
        }
        // rev limiter in top gear / speed governor: hold speed
        if (rpm >= redline || v >= limiter) Ftr = Math.min(Ftr, Fres);
      }
    }
    if (phase === 'shift') {
      Ftr = 0;
      rpm = rpmFromSpeed(R, v, Math.min(gi + 1, nG - 1));
    }

    const a = (Ftr - Fres) / meff;
    // sample
    if (ser && t >= nextSample && ns < cap) {
      ser.t[ns] = t;
      ser.v[ns] = v;
      ser.a[ns] = a;
      ser.gear[ns] = phase === 'shift' ? 0 : gi + 1;
      ser.rpm[ns] = rpm;
      ser.distance[ns] = x;
      ser.tractionLimited[ns] = gripLimited ? 1 : 0;
      ns++;
      nextSample += sampleDt;
    }

    // integrate (trapezoid for x)
    const vN = Math.max(0, v + a * dt);
    const xN = x + 0.5 * (v + vN) * dt;
    const tN = t + dt;

    // events (linear interpolation inside the step)
    if (tStart === null && xN >= x0) tStart = t + (dt * (x0 - x)) / (xN - x);
    const crossV = (th: number) => t + (dt * (th - v)) / (vN - v);
    if (t60 === null && v < V60 && vN >= V60) t60 = crossV(V60);
    if (t100k === null && v < V100K && vN >= V100K) t100k = crossV(V100K);
    if (t130 === null && v < V130 && vN >= V130) t130 = crossV(V130);
    const crossX = (th: number) => {
      const f = (th - x) / (xN - x);
      return { tt: t + dt * f, vv: v + (vN - v) * f };
    };
    if (tEighth === null && x < EIGHTH_MILE_M && xN >= EIGHTH_MILE_M) {
      const c = crossX(EIGHTH_MILE_M);
      tEighth = c.tt;
      vEighth = c.vv;
    }
    if (tTrap0 === null && x < xTrap0 && xN >= xTrap0) tTrap0 = crossX(xTrap0).tt;
    if (tQuarter === null && x < QUARTER_MILE_M && xN >= QUARTER_MILE_M) {
      const c = crossX(QUARTER_MILE_M);
      tQuarter = c.tt;
      vQuarter = c.vv;
    }

    t = tN;
    x = xN;
    v = vN;

    if (phase === 'shift') {
      shiftLeft -= dt;
      if (shiftLeft <= 0) {
        gi++;
        phase = 'drive';
      }
    }

    const doneDist = x >= stopDist;
    const doneSpeed = stopSpeed <= 0 || v >= stopSpeed;
    if (doneDist && doneSpeed) break;
    // stalled (e.g. non-positive net force at standstill): bail out
    if (v < 1e-6 && t > 3 && phase !== 'launch') break;
  }

  const t0 = tStart ?? 0;
  const rel = (tt: number | null) => (tt === null || tStart === null ? null : tt - t0);
  let series: TimeSeries | null = null;
  if (ser) {
    series = {
      t: ser.t.slice(0, ns),
      v: ser.v.slice(0, ns),
      a: ser.a.slice(0, ns),
      gear: ser.gear.slice(0, ns),
      rpm: ser.rpm.slice(0, ns),
      distance: ser.distance.slice(0, ns),
      tractionLimited: ser.tractionLimited.slice(0, ns),
    };
  }
  return {
    rollout,
    t0to60mph: rel(t60),
    t0to100kph: rel(t100k),
    t60to130mph: t60 !== null && t130 !== null ? t130 - t60 : null,
    eighthMileS: rel(tEighth),
    eighthMileTrapMph: vEighth === null ? null : msToMph(vEighth),
    quarterMileS: rel(tQuarter),
    quarterMileTrapMph: vQuarter === null ? null : msToMph(vQuarter),
    quarterMileTrap66ftMph:
      tQuarter !== null && tTrap0 !== null ? msToMph(TRAP_WINDOW_M / (tQuarter - tTrap0)) : null,
    series,
    shifts,
  };
}

export type { Resolved };
