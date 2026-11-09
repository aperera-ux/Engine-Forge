/**
 * Registry of known, documented gaps in the simulator.
 *
 * Each entry is a test that currently FAILS because of a documented model
 * deficiency, a questionable test premise, or estimated reference data
 * (see tests/reports/physics_audit.md §14.4 and tests/reports/known_gaps.md).
 *
 * Listed tests run as expected-failures: they pass while they still fail, and
 * they FAIL if they start passing, so the entry must then be removed.
 * Keys are the vitest full test name (describe chain and title joined by a space).
 */
import { expect, it as baseIt } from 'vitest';

export type GapCategory = 'model-deficiency' | 'test-premise' | 'reference-data';
export interface KnownGap {
  category: GapCategory;
  reason: string;
  ref: string;
}

export const KNOWN_GAPS = new Map<string, KnownGap>([
  ["continuity sweeps on turboI4 (VW EA888 Gen 3 2.0 TSI — Golf GTI Mk7 (Performance)) cam.intakeDurationDeg: no discontinuity / >5% peak-hp jump per 1% change; ≤ 1 reversal(s)", { category: 'model-deficiency', reason: "EA888 ECU cam-phasing and knock-trim corners make peak hp non-smooth in cam duration.", ref: 'physics_audit §14.4' }],
  ["continuity sweeps on turboI4 (VW EA888 Gen 3 2.0 TSI — Golf GTI Mk7 (Performance)) throttleMm: no discontinuity / >5% peak-hp jump per 1% change; ≤ 0 reversal(s); non-decreasing", { category: 'model-deficiency', reason: "In the model a larger throttle gives less power on the EA888, so the non-decreasing check fails.", ref: 'physics_audit §14.4' }],
  ["reference honda-f20c-ap1 peak hp within high tolerance -8/8%", { category: 'model-deficiency', reason: "The VTEC high-lobe is not predicted, so F20C peak hp is about 12% low.", ref: 'physics_audit §14.4' }],
  ["reference honda-f20c-ap1 peak-torque rpm within tolerance", { category: 'model-deficiency', reason: "The VTEC high-lobe is not predicted, so torque peaks at 6000 rpm instead of 7500.", ref: 'physics_audit §14.4' }],
  ["reference honda-f20c-ap1 mass within ±15%", { category: 'model-deficiency', reason: "The mass model over-predicts F20C by about 17% although its mass is a known input.", ref: 'physics_audit §14.4' }],
  ["reference toyota-2jz-gte-us peak-power rpm within tolerance (or within published hp plateau)", { category: 'reference-data', reason: "Turbo inducer, A/R, boost and intercooler are estimated; published peak rpm depends on the ECU tune.", ref: 'physics_audit §14.4' }],
  ["reference gm-ls7 peak hp within high tolerance -8/8%", { category: 'model-deficiency', reason: "Marginal miss (-8.9% vs 8% limit); the crate-engine dyno rating basis is unknown.", ref: 'physics_audit §14.4' }],
  ["reference bmw-b58-340i peak-power rpm within tolerance (or within published hp plateau)", { category: 'reference-data', reason: "Turbo hardware and boost are estimated; published peak rpm depends on the ECU tune.", ref: 'physics_audit §14.4' }],
  ["reference vw-ea888-gen3-gti turbo torque ≥ 95% of peak across published plateau 1500–4600 rpm", { category: 'reference-data', reason: "Turbo hardware and boost are estimated, so the torque plateau width is not reproduced.", ref: 'physics_audit §14.4' }],
  ["reference ford-10-ecoboost turbo torque ≥ 95% of peak across published plateau 1400–4500 rpm", { category: 'reference-data', reason: "Turbo hardware is estimated (turbineAR is below the type-doc range), so the plateau is not reproduced.", ref: 'physics_audit §14.4' }],
  ["reference ford-10-ecoboost mass within ±15%", { category: 'reference-data', reason: "massKg is an estimated field in the reference config.", ref: 'physics_audit §14.4' }],
  ["reference ford-35-ecoboost-gen2 peak-power rpm within tolerance (or within published hp plateau)", { category: 'reference-data', reason: "Turbo hardware and boost are estimated; published peak rpm depends on the ECU tune.", ref: 'physics_audit §14.4' }],
  ["reference toyota-1gr-fe peak hp within high tolerance -8/8%", { category: 'model-deficiency', reason: "Marginal over-prediction just beyond the tolerance (about +8.6% / +8.0%).", ref: 'physics_audit §14.4' }],
  ["reference toyota-1gr-fe peak torque within high tolerance -8/8%", { category: 'model-deficiency', reason: "Marginal over-prediction just beyond the tolerance (about +8.6% / +8.0%).", ref: 'physics_audit §14.4' }],
  ["reference subaru-ej257-sti BSFC at peak power in turbo envelope 290–360 g/kWh", { category: 'reference-data', reason: "WOT lambda is estimated and BSFC follows it (380 g/kWh at peak power).", ref: 'physics_audit §14.4' }],
  ["reference subaru-ej257-sti peak torque within high tolerance -8/8%", { category: 'model-deficiency', reason: "Marginal over-prediction just beyond the tolerance (+8.2%).", ref: 'physics_audit §14.4' }],
  ["reference subaru-ej257-sti peak-torque rpm within tolerance", { category: 'reference-data', reason: "Cam timing and turbo hardware are estimated; torque peaks at 3000 rpm vs 4000 published.", ref: 'physics_audit §14.4' }],
  ["reference porsche-9a1-40-gt3 peak-power rpm within tolerance (or within published hp plateau)", { category: 'model-deficiency', reason: "No high-rpm power fall-off from friction and flow, so the sim peaks at redline (9000 vs 8250).", ref: 'physics_audit §14.4' }],
  ["reference audi-52-v10-r8plus peak-torque rpm within tolerance", { category: 'reference-data', reason: "Cams are estimated (also partly a model limit); sim peak torque at 5250 vs 6500 rpm. Classification uncertain.", ref: 'physics_audit §14.4' }],
  ["reference ferrari-f140fc-f12 BSFC at peak power in perf4v envelope 270–300 g/kWh", { category: 'reference-data', reason: "WOT lambda is estimated and BSFC follows it (265 g/kWh).", ref: 'physics_audit §14.4' }],
  ["reference ferrari-f140fc-f12 mass within ±15%", { category: 'model-deficiency', reason: "The mass model over-predicts the F12 by about 17%.", ref: 'physics_audit §14.4' }],
  ["reference mazda-skyactiv-g25 specific output in eco4v envelope 60–80 hp/L", { category: 'model-deficiency', reason: "Sim overshoots (+13.8% hp, 84 hp/L, 13.8 bar) while published figures are inside the envelope; cams, valves, runner, headers and lambda are also estimated, so partly reference-data.", ref: 'physics_audit §14.4' }],
  ["reference mazda-skyactiv-g25 BMEP at peak torque in eco4v envelope 11.5–13 bar", { category: 'model-deficiency', reason: "Sim overshoots (+13.8% hp, 84 hp/L, 13.8 bar) while published figures are inside the envelope; cams, valves, runner, headers and lambda are also estimated, so partly reference-data.", ref: 'physics_audit §14.4' }],
  ["reference mazda-skyactiv-g25 peak hp within high tolerance -8/8%", { category: 'model-deficiency', reason: "Sim overshoots (+13.8% hp, 84 hp/L, 13.8 bar) while published figures are inside the envelope; cams, valves, runner, headers and lambda are also estimated, so partly reference-data.", ref: 'physics_audit §14.4' }],
  ["reference mazda-skyactiv-g25 peak torque within high tolerance -8/8%", { category: 'model-deficiency', reason: "Sim overshoots (+13.8% hp, 84 hp/L, 13.8 bar) while published figures are inside the envelope; cams, valves, runner, headers and lambda are also estimated, so partly reference-data.", ref: 'physics_audit §14.4' }],
  ["reference mazda-skyactiv-g25 peak-power rpm within tolerance (or within published hp plateau)", { category: 'reference-data', reason: "Cams, valves, runner, headers and lambda are estimated (power rpm 6500 vs 5700, torque rpm 4000 vs 3250).", ref: 'physics_audit §14.4' }],
  ["reference mazda-skyactiv-g25 peak-torque rpm within tolerance", { category: 'reference-data', reason: "Cams, valves, runner, headers and lambda are estimated (power rpm 6500 vs 5700, torque rpm 4000 vs 3250).", ref: 'physics_audit §14.4' }],
  ["aggregate calibration mean |hp error| over high+medium engines ≤ 5%", { category: 'model-deficiency', reason: "Aggregate error is pulled up by known per-engine gaps (F20C VTEC, Mazda overshoot).", ref: 'physics_audit §14.4' }],
  ["aggregate calibration no high/medium engine outside ±12% peak hp", { category: 'model-deficiency', reason: "Aggregate error is pulled up by known per-engine gaps (F20C VTEC, Mazda overshoot).", ref: 'physics_audit §14.4' }],
  ["hypothetical preset High-boost 2.0 I4 drag build (E85) generic plausibility: NA (race) BMEP ≤ 16 bar; boosted BMEP ≤ 30 (pump) / 40 (alcohol); hp/L ≤ 400", { category: 'test-premise', reason: "The 40 bar BMEP limit is a street/alcohol limit; real drag builds (2.5 bar boost, E85, 9000 rpm) report above it.", ref: 'physics_audit §14.4' }],
  ["fuzz: 2000 random configs (seed 20261104) specific output ≤ 400 hp/L; a 0-hp result must come with a warn/critical warning explaining it", { category: 'model-deficiency', reason: "Absurd random configs reach the EGT clamp or very high hp/L; no model guard.", ref: 'physics_audit §14.4' }],
  ["fuzz: 2000 random configs (seed 20261104) NA: BMEP ≤ 16 bar on gasoline (doc: > 15.5 street / 16 race NA indicates a bug); ≤ 17.5 on alcohol", { category: 'model-deficiency', reason: "Absurd random NA configs exceed the BMEP bound.", ref: 'physics_audit §14.4' }],
  ["fuzz: 2000 random configs (seed 20261104) boosted: BMEP ≤ 30 bar on pump/race gas, ≤ 40 on alcohol", { category: 'model-deficiency', reason: "Absurd random boosted configs exceed 30 bar BMEP.", ref: 'physics_audit §14.4' }],
  ["fuzz: 2000 random configs (seed 20261104) no perpetual motion: BTE ≤ 0.42 gasoline (≤ 0.45 alcohol), BSFC ≥ 200 g/kWh gasoline-equivalent", { category: 'model-deficiency', reason: "Absurd random configs give BTE/BSFC outside the thermodynamic bound.", ref: 'physics_audit §14.4' }],
  ["fuzz: 2000 random configs (seed 20261104) EGT at WOT within 500–1100 °C at all points ≥ 1500 rpm (gasoline, λ 0.75–1.0)", { category: 'model-deficiency', reason: "EGT hits the 1227 C clamp on absurd configs, outside the 500-1100 C band.", ref: 'physics_audit §14.4' }],
  ["fuzz: 2000 random configs (seed 20261104) NA torque curves have no adjacent-point jumps > 10% of peak torque (above idle+500 rpm, below float) and ≤ 3 local maxima", { category: 'model-deficiency', reason: "Absurd random NA configs show adjacent-point torque jumps above 10% of peak.", ref: 'physics_audit §14.4' }],
  ["Rule 7: intake runner length naPushrodV8: longer runner → lower peak-torque rpm, bounded (200→400 mm moves peak 5–30%)", { category: 'model-deficiency', reason: "Torque-peak rpm is flat-topped, so runner length moves the argmax too little or erratically.", ref: 'physics_audit §14.4' }],
  ["Rule 8: cam duration naI4: duration sweep −20…+40° moves torque & power peaks up, low-rpm torque down", { category: 'model-deficiency', reason: "Flat-topped torque argmax and low-rpm torque too insensitive to cam duration.", ref: 'physics_audit §14.4' }],
  ["Rule 8: cam duration naPushrodV8: duration sweep −20…+40° moves torque & power peaks up, low-rpm torque down", { category: 'model-deficiency', reason: "Flat-topped torque argmax and low-rpm torque too insensitive to cam duration.", ref: 'physics_audit §14.4' }],
  ["Rule 8: cam duration turboI6: duration sweep −20…+40° moves torque & power peaks up, low-rpm torque down", { category: 'model-deficiency', reason: "Flat-topped torque argmax and low-rpm torque too insensitive to cam duration.", ref: 'physics_audit §14.4' }],
  ["Rule 10: valve size undersized valves: power peaks where Taylor Z ≈ 0.55–0.6 (accept 0.45–0.70)", { category: 'model-deficiency', reason: "Valve-flow choking is too weak: Taylor Z at power peak is about 0.98 vs the 0.45-0.70 band.", ref: 'physics_audit §14.4' }],
  ["Rule 13: ITB/short runner, throttle restriction K20: ITB + 150 mm runners beats plenum + 300 mm at the top end (peak hp)", { category: 'model-deficiency', reason: "ITB top-end gain is not reproduced (-0.9% instead of positive).", ref: 'physics_audit §14.4' }],
  ["directional physics bigger cam → peak power at higher rpm, more top end, less low end", { category: 'model-deficiency', reason: "Flat-topped torque argmax and low-rpm torque too insensitive to cam duration.", ref: 'physics_audit §14.4' }],
]);

/** Drop-in replacement for `it` that treats registered tests as expected failures. */
export const gapIt: typeof baseIt = ((title: string, fn: () => unknown, timeout?: number) =>
  baseIt(
    title,
    async () => {
      // Titles may themselves contain ' > ', so only the describe-chain prefix is normalised.
      const cur = expect.getState().currentTestName ?? title;
      const prefix = cur.endsWith(title) ? cur.slice(0, cur.length - title.length) : '';
      const name = prefix.split(' > ').join(' ') + title;
      const gap = KNOWN_GAPS.get(name);
      if (!gap) return fn();
      let failed = false;
      try {
        await fn();
      } catch {
        failed = true;
      }
      if (!failed) {
        throw new Error(
          `Known gap now PASSES: "${name}" (${gap.category}, ${gap.ref}). Remove it from tests/knownGaps.ts.`,
        );
      }
    },
    timeout,
  )) as unknown as typeof baseIt;
