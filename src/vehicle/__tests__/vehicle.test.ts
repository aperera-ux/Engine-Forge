import { describe, expect, it } from 'vitest';
import { runAcceleration, topSpeed, optimizeGearing, buildTorqueCurve, tireRollingRadiusM, airDensity, tractionCap } from '../index';
import { resolve, resistance } from '../physics';
import { REFERENCE_CARS } from '../validation/referenceCars';
import { curveFor } from '../validation/run';
import type { TorqueCurve, VehicleSpec } from '../types';

const car = REFERENCE_CARS.find((c) => c.id === 'cadillac-ctsv-2009')!;
const base = curveFor(car.engineId, 'published').curve;
const scaled = (c: TorqueCurve, k: number): TorqueCurve => ({ ...c, tq: c.tq.map((x) => x * k) });
const withSpec = (over: Partial<VehicleSpec>): VehicleSpec => ({ ...car.spec, ...over });

describe('physics sanity', () => {
  it('more power is never slower', () => {
    let prev = Infinity;
    for (const k of [0.8, 0.9, 1.0, 1.1, 1.3]) {
      const r = runAcceleration(car.spec, scaled(base, k), { sampleDt: 0 });
      expect(r.quarterMileS!).toBeLessThanOrEqual(prev + 1e-9);
      expect(r.t0to60mph!).toBeGreaterThan(0);
      prev = r.quarterMileS!;
    }
  });
  it('more mass is slower', () => {
    const a = runAcceleration(car.spec, base, { sampleDt: 0 });
    const b = runAcceleration(withSpec({ curbMassKg: car.spec.curbMassKg + 150 }), base, { sampleDt: 0 });
    expect(b.quarterMileS!).toBeGreaterThan(a.quarterMileS!);
    expect(b.t0to60mph!).toBeGreaterThan(a.t0to60mph!);
    expect(b.quarterMileTrapMph!).toBeLessThan(a.quarterMileTrapMph!);
  });
  it('more grip is never slower; less grip is slower', () => {
    const t = (mu: number) => runAcceleration(withSpec({ muPeak: mu }), base, { sampleDt: 0 }).t0to60mph!;
    expect(t(0.6)).toBeGreaterThan(t(1.0));
    expect(t(1.0)).toBeGreaterThanOrEqual(t(1.5) - 1e-9);
  });
  it('drag makes top speed finite and lowers it', () => {
    const lowDrag = topSpeed(withSpec({ cdA: 0.4 }), base);
    const hiDrag = topSpeed(withSpec({ cdA: 1.2 }), base);
    expect(Number.isFinite(hiDrag.speedMph)).toBe(true);
    expect(hiDrag.speedMph).toBeLessThan(lowDrag.speedMph);
    expect(hiDrag.limitedBy).toBe('power');
    // very short gearing -> redline limited
    const short = topSpeed(withSpec({ transmission: { ...car.spec.transmission, finalDrive: 8 } }), base);
    expect(short.limitedBy).toBe('redline');
  });
  it('rollout deducts time', () => {
    const on = runAcceleration(car.spec, base, { rollout: true, sampleDt: 0 });
    const off = runAcceleration(car.spec, base, { rollout: false, sampleDt: 0 });
    expect(on.t0to60mph!).toBeLessThan(off.t0to60mph!);
    expect(off.t0to60mph! - on.t0to60mph!).toBeLessThan(0.5);
  });
  it('time-series is monotonic in time and distance', () => {
    const r = runAcceleration(car.spec, base, { stopSpeedMph: 130 });
    const s = r.series!;
    for (let i = 1; i < s.t.length; i++) {
      expect(s.t[i]).toBeGreaterThan(s.t[i - 1]);
      expect(s.distance[i]).toBeGreaterThanOrEqual(s.distance[i - 1]);
    }
    expect(r.t60to130mph).not.toBeNull();
    expect(r.shifts.length).toBeGreaterThanOrEqual(2);
  });
  it('traction cap includes weight transfer (RWD cap above static mu*W_rear)', () => {
    const R = resolve(car.spec, base, {});
    const staticCap = R.mu * R.mass * 9.80665 * (1 - car.spec.frontWeightFraction);
    expect(tractionCap(R, R.mu)).toBeGreaterThan(staticCap);
  });
  it('helpers', () => {
    expect(tireRollingRadiusM('255/35R19')).toBeCloseTo(0.3206, 3);
    expect(airDensity({ tempC: 15, pressureKPa: 101.325 })).toBeCloseTo(1.225, 2);
    expect(airDensity({ tempC: 35, pressureKPa: 95 })).toBeLessThan(1.1);
  });
});

