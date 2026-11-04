/**
 * Mechanical limits: valve float (spring force vs valvetrain inertia),
 * rotating-assembly inertia-load limit, and dry mass estimate.
 */
import type { EngineConfig } from '../types';
import type { Geometry } from './geometry';

/** Effective valvetrain mass beyond the valve itself (retainer, 1/3 spring, follower, rocker/pushrod reflected), g. */
const VT_EXTRA_G = { pushrod: 130, sohc: 55, dohc: 48 } as const;
/** Valvetrain stiffness/spring-package factor. */
const VT_STIFF = { pushrod: 0.95, sohc: 1.0, dohc: 1.05 } as const;

export function valveMassG(diaMm: number): number {
  return 45 * (diaMm / 35) ** 2;
}

/**
 * Valve float rpm. Required spring force ∝ m_eff · lift · (ω / duration)²,
 * spring capacity scales with valve size (bigger valves, bigger springs).
 */
export function valveFloatRpm(c: EngineConfig): number {
  const side = (d: number, lift: number, dur: number) => {
    const mEff = valveMassG(d) + VT_EXTRA_G[c.valvetrain];
    const spring = Math.pow(d / 35, 1.5) * VT_STIFF[c.valvetrain];
    const adv = dur + 40;
    return 1320 * Math.sqrt(spring / ((mEff * lift) / (adv * adv)));
  };
  const cam = c.cam;
  const nI = side(c.intakeValveMm, cam.intakeLiftMm, cam.intakeDurationDeg);
  const nE = side(c.exhaustValveMm, cam.exhaustLiftMm, cam.exhaustDurationDeg);
  return Math.min(nI, nE);
}

const ROD_CAP_KN = { cast: 20, 'forged-steel': 33, 'billet-steel': 40, titanium: 38 } as const;
const PISTON_CAP_KN = { cast: 27, hypereutectic: 29, forged: 36 } as const;
const CRANK_F = { cast: 0.93, forged: 1.0, billet: 1.06 } as const;
/** Peak cylinder pressure capability, bar. */
export const PISTON_PMAX = { cast: 120, hypereutectic: 130, forged: 170 } as const;
export const ROD_PMAX = { cast: 140, 'forged-steel': 180, 'billet-steel': 210, titanium: 190 } as const;

export function reciprocatingMassKg(c: EngineConfig): number {
  const pist = 0.3 * Math.pow(c.boreMm / 86, 2.5) * (c.pistons === 'forged' ? 1.0 : 1.05);
  const pinRings = 0.35 * pist;
  const rodMass = 0.5 * (c.rodLengthMm / 139) * Math.pow(c.boreMm / 86, 1.5) * (c.rods === 'titanium' ? 0.6 : 1);
  return pist + pinRings + rodMass / 3;
}

/** Rpm at which TDC inertia load reaches the weakest component's safe capacity. */
export function mechanicalLimitRpm(c: EngineConfig, g: Geometry): number {
  const scale = (c.boreMm / 86) ** 2;
  const cap = Math.min(ROD_CAP_KN[c.rods], PISTON_CAP_KN[c.pistons]) * 1000 * scale;
  const m = reciprocatingMassKg(c);
  const accelPerW2 = g.r * (1 + g.r / g.l);
  const w = Math.sqrt(cap / (m * accelPerW2));
  return ((w * 60) / (2 * Math.PI)) * CRANK_F[c.crank];
}

export function estimateMassKg(c: EngineConfig): number {
  const dispL = (c.cylinders * Math.PI * (c.boreMm / 10) ** 2 * (c.strokeMm / 10)) / 4000;
  const n = c.cylinders;
  const banks = c.layout === 'inline' ? 1 : 2;
  const iron = c.blockMaterial === 'iron';
  // Block + crank + rods + pistons.
  const blockF = c.layout === 'inline' ? 1.0 : c.layout === 'v' ? 0.85 : 0.9;
  let block = (26 + 12 * dispL + 2.6 * n) * blockF;
  block *= iron ? 1.3 : 1.0;
  // Heads (aluminum), cams, valvetrain.
  const perCyl = c.valvetrain === 'pushrod' ? 3.2 : c.valvetrain === 'sohc' ? 4.8 : 6.2;
  const heads = banks * 4 + n * perCyl * (0.75 + 0.06 * c.valvesPerCylinder) * Math.pow(c.boreMm / 86, 1.2);
  // Intake, exhaust manifolds, flywheel-less ancillaries (pumps, alternator).
  const ancillary = 18 + 2.0 * n + 3 * dispL;
  let extra = 0;
  if (c.induction === 'turbo') extra += c.turbo.count * 8 + 4 + (c.turbo.intercoolerEffectiveness > 0 ? 6 : 0);
  if (c.induction === 'supercharger') extra += 22 + (c.supercharger.intercoolerEffectiveness > 0 ? 8 : 0);
  if (c.itb) extra += 3;
  return block + heads + ancillary + extra;
}
