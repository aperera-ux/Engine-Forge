/**
 * Reference production engines with published (SAE net / manufacturer) ratings.
 * Used to calibrate and validate the physics model (src/sim).
 *
 * Conventions follow layout.ts: inline vAngleDeg = 0 (ignored), flat = 180.
 * Throttle size for ITBs = equivalent single diameter, d_eq = d * sqrt(n).
 * Fuel matches the octane the rating was certified on (US 91 premium -> gas91,
 * Euro/JDM 98-100 RON premium -> gas93, US regular -> gas87).
 * Cam durations are at 0.050" lift. VVT engines: centerline = typical WOT value.
 * Fields that are not published are estimated from similar engines and listed
 * in `estimatedFields` (dot paths into EngineConfig).
 * Torque/power plateaus (turbo engines): `torqueRpm` is the plateau midpoint;
 * the full published range is in `torqueRpmRange` / `hpRpmRange`.
 */
import type { EngineConfig, SuperchargerConfig, TurboConfig } from '../types';

export interface ReferenceEngine {
  id: string;
  config: EngineConfig;
  published: {
    hp: number;
    hpRpm: number;
    torqueNm: number;
    torqueRpm: number;
    redlineRpm: number;
    massKg?: number;
    /** Published plateau range for torque, rpm [from, to] (turbo engines). */
    torqueRpmRange?: [number, number];
    /** Published range over which peak power is held, rpm. */
    hpRpmRange?: [number, number];
  };
  /**
   * How far the published rating can be trusted as a calibration target.
   * high = SAE J1349 certified / consistent with independent dynos;
   * medium = manufacturer figure, mild under-/over-rating suspected;
   * low = known to be conservative (weight less in calibration).
   */
  ratingConfidence?: 'high' | 'medium' | 'low';
  source: string;
  estimatedFields: string[];
  notes?: string;
}

/** Placeholder sub-configs for engines that do not use that induction type. */
const NO_TURBO: TurboConfig = {
  targetBoostBar: 0,
  compressorInducerMm: 50,
  turbineAR: 0.63,
  intercoolerEffectiveness: 0,
  twinScroll: false,
  count: 1,
};
const NO_SC: SuperchargerConfig = { type: 'twin-screw', targetBoostBar: 0, intercoolerEffectiveness: 0 };

const LBFT = 1.35582;
const nm = (lbft: number) => Math.round(lbft * LBFT);

