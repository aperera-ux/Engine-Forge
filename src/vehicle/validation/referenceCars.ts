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
 * SPLIT POLICY (round 2). Written BEFORE any error was computed for the new cars:
 *   'seen'    = Camaro SS 2010, Supra 1993, WRX STI 2008. They were the round-1
 *               holdout, their errors have been looked at and a fit was made
 *               with them on screen, so they are NOT a valid holdout any more.
 *               Reported separately, never fitted.
 *   'train'   = the 6 round-1 train cars + GTI Mk7 DSG, Charger Hellcat,
 *               Ferrari 458 (fitting allowed).
 *   'holdout' = FRESH set, chosen from the new cars before running them:
 *               Mazda6 2.5 AT (FWD, conventional auto), GTI Mk5 DSG (FWD, DCT),
 *               BMW 340i 8AT (RWD, conventional auto), Porsche 911 GT3 PDK (RWD, DCT).
 *               Never tune on these. Any parameter change after the first
 *               look at them must be disclosed in research/vehicle_sources.md.
 *
 * DATA STATUS (round 2): Car and Driver, Motor Trend and Wayback were not
 * reachable from the tool sandbox (WebFetch refuses those domains, Edmunds and
 * fastestlaps return 403). Values are therefore secondary, recalled or
 * estimated. `sources` lists what each URL actually supports; everything not
 * listed there is in `estimated` / `recalled`.
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
  split: 'train' | 'holdout' | 'seen';
  spec: VehicleSpec;
  measured: MeasuredResult;
  refConfidence: 'high' | 'medium' | 'low';
  /** Spec fields that are estimates rather than published values. */
  estimated: string[];
  notes: string;
  /** Published top speed (mph) and its nature. 'limiter' = electronically governed; 'drag-limited' = power/drag (or gear) limited. */
  topSpeed?: { mph: number; kind: 'limiter' | 'drag-limited'; source: string };
  /** URLs that actually support a value (field -> url). Values not listed are recalled/estimated. */
  sources?: Record<string, string>;
  /** Values typed from memory of OEM/magazine data, not re-read from a page in this session. */
  recalled?: string[];
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
    topSpeed: { mph: 198, kind: 'drag-limited', source: 'GM published (Z06 2006), recalled' },
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
    topSpeed: { mph: 205, kind: 'drag-limited', source: 'GM published 205 mph, recalled' },
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
    topSpeed: { mph: 191, kind: 'drag-limited', source: 'GM published 191 mph, recalled' },
  },
  {
    id: 'bmw-m3-e92-2008',
    label: '2008 BMW M3 (E9x, S65, 6MT)',
    engineId: 'bmw-s65-m3',
    split: 'train',
    spec: {
      name: '2008 BMW M3',
      speedLimiterMph: 155,
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
    topSpeed: { mph: 155, kind: 'limiter', source: 'BMW electronic limiter 155 mph (well known), recalled' },
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
      speedLimiterMph: 155,
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
    topSpeed: { mph: 155, kind: 'limiter', source: 'Ford 155 mph limiter on 6MT GT, recalled' },
  },
  // ---------------------------------- SEEN (round-1 holdout; not valid as holdout any more) ----------------------------------
  {
    id: 'chevrolet-camaro-ss-2010',
    label: '2010 Chevrolet Camaro SS (LS3, TR6060 6MT)',
    engineId: 'gm-ls3',
    split: 'seen',
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
    split: 'seen',
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
    split: 'seen',
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
  // ---------------------------------- NEW IN ROUND 2 ----------------------------------
  {
    id: 'vw-gti-mk7-dsg-2015',
    label: '2015 Volkswagen Golf GTI Performance (EA888 Gen3, 6-speed DSG, FWD)',
    engineId: 'vw-ea888-gen3-gti',
    split: 'train',
    spec: {
      name: '2015 Golf GTI DSG',
      curbMassKg: 3100 * LB,
      cgHeightM: 0.5,
      wheelbaseM: 2.631,
      frontWeightFraction: 0.62,
      layout: 'FWD',
      speedLimiterMph: 155,
      tireRadiusM: tireRollingRadiusM('225/40R18'),
      tireWidthMm: 225,
      tireClass: 'summer-performance',
      cdA: 0.32 * 2.2,
      transmission: { type: 'dct', gearRatios: [3.462, 2.15, 1.464, 1.077, 0.774, 0.625], finalDrive: 3.944 },
    },
    measured: { zeroTo60: 6.1, quarterMileS: null, quarterMileTrapMph: null, rollout: true, source: 'Edmunds long-term test, DSG + Performance Pack, 0-60 only (search snippet of the Edmunds forum page)' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'curbMassKg', 'gearRatios', 'finalDrive', 'tire size'],
    recalled: ['gearRatios', 'finalDrive'],
    sources: { zeroTo60: 'https://forums.edmunds.com/discussion/comment/5046297', topSpeed: 'https://en.wikipedia.org/wiki/Volkswagen_Golf_Mk7 (246-250 km/h, limited)' },
    topSpeed: { mph: 155, kind: 'limiter', source: 'VW 250 km/h governor (Wikipedia Mk7 article, 246-250 km/h)' },
    notes: 'Only a 0-60 reference (no ET/trap). Whether Edmunds ran the 230 hp Performance engine as the simulated engine assumes was not verified.',
  },
  {
    id: 'dodge-charger-hellcat-2015',
    label: '2015 Dodge Charger SRT Hellcat (6.2 SC Hemi, 8HP90 8AT, RWD)',
    engineId: 'dodge-hellcat-62',
    split: 'train',
    spec: {
      name: '2015 Charger Hellcat',
      curbMassKg: 4575 * LB,
      cgHeightM: 0.55,
      wheelbaseM: 3.052,
      frontWeightFraction: 0.54,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('275/40R20'),
      tireWidthMm: 275,
      tireClass: 'max-performance',
      cdA: 0.33 * 2.4,
      transmission: { type: 'automatic', gearRatios: [4.71, 3.14, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67], finalDrive: 3.09, converterStallRatio: 1.9 },
    },
    measured: { zeroTo60: 3.6, quarterMileS: 11.7, quarterMileTrapMph: 125, rollout: true, source: 'Car and Driver 2015 Charger SRT Hellcat, recalled (not re-read)' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'finalDrive', 'curbMassKg', 'converterStallRatio'],
    recalled: ['measured', 'finalDrive', 'curbMassKg'],
    sources: { gearRatios: 'https://en.wikipedia.org/wiki/ZF_8HP_transmission (8HP70 table; the 8HP90 ratios are the same family)' },
    topSpeed: { mph: 204, kind: 'drag-limited', source: 'FCA published 204 mph, recalled' },
    notes: 'Traction-limited launch; magazine result depends on TC and tyre temperature.',
  },
  {
    id: 'ferrari-458-italia-2010',
    label: '2010 Ferrari 458 Italia (F136, 7-speed DCT, RWD)',
    engineId: 'ferrari-f136-458',
    split: 'train',
    spec: {
      name: '2010 458 Italia',
      curbMassKg: 3450 * LB,
      cgHeightM: 0.45,
      wheelbaseM: 2.65,
      frontWeightFraction: 0.42,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('295/35R20'),
      tireWidthMm: 295,
      tireClass: 'max-performance',
      cdA: 0.33 * 1.95,
      transmission: { type: 'dct', gearRatios: [3.08, 2.18, 1.63, 1.29, 1.03, 0.84, 0.69], finalDrive: 5.14 },
    },
    measured: { zeroTo60: 3.0, quarterMileS: 11.2, quarterMileTrapMph: 129, rollout: true, source: 'Car and Driver 458 Italia test, recalled (not re-read); Ferrari claims 3.4 s 0-100 km/h' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'tire size'],
    recalled: ['measured'],
    sources: {
      curbMass: 'https://en.wikipedia.org/wiki/Ferrari_458 (1,565 kg, citing Car and Driver first drive)',
      wheelbase: 'https://en.wikipedia.org/wiki/Ferrari_458 (2,650 mm)',
      gearRatios: 'https://en.wikipedia.org/wiki/Ferrari_458 (3.08-0.69, final 5.14; table uncited on Wikipedia)',
    },
    topSpeed: { mph: 202, kind: 'drag-limited', source: 'Ferrari: over 325 km/h (Wikipedia Ferrari 458 citing Ferrari data)' },
    notes: 'Ferrari 3.4 s 0-100 km/h; magazine 0-60 values for this car vary 2.9-3.3 s.',
  },
  // ---------------------------------- FRESH HOLDOUT (declared before any run) ----------------------------------
  {
    id: 'mazda6-25-2014',
    label: '2014 Mazda6 2.5 (Skyactiv-G, 6-speed AT, FWD)',
    engineId: 'mazda-skyactiv-g25',
    split: 'holdout',
    spec: {
      name: '2014 Mazda6',
      curbMassKg: 3190 * LB,
      cgHeightM: 0.52,
      wheelbaseM: 2.83,
      frontWeightFraction: 0.61,
      layout: 'FWD',
      tireRadiusM: tireRollingRadiusM('225/55R17'),
      tireWidthMm: 225,
      tireClass: 'all-season',
      cdA: 0.28 * 2.2,
      transmission: { type: 'automatic', gearRatios: [3.487, 1.992, 1.449, 1.0, 0.707, 0.6], finalDrive: 4.411 },
    },
    measured: { zeroTo60: 7.4, quarterMileS: 15.6, quarterMileTrapMph: 90, rollout: true, source: 'magazine range for 2014 Mazda6 6AT (about 7.3-7.7 s 0-60), recalled' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'curbMassKg', 'finalDrive', 'gearRatios', 'tire size/class'],
    recalled: ['measured', 'gearRatios', 'finalDrive'],
    sources: { engine: 'engine rating from src/sim/validation/referenceEngines.ts citing Mazda NA spec (184 hp)' },
    notes: 'Lowest-power car in the set; tests the automatic path with a lock-up converter.',
  },
  {
    id: 'vw-gti-mk5-dsg-2006',
    label: '2006 Volkswagen GTI (EA113 2.0T, 6-speed DSG, FWD)',
    engineId: 'vw-ea113-20tfsi',
    split: 'holdout',
    spec: {
      name: '2006 GTI DSG',
      curbMassKg: 3250 * LB,
      cgHeightM: 0.5,
      wheelbaseM: 2.578,
      frontWeightFraction: 0.61,
      layout: 'FWD',
      tireRadiusM: tireRollingRadiusM('225/45R17'),
      tireWidthMm: 225,
      tireClass: 'summer-performance',
      cdA: 0.33 * 2.1,
      transmission: { type: 'dct', gearRatios: [3.462, 2.15, 1.464, 1.077, 0.774, 0.625], finalDrive: 3.944 },
    },
    measured: { zeroTo60: 6.1, quarterMileS: 14.6, quarterMileTrapMph: 94, rollout: true, source: 'magazine results for the 2006 GTI DSG (about 6.0-6.5 s 0-60), recalled' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'curbMassKg', 'gearRatios', 'finalDrive'],
    recalled: ['measured', 'gearRatios', 'finalDrive'],
    topSpeed: { mph: 145, kind: 'drag-limited', source: 'VW 233 km/h claim, recalled' },
    notes: 'Same DQ250 ratio set as the Mk7 train car (shared recalled data).',
  },
  {
    id: 'bmw-340i-2016',
    label: '2016 BMW 340i (B58, 8HP 8AT, RWD)',
    engineId: 'bmw-b58-340i',
    split: 'holdout',
    spec: {
      name: '2016 340i',
      curbMassKg: 3740 * LB,
      cgHeightM: 0.5,
      wheelbaseM: 2.81,
      frontWeightFraction: 0.5,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('255/40R18'),
      tireWidthMm: 255,
      tireClass: 'max-performance',
      cdA: 0.26 * 2.2,
      transmission: { type: 'automatic', gearRatios: [4.714, 3.143, 2.106, 1.667, 1.285, 1.0, 0.839, 0.667], finalDrive: 3.15 },
    },
    measured: { zeroTo60: 4.8, quarterMileS: 13.5, quarterMileTrapMph: 105, rollout: true, source: '0-60specs.com aggregate of 3 stock tests: 4.7-5.1 s, 13.3-13.6 s at 104-106 mph (midpoints used)' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'finalDrive', 'tire size', 'converter stall (global default)'],
    recalled: ['finalDrive'],
    sources: {
      measured: 'https://www.0-60specs.com/bmw/340i-0-60-times',
      curbMass: 'https://www.0-60specs.com/bmw/340i-0-60-times (3,740 lb listing)',
      gearRatios: 'https://en.wikipedia.org/wiki/ZF_8HP_transmission (8HP45 column)',
    },
    notes: 'Aggregator ranges, not one magazine test. Edmunds long-term xDrive (AWD) logged 12.7 s quarter, not comparable.',
  },
  {
    id: 'porsche-911-gt3-991-2018',
    label: '2018 Porsche 911 GT3 (991.2, 9A1 4.0, 7-speed PDK, RWD)',
    engineId: 'porsche-9a1-40-gt3',
    split: 'holdout',
    spec: {
      name: '2018 911 GT3',
      curbMassKg: 3153 * LB,
      cgHeightM: 0.46,
      wheelbaseM: 2.457,
      frontWeightFraction: 0.38,
      layout: 'RWD',
      tireRadiusM: tireRollingRadiusM('305/30R21'),
      tireWidthMm: 305,
      tireClass: 'max-performance',
      cdA: 0.33 * 2.0,
      transmission: { type: 'dct', gearRatios: [3.91, 2.29, 1.66, 1.31, 1.08, 0.88, 0.73], finalDrive: 4.44 },
    },
    measured: { zeroTo60: 2.8, quarterMileS: 10.9, quarterMileTrapMph: 129, rollout: true, source: 'magazine results for 991.2 GT3 PDK, recalled; Porsche claims 3.4 s 0-62 mph' },
    refConfidence: 'low',
    estimated: ['cgHeightM', 'cdA', 'frontWeightFraction', 'gearRatios', 'finalDrive'],
    recalled: ['measured', 'gearRatios', 'finalDrive', 'curbMassKg'],
    topSpeed: { mph: 198, kind: 'drag-limited', source: 'Porsche published 198 mph (318 km/h), recalled' },
    notes: 'Gear ratios are the least certain data in the set (PDK ratios not publicly tabulated in sources reachable here).',
  },
];
