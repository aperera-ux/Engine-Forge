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
  {
    engineId: 'bmw-n20-28i',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST1111%20N20%20Engine/N20%20Engine.pdf',
      title: 'BMW Technical Training ST1111 "N20 Engine", 1.2.1 Full-load diagram N20B20O0 vs N52B30O1',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'high',
    points: [{ rpm: 1000, torqueNm: 226, hp: 32 }, { rpm: 1250, torqueNm: 347, hp: 61 }, { rpm: 1500, torqueNm: 350, hp: 74 }, { rpm: 1750, torqueNm: 350, hp: 86 }, { rpm: 2000, torqueNm: 350, hp: 98 }, { rpm: 2250, torqueNm: 350, hp: 111 }, { rpm: 2500, torqueNm: 350, hp: 123 }, { rpm: 2750, torqueNm: 350, hp: 135 }, { rpm: 3000, torqueNm: 350, hp: 147 }, { rpm: 3250, torqueNm: 350, hp: 160 }, { rpm: 3500, torqueNm: 350, hp: 172 }, { rpm: 3750, torqueNm: 350, hp: 184 }, { rpm: 4000, torqueNm: 350, hp: 197 }, { rpm: 4250, torqueNm: 350, hp: 209 }, { rpm: 4500, torqueNm: 350, hp: 221 }, { rpm: 4750, torqueNm: 350, hp: 233 }, { rpm: 5000, torqueNm: 344, hp: 242 }, { rpm: 5250, torqueNm: 331, hp: 244 }, { rpm: 5500, torqueNm: 318, hp: 246 }, { rpm: 6000, torqueNm: 291, hp: 245 }, { rpm: 6250, torqueNm: 277, hp: 243 }, { rpm: 6500, torqueNm: 264, hp: 241 }, { rpm: 6750, torqueNm: 244, hp: 231 }, { rpm: 7000, torqueNm: 223, hp: 219 }],
    notes: 'Raster chart traced by colour at 4x; x 0-8000 rpm and 0-400 Nm / 0-200 kW from gridlines (Nm = 2 x kW on the same grid). Solid N20 traces: upper trace <= 5500 rpm, lower trace >= 6000 rpm (the dashed N52 curves cross the solid ones near 5700 rpm; 5750 dropped). Cross-check vs chart kW: mean 0.5 %, max 2.5 %. Piecewise-linear declared curve.',
    split: 'train',
  },
  {
    engineId: 'bmw-n63-550i',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST501%20New%20Engine%20Technology/03_BMW%20Engines%20Introduction.pdf',
      title: 'BMW Technical Training ST501 "BMW Engines Introduction", p.23 Full Load Diagram N63B44O0 vs N62B48O1',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'high',
    points: [{ rpm: 1000, torqueNm: 443, hp: 62 }, { rpm: 1250, torqueNm: 489, hp: 86 }, { rpm: 1500, torqueNm: 538, hp: 113 }, { rpm: 1750, torqueNm: 598, hp: 147 }, { rpm: 2000, torqueNm: 600, hp: 169 }, { rpm: 2250, torqueNm: 600, hp: 190 }, { rpm: 2500, torqueNm: 600, hp: 211 }, { rpm: 2750, torqueNm: 600, hp: 232 }, { rpm: 3000, torqueNm: 600, hp: 253 }, { rpm: 3250, torqueNm: 600, hp: 274 }, { rpm: 3500, torqueNm: 600, hp: 295 }, { rpm: 3750, torqueNm: 600, hp: 316 }, { rpm: 4000, torqueNm: 600, hp: 337 }, { rpm: 4250, torqueNm: 600, hp: 358 }, { rpm: 4500, torqueNm: 600, hp: 379 }, { rpm: 4750, torqueNm: 591, hp: 394 }, { rpm: 5000, torqueNm: 572, hp: 402 }, { rpm: 5250, torqueNm: 550, hp: 405 }, { rpm: 5500, torqueNm: 526, hp: 406 }, { rpm: 5750, torqueNm: 504, hp: 407 }, { rpm: 6000, torqueNm: 483, hp: 407 }, { rpm: 6250, torqueNm: 461, hp: 405 }, { rpm: 6500, torqueNm: 437, hp: 399 }],
    notes: 'Raster chart (grey background, white gridlines) traced by colour at 4x; upper (solid) traces. Axes 1000-6000 rpm gridlines, 360-600 Nm / 20-300 kW. Cross-check vs chart kW: mean 0.8 %, max 2.7 %.',
    split: 'train',
  },
  {
    engineId: 'bmw-n62-48',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST501%20New%20Engine%20Technology/03_BMW%20Engines%20Introduction.pdf',
      title: 'BMW Technical Training ST501 "BMW Engines Introduction", p.23 Full Load Diagram (dotted N62B48O1 comparison curve)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'low',
    points: [{ rpm: 1000, torqueNm: 381, hp: 54 }, { rpm: 1250, torqueNm: 397, hp: 70 }, { rpm: 1500, torqueNm: 415, hp: 87 }, { rpm: 1750, torqueNm: 433, hp: 106 }, { rpm: 2000, torqueNm: 448, hp: 126 }, { rpm: 2250, torqueNm: 462, hp: 146 }, { rpm: 2500, torqueNm: 469, hp: 165 }, { rpm: 2750, torqueNm: 475, hp: 183 }, { rpm: 3000, torqueNm: 482, hp: 203 }, { rpm: 3250, torqueNm: 487, hp: 222 }, { rpm: 3500, torqueNm: 488, hp: 240 }, { rpm: 3750, torqueNm: 488, hp: 257 }, { rpm: 4000, torqueNm: 486, hp: 273 }, { rpm: 4250, torqueNm: 481, hp: 287 }, { rpm: 4500, torqueNm: 474, hp: 300 }, { rpm: 4750, torqueNm: 468, hp: 312 }, { rpm: 5000, torqueNm: 462, hp: 324 }, { rpm: 5250, torqueNm: 456, hp: 336 }, { rpm: 5500, torqueNm: 449, hp: 347 }, { rpm: 5750, torqueNm: 438, hp: 354 }, { rpm: 6000, torqueNm: 426, hp: 359 }, { rpm: 6250, torqueNm: 409, hp: 359 }, { rpm: 6500, torqueNm: 393, hp: 359 }],
    notes: 'Dotted comparison trace (second trace from top in each column, +/-6 px window). Torque trace matches the 490 Nm @ 3400 label and the chart kW above 4500 rpm (within 3 %), BUT the drawn N62 power trace below 4000 rpm is a near-straight line inconsistent with this torque (up to 30 % low) - one of the two traces is schematic, hence LOW confidence.',
    split: 'train',
  },
  {
    engineId: 'bmw-n74-760i',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST915%20N74%20Engine/N74_Engine_web.pdf',
      title: 'BMW Technical Training ST915 "N74 Engine", p.10 Horse Power and Torque Diagram (N74B60 vs N73B60, N63B44)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'medium',
    points: [{ rpm: 1000, torqueNm: 498, hp: 70 }, { rpm: 1250, torqueNm: 575, hp: 101 }, { rpm: 1500, torqueNm: 693, hp: 146 }, { rpm: 1750, torqueNm: 750, hp: 184 }, { rpm: 2000, torqueNm: 750, hp: 211 }, { rpm: 2250, torqueNm: 750, hp: 237 }, { rpm: 2500, torqueNm: 750, hp: 263 }, { rpm: 2750, torqueNm: 750, hp: 290 }, { rpm: 3000, torqueNm: 750, hp: 316 }, { rpm: 3250, torqueNm: 750, hp: 342 }, { rpm: 3500, torqueNm: 750, hp: 369 }, { rpm: 3750, torqueNm: 750, hp: 395 }, { rpm: 4000, torqueNm: 750, hp: 421 }, { rpm: 4250, torqueNm: 750, hp: 448 }, { rpm: 4500, torqueNm: 750, hp: 474 }, { rpm: 4750, torqueNm: 750, hp: 500 }, { rpm: 5000, torqueNm: 750, hp: 527 }, { rpm: 5250, torqueNm: 735, hp: 542 }, { rpm: 5500, torqueNm: 707, hp: 546 }, { rpm: 5750, torqueNm: 675, hp: 545 }, { rpm: 6000, torqueNm: 646, hp: 544 }, { rpm: 6250, torqueNm: 616, hp: 541 }, { rpm: 6500, torqueNm: 580, hp: 529 }],
    notes: 'Low-resolution raster (separate kW and Nm panels); torque panel traced by colour at 4x (upper solid trace), axes 0-7000 rpm / 400-850 Nm from gridlines. Power panel only used as cross-check: torque-derived power 405-407 kW at 5500-6000 rpm vs the 400 kW label (+1.5 %). Trace reaches 750 Nm at ~1600 rpm, not 1500 as labelled.',
    split: 'holdout',
  },
  {
    engineId: 'bmw-s85-m5',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST505%20E60%20M5%20Complete%20Vehicle/03_M%20Engines.pdf',
      title: 'BMW Technical Training ST505 "M Engines", p.13 S85B50 Engine Statistics (power/torque chart)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'medium',
    points: [{ rpm: 1250, torqueNm: 394, hp: 69 }, { rpm: 1500, torqueNm: 391, hp: 82 }, { rpm: 1750, torqueNm: 390, hp: 96 }, { rpm: 2000, torqueNm: 390, hp: 110 }, { rpm: 2250, torqueNm: 391, hp: 124 }, { rpm: 2500, torqueNm: 395, hp: 139 }, { rpm: 2750, torqueNm: 413, hp: 160 }, { rpm: 3000, torqueNm: 429, hp: 181 }, { rpm: 3250, torqueNm: 440, hp: 201 }, { rpm: 3500, torqueNm: 447, hp: 220 }, { rpm: 3750, torqueNm: 453, hp: 239 }, { rpm: 4000, torqueNm: 458, hp: 257 }, { rpm: 4250, torqueNm: 462, hp: 276 }, { rpm: 4500, torqueNm: 465, hp: 294 }, { rpm: 4750, torqueNm: 470, hp: 314 }, { rpm: 5000, torqueNm: 473, hp: 332 }, { rpm: 5250, torqueNm: 480, hp: 354 }, { rpm: 5500, torqueNm: 494, hp: 382 }, { rpm: 5750, torqueNm: 507, hp: 409 }, { rpm: 6000, torqueNm: 520, hp: 438 }, { rpm: 6250, torqueNm: 517, hp: 454 }, { rpm: 6500, torqueNm: 510, hp: 466 }, { rpm: 6750, torqueNm: 504, hp: 478 }, { rpm: 7000, torqueNm: 497, hp: 489 }, { rpm: 7250, torqueNm: 485, hp: 494 }, { rpm: 7500, torqueNm: 472, hp: 497 }, { rpm: 7750, torqueNm: 460, hp: 501 }, { rpm: 8000, torqueNm: 438, hp: 492 }, { rpm: 8250, torqueNm: 423, hp: 490 }],
    notes: 'Raster chart (grey background, white gridlines), thick coarse piecewise-linear traces; traced by colour at 4x. Axes 2000-8000 rpm gridlines, 250-800 Nm / 50-600 PS. Cross-check vs chart PS (P = T*n/7023): mean 1.2 %, max 4.1 %. Coarse source -> medium confidence.',
    split: 'train',
  },
  {
    engineId: 'bmw-s65-m3',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST505%20E60%20M5%20Complete%20Vehicle/03_M%20Engines.pdf',
      title: 'BMW Technical Training ST505 "M Engines", p.15 S65B40 power/torque chart',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'medium',
    points: [{ rpm: 1500, torqueNm: 297, hp: 63 }, { rpm: 1750, torqueNm: 317, hp: 78 }, { rpm: 2000, torqueNm: 336, hp: 94 }, { rpm: 2250, torqueNm: 356, hp: 112 }, { rpm: 2500, torqueNm: 375, hp: 132 }, { rpm: 2750, torqueNm: 388, hp: 150 }, { rpm: 3000, torqueNm: 392, hp: 165 }, { rpm: 3250, torqueNm: 396, hp: 181 }, { rpm: 3500, torqueNm: 399, hp: 196 }, { rpm: 3750, torqueNm: 400, hp: 211 }, { rpm: 4000, torqueNm: 400, hp: 225 }, { rpm: 4250, torqueNm: 397, hp: 237 }, { rpm: 4500, torqueNm: 395, hp: 250 }, { rpm: 4750, torqueNm: 393, hp: 262 }, { rpm: 5000, torqueNm: 393, hp: 276 }, { rpm: 5250, torqueNm: 394, hp: 290 }, { rpm: 5500, torqueNm: 394, hp: 304 }, { rpm: 5750, torqueNm: 394, hp: 318 }, { rpm: 6000, torqueNm: 394, hp: 332 }, { rpm: 6250, torqueNm: 394, hp: 346 }, { rpm: 6500, torqueNm: 393, hp: 359 }, { rpm: 6750, torqueNm: 392, hp: 372 }, { rpm: 7000, torqueNm: 390, hp: 383 }, { rpm: 7250, torqueNm: 389, hp: 396 }, { rpm: 7500, torqueNm: 386, hp: 407 }, { rpm: 7750, torqueNm: 379, hp: 412 }, { rpm: 8000, torqueNm: 366, hp: 411 }, { rpm: 8250, torqueNm: 352, hp: 408 }],
    notes: 'Same chart style/method as S85. Cross-check vs chart PS above 3500 rpm: within 3.7 % (mean ~1.5 %); below 3000 rpm the drawn power trace is inconsistent with the torque trace (up to 26 % at 1500 rpm) - torque used.',
    split: 'holdout',
  },
  // ───────────────────────────── VW / Audi Self Study Programmes ─────────────────────────────
  {
    engineId: 'audi-42-fsi-rs4',
    source: {
      url: 'https://www.vaglinks.com/Docs/SSP/VWUSA.COM_SSP_377_4.2L_FSI_Engine.pdf',
      title: 'Audi SSP 377 "4.2l V8 FSI Engine", p.8 Torque/power curve (V8 FSI high-revving engine in RS4, solid)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'high',
    points: [{ rpm: 1250, torqueNm: 305, hp: 54 }, { rpm: 1500, torqueNm: 330, hp: 70 }, { rpm: 1750, torqueNm: 354, hp: 87 }, { rpm: 2000, torqueNm: 378, hp: 106 }, { rpm: 2250, torqueNm: 398, hp: 126 }, { rpm: 2500, torqueNm: 403, hp: 141 }, { rpm: 2750, torqueNm: 405, hp: 156 }, { rpm: 3000, torqueNm: 406, hp: 171 }, { rpm: 3250, torqueNm: 405, hp: 185 }, { rpm: 3500, torqueNm: 406, hp: 200 }, { rpm: 3750, torqueNm: 406, hp: 214 }, { rpm: 4000, torqueNm: 406, hp: 228 }, { rpm: 4250, torqueNm: 406, hp: 242 }, { rpm: 4500, torqueNm: 409, hp: 258 }, { rpm: 4750, torqueNm: 411, hp: 274 }, { rpm: 5000, torqueNm: 416, hp: 292 }, { rpm: 5250, torqueNm: 424, hp: 313 }, { rpm: 5500, torqueNm: 428, hp: 331 }, { rpm: 5750, torqueNm: 427, hp: 345 }, { rpm: 6000, torqueNm: 426, hp: 359 }, { rpm: 6250, torqueNm: 425, hp: 373 }, { rpm: 6500, torqueNm: 418, hp: 382 }, { rpm: 6750, torqueNm: 411, hp: 390 }, { rpm: 7000, torqueNm: 405, hp: 398 }, { rpm: 7250, torqueNm: 397, hp: 404 }, { rpm: 7500, torqueNm: 388, hp: 409 }, { rpm: 7750, torqueNm: 378, hp: 411 }, { rpm: 8000, torqueNm: 368, hp: 413 }, { rpm: 8250, torqueNm: 352, hp: 408 }],
    notes: 'VECTOR chart: path vertices read from the PDF. Axis calibration from PDF gridlines and text labels: 24.07 pt per 1000 rpm from the frame at 0 rpm. CAVEAT: the printed rpm labels read "0 2000 5000 7000 9000" but sit on the 0/2000/4000/6000/8000 gridlines (label typo) - the 1000-rpm-per-gridline reading is confirmed by the stated 309 kW @ 7800 and 430 Nm @ 5500 (trace peaks at 7801 and 5450 rpm). Torque axis 300-460 Nm, power 80-320 kW. Cross-check vs chart kW: mean 0.8 %, max 4.9 % (1750 rpm).',
    split: 'train',
  },
  {
    engineId: 'audi-25-tfsi-ttrs',
    source: {
      url: 'https://www.vaglinks.com/Docs/SSP/VWUSA.COM_SSP_451_Audi%20TT-RS_2.5L_TFSI.pdf',
      title: 'Audi SSP 451 "Audi TT RS 2.5L TFSI", p.14 Torque/power curve (CEPA)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'high',
    points: [{ rpm: 1000, torqueNm: 257, hp: 36 }, { rpm: 1250, torqueNm: 309, hp: 54 }, { rpm: 1500, torqueNm: 369, hp: 78 }, { rpm: 1750, torqueNm: 437, hp: 107 }, { rpm: 2000, torqueNm: 451, hp: 127 }, { rpm: 2250, torqueNm: 452, hp: 143 }, { rpm: 2500, torqueNm: 452, hp: 159 }, { rpm: 2750, torqueNm: 452, hp: 175 }, { rpm: 3000, torqueNm: 452, hp: 190 }, { rpm: 3250, torqueNm: 452, hp: 206 }, { rpm: 3500, torqueNm: 452, hp: 222 }, { rpm: 3750, torqueNm: 452, hp: 238 }, { rpm: 4000, torqueNm: 452, hp: 254 }, { rpm: 4250, torqueNm: 452, hp: 270 }, { rpm: 4500, torqueNm: 451, hp: 285 }, { rpm: 5000, torqueNm: 451, hp: 317 }, { rpm: 5250, torqueNm: 447, hp: 330 }, { rpm: 5500, torqueNm: 433, hp: 334 }, { rpm: 5750, torqueNm: 415, hp: 335 }, { rpm: 6000, torqueNm: 397, hp: 335 }, { rpm: 6250, torqueNm: 383, hp: 336 }, { rpm: 6500, torqueNm: 367, hp: 335 }],
    notes: 'Raster chart (light grey background, white gridlines) traced by colour at 4x (dark grey = Nm, red = kW); 1000-6000 rpm gridlines, 60-540 Nm / 30-270 kW. Cross-check vs chart kW 1750-6500 rpm: within 1.7 %; below 1500 rpm the drawn power trace is 9-12 % above torque-derived power. 4750 rpm dropped (curves cross).',
    split: 'holdout',
  },
  {
    engineId: 'vw-ea113-20tfsi',
    source: {
      url: 'https://www.vaglinks.com/Docs/SSP/VWUSA.COM_SSP_821503_FSI_Turbo_Motor.pdf',
      title: 'VW of America SSP 821503 "2.0L FSI Turbo Engine", p.2 Torque and Power (S339_047)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'SAE J1349', confidence: 'medium',
    points: [{ rpm: 1000, torqueNm: 165, hp: 23 }, { rpm: 1250, torqueNm: 200, hp: 35 }, { rpm: 1500, torqueNm: 239, hp: 50 }, { rpm: 1750, torqueNm: 276, hp: 68 }, { rpm: 2000, torqueNm: 280, hp: 79 }, { rpm: 2250, torqueNm: 280, hp: 88 }, { rpm: 2500, torqueNm: 280, hp: 98 }, { rpm: 2750, torqueNm: 280, hp: 108 }, { rpm: 3000, torqueNm: 280, hp: 118 }, { rpm: 3250, torqueNm: 280, hp: 128 }, { rpm: 3500, torqueNm: 280, hp: 138 }, { rpm: 3750, torqueNm: 280, hp: 147 }, { rpm: 4000, torqueNm: 280, hp: 157 }, { rpm: 4250, torqueNm: 280, hp: 167 }, { rpm: 4500, torqueNm: 280, hp: 177 }, { rpm: 4750, torqueNm: 280, hp: 187 }, { rpm: 5000, torqueNm: 279, hp: 196 }, { rpm: 5250, torqueNm: 270, hp: 199 }, { rpm: 5500, torqueNm: 261, hp: 202 }, { rpm: 5750, torqueNm: 251, hp: 203 }, { rpm: 6000, torqueNm: 241, hp: 203 }, { rpm: 6250, torqueNm: 231, hp: 203 }, { rpm: 6500, torqueNm: 221, hp: 202 }],
    notes: 'Raster chart traced by colour at 4x. CAVEAT: the axis labels are US-unit conversions of a metric grid (lb-ft labels 22/44/.../243 = 30-330 Nm in 30 Nm steps; hp labels 20/41/.../224 = 15-165 kW in 15 kW steps, one label misprinted "109" for 122). Calibrated on the metric grid; verified by the 280 Nm plateau and 147 kW peak. Cross-check vs chart power 2000-6500 rpm: within 2.5 % (chart power slightly low at the top). Chart drawn to 7000 rpm; truncated at the 6500 rpm limit.',
    split: 'train',
  },
  // ───────────────────────────── added in research round 2 ─────────────────────────────
  {
    engineId: 'gm-ls3',
    source: {
      url: 'https://www.crateenginedepot.com/Pdfs/19435098_Information.pdf',
      title: 'Chevrolet Performance LS3 crate engine sell sheet P/N 19540155 (same chart as 2017 catalog p.200), DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'SAE J1349', confidence: 'medium',
    points: [{ rpm: 3000, torqueNm: 501, hp: 211 }, { rpm: 3250, torqueNm: 502, hp: 229 }, { rpm: 3500, torqueNm: 520, hp: 256 }, { rpm: 3750, torqueNm: 539, hp: 284 }, { rpm: 4000, torqueNm: 549, hp: 308 }, { rpm: 4250, torqueNm: 566, hp: 338 }, { rpm: 4500, torqueNm: 575, hp: 363 }, { rpm: 4750, torqueNm: 567, hp: 378 }, { rpm: 5000, torqueNm: 562, hp: 395 }, { rpm: 5250, torqueNm: 551, hp: 406 }, { rpm: 5500, torqueNm: 536, hp: 414 }, { rpm: 5750, torqueNm: 518, hp: 418 }, { rpm: 6000, torqueNm: 504, hp: 425 }, { rpm: 6250, torqueNm: 471, hp: 413 }],
    notes: "Vector chart (PDF path vertices) BUT the x axis is CATEGORICAL, not linear: tick labels 800,1600,2400,3200,4000,4300,4500,4700,5400,5900,6400 are equally spaced, there are no vertical gridlines. Rpm along the axis was mapped by piecewise-linear interpolation between the equally spaced labels (traces begin/end on the first/last label), and checked independently: rpm implied by the chart own hp and torque traces (hp*5252/tq) agrees with the label mapping to within 1-3 % above 3000 rpm (peak torque lands at 4570 rpm vs the 4600 published; peak hp at 5750-5900 vs 5900). Below 3000 rpm the hp trace is too small to cross-check (differences 4-11 %), so those points were dropped; the chart ends at 6400 label (points above 6250 dropped). Peak 424 lb-ft (575 Nm) vs 425 published. Cross-check vs chart hp 3000-6250 rpm: mean 1.0 %, max 2.6 %. Vector (PDF path) chart: trace vertices read exactly from the PDF drawing operators, axes calibrated from the PDF gridlines; axis labels are outlined glyphs so tick values were read from the rendered page. Smoothed few-vertex representation of the dyno run (Chevrolet Performance: crate engines tested to SAE J1349 net / J1995 gross, with test headers and no accessories).",
    split: 'train',
  },
  {
    engineId: 'gm-ls376-525',
    source: {
      url: 'https://images.carid.com/gm-parts/products/pdf/chevrolet-performance-2017-catalog.pdf',
      title: 'Chevrolet Performance Parts Catalog 2017 (crate engine DYNO CHART pages) p.206: LS376/525 crate P/N 19301360',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'SAE J1349', confidence: 'high',
    points: [{ rpm: 3250, torqueNm: 563, hp: 257 }, { rpm: 3500, torqueNm: 562, hp: 276 }, { rpm: 3750, torqueNm: 574, hp: 302 }, { rpm: 4000, torqueNm: 599, hp: 336 }, { rpm: 4250, torqueNm: 641, hp: 382 }, { rpm: 4500, torqueNm: 662, hp: 419 }, { rpm: 4750, torqueNm: 644, hp: 430 }, { rpm: 5000, torqueNm: 654, hp: 459 }, { rpm: 5250, torqueNm: 655, hp: 483 }, { rpm: 5500, torqueNm: 649, hp: 501 }, { rpm: 5750, torqueNm: 630, hp: 509 }, { rpm: 6000, torqueNm: 618, hp: 521 }, { rpm: 6250, torqueNm: 600, hp: 526 }],
    notes: "Vector (PDF path) chart: trace vertices read exactly from the PDF drawing operators, axes calibrated from the PDF gridlines; axis labels are outlined glyphs so tick values were read from the rendered page. Smoothed few-vertex representation of the dyno run (Chevrolet Performance: crate engines tested to SAE J1349 net / J1995 gross, with test headers and no accessories). Chart axes 3000-6300 rpm (300 steps), 200-550. Cross-check vs chart hp: mean 0.5 %, max 1.2 %. Chart peaks 489 lb-ft / 532 hp vs headline 486 lb-ft @ 5200 / 525 hp @ 6200.",
    split: 'train',
  },
  {
    engineId: 'gm-zz572-620',
    source: {
      url: 'https://images.carid.com/gm-parts/products/pdf/chevrolet-performance-2017-catalog.pdf',
      title: 'Chevrolet Performance Parts Catalog 2017 (crate engine DYNO CHART pages) p.316: ZZ572/620 Deluxe big-block crate P/N 19331583',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'high',
    points: [{ rpm: 3250, torqueNm: 841, hp: 384 }, { rpm: 3500, torqueNm: 870, hp: 428 }, { rpm: 3750, torqueNm: 880, hp: 463 }, { rpm: 4000, torqueNm: 880, hp: 494 }, { rpm: 4250, torqueNm: 880, hp: 525 }, { rpm: 4500, torqueNm: 880, hp: 556 }, { rpm: 4750, torqueNm: 873, hp: 582 }, { rpm: 5000, torqueNm: 851, hp: 598 }, { rpm: 5250, torqueNm: 832, hp: 613 }, { rpm: 5500, torqueNm: 809, hp: 625 }, { rpm: 5750, torqueNm: 776, hp: 626 }],
    notes: "Vector (PDF path) chart: trace vertices read exactly from the PDF drawing operators, axes calibrated from the PDF gridlines; axis labels are outlined glyphs so tick values were read from the rendered page. Smoothed few-vertex representation of the dyno run (Chevrolet Performance: crate engines tested to SAE J1349 net / J1995 gross, with test headers and no accessories). Chart axes 3000-6000 rpm (250 steps), 300-700. Carbureted (850 cfm). Cross-check vs chart hp: mean 0.5 %, max 1.3 %. Chart peaks 649 lb-ft / 624 hp vs headline 645 lb-ft @ 4200 / 621 hp @ 5400.",
    split: 'holdout',
  },
  {
    engineId: 'gm-zz427-480',
    source: {
      url: 'https://images.carid.com/gm-parts/products/pdf/chevrolet-performance-2017-catalog.pdf',
      title: 'Chevrolet Performance Parts Catalog 2017 (crate engine DYNO CHART pages) p.300: ZZ427/480 big-block crate P/N 19166393',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'high',
    points: [{ rpm: 3000, torqueNm: 596, hp: 251 }, { rpm: 3250, torqueNm: 597, hp: 272 }, { rpm: 3500, torqueNm: 643, hp: 316 }, { rpm: 3750, torqueNm: 664, hp: 350 }, { rpm: 4000, torqueNm: 665, hp: 374 }, { rpm: 4250, torqueNm: 661, hp: 394 }, { rpm: 4500, torqueNm: 652, hp: 412 }, { rpm: 4750, torqueNm: 644, hp: 429 }, { rpm: 5000, torqueNm: 636, hp: 447 }, { rpm: 5250, torqueNm: 627, hp: 462 }, { rpm: 5500, torqueNm: 610, hp: 471 }, { rpm: 5750, torqueNm: 593, hp: 479 }, { rpm: 6000, torqueNm: 568, hp: 479 }],
    notes: "Vector (PDF path) chart: trace vertices read exactly from the PDF drawing operators, axes calibrated from the PDF gridlines; axis labels are outlined glyphs so tick values were read from the rendered page. Smoothed few-vertex representation of the dyno run (Chevrolet Performance: crate engines tested to SAE J1349 net / J1995 gross, with test headers and no accessories). Chart axes 3000-6000 rpm (300 steps), 200-500. Carbureted (770 cfm). Cross-check vs chart hp: mean 0.8 %, max 2.0 %. Chart peaks 492 lb-ft / 482 hp vs headline 490 @ 3800 / 480 @ 6000.",
    split: 'train',
  },
  {
    engineId: 'vw-ea888-gen1-20tfsi',
    source: {
      url: 'https://www.vaglinks.com/Docs/SSP/VWUSA.COM_SSP_922903_2.0L_4V_TFSI_Engine.pdf',
      title: 'Audi/VW SSP 922903 "2.0L 4V TFSI Engine", p.7 Torque/Power Curve (CAEB)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'high',
    points: [{ rpm: 1500, torqueNm: 246, hp: 52 }, { rpm: 1750, torqueNm: 281, hp: 69 }, { rpm: 2000, torqueNm: 281, hp: 79 }, { rpm: 2250, torqueNm: 281, hp: 89 }, { rpm: 2500, torqueNm: 281, hp: 98 }, { rpm: 2750, torqueNm: 281, hp: 108 }, { rpm: 3000, torqueNm: 281, hp: 118 }, { rpm: 3250, torqueNm: 281, hp: 128 }, { rpm: 3500, torqueNm: 281, hp: 138 }, { rpm: 3750, torqueNm: 281, hp: 148 }, { rpm: 4000, torqueNm: 281, hp: 158 }, { rpm: 4250, torqueNm: 281, hp: 167 }, { rpm: 4500, torqueNm: 281, hp: 177 }, { rpm: 4750, torqueNm: 281, hp: 187 }, { rpm: 5000, torqueNm: 281, hp: 197 }, { rpm: 5250, torqueNm: 268, hp: 198 }, { rpm: 5500, torqueNm: 256, hp: 198 }, { rpm: 5750, torqueNm: 245, hp: 198 }, { rpm: 6000, torqueNm: 235, hp: 198 }, { rpm: 6250, torqueNm: 224, hp: 196 }, { rpm: 6500, torqueNm: 213, hp: 194 }],
    notes: "Declared (idealised, piecewise-linear) full-load curve from an Audi/VW Self Study Programme: vector chart, trace vertices read from the PDF path data, axes calibrated from the printed label positions. Dual-unit axes (lb ft (Nm), hp (kW)); metric scale used. Chart peaks 280.7 Nm / 147.5 kW vs spec 280 Nm @ 1700-5000 / 147 kW @ 5100-6000. Cross-check torque-derived power vs chart kW: mean 0.4 %, max 1.0 % (points from 1500 rpm; 1000-1250 rpm dropped, power trace inconsistent there). Torque plateau is ECU-limited (flat to 5000).",
    split: 'train',
  },
  {
    engineId: 'vw-18tfsi-byt',
    source: {
      url: 'https://www.vaglinks.com/Docs/SSP/VWUSA.COM_SSP_384_Audi_1.8l_4V_TSFI_Engine.pdf',
      title: 'Audi SSP 384 "1.8l 4V TFSI Engine", p.7 Torque/power curve (BYT, 118 kW)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'medium',
    points: [{ rpm: 1500, torqueNm: 248, hp: 52 }, { rpm: 1750, torqueNm: 252, hp: 62 }, { rpm: 2000, torqueNm: 252, hp: 71 }, { rpm: 2250, torqueNm: 252, hp: 80 }, { rpm: 2500, torqueNm: 252, hp: 89 }, { rpm: 2750, torqueNm: 252, hp: 97 }, { rpm: 3000, torqueNm: 252, hp: 106 }, { rpm: 3250, torqueNm: 252, hp: 115 }, { rpm: 3500, torqueNm: 252, hp: 124 }, { rpm: 3750, torqueNm: 252, hp: 133 }, { rpm: 4000, torqueNm: 252, hp: 142 }, { rpm: 4250, torqueNm: 252, hp: 150 }, { rpm: 4500, torqueNm: 246, hp: 155 }, { rpm: 4750, torqueNm: 236, hp: 157 }, { rpm: 5000, torqueNm: 226, hp: 158 }, { rpm: 5250, torqueNm: 216, hp: 159 }, { rpm: 5500, torqueNm: 206, hp: 159 }, { rpm: 5750, torqueNm: 197, hp: 159 }, { rpm: 6000, torqueNm: 187, hp: 158 }, { rpm: 6250, torqueNm: 178, hp: 156 }, { rpm: 6500, torqueNm: 168, hp: 153 }],
    notes: "Declared (idealised, piecewise-linear) full-load curve from an Audi/VW Self Study Programme: vector chart, trace vertices read from the PDF path data, axes calibrated from the printed label positions. Axes 0-300 Nm / 0-120 kW, 1000-7000 rpm. Chart torque plateau reads 252 Nm (spec 250); power plateau 116.7 kW (spec 118). Cross-check vs chart kW: mean 1.5 %, max 4.6 % (points from 1500 rpm; the ramp below is dropped). Medium confidence because power plateau is ~1 % below the spec.",
    split: 'train',
  },
  {
    engineId: 'audi-27t-s4',
    source: {
      url: 'https://www.vaglinks.com/Docs/SSP/VWUSA.COM_SSP_198_2.7T_S4_Engine.pdf',
      title: 'Audi SSP 198 "2.7 l V6 biturbo engine (S4)", p.5 power/torque diagram (top chart, 195 kW / 400 Nm)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'medium',
    points: [{ rpm: 1750, torqueNm: 387, hp: 95 }, { rpm: 2000, torqueNm: 401, hp: 113 }, { rpm: 2250, torqueNm: 401, hp: 127 }, { rpm: 2500, torqueNm: 401, hp: 141 }, { rpm: 2750, torqueNm: 401, hp: 155 }, { rpm: 3000, torqueNm: 401, hp: 169 }, { rpm: 3250, torqueNm: 401, hp: 183 }, { rpm: 3500, torqueNm: 401, hp: 197 }, { rpm: 3750, torqueNm: 396, hp: 209 }, { rpm: 4000, torqueNm: 385, hp: 217 }, { rpm: 4250, torqueNm: 375, hp: 224 }, { rpm: 4500, torqueNm: 364, hp: 230 }, { rpm: 4750, torqueNm: 354, hp: 236 }, { rpm: 5000, torqueNm: 343, hp: 241 }, { rpm: 5250, torqueNm: 332, hp: 245 }, { rpm: 5500, torqueNm: 322, hp: 248 }, { rpm: 5750, torqueNm: 311, hp: 251 }, { rpm: 6000, torqueNm: 300, hp: 253 }, { rpm: 6250, torqueNm: 290, hp: 254 }],
    notes: "Declared (idealised, piecewise-linear) full-load curve from an Audi/VW Self Study Programme: vector chart, trace vertices read from the PDF path data, axes calibrated from the printed label positions. Axes 0-500 Nm / 0-200 kW, 1000-7000 rpm. Two charts are printed on the page (195 kW/400 Nm and 169 kW/310 Nm versions); the top (S4) one used. Chart peaks 401 Nm / 194.5 kW. Cross-check vs chart kW: mean 1.6 %, max 4.1 % (power trace sits up to 4 % below torque-derived power at 5000-6000 rpm, so one of the two is schematic). Points from 1750 rpm.",
    split: 'holdout',
  },
  {
    engineId: 'audi-52-v10-bxa',
    source: {
      url: 'https://www.vaglinks.com/Docs/SSP/VWUSA.COM_SSP_923603_5.2lL_V10_FSI_Engine.pdf',
      title: 'Audi SSP 923603 "5.2l V10 FSI Engine", p.2 Torque and Horsepower (S6, BXA, left chart)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'high',
    points: [{ rpm: 1500, torqueNm: 430, hp: 91 }, { rpm: 1750, torqueNm: 445, hp: 109 }, { rpm: 2000, torqueNm: 460, hp: 129 }, { rpm: 2250, torqueNm: 479, hp: 151 }, { rpm: 2500, torqueNm: 499, hp: 175 }, { rpm: 2750, torqueNm: 519, hp: 200 }, { rpm: 3000, torqueNm: 538, hp: 227 }, { rpm: 3250, torqueNm: 539, hp: 246 }, { rpm: 3500, torqueNm: 539, hp: 265 }, { rpm: 3750, torqueNm: 539, hp: 284 }, { rpm: 4000, torqueNm: 539, hp: 303 }, { rpm: 4250, torqueNm: 534, hp: 319 }, { rpm: 4500, torqueNm: 529, hp: 334 }, { rpm: 4750, torqueNm: 524, hp: 349 }, { rpm: 5000, torqueNm: 519, hp: 364 }, { rpm: 5250, torqueNm: 510, hp: 376 }, { rpm: 5500, torqueNm: 500, hp: 387 }, { rpm: 5750, torqueNm: 491, hp: 397 }, { rpm: 6000, torqueNm: 482, hp: 406 }, { rpm: 6250, torqueNm: 470, hp: 412 }, { rpm: 6500, torqueNm: 457, hp: 417 }, { rpm: 6750, torqueNm: 444, hp: 421 }, { rpm: 7000, torqueNm: 432, hp: 425 }],
    notes: "Declared (idealised, piecewise-linear) full-load curve from an Audi/VW Self Study Programme: vector chart, trace vertices read from the PDF path data, axes calibrated from the printed label positions. Axes 0-720 Nm / 0-360 kW, 0-8000 rpm (labels dual-unit). Chart peaks 539 Nm / 321 kW vs table 540 Nm @ 3000-4000 / 320 kW. Cross-check torque-derived vs chart kW: mean 1.5 %, max 3.4 %. Points 1500-7000 rpm (trace runs to ~7190).",
    split: 'train',
  },
  // ───────────────────────────── added in research round 3: chevrolet.com crate-engine dyno charts (raster) ─────────────────────────────
  {
    engineId: 'gm-lt1-crate',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/new/performance-parts/crate-engines/lt-engines/lt1-engine/02-gifs/Dyno-Chart-LT1.gif',
      title: 'Chevrolet Performance (chevrolet.com) LT1 6.2 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 1500, torqueNm: 486, hp: 102 }, { rpm: 1750, torqueNm: 503, hp: 124 }, { rpm: 2000, torqueNm: 520, hp: 146 }, { rpm: 2250, torqueNm: 534, hp: 169 }, { rpm: 2500, torqueNm: 547, hp: 192 }, { rpm: 2750, torqueNm: 562, hp: 217 }, { rpm: 3000, torqueNm: 576, hp: 243 }, { rpm: 3250, torqueNm: 579, hp: 264 }, { rpm: 3500, torqueNm: 582, hp: 286 }, { rpm: 3750, torqueNm: 598, hp: 315 }, { rpm: 4000, torqueNm: 613, hp: 344 }, { rpm: 4250, torqueNm: 618, hp: 369 }, { rpm: 4500, torqueNm: 623, hp: 394 }, { rpm: 4750, torqueNm: 626, hp: 418 }, { rpm: 5000, torqueNm: 611, hp: 429 }, { rpm: 5250, torqueNm: 593, hp: 437 }, { rpm: 5500, torqueNm: 576, hp: 445 }, { rpm: 5750, torqueNm: 556, hp: 449 }, { rpm: 6000, torqueNm: 540, hp: 455 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 0.8 %, max 1.8 %. Traced peaks 462 lb-ft @ 4750 rpm / 455 hp vs callouts 462 lb-ft @ 4600 / 459 hp @ 6000. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 1500-6000 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-lt4-crate',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/new/performance-parts/crate-engines/lt-engines/lt4-engine/dyno-chart/2026-dyno-chart-lt4.gif',
      title: 'Chevrolet Performance (chevrolet.com) LT4 6.2 supercharged crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 1250, torqueNm: 618, hp: 108 }, { rpm: 1500, torqueNm: 660, hp: 139 }, { rpm: 1750, torqueNm: 701, hp: 172 }, { rpm: 2000, torqueNm: 740, hp: 208 }, { rpm: 2250, torqueNm: 772, hp: 244 }, { rpm: 2500, torqueNm: 804, hp: 282 }, { rpm: 2750, torqueNm: 836, hp: 323 }, { rpm: 3000, torqueNm: 847, hp: 357 }, { rpm: 3250, torqueNm: 857, hp: 391 }, { rpm: 3500, torqueNm: 883, hp: 434 }, { rpm: 3750, torqueNm: 882, hp: 464 }, { rpm: 4000, torqueNm: 875, hp: 492 }, { rpm: 4250, torqueNm: 860, hp: 513 }, { rpm: 4500, torqueNm: 850, hp: 537 }, { rpm: 4750, torqueNm: 846, hp: 564 }, { rpm: 5000, torqueNm: 831, hp: 583 }, { rpm: 5250, torqueNm: 810, hp: 597 }, { rpm: 5500, torqueNm: 792, hp: 612 }, { rpm: 5750, torqueNm: 772, hp: 623 }, { rpm: 6000, torqueNm: 751, hp: 633 }, { rpm: 6250, torqueNm: 736, hp: 646 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 0.8 %, max 2.3 %. Traced peaks 652 lb-ft @ 3500 rpm / 646 hp vs callouts 650 lb-ft @ 3600 / 650 hp @ 6400. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 1250-6250 rpm.",
    split: 'holdout',
  },
  {
    engineId: 'gm-l8p-crate',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/lt/l8p/dyno/Dyno-Chart-L8P.gif',
      title: 'Chevrolet Performance (chevrolet.com) L8P 6.6 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 2000, torqueNm: 578, hp: 162 }, { rpm: 2250, torqueNm: 582, hp: 184 }, { rpm: 2500, torqueNm: 598, hp: 210 }, { rpm: 2750, torqueNm: 620, hp: 239 }, { rpm: 3000, torqueNm: 654, hp: 276 }, { rpm: 3250, torqueNm: 677, hp: 309 }, { rpm: 3500, torqueNm: 694, hp: 341 }, { rpm: 3750, torqueNm: 716, hp: 377 }, { rpm: 4000, torqueNm: 726, hp: 408 }, { rpm: 4250, torqueNm: 725, hp: 433 }, { rpm: 4500, torqueNm: 729, hp: 461 }, { rpm: 4750, torqueNm: 730, hp: 487 }, { rpm: 5000, torqueNm: 713, hp: 501 }, { rpm: 5250, torqueNm: 696, hp: 513 }, { rpm: 5500, torqueNm: 673, hp: 520 }, { rpm: 5750, torqueNm: 651, hp: 525 }, { rpm: 6000, torqueNm: 613, hp: 516 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 1.3 %, max 3.4 %. Traced peaks 539 lb-ft @ 4750 rpm / 525 hp vs callouts 543 lb-ft @ 4600 / 523 hp @ 5800. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 2000-6000 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-l8t-66',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/lt/l8p/dyno/new/2026-dyno-chart-l8t-v02.gif',
      title: 'Chevrolet Performance (chevrolet.com) L8T 6.6 (HD truck gas V8) crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 1750, torqueNm: 523, hp: 129 }, { rpm: 2000, torqueNm: 547, hp: 154 }, { rpm: 2250, torqueNm: 565, hp: 179 }, { rpm: 2500, torqueNm: 580, hp: 203 }, { rpm: 2750, torqueNm: 589, hp: 228 }, { rpm: 3000, torqueNm: 598, hp: 252 }, { rpm: 3250, torqueNm: 605, hp: 276 }, { rpm: 3500, torqueNm: 611, hp: 300 }, { rpm: 3750, torqueNm: 619, hp: 326 }, { rpm: 4000, torqueNm: 625, hp: 351 }, { rpm: 4250, torqueNm: 612, hp: 365 }, { rpm: 4500, torqueNm: 595, hp: 376 }, { rpm: 4750, torqueNm: 579, hp: 386 }, { rpm: 5000, torqueNm: 555, hp: 390 }, { rpm: 5250, torqueNm: 538, hp: 397 }, { rpm: 5500, torqueNm: 516, hp: 399 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 1.0 %, max 3.9 %. Traced peaks 461 lb-ft @ 4000 rpm / 399 hp vs callouts 464 lb-ft @ 4000 / 401 hp @ 5200. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 1750-5500 rpm.",
    split: 'holdout',
  },
  {
    engineId: 'gm-ht383',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/new/engines1/crate-engine/383/02-images/2026-dyno-chart-ht-383-v2.gif',
      title: 'Chevrolet Performance (chevrolet.com) HT383 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 2500, torqueNm: 564, hp: 198 }, { rpm: 2750, torqueNm: 584, hp: 225 }, { rpm: 3000, torqueNm: 580, hp: 244 }, { rpm: 3250, torqueNm: 604, hp: 276 }, { rpm: 3500, torqueNm: 598, hp: 294 }, { rpm: 3750, torqueNm: 581, hp: 306 }, { rpm: 4000, torqueNm: 553, hp: 311 }, { rpm: 4250, torqueNm: 538, hp: 321 }, { rpm: 4500, torqueNm: 511, hp: 323 }, { rpm: 4750, torqueNm: 481, hp: 321 }, { rpm: 5000, torqueNm: 422, hp: 297 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 1.0 %, max 2.5 % (1 stray hp reading excluded). Traced peaks 446 lb-ft @ 3250 rpm / 323 hp vs callouts 444 lb-ft @ 3000 / 323 hp @ 4200. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 2500-5000 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-sp383-435',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/new/engines1/crate-engine/383/02-images/Dyno-Chart-SP383.gif',
      title: 'Chevrolet Performance (chevrolet.com) SP383/435 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 2750, torqueNm: 512, hp: 198 }, { rpm: 3000, torqueNm: 531, hp: 224 }, { rpm: 3250, torqueNm: 540, hp: 246 }, { rpm: 3500, torqueNm: 543, hp: 267 }, { rpm: 3750, torqueNm: 554, hp: 292 }, { rpm: 4000, torqueNm: 570, hp: 320 }, { rpm: 4250, torqueNm: 587, hp: 350 }, { rpm: 4500, torqueNm: 599, hp: 379 }, { rpm: 4750, torqueNm: 598, hp: 399 }, { rpm: 5000, torqueNm: 586, hp: 411 }, { rpm: 5250, torqueNm: 570, hp: 420 }, { rpm: 5500, torqueNm: 552, hp: 427 }, { rpm: 5750, torqueNm: 525, hp: 424 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 1.1 %, max 3.8 %. Traced peaks 442 lb-ft @ 4500 rpm / 427 hp vs callouts 445 lb-ft @ 4600 / 435 hp @ 5600. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 2750-5750 rpm.",
    split: 'holdout',
  },
  {
    engineId: 'gm-sp350-357',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/crate-engines/350/dynos/Dyno-Chart-SP350-357.gif',
      title: 'Chevrolet Performance (chevrolet.com) SP350/357 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 3000, torqueNm: 524, hp: 221 }, { rpm: 3250, torqueNm: 532, hp: 243 }, { rpm: 3500, torqueNm: 536, hp: 264 }, { rpm: 3750, torqueNm: 541, hp: 285 }, { rpm: 4000, torqueNm: 546, hp: 307 }, { rpm: 4250, torqueNm: 543, hp: 324 }, { rpm: 4500, torqueNm: 538, hp: 340 }, { rpm: 4750, torqueNm: 524, hp: 349 }, { rpm: 5000, torqueNm: 507, hp: 356 }, { rpm: 5250, torqueNm: 477, hp: 352 }, { rpm: 5500, torqueNm: 459, hp: 354 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 0.8 %, max 2.2 %. Traced peaks 403 lb-ft @ 4000 rpm / 356 hp vs callouts 407 lb-ft @ 4000 / 357 hp @ 5500. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 3000-5500 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-sp350-385',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/crate-engines/350/dynos/Dyno-Chart-SP350-385.gif',
      title: 'Chevrolet Performance (chevrolet.com) SP350/385 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 3000, torqueNm: 543, hp: 229 }, { rpm: 3250, torqueNm: 543, hp: 248 }, { rpm: 3500, torqueNm: 544, hp: 267 }, { rpm: 3750, torqueNm: 543, hp: 286 }, { rpm: 4000, torqueNm: 543, hp: 305 }, { rpm: 4250, torqueNm: 543, hp: 324 }, { rpm: 4500, torqueNm: 542, hp: 342 }, { rpm: 4750, torqueNm: 539, hp: 359 }, { rpm: 5000, torqueNm: 534, hp: 375 }, { rpm: 5250, torqueNm: 518, hp: 382 }, { rpm: 5500, torqueNm: 499, hp: 386 }, { rpm: 5750, torqueNm: 475, hp: 383 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 1.1 %, max 2.0 %. Traced peaks 401 lb-ft @ 3500 rpm / 386 hp vs callouts 405 lb-ft @ 3600 / 385 hp @ 5600. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 3000-5750 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-350-ho',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/crate-engines/350/Dyno-Chart-350_HO.gif',
      title: 'Chevrolet Performance (chevrolet.com) 350 HO crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 3000, torqueNm: 495, hp: 208 }, { rpm: 3250, torqueNm: 501, hp: 229 }, { rpm: 3500, torqueNm: 510, hp: 251 }, { rpm: 3750, torqueNm: 517, hp: 272 }, { rpm: 4000, torqueNm: 512, hp: 287 }, { rpm: 4250, torqueNm: 509, hp: 303 }, { rpm: 4500, torqueNm: 499, hp: 315 }, { rpm: 4750, torqueNm: 484, hp: 323 }, { rpm: 5000, torqueNm: 471, hp: 331 }, { rpm: 5250, torqueNm: 424, hp: 312 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 1.6 %, max 3.9 %. Traced peaks 381 lb-ft @ 3750 rpm / 331 hp vs callouts 381 lb-ft @ 3700 / 333 hp @ 5100. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 3000-5250 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-zz454',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/big-block/454-engines/01-images/Dyno-Chart-ZZ454.gif',
      title: 'Chevrolet Performance (chevrolet.com) ZZ454 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 2750, torqueNm: 599, hp: 231 }, { rpm: 3000, torqueNm: 665, hp: 280 }, { rpm: 3250, torqueNm: 686, hp: 313 }, { rpm: 3500, torqueNm: 689, hp: 339 }, { rpm: 3750, torqueNm: 688, hp: 362 }, { rpm: 4000, torqueNm: 688, hp: 387 }, { rpm: 4250, torqueNm: 684, hp: 408 }, { rpm: 4500, torqueNm: 673, hp: 426 }, { rpm: 4750, torqueNm: 662, hp: 442 }, { rpm: 5000, torqueNm: 650, hp: 457 }, { rpm: 5250, torqueNm: 634, hp: 467 }, { rpm: 5500, torqueNm: 607, hp: 469 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 1.1 %, max 3.8 %. Traced peaks 508 lb-ft @ 3500 rpm / 469 hp vs callouts 519 lb-ft @ 3700 / 469 hp @ 5500. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 2750-5500 rpm.",
    split: 'holdout',
  },
  {
    engineId: 'gm-454-ho',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/big-block/454-engines/01-images/vthree/2026_Dyno-Chart_454HO-v2.gif',
      title: 'Chevrolet Performance (chevrolet.com) 454 HO crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 2750, torqueNm: 624, hp: 241 }, { rpm: 3000, torqueNm: 653, hp: 275 }, { rpm: 3250, torqueNm: 671, hp: 306 }, { rpm: 3500, torqueNm: 675, hp: 332 }, { rpm: 3750, torqueNm: 673, hp: 354 }, { rpm: 4000, torqueNm: 668, hp: 375 }, { rpm: 4250, torqueNm: 651, hp: 388 }, { rpm: 4500, torqueNm: 644, hp: 407 }, { rpm: 4750, torqueNm: 624, hp: 416 }, { rpm: 5000, torqueNm: 604, hp: 424 }, { rpm: 5250, torqueNm: 579, hp: 427 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 0.9 %, max 1.8 %. Traced peaks 498 lb-ft @ 3500 rpm / 427 hp vs callouts 500 lb-ft @ 3500 / 438 hp @ 5300. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 2750-5250 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-zz502',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/big-block/502-engine/dynos/Dyno-Chart-ZZ502.gif',
      title: 'Chevrolet Performance (chevrolet.com) ZZ502 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 3000, torqueNm: 767, hp: 323 }, { rpm: 3250, torqueNm: 781, hp: 357 }, { rpm: 3500, torqueNm: 789, hp: 388 }, { rpm: 3750, torqueNm: 790, hp: 416 }, { rpm: 4000, torqueNm: 778, hp: 437 }, { rpm: 4250, torqueNm: 766, hp: 457 }, { rpm: 4500, torqueNm: 748, hp: 472 }, { rpm: 4750, torqueNm: 725, hp: 484 }, { rpm: 5000, torqueNm: 715, hp: 502 }, { rpm: 5250, torqueNm: 691, hp: 510 }, { rpm: 5500, torqueNm: 650, hp: 502 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 0.7 %, max 2.0 %. Traced peaks 583 lb-ft @ 3750 rpm / 510 hp vs callouts 580 lb-ft @ 3600 / 508 hp @ 5200. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 3000-5500 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-ht502',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/big-block/502-engine/dynos/newv/2026_Dyno-Chart_HT502-v2.gif',
      title: 'Chevrolet Performance (chevrolet.com) HT502 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 2000, torqueNm: 646, hp: 182 }, { rpm: 2250, torqueNm: 653, hp: 206 }, { rpm: 2500, torqueNm: 676, hp: 237 }, { rpm: 2750, torqueNm: 694, hp: 268 }, { rpm: 3000, torqueNm: 712, hp: 300 }, { rpm: 3250, torqueNm: 724, hp: 330 }, { rpm: 3500, torqueNm: 710, hp: 349 }, { rpm: 3750, torqueNm: 706, hp: 372 }, { rpm: 4000, torqueNm: 700, hp: 393 }, { rpm: 4250, torqueNm: 681, hp: 406 }, { rpm: 4500, torqueNm: 643, hp: 406 }, { rpm: 4750, torqueNm: 594, hp: 396 }, { rpm: 5000, torqueNm: 541, hp: 380 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 1.4 %, max 3.2 % (1 stray hp reading excluded). Traced peaks 534 lb-ft @ 3250 rpm / 406 hp vs callouts 541 lb-ft @ 3200 / 406 hp @ 4200. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 2000-5000 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-sp502-605',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/big-block/502-engine/dynos/Dyno-Chart-SP502.gif',
      title: 'Chevrolet Performance (chevrolet.com) SP502/605 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 3250, torqueNm: 714, hp: 326 }, { rpm: 3500, torqueNm: 746, hp: 367 }, { rpm: 3750, torqueNm: 774, hp: 408 }, { rpm: 4000, torqueNm: 790, hp: 444 }, { rpm: 4250, torqueNm: 787, hp: 470 }, { rpm: 4500, torqueNm: 785, hp: 496 }, { rpm: 4750, torqueNm: 782, hp: 522 }, { rpm: 5000, torqueNm: 781, hp: 548 }, { rpm: 5250, torqueNm: 764, hp: 563 }, { rpm: 5500, torqueNm: 753, hp: 581 }, { rpm: 5750, torqueNm: 743, hp: 600 }, { rpm: 6000, torqueNm: 717, hp: 604 }, { rpm: 6250, torqueNm: 694, hp: 609 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 0.6 %, max 1.5 %. Traced peaks 583 lb-ft @ 4000 rpm / 609 hp vs callouts 580 lb-ft @ 4000 / 605 hp @ 6000. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 3250-6250 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-zz572-720',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/big-block/572-engines/01-images/v2/2026-dyno-chart-zz572-720-v2.gif',
      title: 'Chevrolet Performance (chevrolet.com) ZZ572/720 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 3500, torqueNm: 782, hp: 384 }, { rpm: 3750, torqueNm: 800, hp: 421 }, { rpm: 4000, torqueNm: 819, hp: 460 }, { rpm: 4250, torqueNm: 850, hp: 507 }, { rpm: 4500, torqueNm: 882, hp: 557 }, { rpm: 4750, torqueNm: 899, hp: 599 }, { rpm: 5000, torqueNm: 916, hp: 643 }, { rpm: 5250, torqueNm: 906, hp: 668 }, { rpm: 5500, torqueNm: 888, hp: 686 }, { rpm: 5750, torqueNm: 865, hp: 698 }, { rpm: 6000, torqueNm: 843, hp: 710 }, { rpm: 6250, torqueNm: 818, hp: 718 }, { rpm: 6500, torqueNm: 790, hp: 721 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 1.5 %, max 6.0 %. Traced peaks 676 lb-ft @ 5000 rpm / 721 hp vs callouts 680 lb-ft @ 4900 / 727 hp @ 6300. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 3500-6500 rpm.",
    split: 'train',
  },
  {
    engineId: 'gm-zz632-1000',
    source: {
      url: 'https://www.chevrolet.com/content/dam/chevrolet/na/us/english/index/performance/powertrain/engines/new/big-block/632-engine/01-images/new/v-3/2026_Dyno-Chart_ZZ632-1000_v2.gif',
      title: 'Chevrolet Performance (chevrolet.com) ZZ632/1000 crate engine page, DYNO CHART',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'unknown', confidence: 'medium',
    points: [{ rpm: 3250, torqueNm: 858, hp: 392 }, { rpm: 3500, torqueNm: 931, hp: 458 }, { rpm: 3750, torqueNm: 981, hp: 516 }, { rpm: 4000, torqueNm: 1051, hp: 591 }, { rpm: 4250, torqueNm: 1096, hp: 654 }, { rpm: 4500, torqueNm: 1117, hp: 706 }, { rpm: 4750, torqueNm: 1124, hp: 750 }, { rpm: 5000, torqueNm: 1147, hp: 805 }, { rpm: 5250, torqueNm: 1155, hp: 851 }, { rpm: 5500, torqueNm: 1163, hp: 898 }, { rpm: 5750, torqueNm: 1162, hp: 938 }, { rpm: 6000, torqueNm: 1146, hp: 966 }, { rpm: 6250, torqueNm: 1121, hp: 984 }, { rpm: 6500, torqueNm: 1095, hp: 999 }, { rpm: 6750, torqueNm: 1054, hp: 999 }, { rpm: 7000, torqueNm: 1016, hp: 999 }],
    notes: "Raster (animated GIF) chart traced by colour at 3440x1566 (or 1720x783): final frame, white (torque) and yellow (hp) marker/line centroids per pixel column, axes calibrated from detected gridlines (labels read visually; x axis starts at the axis line = first label, y bottom = lowest label), sampled every 250 rpm by linear interpolation. Axis units lb-ft / hp (shared axis), torque converted x1.35582 to Nm. Chart hp trace vs chart torque trace (hp = lb-ft*rpm/5252): mean 0.9 %, max 2.5 %. Traced peaks 858 lb-ft @ 5500 rpm / 999 hp vs callouts 876 lb-ft @ 5600 / 1004 hp @ 6600. The chart is an idealised few-marker representation of a crate-engine dyno run (Chevrolet Performance: SAE J1349 net / J1995 gross, test headers, no accessories); declared/idealised, not a raw trace. Points 3250-7000 rpm.",
    split: 'holdout',
  },
  // ───────────── research round 3: BMW ST047 raster chart ─────────────
  {
    engineId: 'bmw-n73-760i',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST047%202003%20System%20Diagnosis%2F1%20N73%20Engine.pdf',
      title: 'BMW Technical Training ST047 "1 N73 Engine" p.5 Power and Torque Output - N73B60 / M73B54 (N73B60 solid curves)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'medium',
    points: [{ rpm: 1250, torqueNm: 481, hp: 85 }, { rpm: 1500, torqueNm: 495, hp: 104 }, { rpm: 1750, torqueNm: 503, hp: 124 }, { rpm: 2000, torqueNm: 513, hp: 144 }, { rpm: 2250, torqueNm: 521, hp: 165 }, { rpm: 2500, torqueNm: 529, hp: 186 }, { rpm: 2750, torqueNm: 538, hp: 208 }, { rpm: 3000, torqueNm: 548, hp: 231 }, { rpm: 3250, torqueNm: 559, hp: 255 }, { rpm: 3500, torqueNm: 571, hp: 281 }, { rpm: 3750, torqueNm: 586, hp: 308 }, { rpm: 4000, torqueNm: 597, hp: 335 }, { rpm: 4250, torqueNm: 594, hp: 354 }, { rpm: 4500, torqueNm: 586, hp: 370 }, { rpm: 4750, torqueNm: 579, hp: 386 }, { rpm: 5000, torqueNm: 571, hp: 401 }, { rpm: 5250, torqueNm: 561, hp: 413 }, { rpm: 5500, torqueNm: 547, hp: 423 }, { rpm: 5750, torqueNm: 533, hp: 430 }, { rpm: 6000, torqueNm: 514, hp: 433 }, { rpm: 6250, torqueNm: 485, hp: 426 }],
    notes: 'Raster chart (embedded 471x606 px image, rendered at 150 dpi) traced by colour: red = torque, blue = kW, solid = N73B60, dashed = M73B54 (dashed trace bridged by continuity across the gaps). Axes: 0-7000 rpm, 320-960 Nm and 0-320 kW read from gridlines/labels. Cross-check torque-derived kW vs chart kW (Nm*rpm/9549): mean 0.9 %, max 2.7 %. Declared (idealised) ECE full-load curve; points 1250-6250 rpm. Chart peak 597 Nm / 320 kW.',
    split: 'train',
  },
  {
    engineId: 'bmw-m73-750il',
    source: {
      url: 'https://archive.org/download/BMWTechnicalTrainingDocuments/ST047%202003%20System%20Diagnosis%2F1%20N73%20Engine.pdf',
      title: 'BMW Technical Training ST047 "1 N73 Engine" p.5 Power and Torque Output - N73B60 / M73B54 (M73B54 dashed curves)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'medium',
    points: [{ rpm: 1750, torqueNm: 425, hp: 104 }, { rpm: 2000, torqueNm: 432, hp: 121 }, { rpm: 2250, torqueNm: 445, hp: 141 }, { rpm: 2500, torqueNm: 452, hp: 159 }, { rpm: 2750, torqueNm: 460, hp: 177 }, { rpm: 3000, torqueNm: 463, hp: 195 }, { rpm: 3250, torqueNm: 467, hp: 213 }, { rpm: 3500, torqueNm: 475, hp: 233 }, { rpm: 3750, torqueNm: 479, hp: 252 }, { rpm: 4000, torqueNm: 488, hp: 274 }, { rpm: 4250, torqueNm: 485, hp: 289 }, { rpm: 4500, torqueNm: 476, hp: 301 }, { rpm: 4750, torqueNm: 467, hp: 311 }, { rpm: 5000, torqueNm: 458, hp: 321 }, { rpm: 5250, torqueNm: 443, hp: 327 }, { rpm: 5500, torqueNm: 412, hp: 318 }, { rpm: 5750, torqueNm: 383, hp: 309 }, { rpm: 6000, torqueNm: 344, hp: 290 }],
    notes: 'Raster chart (embedded 471x606 px image, rendered at 150 dpi) traced by colour: red = torque, blue = kW, solid = N73B60, dashed = M73B54 (dashed trace bridged by continuity across the gaps). Axes: 0-7000 rpm, 320-960 Nm and 0-320 kW read from gridlines/labels. Cross-check torque-derived kW vs chart kW (Nm*rpm/9549): mean 1.7 %, max 3.2 %. Declared (idealised) ECE full-load curve; points 1750-6000 rpm. Chart peak 488 Nm / 236 kW.',
    split: 'train',
  },
  {
    engineId: 'audi-42-fsi-bar',
    source: {
      url: 'https://www.vaglinks.com/Docs/SSP/VWUSA.COM_SSP_822703_4.2L_V8_FSI_Engine.pdf',
      title: 'Audi SSP 822703 (S388) "4.2L V8 FSI Engine" p.3 Technical Data, torque/power chart (BAR)',
    },
    sourceType: 'oem-chart', crankBasis: true, standard: 'ECE', confidence: 'low',
    points: [{ rpm: 3250, torqueNm: 437, hp: 199 }, { rpm: 3500, torqueNm: 438, hp: 215 }, { rpm: 3750, torqueNm: 435, hp: 229 }, { rpm: 4000, torqueNm: 431, hp: 242 }, { rpm: 4250, torqueNm: 425, hp: 253 }, { rpm: 4500, torqueNm: 419, hp: 265 }, { rpm: 4750, torqueNm: 413, hp: 275 }, { rpm: 5000, torqueNm: 409, hp: 287 }, { rpm: 5250, torqueNm: 403, hp: 297 }, { rpm: 5500, torqueNm: 399, hp: 308 }, { rpm: 5750, torqueNm: 395, hp: 319 }, { rpm: 6000, torqueNm: 390, hp: 328 }, { rpm: 6250, torqueNm: 383, hp: 336 }, { rpm: 6500, torqueNm: 375, hp: 342 }, { rpm: 6750, torqueNm: 363, hp: 344 }],
    notes: 'Raster chart (356x396 px embedded image, rendered at 300 dpi) traced by colour; torque (cyan, left axis 0-500 Nm) and power (red, right axis 0-300 kW) with gridlines every 1000 rpm / 50 Nm. Declared (idealised) curve. WARNING: the chart own power trace is inconsistent with its torque trace below ~3000 rpm (kW from Nm*rpm/9549 is 8-21 % lower than the plotted kW at 1000-2750 rpm), so only 3250-7000 rpm is kept (cross-check there: mean 1.2 %, max 3.1 %). Torque peak ~438 Nm @ 3500 and power ~257 kW @ 6750 agree with the table (440 Nm @ 3500, 257 kW @ 6800). The 1000-3000 rpm torque trace (320-431 Nm) is plausible but unverified, hence confidence low.',
    split: 'train',
  },
];

/** All engines (peak-calibration set + extended set) by id. */
export const DYNO_ENGINE_BY_ID: Record<string, ReferenceEngine> = Object.fromEntries(
  [...REFERENCE_ENGINES, ...EXTENDED_REFERENCE_ENGINES].map((e) => [e.id, e]),
);
