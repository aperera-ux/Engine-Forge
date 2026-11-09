# Known gaps

These tests describe behaviour the simulator does not reproduce yet, or checks whose premise is questionable. They are tracked, not hidden: each runs as an expected failure, so `npx vitest run` stays green while the gap stays visible here and in the registry `tests/knownGaps.ts`.
If a listed test starts passing, the suite fails with a message asking you to remove its entry, so this list cannot go stale. Details and evidence are in `tests/reports/physics_audit.md` (§14.4 and later).
Categories: model-deficiency (the model is wrong or too weak), test-premise (the test's expectation is questionable), reference-data (the reference engine config uses estimated inputs).

| Test | Category | Reason | Audit ref |
|---|---|---|---|
| continuity sweeps on turboI4 (VW EA888 Gen 3 2.0 TSI — Golf GTI Mk7 (Performance)) cam.intakeDurationDeg: no discontinuity / >5% peak-hp jump per 1% change; ≤ 1 reversal(s) | model-deficiency | EA888 ECU cam-phasing and knock-trim corners make peak hp non-smooth in cam duration. | §14.4 |
| continuity sweeps on turboI4 (VW EA888 Gen 3 2.0 TSI — Golf GTI Mk7 (Performance)) throttleMm: no discontinuity / >5% peak-hp jump per 1% change; ≤ 0 reversal(s); non-decreasing | model-deficiency | In the model a larger throttle gives less power on the EA888, so the non-decreasing check fails. | §14.4 |
| reference honda-f20c-ap1 peak hp within high tolerance -8/8% | model-deficiency | The VTEC high-lobe is not predicted, so F20C peak hp is about 12% low. | §14.4 |
| reference honda-f20c-ap1 peak-torque rpm within tolerance | model-deficiency | The VTEC high-lobe is not predicted, so torque peaks at 6000 rpm instead of 7500. | §14.4 |
| reference honda-f20c-ap1 mass within ±15% | model-deficiency | The mass model over-predicts F20C by about 17% although its mass is a known input. | §14.4 |
| reference toyota-2jz-gte-us peak-power rpm within tolerance (or within published hp plateau) | reference-data | Turbo inducer, A/R, boost and intercooler are estimated; published peak rpm depends on the ECU tune. | §14.4 |
| reference gm-ls7 peak hp within high tolerance -8/8% | model-deficiency | Marginal miss (-8.9% vs 8% limit); the crate-engine dyno rating basis is unknown. | §14.4 |
| reference bmw-b58-340i peak-power rpm within tolerance (or within published hp plateau) | reference-data | Turbo hardware and boost are estimated; published peak rpm depends on the ECU tune. | §14.4 |
| reference vw-ea888-gen3-gti turbo torque ≥ 95% of peak across published plateau 1500–4600 rpm | reference-data | Turbo hardware and boost are estimated, so the torque plateau width is not reproduced. | §14.4 |
| reference ford-10-ecoboost turbo torque ≥ 95% of peak across published plateau 1400–4500 rpm | reference-data | Turbo hardware is estimated (turbineAR is below the type-doc range), so the plateau is not reproduced. | §14.4 |
| reference ford-10-ecoboost mass within ±15% | reference-data | massKg is an estimated field in the reference config. | §14.4 |
| reference ford-35-ecoboost-gen2 peak-power rpm within tolerance (or within published hp plateau) | reference-data | Turbo hardware and boost are estimated; published peak rpm depends on the ECU tune. | §14.4 |
| reference toyota-1gr-fe peak hp within high tolerance -8/8% | model-deficiency | Marginal over-prediction just beyond the tolerance (about +8.6% / +8.0%). | §14.4 |
| reference toyota-1gr-fe peak torque within high tolerance -8/8% | model-deficiency | Marginal over-prediction just beyond the tolerance (about +8.6% / +8.0%). | §14.4 |
| reference subaru-ej257-sti BSFC at peak power in turbo envelope 290–360 g/kWh | reference-data | WOT lambda is estimated and BSFC follows it (380 g/kWh at peak power). | §14.4 |
| reference subaru-ej257-sti peak torque within high tolerance -8/8% | model-deficiency | Marginal over-prediction just beyond the tolerance (+8.2%). | §14.4 |
| reference subaru-ej257-sti peak-torque rpm within tolerance | reference-data | Cam timing and turbo hardware are estimated; torque peaks at 3000 rpm vs 4000 published. | §14.4 |
| reference porsche-9a1-40-gt3 peak-power rpm within tolerance (or within published hp plateau) | model-deficiency | No high-rpm power fall-off from friction and flow, so the sim peaks at redline (9000 vs 8250). | §14.4 |
| reference audi-52-v10-r8plus peak-torque rpm within tolerance | reference-data | Cams are estimated (also partly a model limit); sim peak torque at 5250 vs 6500 rpm. Classification uncertain. | §14.4 |
| reference ferrari-f140fc-f12 BSFC at peak power in perf4v envelope 270–300 g/kWh | reference-data | WOT lambda is estimated and BSFC follows it (265 g/kWh). | §14.4 |
| reference ferrari-f140fc-f12 mass within ±15% | model-deficiency | The mass model over-predicts the F12 by about 17%. | §14.4 |
| reference mazda-skyactiv-g25 specific output in eco4v envelope 60–80 hp/L | model-deficiency | Sim overshoots (+13.8% hp, 84 hp/L, 13.8 bar) while published figures are inside the envelope; cams, valves, runner, headers and lambda are also estimated, so partly reference-data. | §14.4 |
| reference mazda-skyactiv-g25 BMEP at peak torque in eco4v envelope 11.5–13 bar | model-deficiency | Sim overshoots (+13.8% hp, 84 hp/L, 13.8 bar) while published figures are inside the envelope; cams, valves, runner, headers and lambda are also estimated, so partly reference-data. | §14.4 |
| reference mazda-skyactiv-g25 peak hp within high tolerance -8/8% | model-deficiency | Sim overshoots (+13.8% hp, 84 hp/L, 13.8 bar) while published figures are inside the envelope; cams, valves, runner, headers and lambda are also estimated, so partly reference-data. | §14.4 |
| reference mazda-skyactiv-g25 peak torque within high tolerance -8/8% | model-deficiency | Sim overshoots (+13.8% hp, 84 hp/L, 13.8 bar) while published figures are inside the envelope; cams, valves, runner, headers and lambda are also estimated, so partly reference-data. | §14.4 |
| reference mazda-skyactiv-g25 peak-power rpm within tolerance (or within published hp plateau) | reference-data | Cams, valves, runner, headers and lambda are estimated (power rpm 6500 vs 5700, torque rpm 4000 vs 3250). | §14.4 |
| reference mazda-skyactiv-g25 peak-torque rpm within tolerance | reference-data | Cams, valves, runner, headers and lambda are estimated (power rpm 6500 vs 5700, torque rpm 4000 vs 3250). | §14.4 |
| aggregate calibration mean \|hp error\| over high+medium engines ≤ 5% | model-deficiency | Aggregate error is pulled up by known per-engine gaps (F20C VTEC, Mazda overshoot). | §14.4 |
| aggregate calibration no high/medium engine outside ±12% peak hp | model-deficiency | Aggregate error is pulled up by known per-engine gaps (F20C VTEC, Mazda overshoot). | §14.4 |
| hypothetical preset High-boost 2.0 I4 drag build (E85) generic plausibility: NA (race) BMEP ≤ 16 bar; boosted BMEP ≤ 30 (pump) / 40 (alcohol); hp/L ≤ 400 | test-premise | The 40 bar BMEP limit is a street/alcohol limit; real drag builds (2.5 bar boost, E85, 9000 rpm) report above it. | §14.4 |
| fuzz: 2000 random configs (seed 20261104) specific output ≤ 400 hp/L; a 0-hp result must come with a warn/critical warning explaining it | model-deficiency | Absurd random configs reach the EGT clamp or very high hp/L; no model guard. | §14.4 |
| fuzz: 2000 random configs (seed 20261104) NA: BMEP ≤ 16 bar on gasoline (doc: > 15.5 street / 16 race NA indicates a bug); ≤ 17.5 on alcohol | model-deficiency | Absurd random NA configs exceed the BMEP bound. | §14.4 |
| fuzz: 2000 random configs (seed 20261104) boosted: BMEP ≤ 30 bar on pump/race gas, ≤ 40 on alcohol | model-deficiency | Absurd random boosted configs exceed 30 bar BMEP. | §14.4 |
| fuzz: 2000 random configs (seed 20261104) no perpetual motion: BTE ≤ 0.42 gasoline (≤ 0.45 alcohol), BSFC ≥ 200 g/kWh gasoline-equivalent | model-deficiency | Absurd random configs give BTE/BSFC outside the thermodynamic bound. | §14.4 |
| fuzz: 2000 random configs (seed 20261104) EGT at WOT within 500–1100 °C at all points ≥ 1500 rpm (gasoline, λ 0.75–1.0) | model-deficiency | EGT hits the 1227 C clamp on absurd configs, outside the 500-1100 C band. | §14.4 |
| fuzz: 2000 random configs (seed 20261104) NA torque curves have no adjacent-point jumps > 10% of peak torque (above idle+500 rpm, below float) and ≤ 3 local maxima | model-deficiency | Absurd random NA configs show adjacent-point torque jumps above 10% of peak. | §14.4 |
| Rule 7: intake runner length naPushrodV8: longer runner → lower peak-torque rpm, bounded (200→400 mm moves peak 5–30%) | model-deficiency | Torque-peak rpm is flat-topped, so runner length moves the argmax too little or erratically. | §14.4 |
| Rule 8: cam duration naI4: duration sweep −20…+40° moves torque & power peaks up, low-rpm torque down | model-deficiency | Flat-topped torque argmax and low-rpm torque too insensitive to cam duration. | §14.4 |
| Rule 8: cam duration naPushrodV8: duration sweep −20…+40° moves torque & power peaks up, low-rpm torque down | model-deficiency | Flat-topped torque argmax and low-rpm torque too insensitive to cam duration. | §14.4 |
| Rule 8: cam duration turboI6: duration sweep −20…+40° moves torque & power peaks up, low-rpm torque down | model-deficiency | Flat-topped torque argmax and low-rpm torque too insensitive to cam duration. | §14.4 |
| Rule 10: valve size undersized valves: power peaks where Taylor Z ≈ 0.55–0.6 (accept 0.45–0.70) | model-deficiency | Valve-flow choking is too weak: Taylor Z at power peak is about 0.98 vs the 0.45-0.70 band. | §14.4 |
| Rule 13: ITB/short runner, throttle restriction K20: ITB + 150 mm runners beats plenum + 300 mm at the top end (peak hp) | model-deficiency | ITB top-end gain is not reproduced (-0.9% instead of positive). | §14.4 |
| directional physics bigger cam → peak power at higher rpm, more top end, less low end | model-deficiency | Flat-topped torque argmax and low-rpm torque too insensitive to cam duration. | §14.4 |