describe('energy consistency', () => {
  const constPower = (P: number, lo: number, hi: number) => {
    const pts = [];
    for (let rpm = lo; rpm <= hi; rpm += 25) pts.push({ rpm, torqueNm: P / ((rpm * 2 * Math.PI) / 60) });
    return buildTorqueCurve(pts, hi, 3);
  };
  it('KE gain + resistive work = eta * engine power * dt (constant-power engine, one gear)', () => {
    const P = 200e3;
    const curve = constPower(P, 1000, 12000);
    const spec: VehicleSpec = {
      ...car.spec,
      engineInertiaKgM2: 0,
      wheelMassKg: 0,
      muPeak: 50,
      transmission: { type: 'dct', gearRatios: [3.0], finalDrive: 1.0, launchRpm: 0 },
    };
    const R = resolve(spec, curve, {});
    const dt = 0.001;
    const r = runAcceleration(spec, curve, { rollout: false, dt, sampleDt: dt, stopDistanceM: 0, stopSpeedMph: 90, maxTimeS: 60 });
    const s = r.series!;
    let i0 = 0;
    while (s.rpm[i0] < 1500) i0++;
    const i1 = s.t.length - 1;
    let work = 0;
    for (let i = i0; i < i1; i++) {
      work += 0.5 * (resistance(R, s.v[i]) * s.v[i] + resistance(R, s.v[i + 1]) * s.v[i + 1]) * dt;
    }
    const dKE = 0.5 * R.mass * (s.v[i1] ** 2 - s.v[i0] ** 2);
    const input = R.eta * P * (s.t[i1] - s.t[i0]);
    expect(Math.abs(dKE + work - input) / input).toBeLessThan(0.003);
  });
  it('drag-free constant power gives v = sqrt(v0^2 + 2 eta P dt / m)', () => {
    const P = 150e3;
    const curve = constPower(P, 500, 20000);
    const spec: VehicleSpec = {
      ...car.spec,
      cdA: 0,
      crr0: 0,
      crr2: 0,
      engineInertiaKgM2: 0,
      wheelMassKg: 0,
      muPeak: 50,
      transmission: { type: 'dct', gearRatios: [2.0], finalDrive: 1.0, launchRpm: 0 },
    };
    const R = resolve(spec, curve, {});
    const r = runAcceleration(spec, curve, { rollout: false, sampleDt: 0.001, stopDistanceM: 0, stopSpeedMph: 100, maxTimeS: 60 });
    const s = r.series!;
    const i = s.t.findIndex((t) => t >= 5);
    const j = s.t.findIndex((t) => t >= 2);
    const vA = Math.sqrt(s.v[j] ** 2 + (2 * R.eta * P * (s.t[i] - s.t[j])) / R.mass);
    expect(Math.abs(s.v[i] - vA) / vA).toBeLessThan(0.002);
  });
});

describe('determinism & performance', () => {
  it('is deterministic', () => {
    const a = runAcceleration(car.spec, base, { stopSpeedMph: 130 });
    const b = runAcceleration(car.spec, base, { stopSpeedMph: 130 });
    expect(JSON.stringify({ ...a, series: null })).toBe(JSON.stringify({ ...b, series: null }));
    expect(Array.from(a.series!.v)).toEqual(Array.from(b.series!.v));
  });
  it('quarter-mile run < 20 ms', () => {
    runAcceleration(car.spec, base, { sampleDt: 0 });
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      runAcceleration(car.spec, base, { sampleDt: 0 });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[3]).toBeLessThan(20);
  });
});

describe('gearing optimizer', () => {
  it('never worse than baseline, fast, respects constraints', () => {
    const t0 = performance.now();
    const o = optimizeGearing(car.spec, base, { objective: 'quarter-mile' });
    expect(o.best).toBeLessThanOrEqual(o.baseline + 1e-9);
    expect(o.finalDrive).toBeGreaterThan(car.spec.transmission.finalDrive * 0.7 - 1e-9);
    expect(performance.now() - t0).toBeLessThan(3000);
    const o2 = optimizeGearing(car.spec, base, { objective: '0-60', gearRatios: true, finalDrive: false });
    expect(o2.best).toBeLessThanOrEqual(o2.baseline + 1e-9);
    for (let i = 1; i < o2.gearRatios.length; i++) expect(o2.gearRatios[i - 1] / o2.gearRatios[i]).toBeGreaterThanOrEqual(1.05 - 1e-9);
  });
});
