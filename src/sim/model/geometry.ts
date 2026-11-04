/**
 * Derived geometry: displacement, valve areas, slider-crank volume arrays,
 * piston speed and acceleration (uses layout.ts kinematics).
 */
import type { EngineConfig } from '../types';
import { pistonAccelFactor, pistonDisplacement, SUPPORTED_CYLINDERS } from '../layout';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

/**
 * Returns a numerically safe copy of the config (no NaN, physically
 * realisable ranges). The original config is what is echoed in SimResult.
 */
export function sanitize(c: EngineConfig): EngineConfig {
  const layout = c.layout === 'v' || c.layout === 'flat' ? c.layout : 'inline';
  const allowed = SUPPORTED_CYLINDERS[layout];
  let cyl = Math.round(num(c.cylinders, 4));
  if (!allowed.includes(cyl)) cyl = allowed.reduce((a, b) => (Math.abs(b - cyl) < Math.abs(a - cyl) ? b : a));
  const bore = clamp(num(c.boreMm, 86), 30, 200);
  const stroke = clamp(num(c.strokeMm, 86), 30, 200);
  const rod = Math.max(clamp(num(c.rodLengthMm, 1.6 * stroke), 40, 400), stroke * 0.55 + 5);
  const vpc = clamp(Math.round(num(c.valvesPerCylinder, 4)), 2, 5);
  const cam = c.cam ?? ({} as EngineConfig['cam']);
  const t = c.turbo ?? ({} as EngineConfig['turbo']);
  const s = c.supercharger ?? ({} as EngineConfig['supercharger']);
  const redline = clamp(num(c.redlineRpm, 7000), 1500, 25000);
  return {
    ...c,
    layout,
    cylinders: cyl,
    vAngleDeg: layout === 'flat' ? 180 : layout === 'v' ? clamp(num(c.vAngleDeg, 90), 10, 170) : 0,
    crankPlane: c.crankPlane === 'flat' ? 'flat' : 'cross',
    boreMm: bore,
    strokeMm: stroke,
    rodLengthMm: rod,
    compressionRatio: clamp(num(c.compressionRatio, 10), 5, 20),
    valvetrain: c.valvetrain === 'pushrod' || c.valvetrain === 'sohc' ? c.valvetrain : 'dohc',
    valvesPerCylinder: vpc,
    intakeValveMm: clamp(num(c.intakeValveMm, bore * 0.4), 8, bore),
    exhaustValveMm: clamp(num(c.exhaustValveMm, bore * 0.34), 8, bore),
    cam: {
      intakeDurationDeg: clamp(num(cam.intakeDurationDeg, 230), 150, 340),
      exhaustDurationDeg: clamp(num(cam.exhaustDurationDeg, 230), 150, 340),
      intakeLiftMm: clamp(num(cam.intakeLiftMm, 10), 2, 25),
      exhaustLiftMm: clamp(num(cam.exhaustLiftMm, 10), 2, 25),
      lobeSeparationDeg: clamp(num(cam.lobeSeparationDeg, 112), 95, 130),
      intakeCenterlineDeg: clamp(num(cam.intakeCenterlineDeg, 108), 80, 140),
      vvt: !!cam.vvt,
      variableLift: !!cam.variableLift,
    },
    induction: c.induction === 'turbo' || c.induction === 'supercharger' ? c.induction : 'na',
    turbo: {
      targetBoostBar: clamp(num(t.targetBoostBar, 1), 0, 5),
      compressorInducerMm: clamp(num(t.compressorInducerMm, 50), 25, 130),
      turbineAR: clamp(num(t.turbineAR, 0.63), 0.3, 2),
      intercoolerEffectiveness: clamp(num(t.intercoolerEffectiveness, 0.7), 0, 1),
      twinScroll: !!t.twinScroll,
      count: t.count === 2 ? 2 : 1,
    },
    supercharger: {
      type: s.type === 'roots' || s.type === 'centrifugal' ? s.type : 'twin-screw',
      targetBoostBar: clamp(num(s.targetBoostBar, 0.5), 0, 4),
      intercoolerEffectiveness: clamp(num(s.intercoolerEffectiveness, 0.6), 0, 1),
    },
    intakeRunnerMm: clamp(num(c.intakeRunnerMm, 300), 0, 1500),
    throttleMm: clamp(num(c.throttleMm, 60), 10, 400),
    itb: !!c.itb,
    exhaust: ['log', 'shorty', 'long-tube', 'tuned-equal'].includes(c.exhaust) ? c.exhaust : 'shorty',
    headerPrimaryMm: clamp(num(c.headerPrimaryMm, 600), 50, 3000),
    headerDiameterMm: clamp(num(c.headerDiameterMm, 40), 10, 150),
    fuel: ['gas87', 'gas91', 'gas93', 'race100', 'e85', 'methanol'].includes(c.fuel) ? c.fuel : 'gas91',
    lambda: clamp(num(c.lambda, 0.88), 0.6, 1.4),
    directInjection: !!c.directInjection,
    redlineRpm: redline,
    idleRpm: clamp(num(c.idleRpm, 800), 300, redline - 500),
    blockMaterial: c.blockMaterial === 'iron' ? 'iron' : 'aluminum',
    pistons: c.pistons === 'cast' || c.pistons === 'hypereutectic' ? c.pistons : 'forged',
    rods: ['cast', 'forged-steel', 'billet-steel', 'titanium'].includes(c.rods) ? c.rods : 'forged-steel',
    crank: c.crank === 'cast' || c.crank === 'billet' ? c.crank : 'forged',
  };
}

