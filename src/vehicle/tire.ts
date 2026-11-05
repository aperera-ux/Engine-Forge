import type { Ambient } from './types';

/**
 * Loaded rolling radius from a metric tyre code like "255/35R19" or "255/35ZR19".
 * Unloaded radius = rim/2 + width*aspect; rolling radius ~ 0.97 of that (a common
 * approximation for radial tyres at road speed; the true value depends on load,
 * pressure and speed growth, +-1 %).
 */
export function tireRollingRadiusM(code: string, rollingFactor = 0.97): number {
  const m = /^(\d{3})\/(\d{2})\s*Z?R\s*(\d{2})$/i.exec(code.trim());
  if (!m) throw new Error(`bad tire code: ${code}`);
  const width = Number(m[1]);
  const aspect = Number(m[2]);
  const rimIn = Number(m[3]);
  const unloaded = (rimIn * 25.4) / 2 + (width * aspect) / 100;
  return (unloaded * rollingFactor) / 1000;
}

/** Moist-air density, kg/m^3, from ambient conditions (Magnus saturation pressure). */
export function airDensity(a: Ambient): number {
  const T = a.tempC + 273.15;
  const p = a.pressureKPa * 1000;
  const psat = 610.94 * Math.exp((17.625 * a.tempC) / (a.tempC + 243.04));
  const pv = (a.humidity ?? 0) * psat;
  return (p - pv) / (287.05 * T) + pv / (461.5 * T);
}

/** Normalised longitudinal slip curve D(kappa) in [0,1], peak 1 at slipPeak(). Pacejka-like with E = 0. */
export function slipCurve(kappa: number, B: number, C: number): number {
  const k = Math.abs(kappa);
  return Math.sin(C * Math.atan(B * k));
}

/** Slip ratio of the force peak. */
export function slipPeak(B: number, C: number): number {
  return Math.tan(Math.PI / (2 * C)) / B;
}

/** Inverse of the RISING branch: slip ratio that produces fraction rho (0..1) of peak force. */
export function slipForForceFraction(rho: number, B: number, C: number): number {
  const x = Math.min(1, Math.max(0, rho));
  return Math.tan(Math.asin(x) / C) / B;
}
