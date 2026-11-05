/**
 * Full published wide-open-throttle curves (torque & power vs rpm) for
 * reference engines. Used by src/sim/__tests__/dynoCurves.test.ts to score the
 * whole simulated curve, not just the peaks.
 *
 * Every curve was digitised from a primary source (see research/dyno_sources.md
 * for the per-curve method, axis calibration and caveats). Conventions:
 *  - `torqueNm` is the digitised torque. `hp` is DERIVED from it
 *    (hp = Nm * rpm / 7121, mechanical hp) so the pair is always consistent;
 *    the agreement between the source's own power curve and this derived value
 *    is quoted in `notes` as the "cross-check" (a measure of digitising/source
 *    quality).
 *  - points are sampled on a regular rpm grid (usually 250 rpm) by linear
 *    interpolation along the digitised trace; points the trace did not cover
 *    reliably (labels crossing the trace, curve overlaps) were dropped.
 *  - `split: 'holdout'` engines were chosen BEFORE any simulated error was
 *    looked at and must never be used for tuning physics constants.
 *    Engines that were already in the 21-engine peak calibration set are all
 *    'train' (their peaks were already used for calibration).
 */
import { EXTENDED_REFERENCE_ENGINES, REFERENCE_ENGINES, type ReferenceEngine } from './referenceEngines';

export type DynoSourceType = 'oem-chart' | 'engine-dyno' | 'chassis-dyno-converted' | 'paper';
export type RatingStandard = 'SAE J1349' | 'DIN' | 'ECE' | 'unknown';

export interface DynoCurvePoint {
  rpm: number;
  torqueNm: number;
  /** Mechanical hp, = torqueNm * rpm / 7121. */
  hp: number;
}

export interface DynoCurve {
  /** id in REFERENCE_ENGINES or EXTENDED_REFERENCE_ENGINES. */
  engineId: string;
  source: { url: string; title: string };
  sourceType: DynoSourceType;
  /** true = crankshaft/flywheel (engine) figures; false = wheel figures. */
  crankBasis: boolean;
  /** Only for chassis-dyno data converted to crank: assumed drivetrain loss, %. */
  drivetrainLossPct?: number;
  standard: RatingStandard;
  confidence: 'high' | 'medium' | 'low';
  points: DynoCurvePoint[];
  notes: string;
  split: 'train' | 'holdout';
}

const CP2017 = {
  url: 'https://images.carid.com/gm-parts/products/pdf/chevrolet-performance-2017-catalog.pdf',
  title: 'Chevrolet Performance Parts Catalog 2017 (crate engine "DYNO CHART" pages)',
};
const GM_NOTE =
  'Vector (PDF path) chart: trace coordinates read exactly from the PDF drawing operators, axes calibrated from the PDF gridlines (labels verified against the rendered page). Chevrolet Performance states crate engines are tested to SAE J1349 (net) or J1995 (gross); the curve is a smoothed, few-vertex representation of the dyno run.';

