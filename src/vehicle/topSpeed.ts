import { MPH } from './globals';
import { resolve, resistance, rpmFromSpeed, speedFromRpm, msToKph, msToMph } from './physics';
import { torqueAt } from './torqueCurve';
import type { RunOptions, TopSpeed, TorqueCurve, VehicleSpec } from './types';

/**
 * Steady-state top speed: for each gear find the highest speed <= the
 * redline speed at which engine wheel force still covers rolling + drag; the
 * best gear wins. limitedBy:
 *  - 'redline'  net force is still positive at the rev limit in the best gear
 *               (the car is gear-limited and would pull further with taller gearing)
 *  - 'power'    drag balances the engine force below redline (aero/power limited)
 *  - 'limiter'  an electronic speed governor binds first
 */
export function topSpeed(spec: VehicleSpec, engine: TorqueCurve, opts: RunOptions = {}): TopSpeed {
  const R = resolve(spec, engine, opts);
  const lim = spec.speedLimiterMph ? spec.speedLimiterMph * MPH : Infinity;
  let best = { v: 0, gear: 1, redline: false };
  for (let gi = 0; gi < R.ratios.length; gi++) {
    const vRed = speedFromRpm(R, engine.redlineRpm, gi);
    const net = (v: number) => (torqueAt(engine, rpmFromSpeed(R, v, gi)) * R.ratios[gi] * R.eta) / R.r - resistance(R, v);
    let vTop: number;
    let atRedline = false;
    if (net(vRed * 0.9999) > 0) {
      vTop = vRed;
      atRedline = true;
    } else {
      // the force balance can cross zero more than once on a bumpy curve; take the highest
      // sign change <= vRed by scanning down from the redline speed.
      const steps = 400;
      let hi = vRed;
      let lo = -1;
      for (let i = 1; i <= steps; i++) {
        const vv = vRed * (1 - i / steps);
        if (net(vv) > 0) {
          lo = vv;
          break;
        }
        hi = vv;
      }
      if (lo < 0) continue; // cannot sustain any speed in this gear
      for (let k = 0; k < 40; k++) {
        const mid = 0.5 * (lo + hi);
        if (net(mid) > 0) lo = mid;
        else hi = mid;
      }
      vTop = lo;
    }
    if (vTop > best.v) best = { v: vTop, gear: gi + 1, redline: atRedline };
  }
  let limitedBy: TopSpeed['limitedBy'] = best.redline ? 'redline' : 'power';
  let v = best.v;
  if (v > lim) {
    v = lim;
    limitedBy = 'limiter';
  }
  return { speedMs: v, speedMph: msToMph(v), speedKph: msToKph(v), gear: best.gear, limitedBy };
}
