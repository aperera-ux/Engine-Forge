/**
 * Reference cars for vehicle-model validation. Every number is documented, with
 * its source and confidence, in research/vehicle_sources.md.
 *
 * HONESTY NOTE: the web pages for the original magazine tests were not all
 * retrievable; several measured figures below were taken from secondary
 * reposts (forums, aggregators) that quote Car and Driver / Motor Trend /
 * Edmunds. Each car carries `refConfidence` and per-field `estimated` tags.
 * Re-check against the primary test pages before quoting externally.
 *
 * Train/holdout split was FIXED when this file was written, before any
 * vehicle-model error was computed: holdout = Camaro SS 2010, Supra Turbo 1993,
 * WRX STI 2008 (3 of 9 = 33 %).
 */
import type { VehicleSpec } from '../types';
import { tireRollingRadiusM } from '../tire';

const LB = 0.45359237;

export interface MeasuredResult {
  /** Seconds, rollout-deducted unless `rollout` is false. */
  zeroTo60: number | null;
  quarterMileS: number | null;
  quarterMileTrapMph: number | null;
  /** true = 1-ft rollout deducted from timing (standard US magazine practice). */
  rollout: boolean;
  source: string;
}

export interface ReferenceCar {
  id: string;
  label: string;
  /** id in REFERENCE_ENGINES / EXTENDED_REFERENCE_ENGINES. */
  engineId: string;
  split: 'train' | 'holdout';
  spec: VehicleSpec;
  measured: MeasuredResult;
  refConfidence: 'high' | 'medium' | 'low';
  /** Spec fields that are estimates rather than published values. */
  estimated: string[];
  notes: string;
}