export const DYNO_CURVES: DynoCurve[] = [
  // ───────────────────────────── GM crate engines (vector charts) ─────────────────────────────
  {
    engineId: 'gm-ls7',
    source: { ...CP2017, title: CP2017.title + ' p.214: LS7 7.0L crate P/N 19329246' },
    sourceType: 'oem-chart', crankBasis: true, standard: 'SAE J1349', confidence: 'medium',
    points: [{ rpm: 1500, torqueNm: 483, hp: 102 }, { rpm: 1750, torqueNm: 501, hp: 123 }, { rpm: 2000, torqueNm: 519, hp: 146 }, { rpm: 2250, torqueNm: 535, hp: 169 }, { rpm: 2500, torqueNm: 538, hp: 189 }, { rpm: 2750, torqueNm: 546, hp: 211 }, { rpm: 3000, torqueNm: 553, hp: 233 }, { rpm: 3250, torqueNm: 561, hp: 256 }, { rpm: 3500, torqueNm: 574, hp: 282 }, { rpm: 3750, torqueNm: 584, hp: 308 }, { rpm: 4000, torqueNm: 598, hp: 336 }, { rpm: 4250, torqueNm: 613, hp: 366 }, { rpm: 4500, torqueNm: 625, hp: 395 }, { rpm: 4750, torqueNm: 624, hp: 417 }, { rpm: 5000, torqueNm: 624, hp: 438 }, { rpm: 5250, torqueNm: 624, hp: 460 }, { rpm: 5500, torqueNm: 623, hp: 481 }, { rpm: 5750, torqueNm: 603, hp: 487 }, { rpm: 6000, torqueNm: 586, hp: 494 }, { rpm: 6250, torqueNm: 569, hp: 499 }, { rpm: 6500, torqueNm: 544, hp: 497 }, { rpm: 6750, torqueNm: 514, hp: 487 }, { rpm: 7000, torqueNm: 489, hp: 481 }],
    notes: GM_NOTE + ' Chart drawn to 8000 rpm; points above the 7000 rpm redline dropped (chart hp/torque disagree by >4 % there). Cross-check vs chart hp: mean 1.6 %, max 4.9 %. Chart peak 461 lb-ft is ~2 % below the 470 lb-ft headline rating.',
    split: 'train',
  },
  {
    engineId: 'gm-lsa-crate',
    source: { ...CP2017, title: CP2017.title + ' p.210: LSA 6.2L supercharged crate P/N 19331507' },
    sourceType: 'oem-chart', crankBasis: true, standard: 'SAE J1349', confidence: 'high',
    points: [{ rpm: 2000, torqueNm: 637, hp: 179 }, { rpm: 2250, torqueNm: 658, hp: 208 }, { rpm: 2500, torqueNm: 679, hp: 238 }, { rpm: 2750, torqueNm: 695, hp: 268 }, { rpm: 3000, torqueNm: 710, hp: 299 }, { rpm: 3250, torqueNm: 723, hp: 330 }, { rpm: 3500, torqueNm: 736, hp: 362 }, { rpm: 3750, torqueNm: 746, hp: 393 }, { rpm: 4000, torqueNm: 743, hp: 418 }, { rpm: 4250, torqueNm: 736, hp: 439 }, { rpm: 4500, torqueNm: 729, hp: 460 }, { rpm: 4750, torqueNm: 720, hp: 480 }, { rpm: 5000, torqueNm: 712, hp: 500 }, { rpm: 5250, torqueNm: 698, hp: 514 }, { rpm: 5500, torqueNm: 684, hp: 528 }, { rpm: 5750, torqueNm: 666, hp: 538 }, { rpm: 6000, torqueNm: 649, hp: 547 }, { rpm: 6250, torqueNm: 629, hp: 552 }],
    notes: GM_NOTE + ' Axis labels are real PDF text (1600-6400 rpm, 250-600). Cross-check vs chart hp: mean 0.24 %, max 0.45 %. Peak 550 lb-ft @ ~3800 / 552 hp @ 6250 vs headline 551 @ 3800 / 556 @ 6100.',
    split: 'train',
  },
  {
    engineId: 'gm-ls9-crate',
    source: { ...CP2017, title: CP2017.title + ' p.212: LS9 6.2L supercharged crate P/N 19260165' },
    sourceType: 'oem-chart', crankBasis: true, standard: 'SAE J1349', confidence: 'high',
    points: [{ rpm: 3250, torqueNm: 786, hp: 359 }, { rpm: 3500, torqueNm: 801, hp: 394 }, { rpm: 3750, torqueNm: 816, hp: 430 }, { rpm: 4000, torqueNm: 817, hp: 459 }, { rpm: 4250, torqueNm: 816, hp: 487 }, { rpm: 4500, torqueNm: 812, hp: 513 }, { rpm: 4750, torqueNm: 803, hp: 536 }, { rpm: 5000, torqueNm: 794, hp: 558 }, { rpm: 5250, torqueNm: 784, hp: 578 }, { rpm: 5500, torqueNm: 770, hp: 595 }, { rpm: 5750, torqueNm: 754, hp: 609 }, { rpm: 6000, torqueNm: 734, hp: 618 }, { rpm: 6250, torqueNm: 709, hp: 622 }, { rpm: 6500, torqueNm: 687, hp: 627 }],
    notes: GM_NOTE + ' Axis labels are real PDF text (3000-6500 rpm, 350-650). Chart only shows 3000-6500 rpm. Cross-check vs chart hp: mean 1.0 %, max 1.9 % (chart hp ~1-2 % above torque-derived hp at high rpm). Headline 638 hp @ 6500 / 604 lb-ft @ 3800.',
    split: 'holdout',
  },
  {
    engineId: 'gm-ls376-480',
    source: { ...CP2017, title: CP2017.title + ' p.202: LS376/480 (LS3 + Hot Cam) crate P/N 19301358' },
    sourceType: 'oem-chart', crankBasis: true, standard: 'SAE J1349', confidence: 'medium',
    points: [{ rpm: 2000, torqueNm: 455, hp: 128 }, { rpm: 2250, torqueNm: 501, hp: 158 }, { rpm: 2500, torqueNm: 545, hp: 191 }, { rpm: 2750, torqueNm: 563, hp: 217 }, { rpm: 3000, torqueNm: 581, hp: 245 }, { rpm: 3250, torqueNm: 591, hp: 270 }, { rpm: 3500, torqueNm: 601, hp: 295 }, { rpm: 3750, torqueNm: 606, hp: 319 }, { rpm: 4000, torqueNm: 614, hp: 345 }, { rpm: 4250, torqueNm: 630, hp: 376 }, { rpm: 4500, torqueNm: 651, hp: 411 }, { rpm: 4750, torqueNm: 642, hp: 428 }, { rpm: 5000, torqueNm: 637, hp: 447 }, { rpm: 5250, torqueNm: 627, hp: 462 }, { rpm: 5500, torqueNm: 615, hp: 475 }, { rpm: 5750, torqueNm: 590, hp: 476 }, { rpm: 6000, torqueNm: 570, hp: 480 }, { rpm: 6250, torqueNm: 539, hp: 473 }],
    notes: GM_NOTE + ' Cross-check vs chart hp: mean 1.0 %, max 3.0 %. NOTE the chart matches the ORIGINAL 480 hp @ 5750 / 475 lb-ft @ 4500 rating of this part (2017 headline says 495/473 after a re-rate); the published figures in referenceEngines use the chart-consistent 480/475.',
    split: 'train',
  },
  {
    engineId: 'gm-zz6-350',
    source: { ...CP2017, title: CP2017.title + ' p.124: ZZ6 350 Turn-Key crate P/N 19351532' },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 3250, torqueNm: 531, hp: 242 }, { rpm: 3500, torqueNm: 538, hp: 264 }, { rpm: 3750, torqueNm: 540, hp: 284 }, { rpm: 4000, torqueNm: 542, hp: 304 }, { rpm: 4250, torqueNm: 544, hp: 325 }, { rpm: 4500, torqueNm: 552, hp: 349 }, { rpm: 4750, torqueNm: 551, hp: 368 }, { rpm: 5000, torqueNm: 546, hp: 384 }, { rpm: 5250, torqueNm: 538, hp: 396 }, { rpm: 5500, torqueNm: 525, hp: 405 }, { rpm: 5750, torqueNm: 500, hp: 403 }],
    notes: GM_NOTE + ' Last labelled gridline is 5500 rpm; trace continues to ~5800 (extrapolated axis). Cross-check vs chart hp: mean 0.4 %, max 1.4 %. Carbureted (770 cfm Holley), HEI, 36 deg total timing; GM does not say whether this carb engine is J1349 or J1995, hence standard "unknown". Chart only covers 3000-5800 rpm.',
    split: 'train',
  },
  {
    engineId: 'gm-502-ho',
    source: { ...CP2017, title: CP2017.title + ' p.308: 502 HO big-block crate P/N 12568778' },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 2000, torqueNm: 643, hp: 181 }, { rpm: 2250, torqueNm: 646, hp: 204 }, { rpm: 2500, torqueNm: 671, hp: 235 }, { rpm: 2750, torqueNm: 697, hp: 269 }, { rpm: 3000, torqueNm: 722, hp: 304 }, { rpm: 3250, torqueNm: 733, hp: 335 }, { rpm: 3500, torqueNm: 737, hp: 362 }, { rpm: 3750, torqueNm: 717, hp: 377 }, { rpm: 4000, torqueNm: 707, hp: 397 }, { rpm: 4250, torqueNm: 695, hp: 415 }, { rpm: 4500, torqueNm: 677, hp: 428 }, { rpm: 4750, torqueNm: 658, hp: 439 }, { rpm: 5000, torqueNm: 631, hp: 443 }, { rpm: 5250, torqueNm: 603, hp: 445 }],
    notes: GM_NOTE + ' Cross-check vs chart hp: mean 2.7 %, max 7.7 % (the chart hp trace has wiggles 2500-3250 rpm not present in torque) - torque trace kept. Carbureted, regular fuel, 32 deg total timing. Headline 461 hp @ 5100 / 558 lb-ft @ 3400; chart torque peak 544 lb-ft.',
    split: 'holdout',
  },
  // ───────────────────────────── BMW (technical-training full-load diagrams, raster) ─────────────────────────────
  {
    engineId: 'bmw-b58-340i',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST1505%20B58%20Engine/B58%20Engine.pdf',
      title: 'BMW Technical Training ST1505 "B58 Engine", sec. 1.3.1 Power and torque graph (B58B30M0, F30 340i)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'high',
    points: [{ rpm: 1250, torqueNm: 406, hp: 71 }, { rpm: 1500, torqueNm: 451, hp: 95 }, { rpm: 1750, torqueNm: 451, hp: 111 }, { rpm: 2000, torqueNm: 451, hp: 127 }, { rpm: 2250, torqueNm: 451, hp: 142 }, { rpm: 2500, torqueNm: 451, hp: 158 }, { rpm: 2750, torqueNm: 451, hp: 174 }, { rpm: 3000, torqueNm: 451, hp: 190 }, { rpm: 3250, torqueNm: 451, hp: 206 }, { rpm: 3500, torqueNm: 451, hp: 222 }, { rpm: 3750, torqueNm: 451, hp: 237 }, { rpm: 4250, torqueNm: 451, hp: 269 }, { rpm: 4500, torqueNm: 451, hp: 285 }, { rpm: 4750, torqueNm: 451, hp: 301 }, { rpm: 5000, torqueNm: 450, hp: 316 }, { rpm: 5250, torqueNm: 434, hp: 320 }, { rpm: 5500, torqueNm: 416, hp: 322 }, { rpm: 5750, torqueNm: 399, hp: 322 }, { rpm: 6000, torqueNm: 382, hp: 322 }, { rpm: 6250, torqueNm: 368, hp: 323 }, { rpm: 6500, torqueNm: 354, hp: 323 }, { rpm: 6750, torqueNm: 335, hp: 318 }, { rpm: 7000, torqueNm: 321, hp: 315 }],
    notes: 'Raster chart rendered at 4x and traced by colour (solid red = torque Nm, solid blue = power kW; dashed N55 comparison excluded by picking the upper trace, label boxes masked). Axes from detected gridlines (0-8000 rpm; 80-600 Nm / 20-280 kW). Cross-check vs chart kW: mean 0.4 %, max 1.5 %. This is BMW\'s declared (idealised) full-load curve: 450 Nm plateau 1380-5000, 240 kW 5500-6500. Real 340i engines are widely reported to exceed it (see referenceEngines ratingConfidence low). 4000 rpm dropped (curves cross).',
    split: 'train',
  },
  {
    engineId: 'bmw-n55-535i',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST916%20N55%20Engine/N55_Engine_web.pdf',
      title: 'BMW Technical Training ST916 "N55 Engine", p.9 Full Load Diagram (N55B30M0, F07 535i vs N54B30O0)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'medium',
    points: [{ rpm: 1500, torqueNm: 399, hp: 84 }, { rpm: 1750, torqueNm: 400, hp: 98 }, { rpm: 2000, torqueNm: 400, hp: 112 }, { rpm: 2250, torqueNm: 400, hp: 126 }, { rpm: 2500, torqueNm: 400, hp: 140 }, { rpm: 2750, torqueNm: 400, hp: 154 }, { rpm: 3000, torqueNm: 400, hp: 168 }, { rpm: 3250, torqueNm: 400, hp: 183 }, { rpm: 3500, torqueNm: 400, hp: 197 }, { rpm: 4000, torqueNm: 399, hp: 224 }, { rpm: 4250, torqueNm: 400, hp: 239 }, { rpm: 4500, torqueNm: 400, hp: 253 }, { rpm: 4750, torqueNm: 399, hp: 266 }, { rpm: 5000, torqueNm: 396, hp: 278 }, { rpm: 5250, torqueNm: 393, hp: 289 }, { rpm: 5500, torqueNm: 386, hp: 298 }, { rpm: 5750, torqueNm: 374, hp: 302 }, { rpm: 6000, torqueNm: 360, hp: 303 }, { rpm: 6250, torqueNm: 343, hp: 301 }, { rpm: 6500, torqueNm: 322, hp: 294 }, { rpm: 6750, torqueNm: 303, hp: 288 }],
    notes: 'Raster chart traced by colour at 4x (solid traces; dashed N54 excluded by upper-trace pick, labels masked). Axes 500-7500 rpm, 0-600 Nm / 0-240 kW from gridlines. Cross-check vs chart kW 2000-6750 rpm: within 1.8 %; below 2000 rpm BMW\'s drawn power trace is inconsistent with its own torque trace (up to 11 %), so only torque was used. 3750 rpm dropped (curves cross). Declared curve: 400 Nm 1200-5000, 225 kW 5800-6400.',
    split: 'train',
  },
];

/** All engines (peak-calibration set + extended set) by id. */
export const DYNO_ENGINE_BY_ID: Record<string, ReferenceEngine> = Object.fromEntries(
  [...REFERENCE_ENGINES, ...EXTENDED_REFERENCE_ENGINES].map((e) => [e.id, e]),
);
