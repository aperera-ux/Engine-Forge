import type { DynoPoint, SimResult } from '../sim/types';
import type { TorqueCurve } from './types';

const STEP = 25;

export interface RpmTorque {
  rpm: number;
  torqueNm: number;
}

/**
 * Build a torque table from (rpm, torque) points.
 * Below the first point torque is held flat; above the last point it follows
 * constant power (T ~ 1/rpm) up to the redline; the table is zero above the
 * redline (limiter).
 */
export function buildTorqueCurve(points: RpmTorque[], redlineRpm: number, displacementL: number): TorqueCurve {
  const pts = [...points].filter((p) => p.torqueNm > 0).sort((a, b) => a.rpm - b.rpm);
  if (pts.length === 0) throw new Error('buildTorqueCurve: no points');
  const n = Math.ceil((redlineRpm + 500) / STEP) + 2;
  const tq = new Float64Array(n);
  const first = pts[0];
  const last = pts[pts.length - 1];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const rpm = i * STEP;
    if (rpm <= first.rpm) tq[i] = first.torqueNm;
    else if (rpm >= last.rpm) tq[i] = (last.torqueNm * last.rpm) / rpm;
    else {
      while (pts[j + 1].rpm < rpm) j++;
      const a = pts[j];
      const b = pts[j + 1];
      tq[i] = a.torqueNm + ((b.torqueNm - a.torqueNm) * (rpm - a.rpm)) / (b.rpm - a.rpm);
    }
  }
  return { tq, step: STEP, redlineRpm, displacementL };
}

/** Linear lookup, Nm. Zero above the limiter. */
export function torqueAt(c: TorqueCurve, rpm: number): number {
  if (rpm <= 0) return c.tq[0];
  const x = rpm / c.step;
  const i = Math.floor(x);
  if (i >= c.tq.length - 1) return 0;
  const f = x - i;
  return c.tq[i] + (c.tq[i + 1] - c.tq[i]) * f;
}

/** Curve straight from the engine simulator's public output. */
export function curveFromSimResult(res: SimResult): TorqueCurve {
  return buildTorqueCurve(
    res.curve.map((p: DynoPoint) => ({ rpm: p.rpm, torqueNm: p.torqueNm })),
    res.config.redlineRpm,
    res.displacementL,
  );
}

export interface PublishedPeaks {
  hp: number;
  hpRpm: number;
  torqueNm: number;
  torqueRpm: number;
}

/**
 * Rescale a simulated curve to published peaks when no digitised dyno curve
 * exists: the multiplicative correction is interpolated linearly in rpm
 * between (torque-peak rpm: Tpub/Tsim) and (power-peak rpm: Ppub/Psim) and
 * held constant outside that span. The SHAPE still comes from the simulator.
 */
export function scaleCurveToPeaks(res: SimResult, pub: PublishedPeaks): TorqueCurve {
  const kT = pub.torqueNm / res.peakTorqueNm;
  const kP = pub.hp / res.peakHp;
  const r1 = Math.min(pub.torqueRpm, pub.hpRpm);
  const r2 = Math.max(pub.torqueRpm, pub.hpRpm);
  const f1 = r1 === pub.torqueRpm ? kT : kP;
  const f2 = r2 === pub.hpRpm ? kP : kT;
  const k = (rpm: number) => (rpm <= r1 ? f1 : rpm >= r2 || r2 === r1 ? f2 : f1 + ((f2 - f1) * (rpm - r1)) / (r2 - r1));
  return buildTorqueCurve(
    res.curve.map((p) => ({ rpm: p.rpm, torqueNm: p.torqueNm * k(p.rpm) })),
    res.config.redlineRpm,
    res.displacementL,
  );
}

/** Global launch-rpm rule (see Transmission.launchRpm). */
export function defaultLaunchRpm(c: TorqueCurve): number {
  let peak = 0;
  const nMax = Math.floor(c.redlineRpm / c.step);
  for (let i = 0; i <= nMax; i++) peak = Math.max(peak, c.tq[i]);
  let rpm = 0.35 * c.redlineRpm;
  for (let i = 0; i <= nMax; i++) {
    if (c.tq[i] >= 0.9 * peak) {
      rpm = i * c.step;
      break;
    }
  }
  const r = Math.min(0.65 * c.redlineRpm, Math.max(0.35 * c.redlineRpm, rpm));
  return Math.round(r / 100) * 100;
}
