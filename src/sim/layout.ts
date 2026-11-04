/**
 * Cylinder layout, crank-pin phasing, firing order and slider-crank kinematics.
 * Shared by the renderer (animation) and the simulation (balance, firing).
 *
 * Conventions
 * - Crank angle θ (deg) increases with rotation. θ = 0 is an arbitrary reference.
 * - Each cylinder axis is tilted bankAngleDeg from vertical (inline: 0,
 *   V: ∓vAngle/2, flat: ∓90). Bank A = negative angle, bank B = positive.
 * - A crank pin at pinAngleDeg sits at angle (θ + pinAngle) from vertical.
 *   A piston is at TDC when its pin angle equals its bank angle.
 * - firingPhaseDeg ∈ [0,720): crank angle θ at which that cylinder is at TDC
 *   on its compression stroke (ignition). By construction
 *   pinAngle ≡ bankAngle − firingPhase (mod 360).
 * - Cylinders are numbered 1..n: inline front→rear; V/flat: bank A 1..n/2
 *   front→rear, then bank B (n/2+1)..n front→rear (Audi/Ford style).
 */
import type { EngineConfig, Layout } from './types';

export const SUPPORTED_CYLINDERS: Record<Layout, number[]> = {
  inline: [1, 2, 3, 4, 5, 6, 8],
  v: [2, 4, 6, 8, 10, 12, 16],
  flat: [2, 4, 6, 8, 12],
};

export interface CylinderGeom {
  /** 1-based cylinder number. */
  number: number;
  /** 0 = bank A (or inline), 1 = bank B. */
  bank: 0 | 1;
  /** Index of the crank throw / pair position along the crank, 0 = front. */
  row: number;
  /** Axial position along the crankshaft from the front cylinder, mm. */
  zMm: number;
  bankAngleDeg: number;
  pinAngleDeg: number;
  firingPhaseDeg: number;
}

export interface EngineLayout {
  cylinders: CylinderGeom[];
  /** Cylinder numbers in firing sequence. */
  firingOrder: number[];
  evenFiring: boolean;
  /** Sorted firing intervals, crank deg. */
  firingIntervalsDeg: number[];
  /** Number of rows (throws) along the crank. */
  rows: number;
  /** Cylinder-center spacing along the crank, mm. */
  boreSpacingMm: number;
  /** Axial offset of bank B relative to bank A (rod-width stagger), mm. */
  bankOffsetMm: number;
}

const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Inline firing orders (cylinder numbers), used directly and per-bank. */
const INLINE_FO: Record<number, number[]> = {
  1: [1],
  2: [1, 2],
  3: [1, 2, 3],
  4: [1, 3, 4, 2],
  5: [1, 2, 4, 5, 3],
  6: [1, 5, 3, 6, 2, 4],
  8: [1, 6, 2, 5, 8, 3, 7, 4],
};

/**
 * Hand-specified firing orders (in this module's numbering) for engines whose
 * real-world crank design is not the generic even-fire construction.
 * Values are explicit firing phases per cylinder number (index 0 = cyl 1).
 */
function specialPhases(cfg: EngineConfig): number[] | null {
  const n = cfg.cylinders;
  if (cfg.layout === 'v' && n === 8) {
    // Phases for cyl 1..8 (A1..A4, B1..B4).
    if (cfg.crankPlane === 'flat') {
      // FO 1-5-3-7-4-8-2-6 : each bank fires like an I4 (1-3-4-2).
      return phasesFromOrder([1, 5, 3, 7, 4, 8, 2, 6], n, cfg.vAngleDeg);
    }
    // Crossplane, Ford-style FO 1-5-4-2-6-3-7-8.
    return phasesFromOrder([1, 5, 4, 2, 6, 3, 7, 8], n, cfg.vAngleDeg);
  }
  if (cfg.layout === 'v' && n === 2) {
    // Shared-pin V-twin: B fires vAngle after A's next revolution (uneven).
    return [0, 360 + cfg.vAngleDeg];
  }
  if (cfg.layout === 'flat' && n === 2) return [0, 360];
  if (cfg.layout === 'flat' && n === 4) {
    // True boxer FO 1-4-3-2 (Subaru-equivalent).
    return phasesFromOrder([1, 4, 3, 2], n, 180);
  }
  if (cfg.layout === 'flat' && n === 6) {
    // True boxer FO 1-6-2-4-3-5 (Porsche-equivalent).
    return phasesFromOrder([1, 6, 2, 4, 3, 5], n, 180);
  }
  return null;
}

/** Even-interval phases from an explicit firing order. */
function phasesFromOrder(order: number[], n: number, _v: number): number[] {
  const phases = new Array<number>(n).fill(0);
  const interval = 720 / n;
  order.forEach((cyl, k) => (phases[cyl - 1] = k * interval));
  return phases;
}

