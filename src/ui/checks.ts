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