export const REFERENCE_CARS: ReferenceCar[] = [
  {
    id: 'corvette-z06-2006',
    label: '2006 Chevrolet Corvette Z06 (LS7, T56 6MT)',
    engineId: 'gm-ls7',
    split: 'train',
    spec: {
      name: '2006 Corvette Z06',
      curbMassKg: 3132 * LB,
      cgHeightM: 0.47,
      wheelbaseM: 2.685,
      frontWeightFraction: 0.51,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('325/30R19'),
      tireWidthMm: 325,
      tireClass: 'max-performance',
      cdA: 0.28 * 1.9,
      transmission: {
        type: 'manual',
        gearRatios: [2.97, 2.07, 1.43, 1.0, 0.71, 0.57],
        finalDrive: 3.42,
      },
    },
    measured: { zeroTo60: 3.6, quarterMileS: 11.7, quarterMileTrapMph: 125, rollout: true, source: 'Car and Driver, Oct 2005 (secondary quote)' },
    refConfidence: 'medium',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'gearRatios[4..5]'],
    notes: 'C/D curb weight 3,132 lb vs 3,147 lb listed elsewhere.',
  },
  {
    id: 'corvette-zr1-2009',
    label: '2009 Chevrolet Corvette ZR1 (LS9, TR6060 6MT)',
    engineId: 'gm-ls9-crate',
    split: 'train',
    spec: {
      name: '2009 Corvette ZR1',
      curbMassKg: 3324 * LB,
      cgHeightM: 0.47,
      wheelbaseM: 2.685,
      frontWeightFraction: 0.51,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('335/25R20'),
      tireWidthMm: 335,
      tireClass: 'max-performance',
      cdA: 0.34 * 1.9,
      transmission: {
        type: 'manual',
        gearRatios: [2.97, 2.07, 1.43, 1.0, 0.71, 0.57],
        finalDrive: 3.42,
      },
    },
    measured: { zeroTo60: 3.4, quarterMileS: 11.5, quarterMileTrapMph: 128.3, rollout: true, source: 'Car and Driver, Oct 2008 ZR1 instrumented test (secondary quote)' },
    refConfidence: 'medium',
    estimated: ['curbMassKg (Popular Science figure, not C/D)', 'cgHeightM', 'cdA', 'frontWeightFraction', 'gearRatios', 'finalDrive'],
    notes: 'Engine is the LS9 crate (Chevrolet Performance) curve; LS9 car ratings are the same 638 hp.',
  },
  {
    id: 'cadillac-ctsv-2009',
    label: '2009 Cadillac CTS-V (LSA, TR6060 6MT)',
    engineId: 'gm-lsa-crate',
    split: 'train',
    spec: {
      name: '2009 CTS-V',
      curbMassKg: 4227 * LB,
      cgHeightM: 0.53,
      wheelbaseM: 2.91,
      frontWeightFraction: 0.52,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('285/35R19'),
      tireWidthMm: 285,
      tireClass: 'max-performance',
      cdA: 0.36 * 2.2,
      transmission: {
        type: 'manual',
        gearRatios: [2.66, 1.78, 1.3, 1.0, 0.74, 0.5],
        finalDrive: 3.73,
      },
    },
    measured: { zeroTo60: 4.3, quarterMileS: 12.6, quarterMileTrapMph: 117, rollout: true, source: 'Car and Driver 2009 CTS-V manual (fastestlaps.com quoting C/D)' },
    refConfidence: 'medium',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction'],
    notes: 'Edmunds manual: 4.6 s / 12.5 s @ 115.3 mph. Spread between outlets ~7 % on 0-60.',
  },
  {
    id: 'bmw-m3-e92-2008',
    label: '2008 BMW M3 (E9x, S65, 6MT)',
    engineId: 'bmw-s65-m3',
    split: 'train',
    spec: {
      name: '2008 BMW M3',
      curbMassKg: 3704 * LB,
      cgHeightM: 0.5,
      wheelbaseM: 2.761,
      frontWeightFraction: 0.5,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('265/40R18'),
      tireWidthMm: 265,
      tireClass: 'max-performance',
      cdA: 0.31 * 2.15,
      transmission: {
        type: 'manual',
        gearRatios: [4.056, 2.384, 1.58, 1.19, 1.0, 0.872],
        finalDrive: 3.85,
      },
    },
    measured: { zeroTo60: 4.1, quarterMileS: 12.6, quarterMileTrapMph: 113, rollout: true, source: 'Car and Driver short take, 2008 M3 sedan (autospies quote)' },
    refConfidence: 'low',
    estimated: ['curbMassKg (coupe BMW US figure used for the sedan test)', 'cgHeightM', 'frontWeightFraction', 'cdA', 'gearRatios (recalled)'],
    notes: 'Other outlets: MotorWeek 4.3 / 12.7 @ 112, Edmunds 4.6 / 12.7 (coupe).',
  },
  {
    id: 'honda-s2000-2003',
    label: '2003 Honda S2000 (F20C, 6MT)',
    engineId: 'honda-f20c-ap1',
    split: 'train',
    spec: {
      name: '2003 S2000',
      curbMassKg: 2860 * LB,
      cgHeightM: 0.45,
      wheelbaseM: 2.4,
      frontWeightFraction: 0.5,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('225/50R16'),
      tireWidthMm: 225,
      tireClass: 'max-performance',
      cdA: 0.33 * 1.85,
      transmission: {
        type: 'manual',
        gearRatios: [3.133, 2.045, 1.481, 1.161, 0.972, 0.811],
        finalDrive: 4.1,
      },
    },
    measured: { zeroTo60: 5.4, quarterMileS: 14.1, quarterMileTrapMph: null, rollout: true, source: 'Car and Driver 2003 (0-60specs aggregator quoting forum)' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'curbMassKg (2003-05 listing)', 'gearRatios (recalled)'],
    notes: 'No trap speed found. The engine config redline is 9000 rpm (US AP1 limiter 8900). Engine-curve is simulated and peak-scaled (no digitised dyno curve).',
  },
  {
    id: 'ford-mustang-gt-2018',
    label: '2018 Ford Mustang GT (Coyote Gen 3, 6MT82)',
    engineId: 'ford-coyote-gen3',
    split: 'train',
    spec: {
      name: '2018 Mustang GT',
      curbMassKg: 3878 * LB,
      cgHeightM: 0.52,
      wheelbaseM: 2.72,
      frontWeightFraction: 0.53,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('275/40R19'),
      tireWidthMm: 275,
      tireClass: 'max-performance',
      cdA: 0.35 * 2.2,
      transmission: {
        type: 'manual',
        gearRatios: [3.66, 2.43, 1.69, 1.32, 1.0, 0.65],
        finalDrive: 3.73,
      },
    },
    measured: { zeroTo60: 4.3, quarterMileS: 12.6, quarterMileTrapMph: 115, rollout: true, source: 'Car and Driver 2018 Mustang GT manual (mustang6g forum quoting C/D)' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'finalDrive (3.55 vs 3.73 by package)', 'curbMassKg (C/D tested weight per forum; Ford lists 3,705 lb)', 'gearRatios (recalled)'],
    notes: 'Engine curve is simulated and peak-scaled (no digitised dyno curve).',
  },
  // ---------------------------------- HOLDOUT ----------------------------------
  {
    id: 'chevrolet-camaro-ss-2010',
    label: '2010 Chevrolet Camaro SS (LS3, TR6060 6MT)',
    engineId: 'gm-ls3',
    split: 'holdout',
    spec: {
      name: '2010 Camaro SS',
      curbMassKg: 3857 * LB,
      cgHeightM: 0.52,
      wheelbaseM: 2.852,
      frontWeightFraction: 0.53,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('275/40R20'),
      tireWidthMm: 275,
      tireClass: 'max-performance',
      cdA: 0.356 * 2.17,
      transmission: {
        type: 'manual',
        gearRatios: [2.66, 1.78, 1.3, 1.0, 0.74, 0.5],
        finalDrive: 3.45,
      },
    },
    measured: { zeroTo60: 5.1, quarterMileS: 13.1, quarterMileTrapMph: 110.4, rollout: true, source: 'Edmunds 2010 Camaro SS manual (traction control off)' },
    refConfidence: 'low',
    estimated: ['curbMassKg (forum spec list)', 'cgHeightM', 'cdA', 'frontWeightFraction'],
    notes: 'C/D quoted 4.8 / 13.0 @ 111 for a manual; MotorWeek 5.0 / 13.3 @ 109. Edmunds chosen because the full triple was retrievable. Reference spread ~6 % on 0-60.',
  },
  {
    id: 'toyota-supra-tt-1993',
    label: '1993 Toyota Supra Turbo (2JZ-GTE, V160 6MT)',
    engineId: 'toyota-2jz-gte-us',
    split: 'holdout',
    spec: {
      name: '1993 Supra Turbo',
      curbMassKg: 3417 * LB,
      cgHeightM: 0.48,
      wheelbaseM: 2.55,
      frontWeightFraction: 0.53,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('255/40R17'),
      tireWidthMm: 255,
      tireClass: 'max-performance',
      cdA: 0.32 * 2.0,
      transmission: {
        type: 'manual',
        gearRatios: [3.827, 2.36, 1.685, 1.312, 1.0, 0.793],
        finalDrive: 3.133,
      },
    },
    measured: { zeroTo60: 4.6, quarterMileS: 13.1, quarterMileTrapMph: 109, rollout: true, source: 'Car and Driver, Mar 1993 (secondary quote)' },
    refConfidence: 'medium',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'curbMassKg (3,417 vs 3,450 lb)', 'rollout convention in 1993 assumed'],
    notes: 'Engine curve is simulated and peak-scaled (no digitised dyno curve); turbo spool is part of the engine model.',
  },
  {
    id: 'subaru-wrx-sti-2008',
    label: '2008 Subaru WRX STI (EJ257, 6MT, AWD)',
    engineId: 'subaru-ej257-sti',
    split: 'holdout',
    spec: {
      name: '2008 WRX STI',
      curbMassKg: 3351 * LB,
      cgHeightM: 0.52,
      wheelbaseM: 2.62,
      frontWeightFraction: 0.58,
      layout: 'AWD',
      awdFrontSplit: 0.41,
      tireRadiusM: tireRollingRadiusM('235/45R17'),
      tireWidthMm: 235,
      tireClass: 'max-performance',
      cdA: 0.36 * 2.1,
      transmission: {
        type: 'manual',
        gearRatios: [3.636, 2.375, 1.761, 1.346, 0.971, 0.756],
        finalDrive: 3.9,
      },
    },
    measured: { zeroTo60: 5.1, quarterMileS: 13.6, quarterMileTrapMph: 102, rollout: true, source: 'Car and Driver 2008 WRX STI full test (forum quote)' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'awdFrontSplit', 'gearRatios (recalled)'],
    notes: 'C/D itself remarked on a poor launch; Motor Trend measured 4.8 s / 13.4 s @ 100.5 mph (reference spread ~6 % on 0-60). Only AWD car in the set.',
  },
];
