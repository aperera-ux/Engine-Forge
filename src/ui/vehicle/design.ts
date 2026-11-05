/**
 * The editable vehicle "design": the physics VehicleSpec plus the UI-only
 * inputs that are not part of it (tyre code, frontal area behind Cd*A, run
 * conditions). This is what the store holds and what the Garage saves.
 */
import type { Ambient, ShiftStrategy, TireClass, TransmissionType, VehicleSpec } from '../../vehicle';
import { tireRollingRadiusM } from '../../vehicle';
import type { ReferenceCar } from '../../vehicle/validation/referenceCars';

export interface VehicleDesign {
  spec: VehicleSpec;
  /** Metric tyre code the radius came from ('' when it was set directly or comes from a preset). */
  tireCode: string;
  /** Frontal area, m^2. spec.cdA = Cd * frontalAreaM2. */
  frontalAreaM2: number;
  shiftStrategy: ShiftStrategy;
  /** Redline strategy shifts at this fraction of the limiter. */
  shiftRpmFraction: number;
  ambient: Required<Pick<Ambient, 'tempC' | 'pressureKPa'>>;
  rollout: boolean;
  /** Reference car id this design was loaded from (label only). */
  presetId: string | null;
}

export const DEFAULT_AMBIENT = { tempC: 20, pressureKPa: 101.325 };

export const DEFAULT_DESIGN: VehicleDesign = {
  spec: {
    name: 'Custom sports coupe',
    curbMassKg: 1300,
    driverKg: 80,
    cgHeightM: 0.5,
    wheelbaseM: 2.55,
    frontWeightFraction: 0.52,
    layout: 'RWD',
    tireRadiusM: tireRollingRadiusM('235/40R18'),
    tireWidthMm: 235,
    tireClass: 'summer-performance',
    cdA: 0.3 * 2.0,
    transmission: { type: 'manual', gearRatios: [3.6, 2.19, 1.54, 1.19, 1.0, 0.8], finalDrive: 3.7 },
  },
  tireCode: '235/40R18',
  frontalAreaM2: 2.0,
  shiftStrategy: 'optimal',
  shiftRpmFraction: 1.0,
  ambient: DEFAULT_AMBIENT,
  rollout: true,
  presetId: null,
};

export const TIRE_CLASSES: { value: TireClass; label: string }[] = [
  { value: 'all-season', label: 'All-season (mu 1.11)' },
  { value: 'summer-performance', label: 'Summer performance (1.24)' },
  { value: 'max-performance', label: 'Max performance (1.36)' },
  { value: 'semi-slick', label: 'Semi-slick (1.55)' },
];
export const TRANSMISSIONS: { value: TransmissionType; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'dct', label: 'Dual-clutch' },
  { value: 'automatic', label: 'Torque-converter auto' },
];