export const REFERENCE_ENGINES: ReferenceEngine[] = [
  // ───────────────────────────── Inline 4, NA ─────────────────────────────
  {
    id: 'honda-k20a-dc5',
    config: {
      name: 'Honda K20A — Integra/Civic Type R',
      layout: 'inline', cylinders: 4, vAngleDeg: 0, crankPlane: 'cross',
      boreMm: 86, strokeMm: 86, rodLengthMm: 139, compressionRatio: 11.5,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 35, exhaustValveMm: 30,
      cam: {
        intakeDurationDeg: 238, exhaustDurationDeg: 232,
        intakeLiftMm: 12.0, exhaustLiftMm: 10.8,
        lobeSeparationDeg: 112, intakeCenterlineDeg: 105,
        vvt: true, variableLift: true,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 290, throttleMm: 62, itb: false,
      exhaust: 'tuned-equal', headerPrimaryMm: 600, headerDiameterMm: 40,
      fuel: 'gas93', lambda: 0.87, directInjection: false,
      redlineRpm: 8400, idleRpm: 750,
      blockMaterial: 'aluminum', pistons: 'forged', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 217, hpRpm: 8000, torqueNm: 206, torqueRpm: 7000, redlineRpm: 8400, massKg: 140 },
    ratingConfidence: 'medium',
    source: 'Honda JDM DC5 Integra Type R spec sheet (220 PS @ 8000, 21.0 kgf·m @ 7000); Wikipedia "Honda K engine" (K20A, 86x86, CR 11.5, 35/30 mm valves).',
    estimatedFields: ['cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'massKg'],
    notes: 'i-VTEC: VTC intake phaser + 2-stage VTEC lift. Rated on JDM 100 RON premium (gas93). 220 PS = 217 hp.',
  },
  {
    id: 'honda-f20c-ap1',
    config: {
      name: 'Honda F20C — S2000 (AP1, US)',
      layout: 'inline', cylinders: 4, vAngleDeg: 0, crankPlane: 'cross',
      boreMm: 87, strokeMm: 84, rodLengthMm: 153, compressionRatio: 11.0,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 34, exhaustValveMm: 29,
      cam: {
        intakeDurationDeg: 242, exhaustDurationDeg: 236,
        intakeLiftMm: 11.5, exhaustLiftMm: 10.6,
        lobeSeparationDeg: 112, intakeCenterlineDeg: 108,
        vvt: false, variableLift: true,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 300, throttleMm: 64, itb: false,
      exhaust: 'tuned-equal', headerPrimaryMm: 550, headerDiameterMm: 40,
      fuel: 'gas91', lambda: 0.87, directInjection: false,
      redlineRpm: 9000, idleRpm: 800,
      blockMaterial: 'aluminum', pistons: 'forged', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 240, hpRpm: 8300, torqueNm: nm(153), torqueRpm: 7500, redlineRpm: 9000, massKg: 147 },
    ratingConfidence: 'high',
    source: 'American Honda 2000 S2000 press kit (240 hp @ 8300, 153 lb-ft @ 7500, 9000 rpm redline); Wikipedia "Honda F20C".',
    estimatedFields: ['cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'headerPrimaryMm', 'headerDiameterMm', 'throttleMm', 'lambda', 'intakeValveMm', 'exhaustValveMm'],
    notes: 'Highest-revving production I4 of its era; FRM cylinder liners; DOHC VTEC (no VTC). Mean piston speed 25.2 m/s at 9000.',
  },
  {
    id: 'toyota-4age-20v-blacktop',
    config: {
      name: 'Toyota 4A-GE 20V "Black Top" — AE111',
      layout: 'inline', cylinders: 4, vAngleDeg: 0, crankPlane: 'cross',
      boreMm: 81, strokeMm: 77, rodLengthMm: 128.5, compressionRatio: 11.0,
      valvetrain: 'dohc', valvesPerCylinder: 5, intakeValveMm: 26.5, exhaustValveMm: 27,
      cam: {
        intakeDurationDeg: 232, exhaustDurationDeg: 226,
        intakeLiftMm: 8.2, exhaustLiftMm: 8.0,
        lobeSeparationDeg: 110, intakeCenterlineDeg: 106,
        vvt: true, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 330, throttleMm: 90, itb: true,
      exhaust: 'tuned-equal', headerPrimaryMm: 500, headerDiameterMm: 38,
      fuel: 'gas93', lambda: 0.87, directInjection: false,
      redlineRpm: 8000, idleRpm: 800,
      blockMaterial: 'iron', pistons: 'cast', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 163, hpRpm: 7800, torqueNm: 162, torqueRpm: 5600, redlineRpm: 8000, massKg: 125 },
    ratingConfidence: 'medium',
    source: 'Toyota JDM AE111 Levin/Trueno catalogue (165 PS @ 7800, 16.5 kgf·m @ 5600); Wikipedia "Toyota A engine" (81x77, 3 intake + 2 exhaust valves, 4x45 mm ITBs).',
    estimatedFields: ['cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'headerPrimaryMm', 'headerDiameterMm', 'rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'lambda', 'massKg'],
    notes: '5 valves: 3 small intake, 2 exhaust; intakeValveMm is a single intake valve. ITB equivalent diameter = 45*sqrt(4) = 90 mm. On/off VVT intake phaser.',
  },
  // ───────────────────────────── Inline 6 ─────────────────────────────
  {
    id: 'toyota-2jz-gte-us',
    config: {
      name: 'Toyota 2JZ-GTE — Supra Turbo (US)',
      layout: 'inline', cylinders: 6, vAngleDeg: 0, crankPlane: 'cross',
      boreMm: 86, strokeMm: 86, rodLengthMm: 142, compressionRatio: 8.5,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 33.5, exhaustValveMm: 29,
      cam: {
        intakeDurationDeg: 200, exhaustDurationDeg: 200,
        intakeLiftMm: 8.25, exhaustLiftMm: 8.4,
        lobeSeparationDeg: 115, intakeCenterlineDeg: 112,
        vvt: false, variableLift: false,
      },
      induction: 'turbo',
      turbo: {
        targetBoostBar: 0.75, compressorInducerMm: 42, turbineAR: 0.5,
        intercoolerEffectiveness: 0.6, twinScroll: false, count: 2,
      },
      supercharger: NO_SC,
      intakeRunnerMm: 330, throttleMm: 60, itb: false,
      exhaust: 'log', headerPrimaryMm: 150, headerDiameterMm: 38,
      fuel: 'gas91', lambda: 0.78, directInjection: false,
      redlineRpm: 6800, idleRpm: 650,
      blockMaterial: 'iron', pistons: 'cast', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 320, hpRpm: 5600, torqueNm: nm(315), torqueRpm: 4000, redlineRpm: 6800, massKg: 230 },
    ratingConfidence: 'high',
    source: 'Toyota USA 1993-98 Supra Turbo specifications (320 hp @ 5600, 315 lb-ft @ 4000); Wikipedia "Toyota JZ engine" (86x86, CR 8.5, sequential CT12B twin turbos).',
    estimatedFields: ['cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'turbo.targetBoostBar', 'turbo.compressorInducerMm', 'turbo.turbineAR', 'turbo.intercoolerEffectiveness', 'intakeRunnerMm', 'headerPrimaryMm', 'headerDiameterMm', 'throttleMm', 'lambda', 'massKg'],
    notes: 'Sequential (not parallel) twin CT12B: second turbo comes online ~3500-4000 rpm; stock boost ~0.7-0.8 bar. US premium 91 AKI. Rich WOT (lambda ~0.78) typical of 1990s turbo calibrations.',
  },
  // ───────────────────────────── V8, NA pushrod ─────────────────────────────
  {
    id: 'gm-ls3',
    config: {
      name: 'GM LS3 6.2 — Corvette C6',
      layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'cross',
      boreMm: 103.25, strokeMm: 92, rodLengthMm: 154.9, compressionRatio: 10.7,
      valvetrain: 'pushrod', valvesPerCylinder: 2, intakeValveMm: 55, exhaustValveMm: 40.4,
      cam: {
        intakeDurationDeg: 204, exhaustDurationDeg: 211,
        intakeLiftMm: 14.0, exhaustLiftMm: 13.26,
        lobeSeparationDeg: 117, intakeCenterlineDeg: 116,
        vvt: false, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 260, throttleMm: 90, itb: false,
      exhaust: 'shorty', headerPrimaryMm: 350, headerDiameterMm: 41,
      fuel: 'gas91', lambda: 0.87, directInjection: false,
      redlineRpm: 6600, idleRpm: 600,
      blockMaterial: 'aluminum', pistons: 'hypereutectic', rods: 'forged-steel', crank: 'cast',
    },
    published: { hp: 430, hpRpm: 5900, torqueNm: nm(424), torqueRpm: 4600, redlineRpm: 6600, massKg: 190 },
    ratingConfidence: 'high',
    source: 'GM Performance Parts LS3 crate spec (430 hp @ 5900, 424 lb-ft @ 4600; cam 204/211 @ .050, .551/.522 in lift, 117 LSA; 2.165/1.59 in valves); SAE-certified (J1349) for 2008 Corvette.',
    estimatedFields: ['cam.intakeCenterlineDeg', 'intakeRunnerMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'massKg'],
    notes: 'Powder-metal (sintered-forged) rods, nodular-iron crank. Corvette cast-iron "shorty" manifolds. 430 hp w/ base exhaust (436 w/ NPP).',
  },
  {
    id: 'gm-ls7',
    config: {
      name: 'GM LS7 7.0 — Corvette Z06 (C6)',
      layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'cross',
      boreMm: 104.8, strokeMm: 101.6, rodLengthMm: 157.5, compressionRatio: 11.0,
      valvetrain: 'pushrod', valvesPerCylinder: 2, intakeValveMm: 56, exhaustValveMm: 40.9,
      cam: {
        intakeDurationDeg: 211, exhaustDurationDeg: 230,
        intakeLiftMm: 15.0, exhaustLiftMm: 15.0,
        lobeSeparationDeg: 121, intakeCenterlineDeg: 120,
        vvt: false, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 260, throttleMm: 90, itb: false,
      exhaust: 'shorty', headerPrimaryMm: 450, headerDiameterMm: 44,
      fuel: 'gas91', lambda: 0.87, directInjection: false,
      redlineRpm: 7000, idleRpm: 700,
      blockMaterial: 'aluminum', pistons: 'forged', rods: 'titanium', crank: 'forged',
    },
    published: { hp: 505, hpRpm: 6300, torqueNm: nm(470), torqueRpm: 4800, redlineRpm: 7000, massKg: 207 },
    ratingConfidence: 'high',
    source: 'GM Powertrain 2006 LS7 specifications / GMPP crate catalogue (505 hp @ 6300, 470 lb-ft @ 4800; cam 211/230 @ .050, .591/.591, 121 LSA; titanium intake valves 2.20 in, sodium exhaust 1.61 in; titanium rods, forged crank).',
    estimatedFields: ['cam.intakeCenterlineDeg', 'intakeRunnerMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'massKg'],
    notes: 'Dry sump, CNC-ported heads with 12° valve angle. Mean piston speed 23.7 m/s at 7000.',
  },
  // ───────────────────────────── V8, NA DOHC ─────────────────────────────
  {
    id: 'ford-coyote-gen3',
    config: {
      name: 'Ford Coyote 5.0 Gen 3 — Mustang GT (2018)',
      layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'cross',
      boreMm: 93, strokeMm: 92.7, rodLengthMm: 150.7, compressionRatio: 12.0,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 37.7, exhaustValveMm: 32,
      cam: {
        intakeDurationDeg: 236, exhaustDurationDeg: 232,
        intakeLiftMm: 13.0, exhaustLiftMm: 12.0,
        lobeSeparationDeg: 115, intakeCenterlineDeg: 110,
        vvt: true, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 330, throttleMm: 87, itb: false,
      exhaust: 'shorty', headerPrimaryMm: 400, headerDiameterMm: 40,
      fuel: 'gas93', lambda: 0.86, directInjection: true,
      redlineRpm: 7500, idleRpm: 650,
      blockMaterial: 'aluminum', pistons: 'hypereutectic', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 460, hpRpm: 7000, torqueNm: nm(420), torqueRpm: 4600, redlineRpm: 7500, massKg: 200 },
    ratingConfidence: 'high',
    source: 'Ford 2018 Mustang GT technical specifications (460 hp @ 7000, 420 lb-ft @ 4600, "ratings achieved with 93 octane"); Ford Performance Coyote Technical Reference (93 x 92.7 mm, CR 12.0).',
    estimatedFields: ['cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'pistons', 'massKg'],
    notes: 'Twin independent VCT; port + direct injection (DI flag true); charge-motion control valves in the runners. Rod length 150.7 mm from aftermarket short-block data. Valve sizes from aftermarket head listing (37.7/32).',
  },
  // ───────────────────────────── Inline 6, NA ─────────────────────────────
  {
    id: 'bmw-s54-e46m3',
    config: {
      name: 'BMW S54 3.2 — E46 M3 (US)',
      layout: 'inline', cylinders: 6, vAngleDeg: 0, crankPlane: 'cross',
      boreMm: 87, strokeMm: 91, rodLengthMm: 139, compressionRatio: 11.5,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 35, exhaustValveMm: 30.5,
      cam: {
        intakeDurationDeg: 238, exhaustDurationDeg: 234,
        intakeLiftMm: 11.8, exhaustLiftMm: 11.8,
        lobeSeparationDeg: 112, intakeCenterlineDeg: 106,
        vvt: true, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 270, throttleMm: 118, itb: true,
      exhaust: 'tuned-equal', headerPrimaryMm: 450, headerDiameterMm: 40,
      fuel: 'gas91', lambda: 0.87, directInjection: false,
      redlineRpm: 8000, idleRpm: 850,
      blockMaterial: 'iron', pistons: 'cast', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 333, hpRpm: 7900, torqueNm: nm(262), torqueRpm: 4900, redlineRpm: 8000, massKg: 217 },
    ratingConfidence: 'high',
    source: 'BMW NA 2001 M3 specifications (333 hp @ 7900, 262 lb-ft @ 4900, 8000 rpm); Wikipedia "BMW S54" (87 x 91 mm, CR 11.5, 6 individual throttles, double VANOS).',
    estimatedFields: ['cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'intakeValveMm', 'exhaustValveMm', 'lambda', 'massKg'],
    notes: 'ITB equivalent ~48 mm x sqrt(6). Euro rating 343 PS (DIN) on 98 RON. ~104 hp/L NA.',
  },
  // ───────────────────────────── Inline 6, turbo ─────────────────────────────
  {
    id: 'bmw-b58-340i',
    config: {
      name: 'BMW B58 3.0T — 340i (F30)',
      layout: 'inline', cylinders: 6, vAngleDeg: 0, crankPlane: 'cross',
      boreMm: 82, strokeMm: 94.6, rodLengthMm: 148.2, compressionRatio: 11.0,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 30.1, exhaustValveMm: 26.5,
      cam: {
        intakeDurationDeg: 212, exhaustDurationDeg: 208,
        intakeLiftMm: 9.9, exhaustLiftMm: 9.7,
        lobeSeparationDeg: 114, intakeCenterlineDeg: 112,
        vvt: true, variableLift: true,
      },
      induction: 'turbo',
      turbo: {
        targetBoostBar: 1.0, compressorInducerMm: 50 /* physics agent v4: estimate 46 -> 50 mm so the published plateau end (5000 rpm) is reachable without choke */, turbineAR: 0.5,
        intercoolerEffectiveness: 0.8, twinScroll: true, count: 1,
      },
      supercharger: NO_SC,
      intakeRunnerMm: 200, throttleMm: 74, itb: false,
      exhaust: 'log', headerPrimaryMm: 150, headerDiameterMm: 34,
      fuel: 'gas91', lambda: 0.82, directInjection: true,
      redlineRpm: 7000, idleRpm: 650,
      blockMaterial: 'aluminum', pistons: 'cast', rods: 'forged-steel', crank: 'forged',
      // physics agent v4: OEM torque management = published 330 lb-ft plateau 1380-5000 rpm
      ecu: { torqueLimitNm: nm(330) },
    },
    published: {
      hp: 320, hpRpm: 6000, torqueNm: nm(330), torqueRpm: 3190, redlineRpm: 7000, massKg: 175,
      torqueRpmRange: [1380, 5000], hpRpmRange: [5500, 6500],
    },
    ratingConfidence: 'low',
    source: 'BMW USA 2016 340i technical data (320 hp @ 5500-6500, 330 lb-ft @ 1380-5000); Wikipedia "BMW B58" (82 x 94.6 mm, CR 11.0, twin-scroll turbo, water-to-air intercooler in plenum).',
    estimatedFields: ['rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'turbo.targetBoostBar', 'turbo.compressorInducerMm', 'turbo.turbineAR', 'turbo.intercoolerEffectiveness', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'massKg'],
    notes: 'Widely reported as conservatively rated: chassis dynos of stock 340i/Supra B58s show ~300-320 whp, implying ~360-370 crank hp. Expect a well-calibrated model to land 5-15% ABOVE the published figure. Rod length/valves from aftermarket replacement-part data. Valvetronic (variable lift) + double VANOS.',
  },
  // ───────────────────────────── Inline 4, turbo ─────────────────────────────
  {
    id: 'vw-ea888-gen3-gti',
    config: {
      name: 'VW EA888 Gen 3 2.0 TSI — Golf GTI Mk7 (Performance)',
      layout: 'inline', cylinders: 4, vAngleDeg: 0, crankPlane: 'cross',
      boreMm: 82.5, strokeMm: 92.8, rodLengthMm: 144, compressionRatio: 9.6,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 33.85, exhaustValveMm: 28,
      cam: {
        intakeDurationDeg: 206, exhaustDurationDeg: 204,
        intakeLiftMm: 10.7, exhaustLiftMm: 10.0,
        lobeSeparationDeg: 114, intakeCenterlineDeg: 112,
        vvt: true, variableLift: true,
      },
      induction: 'turbo',
      turbo: {
        targetBoostBar: 1.1, compressorInducerMm: 40, turbineAR: 0.45,
        intercoolerEffectiveness: 0.7, twinScroll: false, count: 1,
      },
      supercharger: NO_SC,
      intakeRunnerMm: 220, throttleMm: 64, itb: false,
      exhaust: 'log', headerPrimaryMm: 120, headerDiameterMm: 32,
      fuel: 'gas91', lambda: 0.82, directInjection: true,
      redlineRpm: 6500, idleRpm: 700,
      blockMaterial: 'iron', pistons: 'cast', rods: 'forged-steel', crank: 'forged',
      // physics agent v4: OEM torque management = published 258 lb-ft plateau 1500-4600 rpm
      ecu: { torqueLimitNm: 350 },
    },
    published: {
      hp: 220, hpRpm: 5450, torqueNm: 350, torqueRpm: 3050, redlineRpm: 6500, massKg: 140,
      torqueRpmRange: [1500, 4600], hpRpmRange: [4700, 6200],
    },
    ratingConfidence: 'medium',
    source: 'VW of America 2015 Golf GTI Performance Package specs (220 hp @ 4700-6200, 258 lb-ft @ 1500-4600); Wikipedia "VW EA888" (82.5 x 92.8, CR 9.6, exhaust-manifold-integrated head, AVS exhaust lift switching, MPI+DI).',
    estimatedFields: ['intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'turbo.targetBoostBar', 'turbo.compressorInducerMm', 'turbo.turbineAR', 'turbo.intercoolerEffectiveness', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'massKg'],
    notes: 'IHI IS20 turbo, exhaust manifold cast into head ("log"). Variable lift = AVS on exhaust cam. Mildly under-rated per dyno reports.',
  },
  {
    id: 'ford-10-ecoboost',
    config: {
      name: 'Ford 1.0 EcoBoost I3 — Fiesta (US)',
      layout: 'inline', cylinders: 3, vAngleDeg: 0, crankPlane: 'cross',
      boreMm: 71.9, strokeMm: 82, rodLengthMm: 137, compressionRatio: 10.0,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 26, exhaustValveMm: 22,
      cam: {
        intakeDurationDeg: 204, exhaustDurationDeg: 200,
        intakeLiftMm: 8.5, exhaustLiftMm: 8.0,
        lobeSeparationDeg: 115, intakeCenterlineDeg: 112,
        vvt: true, variableLift: false,
      },
      induction: 'turbo',
      turbo: {
        targetBoostBar: 1.0, compressorInducerMm: 32, turbineAR: 0.4,
        intercoolerEffectiveness: 0.65, twinScroll: false, count: 1,
      },
      supercharger: NO_SC,
      intakeRunnerMm: 250, throttleMm: 50, itb: false,
      exhaust: 'log', headerPrimaryMm: 100, headerDiameterMm: 28,
      fuel: 'gas87', lambda: 0.85, directInjection: true,
      redlineRpm: 6500, idleRpm: 750,
      blockMaterial: 'iron', pistons: 'cast', rods: 'forged-steel', crank: 'cast',
      // physics agent v4: OEM torque management = published 125 lb-ft plateau 1400-4500 rpm (overboost excluded)
      ecu: { torqueLimitNm: 170 },
    },
    published: {
      hp: 123, hpRpm: 6000, torqueNm: 170, torqueRpm: 2950, redlineRpm: 6500, massKg: 97,
      torqueRpmRange: [1400, 4500],
    },
    ratingConfidence: 'high',
    source: 'Ford 2014 Fiesta 1.0L EcoBoost specifications (123 hp @ 6000, 125 lb-ft @ 1400-4500, 148 lb-ft overboost); Wikipedia "Ford EcoBoost 1.0 Fox" (71.9 x 82 mm, CR 10.0, iron block, integrated exhaust manifold).',
    estimatedFields: ['rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'turbo.targetBoostBar', 'turbo.compressorInducerMm', 'turbo.turbineAR', 'turbo.intercoolerEffectiveness', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'crank', 'massKg'],
    notes: 'Tiny low-inertia turbo (~248k rpm). Torque target excludes the 15 s overboost (200 Nm). turbineAR 0.4 is below the type-doc range; clamp if needed. Unbalanced 3-cyl primary couple (offset flywheel/pulley).',
  },
  // ───────────────────────────── V6 ─────────────────────────────
  {
    id: 'ford-35-ecoboost-gen2',
    config: {
      name: 'Ford 3.5 EcoBoost Gen 2 — F-150 (2017)',
      layout: 'v', cylinders: 6, vAngleDeg: 60, crankPlane: 'cross',
      boreMm: 92.5, strokeMm: 86.7, rodLengthMm: 154.7, compressionRatio: 10.5,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 37, exhaustValveMm: 31,
      cam: {
        intakeDurationDeg: 212, exhaustDurationDeg: 208,
        intakeLiftMm: 10.0, exhaustLiftMm: 9.5,
        lobeSeparationDeg: 115, intakeCenterlineDeg: 112,
        vvt: true, variableLift: false,
      },
      induction: 'turbo',
      turbo: {
        targetBoostBar: 1.0, compressorInducerMm: 38, turbineAR: 0.55, // physics agent v2: 41 -> 38 mm (stock GT15-class; Garrett PowerMax Stage 2 upgrade for 2017+ is 45 mm inducer per Garrett/KC Turbos listings, described as larger than stock)
        intercoolerEffectiveness: 0.7, twinScroll: false, count: 2,
      },
      supercharger: NO_SC,
      intakeRunnerMm: 220, throttleMm: 80, itb: false,
      exhaust: 'log', headerPrimaryMm: 200, headerDiameterMm: 38,
      fuel: 'gas87', lambda: 0.8, directInjection: true,
      redlineRpm: 6000, idleRpm: 600,
      blockMaterial: 'aluminum', pistons: 'cast', rods: 'forged-steel', crank: 'forged',
      // physics agent v4: OEM torque management = published 470 lb-ft rating (flat truck torque curve)
      ecu: { torqueLimitNm: nm(470) },
    },
    published: { hp: 375, hpRpm: 5000, torqueNm: nm(470), torqueRpm: 3500, redlineRpm: 6000, massKg: 205 },
    ratingConfidence: 'medium',
    source: 'Ford 2017 F-150 technical specifications (3.5L EcoBoost: 375 hp @ 5000, 470 lb-ft @ 3500); Wikipedia "Ford EcoBoost engine" (92.5 x 86.7 mm, CR 10.5, twin Garrett turbos, port+DI).',
    estimatedFields: ['rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'turbo.targetBoostBar', 'turbo.compressorInducerMm', 'turbo.turbineAR', 'turbo.intercoolerEffectiveness', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'fuel', 'massKg'],
    notes: 'Truck tune; Ford advertises ratings on regular fuel for F-150 (with premium making slightly more) - fuel flagged as estimated. Electronically actuated wastegates, Ti-VCT.',
  },
  {
    id: 'toyota-1gr-fe',
    config: {
      name: 'Toyota 1GR-FE 4.0 V6 — 4Runner (dual VVT-i)',
      layout: 'v', cylinders: 6, vAngleDeg: 60, crankPlane: 'cross',
      boreMm: 94, strokeMm: 95, rodLengthMm: 154, compressionRatio: 10.4,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 36, exhaustValveMm: 30.5,
      cam: {
        intakeDurationDeg: 214, exhaustDurationDeg: 212,
        intakeLiftMm: 10.0, exhaustLiftMm: 9.6,
        lobeSeparationDeg: 114, intakeCenterlineDeg: 110,
        vvt: true, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 420, throttleMm: 74, itb: false,
      exhaust: 'shorty', headerPrimaryMm: 300, headerDiameterMm: 38,
      fuel: 'gas87', lambda: 0.88, directInjection: false,
      redlineRpm: 6000, idleRpm: 650,
      blockMaterial: 'aluminum', pistons: 'cast', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 270, hpRpm: 5600, torqueNm: nm(278), torqueRpm: 4400, redlineRpm: 6000, massKg: 166 },
    ratingConfidence: 'high',
    source: 'Toyota USA 2010 4Runner specifications (4.0L V6 dual VVT-i: 270 hp @ 5600, 278 lb-ft @ 4400, regular fuel); Wikipedia "Toyota GR engine" (94 x 95 mm, CR 10.4, 60° V6, ACIS).',
    estimatedFields: ['rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'massKg'],
    notes: 'Economy/torque-oriented truck engine: ~67 hp/L, long runners (ACIS), mild cams. Good low-end calibration point.',
  },
  // ───────────────────────────── Flat engines ─────────────────────────────
  {
    id: 'subaru-ej257-sti',
    config: {
      name: 'Subaru EJ257 2.5T — WRX STI (US)',
      layout: 'flat', cylinders: 4, vAngleDeg: 180, crankPlane: 'cross',
      boreMm: 99.5, strokeMm: 79, rodLengthMm: 130.5, compressionRatio: 8.2,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 36, exhaustValveMm: 31,
      cam: {
        intakeDurationDeg: 220, exhaustDurationDeg: 216,
        intakeLiftMm: 9.9, exhaustLiftMm: 9.4,
        lobeSeparationDeg: 114, intakeCenterlineDeg: 110,
        vvt: true, variableLift: false,
      },
      induction: 'turbo',
      turbo: {
        targetBoostBar: 1.0, compressorInducerMm: 47, turbineAR: 0.61,
        intercoolerEffectiveness: 0.6, twinScroll: false, count: 1,
      },
      supercharger: NO_SC,
      intakeRunnerMm: 280, throttleMm: 65, itb: false,
      exhaust: 'shorty', headerPrimaryMm: 450, headerDiameterMm: 38,
      fuel: 'gas91', lambda: 0.78, directInjection: false,
      redlineRpm: 6700, idleRpm: 750,
      blockMaterial: 'aluminum', pistons: 'hypereutectic', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 305, hpRpm: 6000, torqueNm: nm(290), torqueRpm: 4000, redlineRpm: 6700, massKg: 160 },
    ratingConfidence: 'high',
    source: 'Subaru of America 2015 WRX STI specifications (305 hp @ 6000, 290 lb-ft @ 4000); Wikipedia "Subaru EJ engine" (EJ257: 99.5 x 79 mm, CR 8.2, 130.5 mm rods, AVCS, IHI VF48).',
    estimatedFields: ['intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'turbo.targetBoostBar', 'turbo.compressorInducerMm', 'turbo.turbineAR', 'turbo.intercoolerEffectiveness', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'massKg'],
    notes: 'Top-mount air-air intercooler (low effectiveness, heat soak). Unequal-length header. Big bore/short stroke (B/S 1.26) - knock sensitive, rich WOT tune.',
  },
  {
    id: 'porsche-9a1-40-gt3',
    config: {
      name: 'Porsche 9A1 4.0 flat-6 — 911 GT3 (991.2)',
      layout: 'flat', cylinders: 6, vAngleDeg: 180, crankPlane: 'cross',
      boreMm: 102, strokeMm: 81.5, rodLengthMm: 141, compressionRatio: 13.3,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 42.5, exhaustValveMm: 35.5,
      cam: {
        intakeDurationDeg: 256, exhaustDurationDeg: 250,
        intakeLiftMm: 12.5, exhaustLiftMm: 11.0,
        lobeSeparationDeg: 110, intakeCenterlineDeg: 104,
        vvt: true, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 330, throttleMm: 92, itb: false,
      exhaust: 'tuned-equal', headerPrimaryMm: 450, headerDiameterMm: 44,
      fuel: 'gas93', lambda: 0.88, directInjection: true,
      redlineRpm: 9000, idleRpm: 900,
      blockMaterial: 'aluminum', pistons: 'forged', rods: 'titanium', crank: 'forged',
    },
    published: { hp: 500, hpRpm: 8250, torqueNm: 460, torqueRpm: 6000, redlineRpm: 9000 },
    ratingConfidence: 'high',
    source: 'Porsche Cars North America 2018 911 GT3 press kit (500 hp @ 8250, 339 lb-ft (460 Nm) @ 6000, 9000 rpm); Porsche technical data sheet (102 x 81.5 mm, CR 13.3, titanium rods, forged pistons).',
    estimatedFields: ['rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda'],
    notes: 'Euro rating 500 PS on 98 RON (gas93). ~125 hp/L NA street - near the top of the NA street range. Dry sump, rigid rocker-arm valvetrain, VarioCam on intake and exhaust.',
  },
  // ───────────────────────────── Exotic NA V8 / V10 / V12 ─────────────────────────────
  {
    id: 'ferrari-f136-458',
    config: {
      name: 'Ferrari F136 4.5 flat-plane V8 — 458 Italia',
      layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'flat',
      boreMm: 94, strokeMm: 81, rodLengthMm: 148, compressionRatio: 12.5,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 38, exhaustValveMm: 32,
      cam: {
        intakeDurationDeg: 258, exhaustDurationDeg: 250,
        intakeLiftMm: 12.0, exhaustLiftMm: 11.0,
        lobeSeparationDeg: 110, intakeCenterlineDeg: 104,
        vvt: true, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 300, throttleMm: 100, itb: false,
      exhaust: 'tuned-equal', headerPrimaryMm: 450, headerDiameterMm: 42,
      fuel: 'gas93', lambda: 0.88, directInjection: true,
      redlineRpm: 9000, idleRpm: 1000,
      blockMaterial: 'aluminum', pistons: 'forged', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 562, hpRpm: 9000, torqueNm: 540, torqueRpm: 6000, redlineRpm: 9000 },
    ratingConfidence: 'high',
    source: 'Ferrari 458 Italia technical sheet (4497 cc, 94 x 81 mm, CR 12.5, 570 CV @ 9000, 540 Nm @ 6000, 9000 rpm); Wikipedia "Ferrari F136 engine".',
    estimatedFields: ['rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'rods'],
    notes: '570 CV (metric) = 562 hp. 125 hp/L. Flat-plane crank lets each bank use 4-2-1 tuned headers with even 180° pulses. Rated on 98 RON.',
  },
  {
    id: 'audi-52-v10-r8plus',
    config: {
      name: 'Audi/Lamborghini 5.2 FSI V10 — R8 V10 plus (2017)',
      layout: 'v', cylinders: 10, vAngleDeg: 90, crankPlane: 'cross',
      boreMm: 84.5, strokeMm: 92.8, rodLengthMm: 154, compressionRatio: 12.7,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 34, exhaustValveMm: 28.5,
      cam: {
        intakeDurationDeg: 250, exhaustDurationDeg: 244,
        intakeLiftMm: 11.5, exhaustLiftMm: 10.5,
        lobeSeparationDeg: 110, intakeCenterlineDeg: 105,
        vvt: true, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 320, throttleMm: 96, itb: false,
      exhaust: 'tuned-equal', headerPrimaryMm: 450, headerDiameterMm: 40,
      fuel: 'gas91', lambda: 0.88, directInjection: true,
      redlineRpm: 8700, idleRpm: 900,
      blockMaterial: 'aluminum', pistons: 'forged', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 602, hpRpm: 8250, torqueNm: 560, torqueRpm: 6500, redlineRpm: 8700 },
    ratingConfidence: 'high',
    source: 'Audi of America 2017 R8 V10 plus specifications (602 hp @ 8250, 413 lb-ft (560 Nm) @ 6500); Wikipedia "Audi 5.2 FSI V10" (84.5 x 92.8 mm, CR 12.7, 90° V10, dual injection, dry sump).',
    estimatedFields: ['rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'pistons'],
    notes: 'Gen-2 5.2 uses split (offset) crank pins for even 72° firing. US rating on 91 AKI. ~116 hp/L, mean piston speed 26.9 m/s at 8700 - very high.',
  },
  {
    id: 'ferrari-f140fc-f12',
    config: {
      name: 'Ferrari F140FC 6.3 V12 — F12berlinetta',
      layout: 'v', cylinders: 12, vAngleDeg: 65, crankPlane: 'cross',
      boreMm: 94, strokeMm: 75.2, rodLengthMm: 143, compressionRatio: 13.5,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 38, exhaustValveMm: 32,
      cam: {
        intakeDurationDeg: 256, exhaustDurationDeg: 248,
        intakeLiftMm: 12.0, exhaustLiftMm: 11.0,
        lobeSeparationDeg: 110, intakeCenterlineDeg: 104,
        vvt: true, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 340, throttleMm: 110, itb: false,
      exhaust: 'tuned-equal', headerPrimaryMm: 500, headerDiameterMm: 40,
      fuel: 'gas93', lambda: 0.88, directInjection: true,
      redlineRpm: 8700, idleRpm: 900,
      blockMaterial: 'aluminum', pistons: 'forged', rods: 'titanium', crank: 'forged',
    },
    published: { hp: 730, hpRpm: 8250, torqueNm: 690, torqueRpm: 6000, redlineRpm: 8700, massKg: 225 },
    ratingConfidence: 'high',
    source: 'Ferrari F12berlinetta technical sheet (6262 cc, 94 x 75.2 mm, CR 13.5, 740 CV @ 8250, 690 Nm @ 6000); Wikipedia "Ferrari F140 engine".',
    estimatedFields: ['rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'rods', 'massKg'],
    notes: '740 CV = 730 hp. ~117 hp/L. Rated on 98 RON. Very oversquare (B/S 1.25) allowing 8700 rpm at only 21.8 m/s piston speed.',
  },
  // ───────────────────────────── Supercharged ─────────────────────────────
  {
    id: 'dodge-hellcat-62',
    config: {
      name: 'Dodge SRT Hellcat 6.2 supercharged Hemi — Challenger',
      layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'cross',
      boreMm: 103.9, strokeMm: 90.9, rodLengthMm: 157.5, compressionRatio: 9.5,
      valvetrain: 'pushrod', valvesPerCylinder: 2, intakeValveMm: 54.4, exhaustValveMm: 41.9,
      cam: {
        intakeDurationDeg: 220, exhaustDurationDeg: 226,
        intakeLiftMm: 14.2, exhaustLiftMm: 13.8,
        lobeSeparationDeg: 116, intakeCenterlineDeg: 114,
        vvt: true, variableLift: false,
      },
      induction: 'supercharger',
      turbo: NO_TURBO,
      supercharger: { type: 'twin-screw', targetBoostBar: 0.8, intercoolerEffectiveness: 0.7 },
      intakeRunnerMm: 150, throttleMm: 92, itb: false,
      exhaust: 'shorty', headerPrimaryMm: 350, headerDiameterMm: 44,
      fuel: 'gas91', lambda: 0.78, directInjection: false,
      redlineRpm: 6200, idleRpm: 700,
      blockMaterial: 'iron', pistons: 'forged', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 707, hpRpm: 6000, torqueNm: nm(650), torqueRpm: 4800, redlineRpm: 6200, massKg: 260 },
    ratingConfidence: 'high',
    source: 'FCA/SRT 2015 Challenger SRT Hellcat press release (707 hp @ 6000, 650 lb-ft @ 4800, SAE J1349 certified; IHI 2.38 L twin-screw, 11.6 psi; CR 9.5); bore/stroke 103.9 x 90.9, 6.20 in rods, 2.14/1.65 in valves per EngineLabs.',
    estimatedFields: ['cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'supercharger.intercoolerEffectiveness', 'intakeRunnerMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'massKg'],
    notes: 'Twin-screw blower absorbs ~80 hp at peak. Air-to-water intercoolers integrated in the blower housing. Powder-forged rods, forged crank, forged pistons. Two spark plugs per cylinder (Hemi).',
  },
  // ───────────────────────────── Economy NA ─────────────────────────────
  {
    id: 'mazda-skyactiv-g25',
    config: {
      name: 'Mazda Skyactiv-G 2.5 — Mazda6 (US)',
      layout: 'inline', cylinders: 4, vAngleDeg: 0, crankPlane: 'cross',
      boreMm: 89, strokeMm: 100, rodLengthMm: 155, compressionRatio: 13.0,
      valvetrain: 'dohc', valvesPerCylinder: 4, intakeValveMm: 35, exhaustValveMm: 29.5,
      cam: {
        intakeDurationDeg: 226, exhaustDurationDeg: 214,
        intakeLiftMm: 9.8, exhaustLiftMm: 9.5,
        lobeSeparationDeg: 114, intakeCenterlineDeg: 112,
        vvt: true, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 450, throttleMm: 62, itb: false,
      exhaust: 'tuned-equal', headerPrimaryMm: 600, headerDiameterMm: 38,
      fuel: 'gas87', lambda: 0.9, directInjection: true,
      redlineRpm: 6500, idleRpm: 650,
      blockMaterial: 'aluminum', pistons: 'cast', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 184, hpRpm: 5700, torqueNm: nm(185), torqueRpm: 3250, redlineRpm: 6500, massKg: 115 },
    ratingConfidence: 'high',
    source: 'Mazda North America 2014 Mazda6 specifications (2.5L SKYACTIV-G: 184 hp @ 5700, 185 lb-ft @ 3250, regular fuel); Mazda owner manual engine data (89.0 x 100 mm, 2488 cc, CR 13.0).',
    estimatedFields: ['rodLengthMm', 'intakeValveMm', 'exhaustValveMm', 'cam.intakeDurationDeg', 'cam.exhaustDurationDeg', 'cam.intakeLiftMm', 'cam.exhaustLiftMm', 'cam.lobeSeparationDeg', 'cam.intakeCenterlineDeg', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'massKg'],
    notes: 'CR 13 on 87 AKI is possible thanks to the 4-2-1 exhaust (low residuals), DI charge cooling and cavity pistons; expect noticeable knock-limited spark retard at low rpm WOT. ~74 hp/L.',
  },
  // ───────────────────────────── Classic pushrod crate ─────────────────────────────
  {
    id: 'chevy-350-zz4',
    config: {
      name: 'Chevrolet 350 ZZ4 crate small-block',
      layout: 'v', cylinders: 8, vAngleDeg: 90, crankPlane: 'cross',
      boreMm: 101.6, strokeMm: 88.4, rodLengthMm: 144.8, compressionRatio: 10.0,
      valvetrain: 'pushrod', valvesPerCylinder: 2, intakeValveMm: 49.3, exhaustValveMm: 38.1,
      cam: {
        intakeDurationDeg: 208, exhaustDurationDeg: 221,
        intakeLiftMm: 12.04, exhaustLiftMm: 12.95,
        lobeSeparationDeg: 112, intakeCenterlineDeg: 108,
        vvt: false, variableLift: false,
      },
      induction: 'na', turbo: NO_TURBO, supercharger: NO_SC,
      intakeRunnerMm: 180, throttleMm: 86, itb: false,
      exhaust: 'long-tube', headerPrimaryMm: 800, headerDiameterMm: 38.5,
      fuel: 'gas93', lambda: 0.86, directInjection: false,
      redlineRpm: 5500, idleRpm: 750,
      blockMaterial: 'iron', pistons: 'forged', rods: 'forged-steel', crank: 'forged',
    },
    published: { hp: 355, hpRpm: 5250, torqueNm: nm(405), torqueRpm: 3500, redlineRpm: 5500, massKg: 240 },
    ratingConfidence: 'medium',
    source: 'Chevrolet Performance ZZ4 crate engine catalogue (P/N 12556498: 355 hp @ 5250, 405 lb-ft @ 3500; hydraulic roller cam 208/221 @ .050, .474/.510 in lift, 112 LSA; 1.94/1.50 in valves; aluminum heads; rated with 750 cfm 4-bbl carb, headers, 92 octane).',
    estimatedFields: ['cam.intakeCenterlineDeg', 'intakeRunnerMm', 'throttleMm', 'headerPrimaryMm', 'headerDiameterMm', 'lambda', 'pistons', 'massKg'],
    notes: 'Crate-engine dyno rating (with headers, no accessories/mufflers) - closer to gross than SAE net in-car. 4-bbl carb: equivalent throttle ~4 x 43 mm -> 86 mm. Fuel 92 octane -> gas93. ~61 hp/L.',
  },
];