export function computeLayout(cfg: EngineConfig): EngineLayout {
  const n = cfg.cylinders;
  const layout = cfg.layout;
  const half = layout === 'inline' ? n : n / 2;
  const v = layout === 'flat' ? 180 : layout === 'v' ? cfg.vAngleDeg : 0;
  const bankA = layout === 'inline' ? 0 : -v / 2;
  const bankB = layout === 'inline' ? 0 : v / 2;

  let phases = specialPhases(cfg);
  if (!phases) {
    phases = new Array<number>(n).fill(0);
    if (layout === 'inline') {
      const fo = INLINE_FO[n] ?? Array.from({ length: n }, (_, i) => i + 1);
      fo.forEach((cyl, k) => (phases![cyl - 1] = (k * 720) / n));
    } else {
      // Bank A fires as an inline-half; bank B follows each A cylinder by 720/n.
      const fo = INLINE_FO[half] ?? Array.from({ length: half }, (_, i) => i + 1);
      fo.forEach((cyl, k) => {
        const pa = (k * 1440) / n;
        phases![cyl - 1] = pa;
        phases![half + cyl - 1] = mod(pa + 720 / n, 720);
      });
    }
  }

  // Geometry along the crank.
  const bore = cfg.boreMm;
  const boreSpacingMm = bore * 1.18 + 8; // typical siamese-ish spacing
  const bankOffsetMm = layout === 'inline' ? 0 : Math.min(bore * 0.25, 28);

  const cylinders: CylinderGeom[] = [];
  for (let i = 0; i < n; i++) {
    const bank: 0 | 1 = layout === 'inline' || i < half ? 0 : 1;
    const row = layout === 'inline' ? i : i % half;
    const bankAngleDeg = bank === 0 ? bankA : bankB;
    const firingPhaseDeg = mod(phases[i], 720);
    const pinAngleDeg = mod(bankAngleDeg - firingPhaseDeg, 360);
    cylinders.push({
      number: i + 1,
      bank,
      row,
      zMm: row * boreSpacingMm + (bank === 1 ? bankOffsetMm : 0),
      bankAngleDeg,
      pinAngleDeg,
      firingPhaseDeg,
    });
  }

  const firingOrder = [...cylinders]
    .sort((a, b) => a.firingPhaseDeg - b.firingPhaseDeg)
    .map((c) => c.number);
  const sortedPh = [...cylinders].map((c) => c.firingPhaseDeg).sort((a, b) => a - b);
  const intervals = sortedPh.map((p, i) =>
    i === sortedPh.length - 1 ? 720 - p + sortedPh[0] : sortedPh[i + 1] - p,
  );
  const evenFiring = intervals.every((d) => Math.abs(d - 720 / n) < 0.5);

  return {
    cylinders,
    firingOrder,
    evenFiring,
    firingIntervalsDeg: intervals,
    rows: half,
    boreSpacingMm,
    bankOffsetMm,
  };
}

/** Local crank angle from this cylinder's TDC, deg in [0,360). */
export function localCrankAngle(cyl: CylinderGeom, thetaDeg: number): number {
  return mod(thetaDeg + cyl.pinAngleDeg - cyl.bankAngleDeg, 360);
}

/** Position in the 4-stroke cycle, deg in [0,720). 0 = TDC compression (firing). */
export function cyclePhase(cyl: CylinderGeom, thetaDeg: number): number {
  return mod(thetaDeg - cyl.firingPhaseDeg, 720);
}

export type Stroke = 'power' | 'exhaust' | 'intake' | 'compression';
export function strokeAt(cyl: CylinderGeom, thetaDeg: number): Stroke {
  const p = cyclePhase(cyl, thetaDeg);
  if (p < 180) return 'power';
  if (p < 360) return 'exhaust';
  if (p < 540) return 'intake';
  return 'compression';
}

/**
 * Slider-crank kinematics. φ = local crank angle (rad) from TDC.
 * r = crank radius (stroke/2), l = rod length. Returns piston distance
 * DOWN from TDC (same unit as r,l), velocity and acceleration per ω, ω².
 */
export function pistonDisplacement(phiRad: number, r: number, l: number): number {
  const s = Math.sin(phiRad);
  return r * (1 - Math.cos(phiRad)) + l - Math.sqrt(l * l - r * r * s * s);
}

/** dx/dφ — multiply by ω (rad/s) for velocity. */
export function pistonVelocityFactor(phiRad: number, r: number, l: number): number {
  const s = Math.sin(phiRad);
  const c = Math.cos(phiRad);
  return r * s + (r * r * s * c) / Math.sqrt(l * l - r * r * s * s);
}

/** d²x/dφ² — multiply by ω² for acceleration. */
export function pistonAccelFactor(phiRad: number, r: number, l: number): number {
  const s = Math.sin(phiRad);
  const c = Math.cos(phiRad);
  const q = l * l - r * r * s * s;
  return r * c + (r * r * (c * c - s * s)) / Math.sqrt(q) + (r * r * r * r * s * s * c * c) / Math.pow(q, 1.5);
}

/**
 * Rod angle (rad) from cylinder axis for local crank angle φ: sin β = (r/l) sin φ.
 */
export function rodAngle(phiRad: number, r: number, l: number): number {
  return Math.asin((r / l) * Math.sin(phiRad));
}