const num = (x: unknown, d: number, lo = -Infinity, hi = Infinity): number => {
  const n = typeof x === 'number' ? x : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const pick = <T extends string>(x: unknown, allowed: readonly T[], d: T): T => (allowed.includes(x as T) ? (x as T) : d);

/** Parse a metric tyre code; null when it is not valid. */
export function parseTire(code: string): { radiusM: number; widthMm: number } | null {
  try {
    const r = tireRollingRadiusM(code);
    const w = Number(/^\s*(\d{3})/.exec(code)?.[1]);
    return Number.isFinite(r) && r > 0.2 && r < 0.5 && w >= 125 && w <= 405 ? { radiusM: r, widthMm: w } : null;
  } catch {
    return null;
  }
}

/** Deep-merge a possibly partial / stale / hostile object onto the defaults. Never throws. */
export function mergeDesign(raw: unknown): VehicleDesign {
  const D = DEFAULT_DESIGN;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<VehicleDesign> & { spec?: Partial<VehicleSpec> };
  const s = (r.spec && typeof r.spec === 'object' ? r.spec : {}) as Partial<VehicleSpec>;
  const t = (s.transmission && typeof s.transmission === 'object' ? s.transmission : {}) as Partial<VehicleSpec['transmission']>;
  const ratiosIn = Array.isArray(t.gearRatios) ? t.gearRatios.filter((x) => typeof x === 'number' && x > 0.2 && x < 10) : [];
  const ratios = ratiosIn.length >= 2 ? ratiosIn.slice(0, 10) : D.spec.transmission.gearRatios.slice();
  const layout = pick(s.layout, ['FWD', 'RWD', 'AWD'] as const, D.spec.layout);
  const type = pick(t.type, ['manual', 'dct', 'automatic'] as const, 'manual');
  const spec: VehicleSpec = {
    name: typeof s.name === 'string' && s.name.trim() ? s.name.slice(0, 60) : D.spec.name,
    curbMassKg: num(s.curbMassKg, D.spec.curbMassKg, 300, 6000),
    driverKg: num(s.driverKg, 80, 0, 300),
    cgHeightM: num(s.cgHeightM, D.spec.cgHeightM, 0.2, 1.2),
    wheelbaseM: num(s.wheelbaseM, D.spec.wheelbaseM, 1.5, 4),
    frontWeightFraction: num(s.frontWeightFraction, D.spec.frontWeightFraction, 0.2, 0.8),
    layout,
    tireRadiusM: num(s.tireRadiusM, D.spec.tireRadiusM, 0.2, 0.5),
    tireClass: pick(s.tireClass, ['all-season', 'summer-performance', 'max-performance', 'semi-slick'] as const, D.spec.tireClass),
    tireWidthMm: num(s.tireWidthMm, 245, 125, 405),
    cdA: num(s.cdA, D.spec.cdA, 0.1, 2),
    transmission: {
      type,
      gearRatios: ratios,
      finalDrive: num(t.finalDrive, D.spec.transmission.finalDrive, 1, 8),
    },
  };
  if (layout === 'AWD') spec.awdFrontSplit = num(s.awdFrontSplit, 0.4, 0, 1);
  for (const k of ['crr0', 'crr2', 'wheelMassKg', 'engineInertiaKgM2'] as const) {
    const v = s[k];
    if (typeof v === 'number' && Number.isFinite(v)) spec[k] = v;
  }
  if (typeof s.drivetrainEfficiency === 'number') spec.drivetrainEfficiency = num(s.drivetrainEfficiency, 0.9, 0.6, 1);
  if (typeof s.speedLimiterMph === 'number' && s.speedLimiterMph > 0) spec.speedLimiterMph = s.speedLimiterMph;
  if (typeof t.shiftTimeS === 'number') spec.transmission.shiftTimeS = num(t.shiftTimeS, 0.3, 0.02, 1.5);
  if (typeof t.launchRpm === 'number') spec.transmission.launchRpm = num(t.launchRpm, 3000, 500, 12000);
  if (type === 'automatic' && typeof t.converterStallRatio === 'number') spec.transmission.converterStallRatio = num(t.converterStallRatio, 1, 1, 3);
  const amb = (r.ambient && typeof r.ambient === 'object' ? r.ambient : {}) as Partial<VehicleDesign['ambient']>;
  return {
    spec,
    tireCode: typeof r.tireCode === 'string' ? r.tireCode.slice(0, 16) : '',
    frontalAreaM2: num(r.frontalAreaM2, D.frontalAreaM2, 0.8, 4),
    shiftStrategy: pick(r.shiftStrategy, ['optimal', 'redline'] as const, 'optimal'),
    shiftRpmFraction: num(r.shiftRpmFraction, 1, 0.7, 1),
    ambient: { tempC: num(amb.tempC, 20, -30, 60), pressureKPa: num(amb.pressureKPa, 101.325, 60, 110) },
    rollout: r.rollout !== false,
    presetId: typeof r.presetId === 'string' ? r.presetId : null,
  };
}

/** Design from a validated reference car (spec is copied; the area behind Cd*A is assumed 2.0 m^2). */
export function designFromReferenceCar(car: ReferenceCar): VehicleDesign {
  return mergeDesign({
    ...DEFAULT_DESIGN,
    spec: structuredClone(car.spec),
    tireCode: '',
    frontalAreaM2: 2.0,
    presetId: car.id,
  });
}
