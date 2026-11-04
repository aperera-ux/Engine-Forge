/**
 * Engine presets for the UI dropdown: DEFAULT_CONFIG first, then the real
 * reference engines (see validation/referenceEngines.ts for sources and which
 * fields are estimated), then a few hypothetical builds.
 */
import type { EngineConfig } from './types';
import { DEFAULT_CONFIG } from './defaults';
import { REFERENCE_ENGINES } from './validation/referenceEngines';

const NO_SC = { type: 'twin-screw', targetBoostBar: 0, intercoolerEffectiveness: 0 } as const;

/** Hypothetical builds — plausible combinations, not production engines. */
export const HYPOTHETICAL_PRESETS: EngineConfig[] = [
  {
    name: 'Twin-turbo 4.0 flat-plane V8 (hypercar)',
    layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'flat',
    boreMm: 94, strokeMm: 72, rodLengthMm: 145, compressionRatio: 9.6,
    valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 37, exhaustValveMm: 31,
    cam: {
      intakeDurationDeg: 232, exhaustDurationDeg: 226, intakeLiftMm: 11.5, exhaustLiftMm: 10.5,
      lobeSeparationDeg: 114, intakeCenterlineDeg: 110, vvt: true, variableLift: false,
    },
    induction: 'turbo',
    turbo: { targetBoostBar: 1.4, compressorInducerMm: 48, turbineAR: 0.64, intercoolerEffectiveness: 0.8, twinScroll: true, count: 2 },
    supercharger: { ...NO_SC },
    intakeRunnerMm: 220, throttleMm: 90, itb: false,
    exhaust: 'tuned-equal', headerPrimaryMm: 300, headerDiameterMm: 40,
    fuel: 'gas93', lambda: 0.8, directInjection: true,
    redlineRpm: 8000, idleRpm: 900,
    blockMaterial: 'aluminum', pistons: 'forged', rods: 'titanium', crank: 'forged',
  },
  {
    name: 'High-boost 2.0 I4 drag build (E85)',
    layout: 'inline', cylinders: 4, vAngleDeg: 0, crankPlane: 'cross',
    boreMm: 86, strokeMm: 86, rodLengthMm: 145, compressionRatio: 9.0,
    valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 36, exhaustValveMm: 31,
    cam: {
      intakeDurationDeg: 244, exhaustDurationDeg: 240, intakeLiftMm: 12.5, exhaustLiftMm: 11.5,
      lobeSeparationDeg: 114, intakeCenterlineDeg: 110, vvt: true, variableLift: false,
    },
    induction: 'turbo',
    turbo: { targetBoostBar: 2.5, compressorInducerMm: 67, turbineAR: 0.82, intercoolerEffectiveness: 0.8, twinScroll: true, count: 1 },
    supercharger: { ...NO_SC },
    intakeRunnerMm: 230, throttleMm: 80, itb: false,
    exhaust: 'tuned-equal', headerPrimaryMm: 450, headerDiameterMm: 44,
    fuel: 'e85', lambda: 0.78, directInjection: false,
    redlineRpm: 9000, idleRpm: 1000,
    blockMaterial: 'aluminum', pistons: 'forged', rods: 'billet-steel', crank: 'billet',
  },
  {
    name: 'Big-block pushrod 7.4 NA (454 street/strip)',
    layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'cross',
    boreMm: 107.95, strokeMm: 101.6, rodLengthMm: 160.5, compressionRatio: 11.0,
    valvetrain: 'pushrod', valvesPerCylinder: 2, intakeValveMm: 56.4, exhaustValveMm: 44.5,
    cam: {
      intakeDurationDeg: 236, exhaustDurationDeg: 244, intakeLiftMm: 15.2, exhaustLiftMm: 15.2,
      lobeSeparationDeg: 110, intakeCenterlineDeg: 106, vvt: false, variableLift: false,
    },
    induction: 'na',
    turbo: { targetBoostBar: 0, compressorInducerMm: 50, turbineAR: 0.63, intercoolerEffectiveness: 0, twinScroll: false, count: 1 },
    supercharger: { ...NO_SC },
    intakeRunnerMm: 200, throttleMm: 95, itb: false,
    exhaust: 'long-tube', headerPrimaryMm: 850, headerDiameterMm: 50,
    fuel: 'gas93', lambda: 0.86, directInjection: false,
    redlineRpm: 6500, idleRpm: 900,
    blockMaterial: 'iron', pistons: 'forged', rods: 'forged-steel', crank: 'forged',
  },
  {
    name: 'High-rev 3.0 V10 track special',
    layout: 'v', cylinders: 10, vAngleDeg: 90, crankPlane: 'cross',
    boreMm: 86, strokeMm: 51.6, rodLengthMm: 112, compressionRatio: 13.5,
    valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 35, exhaustValveMm: 29,
    cam: {
      intakeDurationDeg: 270, exhaustDurationDeg: 262, intakeLiftMm: 12.5, exhaustLiftMm: 11.5,
      lobeSeparationDeg: 108, intakeCenterlineDeg: 102, vvt: true, variableLift: false,
    },
    induction: 'na',
    turbo: { targetBoostBar: 0, compressorInducerMm: 50, turbineAR: 0.63, intercoolerEffectiveness: 0, twinScroll: false, count: 1 },
    supercharger: { ...NO_SC },
    intakeRunnerMm: 180, throttleMm: 105, itb: true,
    exhaust: 'tuned-equal', headerPrimaryMm: 350, headerDiameterMm: 40,
    fuel: 'race100', lambda: 0.88, directInjection: false,
    redlineRpm: 14000, idleRpm: 2000,
    blockMaterial: 'aluminum', pistons: 'forged', rods: 'titanium', crank: 'billet',
  },
];

export const REFERENCE_PRESETS: EngineConfig[] = REFERENCE_ENGINES.map((r) => r.config);

export const PRESETS: EngineConfig[] = [DEFAULT_CONFIG, ...REFERENCE_PRESETS, ...HYPOTHETICAL_PRESETS];

const refName = (id: string) => REFERENCE_ENGINES.find((r) => r.id === id)!.config.name;

/** Dropdown grouping: category label -> preset names (all exist in PRESETS). */
export const PRESET_GROUPS: Record<string, string[]> = {
  Custom: [DEFAULT_CONFIG.name],
  'Inline 3/4 — NA': ['honda-k20a-dc5', 'honda-f20c-ap1', 'toyota-4age-20v-blacktop', 'mazda-skyactiv-g25'].map(refName),
  'Inline 3/4 — Turbo': ['vw-ea888-gen3-gti', 'ford-10-ecoboost'].map(refName),
  'Inline 6': ['bmw-s54-e46m3', 'toyota-2jz-gte-us', 'bmw-b58-340i'].map(refName),
  'Flat / Boxer': ['subaru-ej257-sti', 'porsche-9a1-40-gt3'].map(refName),
  V6: ['toyota-1gr-fe', 'ford-35-ecoboost-gen2'].map(refName),
  'V8 — Pushrod': ['chevy-350-zz4', 'gm-ls3', 'gm-ls7', 'dodge-hellcat-62'].map(refName),
  'V8 — DOHC': ['ford-coyote-gen3', 'ferrari-f136-458'].map(refName),
  'V10 / V12': ['audi-52-v10-r8plus', 'ferrari-f140fc-f12'].map(refName),
  Hypothetical: HYPOTHETICAL_PRESETS.map((p) => p.name),
};

export function findPreset(name: string): EngineConfig | undefined {
  return PRESETS.find((p) => p.name === name);
}
