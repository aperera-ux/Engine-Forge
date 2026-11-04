/**
 * Friction: Chen–Flynn style mechanical FMEP, valvetrain and accessory terms,
 * and pumping MEP (gas exchange). All bar.
 */
import type { EngineConfig } from '../types';
import { CAL } from './constants';

export function mechanicalFmep(c: EngineConfig, sp: number, pMaxBar: number, rpm: number): number {
  const base = CAL.fA + CAL.fB * pMaxBar + CAL.fC * sp + CAL.fD * sp * sp;
  // Smaller cylinders carry more ring/bearing area per unit displacement.
  const cylCc = (Math.PI / 4) * (c.boreMm / 10) ** 2 * (c.strokeMm / 10);
  const sizeF = Math.pow(500 / Math.max(50, cylCc), 0.12);
  // Valvetrain: cam bearings/followers; scales with valves and cam speed.
  const vt = CAL.valvetrainFmep[c.valvetrain] * (0.6 + 0.1 * c.valvesPerCylinder) * (0.7 + 0.3 * Math.min(2, rpm / 6000));
  // Accessories (oil + water pump, alternator) — mostly speed dependent.
  const acc = 0.08 + 0.025 * (rpm / 1000);
  return base * sizeF + vt + acc;
}

/**
 * Pumping MEP: exhaust-minus-intake pressure work plus valve/port flow loss
 * that grows with the inlet and exhaust Mach indices.
 */
export function pumpingMep(pExhBar: number, pManBar: number, z: number, zExh: number): number {
  return pExhBar - pManBar + 0.55 * z * z * pManBar + 0.25 * zExh * zExh;
}
