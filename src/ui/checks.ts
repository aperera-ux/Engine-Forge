import type { EngineConfig } from '../sim/types';
import type { HintLevel } from './controls';

/** Intake / exhaust valve counts for a given valves-per-cylinder. */
export function valveSplit(v: number): { intake: number; exhaust: number } {
  switch (v) {
    case 2:
      return { intake: 1, exhaust: 1 };
    case 3:
      return { intake: 2, exhaust: 1 };
    case 5:
      return { intake: 3, exhaust: 2 };
    default:
      return { intake: 2, exhaust: 2 };
  }
}

/**
 * Geometric packaging check for valves in the bore. Rough rules from real heads:
 * - 2V wedge/hemi:  Di + De ≤ ~1.0·B
 * - 3V/4V pent-roof: 2·max(D) ≤ ~0.92·B, total valve area ≤ ~0.64 of bore area
 * - 5V: 3 intakes across ≈ 1.25·Di ≤ ~0.92·B…  we lean on the area ratio
 */
export function valveFit(c: EngineConfig): { level: HintLevel; ratio: number; message: string } {
  const { intake, exhaust } = valveSplit(c.valvesPerCylinder);
  const B = c.boreMm;
  const area = (intake * c.intakeValveMm ** 2 + exhaust * c.exhaustValveMm ** 2) / B ** 2;
  const areaMax = { 2: 0.5, 3: 0.56, 4: 0.64, 5: 0.66 }[c.valvesPerCylinder] ?? 0.64;
  let linear: number;
  if (c.valvesPerCylinder === 2) linear = (c.intakeValveMm + c.exhaustValveMm) / (1.0 * B);
  else if (c.valvesPerCylinder === 5) linear = (c.intakeValveMm * 2.2) / (0.95 * B);
  else linear = (2 * Math.max(c.intakeValveMm, c.exhaustValveMm)) / (0.92 * B);
  const ratio = Math.max(area / areaMax, linear);
  if (ratio > 1)
    return {
      level: 'bad',
      ratio,
      message: `Valves don't fit a ${B.toFixed(1)} mm bore (${Math.round(ratio * 100)}% of the packaging limit)`,
    };
  if (ratio > 0.94)
    return { level: 'warn', ratio, message: `Tight valve packaging: ${Math.round(ratio * 100)}% of the limit` };
  return { level: 'ok', ratio, message: `Valve packaging ${Math.round(ratio * 100)}% of limit` };
}

export function exhaustBiggerThanIntake(c: EngineConfig): boolean {
  return c.exhaustValveMm > c.intakeValveMm;
}

export function pistonSpeedLevel(ms: number): HintLevel {
  if (ms > 26) return 'bad';
  if (ms > 22) return 'warn';
  return 'ok';
}

/** Sensible turbo sizing for a displacement (per-turbo share). */
export function seedTurbo(c: EngineConfig, count: 1 | 2 = c.turbo.count): EngineConfig['turbo'] {
  const L = ((Math.PI / 4) * (c.boreMm / 10) ** 2 * (c.strokeMm / 10) * c.cylinders) / 1000;
  const per = L / count;
  const inducer = Math.round(Math.min(90, Math.max(32, 29 * Math.sqrt(per))));
  const ar = +Math.min(1.0, Math.max(0.5, 0.6 + (per - 2) * 0.07)).toFixed(2);
  // Keep boost moderate on high-compression engines.
  const boost = +Math.min(1.2, Math.max(0.5, 0.8 - (c.compressionRatio - 10) * 0.12)).toFixed(2);
  return {
    targetBoostBar: boost,
    compressorInducerMm: inducer,
    turbineAR: ar,
    intercoolerEffectiveness: 0.75,
    twinScroll: c.layout === 'inline' && c.cylinders >= 4,
    count,
  };
}

/** Sensible supercharger seed: boost scaled down as compression rises. */
export function seedSupercharger(c: EngineConfig): EngineConfig['supercharger'] {
  const boost = +Math.min(0.9, Math.max(0.3, 0.6 - (c.compressionRatio - 10) * 0.1)).toFixed(2);
  return { type: c.cylinders >= 6 ? 'twin-screw' : 'centrifugal', targetBoostBar: boost, intercoolerEffectiveness: 0.65 };
}