export interface Geometry {
  /** Swept volume per cylinder, m³. */
  vdCyl: number;
  vdTotal: number;
  /** Clearance volume, m³. */
  vc: number;
  r: number; // crank radius m
  l: number; // rod m
  bore: number; // m
  stroke: number; // m
  pistonArea: number; // m²
  nIntake: number;
  nExhaust: number;
  /** Total intake valve head area per cylinder, m². */
  intakeArea: number;
  exhaustArea: number;
  /** Volume at crank angle index i (deg from TDC-compression = 0, -180..+180 step 1). */
  vol: Float64Array;
  /** (vol[i]/vol[i+1])^1.3 — polytropic step factor for the cycle integration. */
  polyStep: Float64Array;
}

export function valveCounts(vpc: number): { nI: number; nE: number } {
  switch (vpc) {
    case 2: return { nI: 1, nE: 1 };
    case 3: return { nI: 2, nE: 1 };
    case 5: return { nI: 3, nE: 2 };
    default: return { nI: 2, nE: 2 };
  }
}

export function computeGeometry(c: EngineConfig): Geometry {
  const bore = c.boreMm / 1000;
  const stroke = c.strokeMm / 1000;
  const r = stroke / 2;
  const l = c.rodLengthMm / 1000;
  const pistonArea = (Math.PI / 4) * bore * bore;
  const vdCyl = pistonArea * stroke;
  const vc = vdCyl / (c.compressionRatio - 1);
  const { nI, nE } = valveCounts(c.valvesPerCylinder);
  const vol = new Float64Array(361);
  for (let i = 0; i <= 360; i++) {
    const phi = ((i - 180) * Math.PI) / 180;
    vol[i] = vc + pistonArea * pistonDisplacement(phi, r, l);
  }
  const polyStep = new Float64Array(360);
  for (let i = 0; i < 360; i++) polyStep[i] = Math.pow(vol[i] / vol[i + 1], 1.3);
  return {
    polyStep,
    vdCyl,
    vdTotal: vdCyl * c.cylinders,
    vc,
    r,
    l,
    bore,
    stroke,
    pistonArea,
    nIntake: nI,
    nExhaust: nE,
    intakeArea: nI * (Math.PI / 4) * (c.intakeValveMm / 1000) ** 2,
    exhaustArea: nE * (Math.PI / 4) * (c.exhaustValveMm / 1000) ** 2,
    vol,
  };
}

export const meanPistonSpeed = (strokeM: number, rpm: number) => (2 * strokeM * rpm) / 60;

/** Max |piston acceleration| (m/s²) at rpm — occurs at TDC for any real rod ratio. */
export function maxPistonAccel(g: Geometry, rpm: number): number {
  const w = (rpm * 2 * Math.PI) / 60;
  let m = 0;
  for (let d = 0; d <= 180; d += 2) {
    const a = Math.abs(pistonAccelFactor((d * Math.PI) / 180, g.r, g.l));
    if (a > m) m = a;
  }
  return m * w * w;
}

/** Fraction of stroke the piston rises between BDC and `deg` after BDC. */
export function riseFractionAfterBdc(g: Geometry, deg: number): number {
  const xb = pistonDisplacement(Math.PI, g.r, g.l);
  const x = pistonDisplacement(Math.PI + (deg * Math.PI) / 180, g.r, g.l);
  return Math.max(0, (xb - x) / g.stroke);
}
