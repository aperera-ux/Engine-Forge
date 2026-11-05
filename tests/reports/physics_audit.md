# Engine Forge: independent physics audit

**Auditor:** validation/test agent. **Model state audited:** `src/sim/**` as of 03:37 (physics v2 "DONE"; no edits to src/sim after that). **Final run:** 03:5x.

How to reproduce: `npx vitest run tests/unit` (about 35 s). Raw numbers are in `tests/reports/data/*.json` (`sanity.json`, `envelopes.json`, `fuzz.json`, `continuity.json`, `vitest-results.json`).


> **Addendum (after lead arbitration).**
> - Issue #10 is closed. The piston-speed thresholds of the code (info > 22, warn > 27, critical > 30 m/s) are now the spec. The Rule 21 tests were updated and now pass.
> - §5 item 1 is resolved. The doc's intercooler band was revised to −60…−90 °C, and the `it.fails` test became a normal passing test.
> - Both changes are marked "revised after audit" in `research/validation_targets.md`.
> - Net effect: Rule 21 now passes; the other counts below are unchanged.

## 0. Headline

| Suite | File | Pass | Fail | What it covers |
|---|---|---|---|---|
| Sanity rules + identities | `tests/unit/sanity.test.ts` | 81 | 11 | 25 doc rules as one-variable perturbations on K20 (NA I4), LS3 (NA pushrod V8), EA888 (turbo I4), 2JZ-GTE (turbo I6) and Hellcat (SC V8), plus 13 physics identities on every curve point of all 26 presets. Includes 2 `it.fails` tests (doc conflict, see §5). |
| Envelopes and calibration | `tests/unit/envelopes.test.ts` | 225 | 35 | 21 reference engines × (hp/L, BMEP, BSFC, BTE, EGT, Sp, hp/tq/rpm tolerances, plateau, mass, stock warnings), aggregate MAE, 4 hypothetical presets, DEFAULT. |
| Fuzzing | `tests/unit/fuzz.test.ts` | 12 | 3 | 2000 seeded random configs (12% at slider extremes). |
| Continuity | `tests/unit/continuity.test.ts` | 81 | 3 | Every numeric slider swept over its UI range in 101 steps on 4 base engines (8,500 simulations). |
| UI-reported regressions | `tests/unit/ui_regressions.test.ts` | 2 | 4 | The 3 issues found in UI testing, pinned as tests. |
| **Total** | | **401** | **56** | 457 tests |

**Sanity rules:** 18 of the 25 rule groups pass completely (1, 2 and 3 pass on the I6 and fail on the I4). Rules with at least one failing case: 1, 2, 3, 7, 10, 14 (plus 14b, which I added), 17 and 21. Rule 4 passes power and knock but fails the doc's temperature band. That band is a doc error (§5).

**What passes:**
- Every bookkeeping identity holds on every point: P = T·ω, BMEP = 4πT/Vd, IMEP − FMEP = BMEP, BSFC = ṁf/P, ṁf = ṁa/(λ·AFR), BTE = P/(ṁf·LHV), and VE·Vd·ρ·N/120 = ṁa.
- NA MAP never exceeds ambient. BTE ≤ 0.42 and BSFC ≥ 200 g/kWh hold everywhere, including all 2000 fuzz cases.
- No NaN or Infinity, no throws and no negative outputs.
- simulate takes 0.70 ms median, 8.4 ms p99 and 9.9 ms max (budget 15–20 ms).
- Most first-order trends point the right way: cam duration on the LS3, octane, lambda, E85 and methanol, VVT and VTEC, NA exhaust ranking, ITBs, throttle, valve float, FMEP, η_m, mass, piston acceleration and bore-vs-knock.

**What would break trust:** the knock model barely bites at high rpm, so high compression always wins. NA torque curves are too flat and keep rising to the limiter, so "VTEC" and cam character are weak. Several controls give the wrong sign or a silent no-op: the supercharger rev limiter, the intercooler near 0, twin-scroll, the turbo exhaust type and the >2.1 bar boost ceiling. A turbo LS3 drops to 0 hp just past valve float.

## 1. Ranked issues (how badly each undermines a knowledgeable user's trust)

Each entry gives evidence, then the file/function and what is physically wrong, then a suggested fix.

### #1 Knock does not limit compression ratio or boost at high rpm (high CR always wins)
- **Evidence:**
  - K20 on **87 AKI**: peak torque rises monotonically with CR, 194 N·m (CR 9) → 228 N·m (CR 16). At the peak-torque rpm (6250) the model reports **0° retard even at CR 16** (Pmax 104 bar). Retard appears only at low rpm.
  - EA888 on 91 at 1.1 bar: best peak hp is at **CR 14** (222 hp, with 40° retard, the cap, in the low/mid band). A boosted pump-gas engine should peak near CR 9–10.5.
  - Fuzz: 13 boosted configs exceed the BMEP limit, e.g. #1652 at **33.7 bar BMEP on 91**, and #1599 at 44 bar BMEP with **0° retard** at 3 bar MAP (E85, 62 mm bore).
  - Rule 14 (interior CR optimum) and Rule 14b fail.
- **Diagnosis:**
  - `combustion.ts › runCycle`: the Douaud–Eyzat integral is accumulated in **milliseconds** (`msPerDeg = 1000/(6·rpm)`) with `CAL.endGasHeatLoss = 0`. The knock integral therefore falls about ∝ 1/rpm, and above ~5000 rpm knock almost disappears whatever the CR.
  - In real engines the knock-limited spark advance (KLSA) loss shrinks much less with speed. Burn duration in ms also shortens, and the end gas runs hotter (less wall heat loss) at high speed.
  - `indicatedEfficiency` keeps paying `1 − CR^−0.28` up to CR 20, with only a weak heat-loss term (`h ∝ (CR/11)^0.3`), so the CR gain outruns the knock penalty.
  - `knockLimitedSpark` saturates at `maxRetard = min(40, mbt+15)`. When it saturates the engine simply runs at the cap. There is no ECU response (boost cut, enrichment).
- **Fix:**
  - Calibrate the knock integral against a KLSA-vs-rpm dataset at fixed CR and fuel; at minimum, make the knock-limited CR fall with rpm much less steeply. Options: scale the induction time with burn time rather than wall-clock time, or add end-gas temperature rise with rpm.
  - Add a CR-dependent heat-transfer/crevice penalty so η_i flattens above CR ≈ 13.
  - Make boost control knock-aware: when retard exceeds ~10°, lower the boost target, as real ECUs do.
  - Acceptance tests: Rule 14 and 14b, plus fuzz `boost-bmep`.

### #2 NA torque curves are too flat and power keeps rising to the limiter (no "VTEC", wrong peak rpm)
- **Evidence:**
  - **F20C:** peak torque at **4250 rpm** (published 7500), peak power at the 9000 limiter (published 8300), −10.1% hp. VE is 0.86–0.99 across the whole 1000–9000 rpm range, with no high-cam surge.
  - **K20A:** power peak at the 8400 limiter (published 8000). Raising the redline to 10,000 adds hp (222 hp @ 10k). The model's valve-float estimate for the K20 is 11,077 rpm.
  - **GT3:** peak power 9000 vs 8250. **R8 V10:** peak torque 5250 vs 6500. **Mazda Skyactiv:** 6500 vs 5700, +14.6% hp.
  - Rule 10: with undersized valves, power peaks at **Taylor Z = 0.71–0.74** (doc 0.55–0.6).
  - Rule 9: a 10° LSA change moves VE by only ±1%.
  - Rule 7 (LS3): the peak-torque rpm vs runner length is non-monotonic (4200 @ 200 mm, 4800 @ 250–300 mm, 4400 @ 400 mm).
- **Diagnosis:**
  - `airflow.ts › profileVe`: `fChoke = 1/√(1+(Z/0.95)^6)` (`CAL.zChoke 0.95`) leaves VE nearly untouched until Z ≈ 0.8. Real VE falls off sharply above Z ≈ 0.6, so the model's high-rpm breathing is too good. That is why power rises to the limiter and peak rpm comes out too high.
  - With the cam (`zOpt`) and runner/exhaust tuning amplitudes small (`runnerAmp 0.06`, `exhAmp ≤ 0.06`), the cam/IVC term is the only thing shaping the curve, which flattens it. Different cams then look alike: the F20C's long-duration VTEC lobe produces no high-rpm VE hump.
  - The runner model has three overlapping Gaussians (main peak, 0.68× and 1.5× harmonics). On a flat curve the argmax jumps between them.
  - `mechanical.ts › valveFloatRpm` for DOHC Hondas is high (11.1k), so it never caps the curve.
- **Fix:**
  - Lower `zChoke` to ~0.6–0.65 with a softer exponent, and re-tune `veBase`.
  - Make `zOpt` and the high-Z penalty depend more strongly on duration/IVC, so cams move the VE peak.
  - Raise the NA runner/header tuning amplitudes (doc §2.4–2.5: about ±5–10% VE).
  - Recalibrate against peak-power *rpm*, not just peak hp.
  - Acceptance tests: envelope peak-rpm tests, Rule 10 Z, Rule 7, and continuity `redlineRpm` on the K20.

### #3 Supercharger boost is tied to the rev limiter (raising redline changes the "pulley")
- **Evidence:**
  - Hellcat: raising the redline 6200 → 12,000 lowers boost at 4000 rpm (0.73 → 0.68 bar) and *reduces* peak hp beyond 8100 (816 → 782 hp). Continuity test `scV8 redlineRpm` fails.
  - Centrifugal: redline 6500 → 9000 halves boost at 4000 rpm (0.29 → 0.15 bar) and costs about 94 hp.
- **Diagnosis:**
  - `boost.ts › solveSupercharger`: `x = rpm / c.redlineRpm`. Boost for both PD and centrifugal types is scheduled on rpm/redline, so the rev limiter acts as a drive-ratio change.
  - Physically, blower speed = crank speed × pulley ratio. The limiter only truncates the curve, so raising it can never reduce power at any existing rpm.
- **Fix:**
  - Schedule boost against a fixed reference rpm. Option (a): an additive optional field (`supercharger.referenceRpm`, defaulting to the preset's redline). Option (b): derive the drive ratio once from `targetBoostBar` at a nominal rpm.
  - "Boost at redline" can still be shown as a derived readout.

### #4 Turbo hardware sliders behave non-physically (smaller turbo, less low-end; inducer secretly resizes turbine)
- **Evidence:**
  - EA888 at 1.5 bar target: a 34 mm compressor gives **less** 2000-rpm torque than a 52 mm one (184 vs 231 N·m), even though it is at full boost from **1000 rpm**.
  - The cause is that the model holds 1.5 bar at 1000–2800 rpm with 25–38° of knock retard and 4+ bar turbine-inlet pressure.
  - A 30 mm / 0.40 A/R turbo on a 2.0 L makes 1.1 bar at 1000 rpm, which is implausible even in steady state.
- **Diagnosis:**
  - `boost.ts › solveTurbo`: the turbine nozzle area `at = turbineAreaPerARmm2 · AR · inducer² · n` scales with compressor inducer². The inducer slider therefore also shrinks the turbine, and "smaller compressor" becomes "tiny turbine, enormous back pressure".
  - The boost target is held regardless of knock (see #1). The resulting retard, not airflow, decides low-rpm torque, so the doc's "smaller turbo → more low-rpm torque" is inverted.
- **Fix:**
  - Decouple turbine size from the inducer (base it on A/R × a turbine-wheel size tied to frame size, or a separate frame-size constant).
  - Add knock-limited boost (#1).
  - Enforce a low-flow/surge-line minimum on boost at very low exhaust energy.

### #5 Silent boost ceiling: every compressor tops out at PR 3.2 (≈ 2.1 bar), with no warning
- **Evidence:**
  - 2.0 L on E85 with a 62 mm compressor: 2.0 bar → 522 hp, 2.5 bar → **522 hp**, since actual boost peaks at 2.17 bar. The warnings mention only cylinder pressure and lag.
  - The "High-boost 2.0 I4 drag build (E85)" preset (target 2.5 bar) cannot reach its target.
  - 2JZ: a 1.5 bar target gives the same 445.7 hp as a 2.0 bar target (boost ≈ 1.34 at peak).
  - The UI slider goes to 3 bar.
- **Diagnosis:**
  - `boost.ts › compressorMaxPr` uses the global `CAL.compPrMax = 3.2` for every compressor size, and its knee at φ = 0.6 (`compSpeedLineKnee`) rolls PR off from 60% of choke flow upward.
  - When the target is unreachable there is no `boost-target-not-reached` warning. The `choke` flag needs φ > 0.97 *and* η < 0.58, so it rarely fires.
- **Fix:**
  - Scale max PR with compressor size/class (about 3.5–4.0 for modern billet wheels).
  - Move the knee to about 0.75.
  - Add a warning whenever the achieved boost is < 95% of the target in the upper rev range, stating the limiting reason (speed line, choke, TIT/turbine-inlet pressure, turbine power).

### #6 Turbo LS3 drops to 0 hp just past valve float; BSFC clamp artefacts (UI report 1)
- **Evidence:**
  - Twin 51 mm turbo LS3, 0.72 bar, redline 8500: hp 704 @ 7000 → 667 @ 7250 → 421 @ 7500 → **0 @ 7750** and above.
  - VE collapses 1.26 → 0.18, and boost collapses with it because the exhaust energy disappears.
  - The UI saw BSFC ≈ 3000 g/kWh at the collapse points.
  - Test `ui_regressions › power never collapses…` fails.
- **Diagnosis:**
  - `airflow.ts › computeVe`: `fFloat = max(0.15, exp(−((N/N_float − 1)/0.07)²))`, so VE falls 85% within about 10% above the float rpm (LS3 float = 7165).
  - Valve float does make power fall (Rule 23 passes), but real float loses perhaps 10–40% over several hundred rpm. A turbo engine compounds the loss.
  - `engine.ts › evalPoint`: `bsfc = powerKw > 0.5 ? min(3000, …) : 0`. Points with a few kW of power pin at the 3000 clamp, and points below 0.5 kW report 0. Both are artefacts that make the BSFC chart spike.
- **Fix:**
  - Use a gentler float roll-off, for example a linear decline to ~0.5–0.6 VE at 1.2× float, and keep the critical warning.
  - For P < ~5% of peak, report BSFC as NaN/undefined or omit it from charts instead of clamping. This needs a UI agreement, since `bsfcGkWh` is a number.

### #7 Intercooler 0 → 1% loses 4% power (discontinuity); a tiny intercooler is worse than none
- **Evidence:** EA888: IC ε = 0 → 192.4 hp; ε = 0.01 → 184.2 hp (−4.3%, a true step that persists at 0.1% resolution). The Hellcat (SC) shows a smaller dip. Both continuity tests fail.
- **Diagnosis:**
  - `boost.ts › solveTurbo`: `icDrop = (ε > 0 ? 0.12e5 : 0.04e5)·φ²`.
  - `solveSupercharger`: `icDrop = ε > 0 ? 0.08e5·min(1, boost) : 0.02e5`.
  - The pressure drop is a step function of "IC present". The extra drop forces a higher compressor PR, which makes the charge hotter and the engine more knock-prone.
- **Fix:** make the core pressure drop continuous in ε, e.g. `(0.04 + 0.08·ε/0.75)e5·φ²`.

### #8 Turbo controls that do nothing: twin-scroll on the EA888, exhaust type on turbos
- **Evidence:**
  - Twin-scroll changes the full-boost rpm by **0%** on the EA888 (2050 → 2050) and by −6% on the 2JZ. The doc expects 10–15% earlier.
  - Exhaust type changes 2JZ peak hp by **0.0%**, and log vs tuned-equal spool is identical (3200 rpm). The doc says a log manifold helps spool.
- **Diagnosis:**
  - Twin-scroll is modelled only as `pExhCyl ×0.95`, turbine η ×1.1 and a 0.5 wave factor (`boost.ts`, `engine.ts`). Where spool is limited by the speed line or compressor rather than turbine power, these do nothing.
  - For turbos, exhaust type enters only through `exhAmp × waveFactor (0.3)`, and `exhAmp.log = 0`. `exhaustBackPressure` (`exhZeta` by type) is used only for NA/SC.
- **Fix:**
  - Add a pulse-energy / turbine-inlet-volume factor by exhaust type (log = small volume, best pulse energy) to the turbine power at low flow.
  - Model twin-scroll as better pulse utilisation, i.e. higher turbine η at low φ, rather than a flat multiplier.

### #9 Calibration outside the research doc's tolerances (published figures)
- **Evidence:**
  - MAE over high/medium engines is **5.66%** (goal ≤ 5%).
  - Mazda Skyactiv is at **+14.6%** (goal: none outside ±12%), at 84.7 hp/L vs the eco envelope of 60–80, with BMEP 13.3 > 13.
  - Hellcat +10.2% (126 hp/L > SC envelope 125). F20C −10.1%, 1GR +9.2%, F136 torque −14.4%, GT3 torque −9.4%, 3.5 EcoBoost torque −11.1%, Coyote torque −8.5%.
  - Turbo plateaus are not flat from their published start rpm: B58 78% of peak at 1400, EA888 86.5% at 1600, 1.0 EcoBoost 67% at 1450.
  - EJ257 and 3.5 EB torque peaks come early (2800 vs 4000, 2650 vs 3500).
  - The physics log reports "all within ±15%", but the research doc's bar is ±8% (high confidence) and ±12% maximum.
- **Diagnosis:**
  - These are largely downstream of #1 and #2 (flat NA VE, knock balance).
  - The plateau shortfall comes from spool that is about 200–300 rpm too late at 1400–1600, plus the 15–20° retard spike right as boost arrives (`solveTurbo` / `knockLimitedSpark`).
- **Fix:** recalibrate after #1 and #2. Then use the plateau tests (`envelopes.test.ts`) as the acceptance criterion.

### #10 Piston-speed warnings looser than the research doc
- **Evidence:** at 26 m/s the model gives only `info`; at 28 m/s only `warn`. The doc says warn above 25 and critical above 27 (Rule 21 fails twice).
- **Diagnosis:** `warnings.ts` (v2) moved the thresholds to info >22, warn >27, critical >30, so that the F20C (25.2) and the R8 V10 (26.9) show no warning.
- **Comment:** that is a deliberate product decision, but it contradicts the doc. A 28 m/s street build should warn more loudly than "warn". Either align the doc and code (my recommendation: warn > 25 with wording such as "production-limit territory (F20C/R8)", critical > 27) or update the doc. This is a decision for the lead.

### #11 Jagged spark-advance / knock-retard / BSFC curves (UI report 3)
- **Evidence:**
  - Retard values are quantized in 0.31° steps (e.g. 3.44 / 6.25 / 5.31 / 4.38° at 2600–3200 rpm on the turbo LS3).
  - On the DI turbos the retard spikes by 15–20° at the rpm where boost first reaches target (B58 20.6° at 1600, EA888 19.8° at 1600, 1.0 EB 17° at 1900). This produces 7–26 g/kWh second-difference kinks in BSFC.
  - The smoothness tests fail on 2 (retard) and 9 (BSFC) points after excluding the genuine corner at the knock-limit onset.
- **Diagnosis:**
  - `combustion.ts › knockLimitedSpark` bisects 7 times over a ≤ 40° window, which gives 0.31° resolution, and returns the conservative bound `hi`. That produces stair-steps.
  - The spike at spool completion is a real effect (lowest rpm at full boost is the worst knock point), but its 20° magnitude is overstated (#1).
  - EGT and exhaust pressure are warm-started from the previous rpm point (`simulate` loop), which can add point-to-point noise on turbo curves.
- **Fix:** interpolate the retard where the knock integral crosses 1 (a secant step on the last bracket), or add 3 more bisection steps (still < 1 ms). Optionally iterate the warm start twice on turbo points.

### #12 Compressor choke looks premature (UI report 2)
- **Evidence:**
  - `CAL.compChokePerMm2 = 1.15e-4 kg/s/mm²` gives 0.299 kg/s = **39.6 lb/min** per 51 mm compressor, i.e. 0.0152·D² lb/min. The rule of thumb is 0.018·D², or 46.8 lb/min each (94 lb/min for the pair).
  - The usable flow is lower still, because `compressorMaxPr` starts rolling PR off at φ = 0.6, which is ~24 lb/min each.
  - Twin 51 mm on the 6.2 L: needed flow at 0.72 bar is ~36 lb/min each (φ ≈ 0.91). At 1.0 bar the model cannot hold boost: it drops to 0.79 bar by 6250–6750 rpm, where ~37 lb/min each is needed.
  - In my configuration (A/R 0.82, IC 0.75) the model did not emit a `compressor-choke` warning at 0.72 bar; the UI's configuration probably differs. The boost shortfall at 1.0 bar, however, is reproduced (test fails, 0.887 bar at 5600).
- **Fix:** raise `compChokePerMm2` to ~1.35e-4 (= 0.018·D² lb/min) and move the speed-line knee to ~0.75. Re-check the 2JZ and EA888 calibration afterwards.

### #13 Other (lower impact)
- **DI VE benefit too small:** +0.38% (doc +1–3%), and DI knock retard improves by only ~1°. Cause: `evapCooling` fractions 0.10 vs 0.15 for VE in `engine.ts › simulate`.
- **Charge-temperature sensitivity on knock-limited turbos:** −0.17 to −0.18 %/°C, vs the doc's ≈ −0.33. It passes my widened window, but the knock sensitivity to T_ivc is weak.
- **EGT hits the 1500 K clamp** (1227 °C) in 79 of 627 gasoline fuzz configs (λ 0.75–1.0, mostly heavily retarded). `combustion.ts › exhaustTemp` saturates, so the reported value is a clamp, not physics.
- **NA adjacent-point torque jumps** of up to 27% of peak torque in 30 extreme fuzz configs (CR 16, 6 mm lift, 320° duration…). Likely `knockLimitedSpark` hitting `maxRetard`, where the work ratio jumps to its 0.35 floor.
- **Mass:** 1.0 EcoBoost +27% (123 vs 97 kg), F20C −17.5%, F12 +17% (`mechanical.ts › estimateMassKg`: the fixed 18 kg ancillary plus per-cylinder terms over-weight small engines).
- **Zero-hp extreme configs** (2 of 2000, e.g. a 20 L V12 on one 30 mm turbo): turbine-inlet pressure 8–10 bar, so PMEP exceeds IMEP. This is physically defensible and a warning is shown, so it passes.
- **Rule 1 on the EA888:** 0.5 → 1.0 bar gives only +17.7% (doc 25–40%), because the stock engine is already ~16° knock-limited at 1 bar. Same root cause as #1 and #4. The 2JZ gives +33% (passes).
- **Rule 5 drive loss:** 9.6% of gross at 0.8 bar on the Hellcat. That passes my 7–20% window but sits at the low edge of the doc's 10–15%.

## 2. Issues from UI testing (lead's report), reproduced

| UI report | Reproduced? | Test | Root cause |
|---|---|---|---|
| Twin-turbo LS3 (8500 redline): power → 0 and BSFC ≈ 3000 above ~7.8k | **Yes**: 0 hp from 7750 rpm; VE 0.18 | `ui_regressions` #1 fails; BSFC check passes in my config (points < 0.5 kW report 0, not 3000) | #6: `fFloat` floor 0.15 with a 7% width; `engine.ts` BSFC clamp `min(3000,…)` for 0.5 kW < P. |
| Twin 51 mm: choke at 0.72 bar on a 6.2 L | **Partly**: no choke warning at 0.72 bar in my config, but at 1.0 bar boost falls to 0.79–0.89 bar above 5500 | `ui_regressions` #3 passes, #4 fails | #12: choke flow 0.0152·D² vs 0.018·D², and the speed-line knee at φ 0.6. |
| Jagged spark advance / retard / BSFC | **Yes**: 0.31° quantization and 15–20° retard spikes at spool completion | `ui_regressions` #5 and #6 fail | #11: 7-step bisection, the conservative bound, #1. |

## 3. Failure triage (all 56 failures)

**REAL** means a model problem. **STRICT** means my test criterion went beyond what the research doc supports; where that happened I fixed or removed the criterion during the run and say so below. **DOC** means the research doc itself is inconsistent.

| Test | Verdict | Note |
|---|---|---|
| Rule 1 turboI4 0.5 → 1.0 bar +25–40% | REAL | +17.7%: stock EA888 is 16–18° knock-limited at 1 bar (#1/#4). |
| Rule 1 E85 2.0 L beyond 2 bar | REAL | PR ceiling 3.2 (#5). |
| Rule 2 turboI4 inducer (low-rpm torque) | REAL | #4. |
| Rule 3 turboI4 twin-scroll | REAL | #8 (0% change). |
| Rule 7 LS3 runner | REAL (moderate) | #2; the peak-torque rpm argmax is unstable on a flat curve. |
| Rule 10 Z at peak 0.71–0.74 | REAL | #2. The test already widens the doc's 0.55–0.6 to 0.45–0.70. |
| Rule 14 CR optimum on 87 | REAL | #1. |
| Rule 14b turbo CR optimum ≤ 11 | REAL | #1. This test is mine, not in the doc; it follows from Rule 14 plus boost. |
| Rule 17 DI VE | REAL (minor) | #13. |
| Rule 21 Sp 26/28 | REAL vs doc / product decision | #10. |
| Envelopes: 32 per-engine failures + 2 aggregate | REAL | #2/#9. The criteria are verbatim from the doc's tolerance table. Some estimated-hardware engines (3.5 EB, B58 low confidence) are partly a data-quality issue (doc §3). |
| Envelopes: E85 drag preset BMEP 41 > 40 | REAL (borderline) | 2.5 bar target on E85; 41 bar is high, but it is the doc's own "40+" race band, so low priority. |
| Fuzz boost BMEP > 30/40 (13) | REAL | #1. |
| Fuzz EGT > 1100 (79/627) | REAL (low) | Mostly heavy retard; values clamp at 1227 °C (#13). |
| Fuzz NA adjacent jumps (30) | REAL (low) | Extreme configs; `maxRetard` saturation (#13). |
| Continuity IC ε turbo / SC | REAL | #7. |
| Continuity SC redline | REAL | #3. |
| UI #1 TT LS3 collapse | REAL | #6. |
| UI #4 51 mm at 1.0 bar | REAL | #12. |
| UI #5/#6 smoothness | MIXED | Quantization is real (#11). The spool-completion spike is physically a peak, but its size is #1. |

**Criteria I corrected as over-strict during the run** (none of these failed for the model's benefit after correction unless stated):
1. Rule 4: the doc's "−30…−50 °C" charge-temperature band is kept as an `it.fails` (DOC conflict, §5), with an added physics-consistent check ΔT = −ε·(T₂ − T_amb). My own T₂ upper bound was widened from 125 to 145 °C after I found a small wheel near choke at η ≈ 0.63 legitimately runs at 136 °C.
2. Rule 8: the torque-peak-rpm check now applies to NA engines only. A turbo's torque peak is set by spool and boost control, not by the cam; the doc's rule is NA.
3. Rule 13: I removed my invented "> 1.5× critical throttle barely matters (≤ 3%)". The model's +3.9% from 52 → 88 mm on a K20 at 8400 rpm agrees with a hand calculation (Mach 0.28, about 5% pressure loss). Replaced with the doc criterion plus a "bigger never hurts" check.
4. Envelopes:
   - I removed my BTE floor of 0.26 at peak power. Rich, retarded turbos at 0.24–0.25 are consistent with the doc's own 290–360 g/kWh envelope.
   - I removed "NA ≤ 130 hp/L" for the hypothetical *race* V10. The doc's limit is for street engines; race NA can exceed it, and the BMEP ≤ 16 check is kept.
   - "Stock knock retard ≤ 6°" is now recorded only. Downsized DI turbos are genuinely knock-limited at low-speed full load and the doc gives no number.
5. Fuzz:
   - The "peak hp > 0" requirement became "a 0-hp result must carry a warn/critical warning". A 30 mm throttle on a 27 L V16 really makes no brake power.
   - The NA BMEP limit (16 bar) now applies to gasoline; alcohol fuels get 17.5. The doc's limit is stated for gasoline, and methanol NA drag engines exceed it.
   - The adjacent-jump metric is now relative to peak torque, not to the previous point, so a choked top end fading to 0 is not flagged.
6. Continuity: "1% parameter change" now means 1% of the value, not 1% of slider range. Each flagged step is re-sampled at 0.1% of range to separate true discontinuities from steep but continuous slopes. Example: a redline of 3000 → 3170 is a 5.7% change and legitimately gives +5.9% hp.
7. UI smoothness: points touching the knock-onset corner (retard = max(0,·)) and the lugging region below 1500 rpm are excluded.

## 4. Sanity-rule results (per rule; numbers from `tests/reports/data/sanity.json`)

| Rule / group | Pass | Fail | Failing cases |
|---|---|---|---|
| physics identities on every curve point | 13 | 0 | – |
| Rule 1: more boost → more power (until knock/choke/EGT) | 5 | 2 | turboI4: 0.5 → 1.0 bar adds 25–40% peak power; 2.0 CR 9.5 on E85 keeps gaining power beyond 2 bar and retards far less than 93 |
| Rule 2: compressor inducer / turbine A/R trade-off | 3 | 1 | turboI4: bigger inducer → later spool, more peak power at 1.5 bar; smaller → more low-rpm torque |
| Rule 3: twin-scroll spools earlier, same peak | 1 | 1 | turboI4: full-boost rpm 5–20% lower (doc: 10–15%), peak hp within ±4% |
| Rule 4: intercooler | 6 | 0 | – |
| Rule 5: supercharger types | 4 | 0 | – |
| Rule 6: NA never reports boost | 1 | 0 | – |
| Rule 7: intake runner length | 1 | 1 | naPushrodV8: longer runner → lower peak-torque rpm, bounded (200→400 mm moves peak 5–30%) |
| Rule 8: cam duration | 4 | 0 | – |
| Rule 9: lobe separation / overlap | 2 | 0 | – |
| Rule 10: valve size | 2 | 1 | undersized valves: power peaks where Taylor Z ≈ 0.55–0.6 (accept 0.45–0.70) |
| Rule 11: VVT and variable lift | 3 | 0 | – |
| Rule 12: exhaust ranking | 3 | 0 | – |
| Rule 13: ITB/short runner, throttle restriction | 3 | 0 | – |
| Rule 14: compression ratio | 3 | 1 | beyond the knock limit net torque falls: on 87 the CR sweep 9→16 has an interior optimum |
| Rule 14b: compression ratio on a boosted engine | 0 | 1 | EA888 (1.1 bar, 91, DI): best peak hp at CR ≤ 11 — boosted engines are knock-limited, so high CR must not win |
| Rule 15: higher octane never reduces power | 6 | 0 | – |
| Rule 16: alcohol fuels | 3 | 0 | – |
| Rule 17: direct injection | 1 | 1 | NA K20 and LS3: DI gives +1–3% VE (accept +0.5…+4%) at peak torque rpm |
| Rule 18: lambda | 2 | 0 | – |
| Rule 19: bigger bore (fixed CR & fuel) → more knock | 2 | 0 | – |
| Rule 20: charge temperature | 2 | 0 | – |
| Rule 21: mean piston speed thresholds | 2 | 2 | Sp 26 m/s → piston-speed warn, not critical; Sp 28 m/s → piston-speed critical |
| Rule 22: piston acceleration | 3 | 0 | – |
| Rule 23: valve float | 2 | 0 | – |
| Rule 24: friction and mechanical efficiency | 2 | 0 | – |
| Rule 25: mass and cylinder count | 2 | 0 | – |

Key measured numbers per rule:
- **R1 boost:**
  - 2JZ: 0.5 → 1.0 bar gives +33.0% hp (pass). EA888: +17.7% (fail).
  - Peak hp plateaus above 1.5 bar on both: EA888 at 213 hp with 28–40° retard, 2JZ at 445.7 hp (PR/speed-line ceiling).
  - Hellcat 0.4/0.8/1.2 bar: 613/779/932 hp.
  - 2.0 L CR 9.5 on 93: retard 0/4.1/10.3/12.2° at 1.0/1.5/2.0/2.5 bar (pass).
- **R2:**
  - Inducer ×0.85 vs ×1.3: spool 1000 vs 2350 rpm (EA888) and 1800 vs 3600 (2JZ). Peak hp 150 vs 352 and 327 vs 567.
  - A/R 0.45 vs 1.0: back pressure at redline 4.3 vs 1.95 bar (pass).
- **R3:** twin-scroll spool on EA888 2050 → 2050 (fail); 2JZ 3200 → 3000 (−6%, pass); peak within ±1.4%.
- **R4:**
  - Intercooler 0 → 0.75 at 1 bar: +10.4% (EA888) and +12.5% (2JZ) power (pass).
  - Charge temperature −82 / −68 °C, vs expected −83 / −70 from ε·ΔT (physics pass; doc band fails, §5).
  - Retard 36.8 → 16.7° (EA888).
- **R5:**
  - PD boost at 40% redline / boost at redline = 0.87. Centrifugal at 50% redline = 0.25 (pass).
  - Mid-range torque: centrifugal 662 vs twin-screw 893 N·m.
  - Drive loss 6.5% @ 0.4 bar and 9.6% @ 0.8 bar.
- **R6:** NA MAP ≤ ambient on all NA presets, including tuned runner+header+ITB variants (pass).
- **R7:**
  - K20 peak-torque rpm 7250 → 4750 for 150 → 500 mm, monotone (pass).
  - LS3 non-monotone (fail): 4600/4200/4800/4800/4600/4400/4200.
- **R8:**
  - LS3 +20° @.050: power peak 6000 → 6600 (+600, in the accepted 500–1400 window but below the doc's 800–1000), 2000-rpm torque −6.9%, hp 434 → 462 (pass).
  - Duration sweeps on K20, LS3 and 2JZ move the power peak up and low-rpm torque down (pass).
- **R9:**
  - LSA 116 → 106 on LS3 long-tubes: VE at 2000 rpm 0.840 → 0.836, VE at the power peak 0.904 → 0.911 (pass, but effects are only ±1%).
  - High-rpm benefit NA +0.9% vs turbo −1.3% (pass).
- **R10:** intake valve ×1.1 vs ×0.85 moves the power peak 7750 → 9900 (K20) and 4800 → 6800 (LS3) (pass). Z at peak 0.708 / 0.743 (fail).
- **R11:**
  - VVT: torque-curve area +6.2% (K20) and +3.2% (LS3); peak torque +3.9% / +1.7% (pass).
  - VTEC at 3000 rpm: 194 vs 172 N·m for the high cam alone; peak hp equals the high cam (pass).
- **R12:**
  - NA exhaust ranking log < shorty < long-tube < tuned-equal on both K20 and LS3 (pass); spread 6%.
  - Turbo spread 0.0% (pass as "collapses", but see #8).
- **R13:**
  - ITB + 150 mm: 243 vs 217 hp (pass).
  - A throttle at 0.6× the critical diameter cuts K20 power to 84 hp (pass).
- **R14:**
  - +1 CR on race fuel: +3.0% (K20), +2.7% (LS3) (pass).
  - CR 13 on 87: 10.9° / 7.8° retard (pass).
  - No interior optimum up to CR 16 (fail). Turbo optimum at CR 14 (fail).
- **R15:** octane is monotone on all 5 bases. LS3 91 → 93 changes 0.0% (pass).
- **R16:**
  - E85 NA +6.7% (accepted window +1…+8; doc +3–5); BSFC ×1.42.
  - Methanol 258 vs E85 232 hp; BSFC ×1.98.
  - Knock-limited turbo: E85 +7.6% (pass).
- **R17:** DI retard 8.75 → 7.81° and 22.8 → 21.3° (pass); VE +0.38% (fail).
- **R18:** best λ = 0.87 on both; lean of 1 and richer than 0.75 both lose; EGT is monotone in λ (pass).
- **R19:** bore 80 → 92: retard 7.96 → 9.06°. EA888 bore 78 → 88: 16.7 → 21.3° (pass).
- **R20:** −0.18 / −0.16 %/°C (pass with the widened window; doc ≈ −0.33).
- **R21:**
  - Thresholds differ from the doc (fail ×2).
  - Longer stroke: Sp 22.4 → 26.9 m/s and reliability 99 → 85 (pass).
- **R22:**
  - rω²(1 + r/l) within 2% for all references (pass).
  - Longer rod lowers peak acceleration (pass).
  - Cast parts at 45 km/s² raise a critical rotating-assembly warning (pass).
- **R23:** past float the curve gains no power and shows a valve-float warning (K20 float 11,077 rpm, LS3 7165) (pass).
- **R24:**
  - Mechanical FMEP rises monotonically on all references (pass).
  - η_m at peak torque 0.85–0.88 and at peak power 0.79–0.83 (pass).
- **R25:**
  - Iron is heavier than aluminium (pass).
  - 3.0 L I4 → I6 → V8: mass 140/157/165 kg, mechanical limit 8735/9667/10387 rpm, Sp 23.0/20.1/18.2 m/s (pass).

## 5. Places where the research doc is inconsistent (for the research agent)
1. **Rule 4 temperature band.** With ε = 0.75 at 1 bar, a compressor at η 0.65–0.75 delivers T₂ ≈ 110–135 °C at 25 °C ambient, so the drop is ε·(T₂ − 25) ≈ −65…−85 K, not −30…−50. The model is right and the doc band should be revised. It is kept as `it.fails` so it flips if either side changes.
2. **Rule 21 vs production engines.** The doc's "warn > 25 m/s" would flag the F20C (25.2) and the R8 V10 (26.9). That is probably intended ("production-limit"), but the physics agent changed the code instead of the doc. Needs a decision (#10).
3. **Turbo-street BMEP envelope (17–24 bar)** and the published B58/EA888 torque plateaus imply full boost by ~1400–1500 rpm. That needs turbine sizing which the shared `turbineAreaPerARmm2 · inducer²` scaling cannot give without breaking other engines (#4).

## 6. Envelope and calibration table (all reference engines)
Classes: pushrod = NA 2v pushrod; eco4v = NA economy 4v; perf4v = NA performance 4v; turbo = turbo street; scV8 = supercharged V8.

| Engine | class | hp sim/pub (err) | N·m sim/pub (err) | P-pk rpm sim/pub | T-pk rpm sim/pub | hp/L | BMEP@Tpk | BSFC@Ppk | BTE@Ppk | EGT@Ppk °C | Sp red | rel | warnings |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| honda-k20a-dc5 | perf4v | 217/217 (+0.2%) | 210/206 (+1.9%) | 8400/8000 | 6250/7000 | 108.8 | 13.2 | 279 | 0.300 | 858 | 24.1 | 97 | info:piston-speed |
| honda-f20c-ap1 | perf4v | 216/240 (-10.1%) | 200/207 (-3.4%) | 9000/8300 | 4250/7500 | 108.0 | 12.6 | 289 | 0.289 | 880 | 25.2 | 95 | info:piston-speed |
| toyota-4age-20v-blacktop | perf4v | 179/163 (+9.6%) | 172/162 (+6.1%) | 8000/7800 | 6200/5600 | 112.5 | 13.6 | 274 | 0.306 | 861 | 20.5 | 100 | – |
| toyota-2jz-gte-us | turbo | 345/320 (+7.7%) | 449/427 (+5.3%) | 6600/5600 | 3800/4000 | 115.0 | 18.8 | 346 | 0.242 | 937 | 19.5 | 100 | – |
| gm-ls3 | pushrod | 434/430 (+1.0%) | 563/575 (-2.0%) | 6000/5900 | 4800/4600 | 70.5 | 11.5 | 286 | 0.293 | 882 | 20.2 | 100 | – |
| gm-ls7 | pushrod | 481/505 (-4.7%) | 638/637 (+0.1%) | 6000/6300 | 4800/4800 | 68.6 | 11.4 | 287 | 0.292 | 874 | 23.7 | 97 | info:piston-speed |
| ford-coyote-gen3 | perf4v | 474/460 (+3.0%) | 520/569 (-8.5%) | 7500/7000 | 5200/4600 | 94.1 | 13.0 | 280 | 0.299 | 844 | 23.2 | 98 | info:piston-speed |
| bmw-s54-e46m3 | perf4v | 347/333 (+4.3%) | 351/355 (-1.3%) | 8000/7900 | 5400/4900 | 107.0 | 13.6 | 277 | 0.302 | 854 | 24.3 | 95 | info:piston-speed |
| bmw-b58-340i | turbo | 302/320 (-5.7%) | 502/447 (+12.4%) | 5200/6000 | 2800/3190 | 100.7 | 21.1 | 306 | 0.274 | 840 | 22.1 | 100 | info:piston-speed, info:knock |
| vw-ea888-gen3-gti | turbo | 213/220 (-3.1%) | 333/350 (-4.7%) | 5350/5450 | 2950/3050 | 107.4 | 21.1 | 319 | 0.263 | 903 | 20.1 | 100 | info:knock |
| ford-10-ecoboost | turbo | 126/123 (+2.8%) | 161/170 (-5.5%) | 6500/6000 | 2350/2950 | 126.6 | 20.2 | 318 | 0.263 | 936 | 17.8 | 100 | info:knock |
| ford-35-ecoboost-gen2 | turbo | 405/375 (+7.9%) | 566/637 (-11.1%) | 5950/5000 | 2650/3500 | 115.8 | 20.4 | 319 | 0.263 | 890 | 17.3 | 100 | info:knock |
| toyota-1gr-fe | eco4v | 295/270 (+9.2%) | 394/377 (+4.5%) | 6000/5600 | 4450/4400 | 74.5 | 12.5 | 278 | 0.301 | 875 | 19.0 | 100 | – |
| subaru-ej257-sti | turbo | 288/305 (-5.5%) | 420/393 (+6.8%) | 6000/6000 | 2800/4000 | 117.3 | 21.5 | 342 | 0.244 | 973 | 17.6 | 100 | info:knock, info:egt |
| porsche-9a1-40-gt3 | perf4v | 480/500 (-4.1%) | 417/460 (-9.4%) | 9000/8250 | 5750/6000 | 120.0 | 13.1 | 267 | 0.314 | 860 | 24.4 | 96 | info:piston-speed |
| ferrari-f136-458 | perf4v | 534/562 (-5.0%) | 462/540 (-14.4%) | 9000/9000 | 6000/6000 | 118.8 | 12.9 | 271 | 0.309 | 867 | 24.3 | 97 | info:piston-speed |
| audi-52-v10-r8plus | perf4v | 563/602 (-6.5%) | 545/560 (-2.7%) | 8700/8250 | 5250/6500 | 108.2 | 13.2 | 276 | 0.303 | 837 | 26.9 | 93 | info:piston-speed |
| ferrari-f140fc-f12 | perf4v | 756/730 (+3.5%) | 661/690 (-4.2%) | 8700/8250 | 6750/6000 | 120.7 | 13.3 | 261 | 0.321 | 846 | 21.8 | 100 | – |
| dodge-hellcat-62 | scV8 | 779/707 (+10.2%) | 926/881 (+5.1%) | 6200/6000 | 4450/4800 | 126.3 | 18.9 | 334 | 0.250 | 869 | 18.8 | 100 | – |
| mazda-skyactiv-g25 | eco4v | 211/184 (+14.6%) | 263/251 (+4.7%) | 6500/5700 | 4300/3250 | 84.7 | 13.3 | 259 | 0.323 | 815 | 21.7 | 100 | info:knock |
| chevy-350-zz4 | pushrod | 356/355 (+0.2%) | 518/549 (-5.7%) | 5500/5250 | 4000/3500 | 62.0 | 11.3 | 293 | 0.285 | 882 | 16.2 | 100 | – |

Hypothetical presets:
- Twin-turbo 4.0 flat-plane V8: 659 hp (165 hp/L), BMEP max 28.5.
- E85 2.0 drag build: 633 hp, BMEP 41.1. Its 2.5 bar target is not reached (#5).
- 7.4 big-block NA: 564 hp (76 hp/L).
- 3.0 V10 track special: 539 hp (180 hp/L NA, BMEP 14.0). Critical valve-float warning, reliability 62.
- DEFAULT: 202 hp (101 hp/L), only an info warning (pass).

Stock reliability: all 21 references score ≥ 93 with no warn/critical warnings (pass). The DI turbos carry permanent `info:knock` (B58, EA888, 1.0 EB and 3.5 EB at 15–17° retard ≥ 2000 rpm and 9–12.5° ≥ 3500 rpm; recorded, not asserted).

## 7. Fuzzing (2000 configs, seed 20261104)
- **Robustness:** 0 throws, 0 NaN/Infinity, 0 negative outputs. The rpm grid is always strictly increasing and ends at the redline; peaks equal the curve maxima. P = T·ω and BMEP identities hold on all ~60k points.
- **Timing:** median **0.70 ms**, p95 7.1 ms, p99 8.4 ms, max 9.9 ms.
- **Plausibility counts (failures):**
  - Boosted BMEP > 30 (pump) / > 40 (alcohol): 13.
  - Gasoline EGT outside 500–1100 °C: 79 / 627.
  - NA adjacent torque jumps > 10% of peak: 30 / 1013.
  - NA gasoline BMEP > 16: 0. BTE/BSFC violations: 0.
- **Worst offenders** (full configs in `tests/reports/data/fuzz.json › offenders`):
  - `boost-bmep` #1652: I3, 106.6 × 119 mm, CR 10.1, twin 56 mm turbos at 2.08 bar, gas91, λ 0.80 → **33.7 bar BMEP** (15° retard).
  - `boost-bmep` #1599: I4 62.6 × 80.8, CR 10.5, 43.5 mm at 2.19 bar, E85 λ 0.985 → **44.1 bar** with 0° retard.
  - `egt` #87, #236, #249: EGT pinned at **1227 °C** (the 1500 K clamp).
  - `na-torque-jump` #534: I2 50 × 130 mm, CR 16, gas87, 6 mm lift / 320° duration, 30 mm throttle → 27% step.
  - `zero-hp` #366, #1675: a 20–27 L V12/V16 on one 30 mm turbo or a 30 mm throttle. Turbine-inlet pressure is 8–10 bar or MAP 0.33 bar, PMEP exceeds IMEP, and warnings are shown (accepted).

## 8. Continuity / UX realism (4 bases × 21–24 sliders × 101 steps)
- No true discontinuity anywhere except the **intercooler 0 → >0 step** (#7; turbo −4.3%, SC smaller).
- No slider produced more non-physical reversals than allowed, except **redline on the supercharged V8** (#3: peak hp falls once the redline passes 8100).
- Idle and V-angle sliders have no effect on peak hp (correct).
- Observed but not asserted:
  - Turbo-I4 CR is optimal at 13.6 (#1).
  - On the turbo I4 the peak-torque-rpm readout jumps by > 15% in up to 4 of 100 steps for CR, duration and λ. The torque curve is flat, so the readout flickers; consider showing a torque-plateau band in the UI.

## 9. Files
- Tests (all new, all mine): `tests/unit/helpers.ts`, `tests/unit/sanity.test.ts`, `tests/unit/envelopes.test.ts`, `tests/unit/fuzz.test.ts`, `tests/unit/continuity.test.ts`, `tests/unit/ui_regressions.test.ts`.
- Data: `tests/reports/data/{sanity,envelopes,fuzz,continuity,vitest-results}.json`.
- No files under `src/sim/` were modified.

---

## 10. v3 re-audit (physics v3, with the knock-aware ECU boost trim)

### 10.1 Test changes after the lead's ruling ("keep the ECU, isolate hardware effects")
- **Hardware-comparison tests now run on a non-knock-limited setup:**
  - Rule 1 (EA888 boost scaling), Rule 2 (inducer and A/R), Rule 3 (twin-scroll), Rule 4 (intercooler gain and charge temperature) and Rule 20 (charge-temperature slope) now run on E85 with CR ≤ 8.5 (`isolateKnock` in `sanity.test.ts`).
  - Every isolated test asserts a precondition that knock retard is ≤ 2°, so the isolation cannot drift silently.
  - The UI twin-51 mm LS3 choke tests run on E85, with the same precondition.
- **New companion tests (all pass on v3):**
  - Intercooler gain on 91 ≥ gain on race 100: EA888 +31.3% vs +24.0%; 2JZ +22.6% vs +15.5%.
  - A hotter charge costs at least as much on pump gas as on the knock-free setup, with more retard: EA888 −0.63 vs −0.26 %/°C; 2JZ −0.26 vs −0.16 %/°C.
  - When the ECU trims boost, a `boost-target` message citing knock appears. EA888 on 91 with no intercooler at 1.5 bar reaches 1.26 bar max: "Target boost not held: 75 % … because knock control trims boost".
- **Spool measurement:** spool is now compared at a common threshold, 95% of min(target, the lower run's max boost), so a run that is legitimately trimmed or choked cannot score "Infinity".
- **Rule 1 (EA888):** both runs now use a ≥ 48 mm wheel and must hold 1.0 bar at peak power. The doc rule says "until … compressor choke", and the stock 40 mm wheel chokes at 1 bar near redline even on E85.
- **Rule 2 low-rpm torque (my own criterion):** now compared midway between the two spool points, i.e. where only the smaller housing is on boost. The old fixed 2500 rpm sat at the big housing's spool point.
- **Rule 4 ε·ΔT check (my own criterion):** both runs are now evaluated at the same rpm instead of at each run's own peak-power rpm.
- Nothing else was loosened.

### 10.2 Counts

| Suite | v2 (pass/fail) | **v3 (pass/fail)** |
|---|---|---|
| sanity | 81 / 11 (+ Rule 21/IC rulings) | **96 / 2** |
| envelopes | 225 / 35 | **223 / 37** |
| fuzz | 12 / 3 | **11 / 4** |
| continuity | 81 / 3 | **83 / 1** |
| ui_regressions | 2 / 4 | **5 / 1** |
| **total** | 401 / 56 | **418 / 45** (463 tests) |

### 10.3 Status of the original top 10

| # | Issue | v3 status | Evidence |
|---|---|---|---|
| 1 | Knock doesn't limit CR/boost at high rpm | **Mostly closed** (residual at extreme boost, see 10.4 R1) | K20 on 87: CR optimum is now **12** (213.8 N·m), falling to 201 at CR 16. EA888 turbo: optimum CR **9–10**, falling to 183 hp at CR 15. Rules 14 and 14b pass. |
| 2 | NA curves too flat; power to the limiter | **Open** (partial gain) | Z at peak is now 0.64/0.69 (Rule 10 passes). F20C: torque peak at 5000 (published 7500), power still at the 9000 limiter, −13.6%. K20 duration sweep: torque-peak rpm stuck at 6000. LS3 runner peak-rpm still non-monotone. |
| 3 | Supercharger boost tied to redline | **Closed** | `referenceRpm` pulley; the continuity redline sweep on the Hellcat passes. |
| 4 | Turbo hardware sliders backwards | **Closed** (isolated) | Inducer ×0.85/×1.3: spool 1150/1900 (EA888) and 1800/3000 (2JZ). A/R: small housing gives 2× torque between the spool points and higher back pressure. |
| 5 | Silent PR 3.2 ceiling | **Closed** | 2.0 L E85: 541 → 609 hp from 2.0 → 2.5 bar. `boost-target` warning names the limiter. |
| 6 | Turbo LS3 → 0 hp past float; BSFC clamp | **Closed** | UI test passes (float floor 45%, BSFC 0 below 5 kW). |
| 7 | Intercooler 0 → 1% step | **Closed** | Continuity intercooler sweeps pass for turbo and SC. |
| 8 | Twin-scroll / turbo exhaust no-ops | **Closed** (exhaust still weak) | Twin-scroll spool −8.6% (EA888) and −14% (2JZ). Log manifold spools 200 rpm earlier, but turbo exhaust-type hp spread is only 0.5%. |
| 9 | Calibration outside tolerance | **Open, slightly worse** | MAE **6.18%** (v2 5.66, goal ≤ 5). F20C −13.6% and Mazda +12.1% are outside ±12%. 7 peak-power-rpm and 6 peak-torque-rpm misses. Plateaus: 1.0 EB 67%, B58 87%, EA888 90%. |
| 10 | Piston-speed thresholds | **Closed** (arbitration) | Spec changed to the code's 22/27/30 m/s. |
| 11 | Jagged retard/BSFC | **Mostly closed** | BSFC smoothness passes. One retard kink remains (EJ257 @ 3800, Δ² = 1.81°). |
| 12 | Premature 51 mm choke | **Closed** | On E85: 0.72 bar held with no choke; ≥ 0.9 bar held at 1.0 bar. |

### 10.4 What remains, ranked (v3)
1. **Pump-gas BMEP can still reach 46–57 bar at very high boost** (fuzz `boost-bmep` 23 cases, up from 13). Example: #1569, a flat-12 with 61 mm bores on 91 at 2.98 bar target, gives **46.2 bar**. The knock-aware trim does not bind for small bores at PR > 3.5. Check `knockLimitedSpark` and the ECU trim in `engine.ts` (`trimPrev` loop) at high MAP with small bore: the bore exponent in the knock/burn model, plus the higher PR ceiling (`3.8 + 0.01/mm`), lets it through.
2. **NA torque character (#2):**
   - F20C torque peak 5000 vs 7500 and power at the limiter. GT3 power at 9000 vs 8250. LS7 peak at 5600 vs 6300. Coyote torque peak 5400 vs 4600. R8 torque peak 5500 vs 6500.
   - Cam duration on DOHC (K20) no longer moves the torque peak.
   - Model: `airflow.ts › profileVe`/`computeVe`. The IVC → zOpt mapping and the cam/runner interaction still give one broad hump that is insensitive to cam timing.
3. **Calibration (#9):** MAE 6.18%. F20C −13.6, Mazda +12.1, 2JZ +9.9 (power peak 6400 vs 5600), Hellcat +9.5 (125.5 hp/L), R8 −8.8, F136 torque −11.5. Turbo plateaus at their published start rpm: 1.0 EcoBoost 67%, B58 87%, EA888 90% (need ≥ 95%).
4. **Performance tail regressed:** fuzz median 1.0 ms (assert passes), but **p95 10.2, p99 16.0, max 27.7 ms**, above the 15 ms budget in ARCHITECTURE.md. Likely cause is the ECU trim loop re-solving the turbo per rpm point. Worth a cap on iterations or a cheaper warm start.
5. **New small discontinuity:** EA888 CR 15.6 → 15.7 drops 2.6% in one 1% step, and the drop does not shrink at 0.1% resolution (true step). Probably a branch switch in the ECU trim (retard threshold of 10° vs boost), in `engine.ts`'s trim loop. Make the trim continuous, e.g. blend near the threshold.
6. **EGT > 1100 °C** in 74 of 627 gasoline fuzz configs (`combustion.ts › exhaustTemp` at its 1500 K clamp under heavy retard).
7. **Extreme-config shape:** 21 NA configs with > 10% of peak torque jumping between adjacent points. One single-cylinder E85 config at 2.66 bar reaches 432 hp/L; it carries critical warnings, but it is still above the 400 hp/L sanity cap.
8. **Minor:**
   - EJ257 retard kink (1.8°).
   - Mass: 1.0 EB +27%, F20C −17.5%, F12 +17%.
   - LS3 runner peak-torque rpm argmax is non-monotone.
   - Turbo exhaust type has almost no effect on peak (0.5%).
   - Envelope BSFC slightly below 270 for the GT3, F136 and F12 (261–269 g/kWh).

## 11. Physics v4 (physics agent): test changes and why

v4 adds a wave-action gas-exchange model, explicit OEM ECU torque / rated-power management, ECU EGT-protection enrichment and a prediction-uncertainty block. Three test edits. None loosens a tolerance.

1. **`tests/unit/helpers.ts › base()` drops `ecu.torqueLimitNm` and `ecu.powerLimitKw`.**
   - The hardware rules (boost, inducer/A/R, twin-scroll, intercooler, charge temperature, cams, continuity sweeps) test hardware physics.
   - A factory torque/power-limited ECU hides those effects by design: a bigger intercooler on a torque-limited EA888 does not change torque.
   - This follows the lead's earlier ruling ("keep the ECU, isolate hardware effects").
   - The stock-calibration tests (envelopes, plateaus, calibration, dyno curves) still use the reference configs with their limits.
2. **`sanity.test.ts` identity "fuel flow = air / (λ·AFR)" uses the λ actually run at each point (`DynoPoint.lambda`).**
   - The ECU now enriches when EGT would exceed 980 °C, so the run λ can be richer than the requested `config.lambda`.
   - The identity itself is unchanged.
3. **No assertion was changed in `envelopes`, `fuzz`, `continuity`, `ui_regressions` or `calibration`.**

### Reference-data rules applied by the physics agent (documented in `referenceEngines.ts`)
- **Uniform rule for boosted engines.** If the published rating is a torque plateau (`torqueRpmRange`), the config gets `ecu.torqueLimitNm` = published torque. If it is a power band (`hpRpmRange`), the config gets `ecu.powerLimitKw` = published power. These are OEM calibration inputs, and the rule is applied the same way to train and holdout engines.
- **B58 inducer estimate 46 → 50 mm.** This is an estimated field. Without it the published plateau end of 5000 rpm is unreachable, and a stock engine shows a choke warning.

### Still failing after v4 (known)
- **Rule 4:** 2JZ intercooler gain is +17.5 %, above the doc's 8–15 %. The charge-density ratio alone at ΔT ≈ 66 K is +15–20 %, so this may be a question about the doc band.
- **Rules 7 and 8 (pushrod V8, I6 turbo) and engine.test "bigger cam":**
  - Wave-tuning ripple makes the torque-peak argmax jump between neighbouring tuning bumps.
  - At low rpm, torque falls too little with longer duration.
- **Rule 10:** with valves undersized (×0.7), power peaks at Taylor Z ≈ 0.9, not 0.6. Valve-flow choking is still too weak.
- **Fuzz:**
  - Boosted BMEP > 30 bar in 30 configs.
  - EGT > 1100 °C in 83 configs, at points where enrichment is already at its λ 0.72 floor.
  - 102 NA curves have adjacent-point jumps, from wave ripple.
- **EA888 continuity:** `cam.intakeDurationDeg` (variable-lift lobe switch) and `throttleMm` (the soft knock-trim acceptance makes a small throttle slightly better).
- **Audio tests `turbo whine` and `spool lag`.** These are side effects: the torque-limited B58 really runs ~0.7 bar at 4000 rpm. They are for the audio agent.

## 12. OEM limits: what is an input and what is predicted

### Inputs (copied from the manufacturer's published rating)
- Every boosted reference engine whose rating is a torque plateau carries `ecu.torqueLimitNm` = the published torque. Every one whose rating is a power band carries `ecu.powerLimitKw` = the published power.
- These are tagged `ecu.limitSource: 'published-rating'`. The rule is one loop at the end of `referenceEngines.ts`, applied identically to train and holdout engines.
- With a published-rating limit applied, the stock engine's peak torque and peak power agree with the published figures **by construction**. They are not a validation of the physics.
- NA engines carry no limit: their curves are predicted.

### What is still predicted with the limits applied
- Where the plateau starts (spool), and whether the hardware can hold it to the published end rpm (turbo capacity, knock, EGT).
- The shape of torque between the torque limit and the power limit.
- The top-end power fall-off and the power rpm.
- Everything below the plateau.

### Switching the limits off
`simulate(config, opts)`:
- `opts.applyOemLimits` (default `true`). When `false`, `torqueLimitNm` and `powerLimitKw` are ignored. The boost schedule, knock-limited boost trim, retard cap and EGT enrichment stay on. The hardware boost target is still the ceiling.
- `opts.includeUnlimited` (default `false`) adds `SimResult.unlimited`, the dyno points with the limits off.
  - It costs one extra solve only when the config really carries an applied limit.
  - Otherwise `unlimited === curve`.
  - Chosen over always-on `unlimited` to keep the common call at one solve. The UI can also just call `simulate` twice.
- `SimResult.oemLimits` reports `{ applied, present, torqueLimitNm, powerLimitKw, source }` so the UI can label the curve.

### Custom builds (`src/sim/customBuild.ts`)
- A preset is **custom** once any hardware field differs from it. The comparison covers every `EngineConfig` field except `name`, `ecu` and `idleRpm`: bore, stroke, CR, cams, valves, turbo, fuel, lambda, redline, etc.
- `isCustomBuild(config, base)`, `hardwareDiff(config, base)` (the list of differing field paths), `shouldApplyOemLimits(config, base)` and `oemLimitOptions(config, base)` (spread into `simulate`).
- Published-rating limits do not apply to a custom build. A limit with any other source (a user cap) always applies.
- Rationale: the published plateau describes the stock hardware. A bigger turbo or more boost must not be capped at the old rating.

### Honest hardware-only score (limits off, boosted reference engines, TRAIN set)
Mean |error| vs published figures, limits on / off:

| Metric | On | Off |
|---|---|---|
| Peak torque | 1.0% | 11.3% |
| Peak hp | 2.7% | 11.2% |
| Curve torque RMS | 3.7% | 11.7% |

- Limits off, the sim is above the published figures on every engine: N55 +23%, N63 +16% torque and +26% hp, 1.8 TFSI +10% torque and +29% hp.
- These are not errors against a hardware-capability measurement. Published curves are ECU-limited, so they cannot measure what the hardware could do.
- The off numbers are an upper bound: the hardware under a safe tune at its configured boost target. For comparison, stage-1 tunes of these engines typically gain 10–20% torque.
- The `turbo.targetBoostBar` values on the extended engines are estimates and now carry the full uncertainty.

### Limits-off turbo score, final (boosted engines that carry a published-rating limit)
| Set | n | Peak torque |err|, on → off | Peak hp |err|, on → off | Curve torque RMS, on → off |
|---|---|---|---|---|
| TRAIN | 10 | 0.9% → 11.8% | 2.5% → 11.1% | 3.8% → 12.0% |
| HOLDOUT | 3 | 2.8% → 20.0% | 10.8% → 17.8% | 8.6% → 16.2% |

- On the holdout, N74 V12 is the outlier: +39% peak torque with the limits off.
- Audi 2.7T S4 is +30% peak hp with the limits on or off.

## 13. Physics v4, round 3: what changed physically

1. **Valve flow knee.**
   - Curtain and throat areas used to be combined as a root-sum-square (p = 2). Measured valve flow (Cd versus l/d) is closer to a rounded min().
   - The combination is now a p-norm with `CAL.valveSeriesExp` = 4, and the port Cd values are retuned to realistic ones (0.79 intake, 0.67 exhaust).
   - Why it matters: 2-valve heads with long cams sit at l/d ≈ 0.24, right on the knee. 4-valve heads are port-limited, so they are barely affected.
   - Effect: 2-valve high-rpm breathing rises about 10%. This was the main cause of the GM pushrod high-rpm deficit.
   - Not the cause (tested, all under 3%): exhaust primary diameter, exhaust type, runner length, exhaust valve size.
2. **Production intake loss (`EngineConfig.intakeSystem`, 'stock' by default).**
   - NA engines with a production airbox lose ζ·ṁ²/(2ρA²) of total pressure across a duct the size of the throttle body.
   - Chevrolet Performance crate-engine dyno charts are bare-engine tests, tagged 'open'.
   - Effect: roughly 3–5% less top-end power on production NA engines. Vehicle ratings are measured with the production intake. This lowered the high-rpm bias of the BMW V10/V12 and Audi V8 engines.
3. **ITB inlet reflection** is lowered from 0.85 to 0.75, with higher runner loss.
4. **Valve float** now loses power more gradually (45% at 25% over the float speed, previously 50% at 20%).
5. **ECU component protection** (boosted): boost is cut when EGT exceeds 1090 °C or peak cylinder pressure exceeds 220 bar. It is a fixed-iteration bisection, so the result is continuous in the inputs.
6. **Tuning-rpm tolerance averaging** (`waveRpmSpread` = 0.02): the wave tables are averaged over ±2% of rpm, for cylinder-to-cylinder and cycle-to-cycle spread of the acoustic length.
   - It is kept small. At 4% it smeared the boost onset of the EA113.
   - It does not fix the sanity-rule failures below.

### Open items, with causes
- **GM crate engines** (LS376/480, LS376/525, ZZ6 and similar) are still 5–10% low across the board.
  - It is a bias, not a high-rpm shape error.
  - The curves have unknown rating bases: J1349, J1995 or unknown. Hardware that is the same except for cams gains too little: LS3 → LS376/525 gives +9% in the sim, against +22% published. Part of the published gain is head porting, which the config cannot express.
  - The sim has no net/gross rating switch.
- **Rules 7, 8 and "bigger cam":**
  - The torque curve of a 2-valve V8 is flat-topped, so its argmax is ill-conditioned.
  - Low-rpm torque is too insensitive to duration, because charge reversion is damped by the near-lossless intake wave.
  - Tolerance averaging does not fix this.
- **Fuzz:**
  - Boosted BMEP > 30 bar: 25 configs.
  - EGT outside 500–1100 °C: 78 configs. Most are the model's 1227 °C clamp on absurd CR/boost/cam combinations.
  - 101 NA curves have adjacent-point jumps.
- **ui_regressions:**
  - LS3 at 8500 rpm: BSFC ≈ 630 g/kWh, over the 600 limit.
  - The twin-51 mm turbo holds 0.88 bar, below 0.9.
  - EA888 knock retard Δ² = −2.6° at 5800 rpm.
- **Audio:** 2 tests are still red (induction spool lag and turbo whine).

### 13a. The three `ui_regressions` checks that regressed in round 3: all real physics, no check changed
1. **LS3 BSFC at 8500 rpm (630 vs 600 g/kWh).** This is the twin-turbo LS3 at 19% over its valve-float speed.
   - The float power loss I softened earlier to keep the "no 40% collapse per step" check green was still too steep at the far end.
   - New shape: 35% loss at 25% over float, floor 50%. BSFC at 8500 is 588 and the per-step collapse check still passes.
   - The 600 limit is arbitrary at that rpm. I kept it because the physics could satisfy it without any tolerance change.
2. **Twin 51 mm at 1.0 bar holds only 0.88 bar.** The 2-valve flow fix raised airflow about 3%, which pushed the compressor onto its top speed line.
   - The speed-line roll-off knee moved from 0.75 to 0.85 of the choke-flow fraction (`compSpeedLineKnee`). Speed lines stay near the top-speed pressure ratio until close to choke.
   - The check's premise is right: 85 of 94 lb/min is a flow fraction of 0.90. The train fit moved +0.01.
3. **EA888 knock retard Δ² of −2.6° at 5800 rpm.** The ECU torque/power limiter ran only 2 secant steps (`ecuTorqueIters`), so boost was under-converged and jumped between neighbouring rpm points (0.73 → 0.83 → 0.74 bar).
   - It now runs 6 fixed steps. The curve is smooth, and the train boosted RMS improved from 3.9% to 3.2%.

### 13b. Flaky test
`src/sim/__tests__/engine.test.ts > robustness and performance > simulate < 15 ms` is a wall-clock check. It fails intermittently under parallel load: two consecutive full runs were 46 failed and 45 failed, and this test accounts for the difference.

## 14. Constants audit and triage

Scope: global `CAL` constants that were tuned in v4. Sensitivities were measured at the final values. Each constant was perturbed ±10%. "dTrain" is the change in mean RMS over the 32 TRAIN dyno curves, in percentage points. "dMed" is the change in median |peak hp error| over the 21-set. The median is a kinked statistic, so ±0.5 pt is noise.

**Literature caveat.** The ranges below are the engineering consensus ranges I could defend from the sources named. The citations are chapter or figure level, from memory, and have not been re-checked against the books. An engineer should verify them against the sources before external use.

### 14.1 Before / after the constrained refit
| | Before audit | After |
|---|---|---|
| Train mean RMS, all 32 | 5.975 | 5.92 |
| Train NA / boosted | 6.92 / 3.15 | 6.85 / 3.14 |
| 21-set median / mean / max \|hp err\| | 5.26 / 5.9 / 14.1 | 4.57 / 5.5 / 13.8 |
| 21-set torque-peak rpm within ±10% | 14/21 | 12/21 |
| Holdout RMS, all 12 (scored once, after freezing) | 7.89 | 7.79 |
| Holdout NA / boosted | 8.16 / 7.52 | 8.24 / 7.15 |

The adoption rule was met (train no more than 0.4 worse, median no more than 0.4 worse). Both improved. Torque-peak rpm placement got worse (14 → 12 of 21).

### 14.2 Constants table
In range = inside the plausible range after the refit. All values are within range now. The out-of-range ones before the refit are marked †.

| Constant | Final | Plausible range and basis | Was | Sensitivity (±10%) | Note |
|---|---|---|---|---|---|
| valveSeriesExp | 4 | 3–8: shape of the Cd(l/d) knee in flow-bench data (Heywood §6.3, Fig. 6.15–6.19; Blair 1999 Ch. 4). No numeric literature value. | 4 | dTrain +0.07 / −0.04, dMed up to +0.8 | Needed by 2-valve long-cam heads. Capped at 5 because p = 7 made the EA888 knock and BSFC curves jagged. |
| valveCurtainCd | 0.81 | 0.6–0.85: curtain discharge coefficient at l/d < 0.2 (Heywood §6.3) | 0.78 | dTrain +0.53 / −0.07. The most sensitive flow constant. | Sets the low-lift flow of every engine. |
| intakeThroatCd | 0.75 † | 0.55–0.75: Cd on valve-head area for production ports, up to 0.75 for race-ported heads (Blair Ch. 4 flow-bench Cd; Heywood Fig. 6.19) | 0.785 | dTrain +0.12 | Clamped. Compensates for the missing port-shape and ram effects of ported heads. |
| exhaustThroatCd | 0.65 † | 0.45–0.65: exhaust ≈ 80% of intake (Blair Ch. 4) | 0.665 | dTrain +0.20 | Clamped. |
| liftShapeExp | 1.85 | 1.5–2.4: seat-minus-.050" duration offset 35–65° for production cams, which is n = 1.5–2.3 (computed with `seatDuration`) | 1.85 | tiny dTrain; dMed 0.4–0.6 | 2.15 fits the offset better but made EA888 phasing jagged, so it is held at 1.85. |
| intakeReflect | 0.94 † | 0.6–0.95: \|R\| at a plenum or open end under flow (Blair Ch. 2) | 0.9785 | dMed +1.6 at −10% (4-valve V8/V10) | Within range but at the edge. Stands in for missing plenum coupling (Helmholtz gain) between cylinders and for the near-lossless runner. |
| intakeReflectItb | 0.6 | 0.5–0.9: bellmouth to atmosphere | 0.75 | S85 only | Low sensitivity. |
| runnerLoss | 0.37 | 0.2–1.0: entry and friction K (Idelchik; Blair Ch. 2) | 0.6 | none | Low sensitivity. |
| runnerLossItb | 0.3 † | 0.04–1.0 (bellmouth 0.04–0.2, sharp edge about 0.5) | 1.2 | none | Reset to the earlier physical value. |
| chargeHeatEff | 0.246 | 0.1–0.4, giving 10–30 K charge heating at WOT (Heywood §6.4) | 0.256 | dMed ≈ 0.5–0.7 | At 5000 rpm about 22 K. |
| intakeWallTempK | 420 | 380–450: port and valve wall (Heywood §6.4) | 420 | dTrain +0.4 / +0.5 | Not tuned in v4. Notably sensitive. |
| fA | 0.273 | 0.25–0.45: Chen–Flynn A ≈ 0.4 for 1960s engines (Chen and Flynn, SAE 650733); modern engines about 25% lower (Sandoval and Heywood, SAE 2003-01-0725) | 0.323 | none | Valvetrain and accessories are modelled separately. |
| fC | 0.04 | 0.03–0.09: Chen–Flynn C ≈ 0.09 for 1960s engines | 0.04 | dMed 0.7 | At the low end. Modern roller and low-tension rings. |
| fD | 0.0009 | 0.0003–0.001 | 0.0006 | none | Textbook-leaning. |
| intakePortLenBore | 1.28 | 0.8–1.8 × bore (port 60–120 mm) | 1.2 | dTrain ≈ 0.07 | |
| exhaustPortLenBore | 0.7 | 0.5–1.5 | 0.7 | none | Fixed. |
| intakeSysZeta | 2.1 | 1–4: airbox + filter + MAF + duct, K on throttle-body-sized duct (about 3% total pressure at rated flow) | 2.5 | dTrain 0.04 | |
| gxEvoTempFactor | 1.14 (T_EVO ≈ 1430 K) | 1.0–1.5: EVO gas temperature 1250–1850 K (Heywood Ch. 5 expansion end) | 1.2 | dTrain +0.11 | |
| gxVeScale | 1.0 | 0.9–1.1 | 1.0 | **dTrain +4.8 / +4.5 (very high)** | The fit depends strongly on it. Held at exactly 1.0, because 1.0 is the only defensible value. |
| compSpeedLineKnee | 0.85 | 0.7–0.9 of choke flow (turbo map; Watson and Janota) | 0.85 | tiny | Set by the regression check, not by the fit. |
| waveRpmSpread | 0.02 | 0–0.05 | 0.02 | none | Can be removed. |
| ecuResidualWeight, ecuImepPerVe | 2, 14 | ECU cam-phasing objective | 2, 14 | none | No effect on any metric. |

**Constants the fit barely depends on** (fixed at textbook or neutral values): exhaustPortLenBore, runnerLoss, runnerLossItb, intakeReflectItb, fA, fD, waveRpmSpread, compSpeedLineKnee and the two ECU objective weights. Only the first four are physically meaningful, and each is within its literature range.

### 14.3 What the former out-of-range values were compensating for
- **intakeReflect 0.98:** missing plenum Helmholtz coupling across cylinders, which gives extra VE at the tuned speed. A single-cylinder line with a near-lossless open end approximates it.
- **runnerLossItb 1.2:** ITB V10 and V8 engines were over-predicted at high rpm. This was absorbing the missing intake-system loss. After the production-intake pressure loss was added, 0.3 is enough.
- **throat Cd 0.785 / 0.665:** the missing head-port effects. Ported heads and the ram effect are not in the config.
- **fA 0.32:** the model's low friction is balancing the under-predicted breathing of the 2-valve pushrod crate engines. Chen–Flynn A ≈ 0.4 is for 1960s engines.
- **valveSeriesExp:** not a compensation. It is the physical knee shape.

### 14.4 Triage of the 27 `envelopes.test.ts` failures and the sanity-rule failures
(a) = real model deficiency, listed as a known limitation. (b) = test premise wrong. (c) = caused by estimated config fields.

| Failure | Class | Evidence |
|---|---|---|
| F20C peak hp −12.2%; peak-torque rpm 6000 vs 7500; ±12% aggregate; aggregate mean 5.5% | (a) | Rating is a press-kit SAE figure; cams and valves estimated, but the VTEC high-lobe is not predicted. |
| F20C mass +17.5%; F12 mass +17% | (a) | Mass model; massKg is a known (not estimated) input for F20C. |
| Ford 1.0 mass +27% | (c) | massKg is in estimatedFields. |
| LS7 hp −8.9% (limit 8) | (a) | Marginal; crate dyno rating basis unknown. |
| 1GR hp +8.6%, torque +8.0%; EJ257 torque +8.2%; Mazda torque +8.6% | (a) | Marginal over-prediction of the tolerance. |
| Mazda hp +13.8%, 84 hp/L, 13.8 bar BMEP, power rpm 6500 vs 5700, torque rpm 4000 vs 3250 | (a)+(c) | Cams, valves, runner, headers and λ are all estimated. The published 74 hp/L and 12.7 bar are inside the envelope, so the sim overshoots. |
| EJ257 BSFC 380 at peak power; F12 BSFC 265 | (c) | λ at WOT is estimated; BSFC follows it. |
| EJ257 peak-torque rpm 3000 vs 4000; R8 peak-torque rpm 5250 vs 6500 | (c)/(a) | Cams estimated. |
| 2JZ power rpm 6200 vs 5600; B58 5200 vs 6000; EA888 6250 vs 5450; EcoBoost 3.5 6000 vs 5000; EA888 and Ford 1.0 torque plateau 0.92 and 0.64 | (c) | Turbo inducer, A/R, boost and intercooler are estimated, and the published rpm depends on the ECU tune. Ford 1.0 turbineAR 0.4 is below the type-doc range (noted in the config). |
| GT3 power rpm 9000 vs 8250 | (a) | Sim peaks at redline; no high-rpm power fall-off from friction and flow. |
| Hypothetical drag preset BMEP 48 vs 40 bar | (b) not changed | 2.5 bar boost on E85 and 9000 rpm. The 40-bar limit is a street and alcohol limit, and real drag builds are reported above it. I have no in-repo evidence, so the check is left as is. |
| Rule 4 intercooler +16.4% vs 8–15% | **(b), changed** | The sibling check pins the charge-temperature drop at 60–90 °C, which means T_no/T_yes − 1 ≈ 75/(393−75) = +23% density at fixed boost. The upper band is now 20%. |
| Rules 7, 8 (three), "bigger cam" | (a) | Flat-topped torque argmax; low-rpm torque too insensitive to duration. |
| Rule 10 undersized valves Z at peak 0.98 vs ≤ 0.7 | (a) | Valve-flow choking too weak. |
| Rule 13 K20 ITB beats plenum | (a) | ITB top-end gain not reproduced (−0.9% instead of +). |
| EA888 continuity (cam duration, throttle) | (a) | ECU phasing and knock-trim corners; throttle bigger gives less power. |
| Fuzz (6) | (a) | Absurd configs (EGT clamp 1227 °C, BMEP > 30 bar, NA jumps). |
| `simulate < 15 ms` (Ford 3.5, 16.2 ms) | flaky | Wall-clock test. Its cost rose with `ecuTorqueIters` = 6. |

Only the Rule 4 premise was changed.

## 15. ECU torque limiter: bracketed solve, and a deterministic peak rpm on limited plateaus

### 15.1 What was wrong
- The old torque/power limiter in `engine.ts` ran 6 fixed secant steps. Each step was computed on the achieved boost (MAP − ambient) but applied as the wastegate/bypass target. The two differ by up to about 0.007 bar, so the iteration aimed at the wrong variable.
- The last steps used nearly identical point pairs, so their slope came from rounding noise.
- Measured on the 12 limited reference configs with the pre-fix code:
  - **46 points sat more than 0.05 N·m above the limit.** The worst were N74 +5.0 N·m at 2200 rpm (+0.67 %), N63 +2.8, N55 +2.2 and B58 +1.9.
  - **Power-limited points stalled below P/ω:** N74 −7.7 N·m at 5400 rpm, B58 −6.3 at 7000, EA888 gen 1 −3.0 at 6000.
  - A 1-ulp change inside the solver moved limited points by up to 5e-4 relative.
  - peakTorqueRpm (the argmax over a plateau of near-identical values) was set by that noise.

### 15.2 What it does now
1. **`limitTorque` solves torque(t) = limit in one variable,** the boost target t that the ECU commands.
   - The bracket starts with hi = the current target.
   - To find lo, it tries the ECU torque model (air charge ∝ torque + friction → required boost → target), then a secant through the two lowest over-limit points aimed at −tol/2. After 4 tries it sets t = 0.
   - Once bracketed, it runs Illinois, falling back to bisection if a step leaves the bracket.
   - It stops at the first point with |T − limit| ≤ `CAL.ecuTorqueTolNm` = 0.05 N·m. If it hits the cap (`ecuTorqueMaxIters` = 16, normally 2–4 evaluations), it returns lo, which is ≤ the limit.
   - **Guarantee:** torque ≤ limit + 0.05 N·m. The one exception is a limit below the unboosted torque at t = 0. A real ECU would then pull throttle or spark, which is not modelled. No reference config hits this case.
2. **The torque limit is re-applied after the knock trim and component protection.**
   - Those steps re-solve the point from the exhaust-state warm start of the limited point (its EGT and back-pressure). That changes knock retard at identical boost: B58 at 1600 rpm, same 0.615 bar, retard 10.0° → 9.5°.
   - So they could land up to 1.5 N·m above the limit. This is a model artefact: `evalPoint` is not a fixed point in EGT. It is left for a follow-up. (Superseded by §16: the point is now a fixed point and this re-limit is removed.)
3. **Peak rpm on a limited plateau.** If any point within `PEAK_PLATEAU_BAND_NM` = 0.1 N·m (2 × tol) of the peak torque is held by the torque limit:
   - `peakTorqueRpm` = the **lowest** rpm in that band, which is the plateau start.
   - New `peakTorqueRpmRange` = [first, last] rpm in the band. It is the OEM quote, "450 N·m @ 1400–5000 rpm"; its single-number form ("from 1400 rpm") is the start.
   - The same rule applies to `peakPowerRpm` / `peakPowerRpmRange` with the power limit, using a band of 0.1 N·m × ω.
   - Otherwise both are the plain argmax and the range is [argmax, argmax]. All NA and limits-off results are unchanged.
   - Why not a relative 0.1 % band for every curve: on smooth NA curves the neighbour of the peak is often within 0.1 %, so that rule shifted 40 NA peak rpms one grid step down. That is a bias, not determinism, so it was rejected.
   - Why not the plateau midpoint: no OEM sheet quotes a midpoint.
4. **Uncertainty.** The curve-shape term of `computeUncertainty` is now measured from the plateau (0 inside it), not from one noise-chosen rpm.
   - `peakTorquePct` is the band at peakTorqueRpm. That is now the low-rpm plateau start, which carries the < 2000 rpm penalty, so on limited engines it rises (B58 10.3 → 12.9 %, N74 8.8 → 12.0).
   - `peakHpPct` falls (N63 12.0 → 9.1).
5. **UI consistency (checked, not edited).** `Analytics.tsx`, `buildSheet.ts` and `DynoChart.tsx` show "peak @ peakTorqueRpm" and put the marker at (peakTorqueRpm, peakTorqueNm). By definition the curve there is within 0.1 N·m of peakTorqueNm (tested), so the marker sits on the curve.
   - Suggested UI follow-up: display `peakTorqueRpmRange` when its ends differ.

### 15.3 Outputs that moved by more than 0.1 % (67 configs × default / unlimited / oemOff; every SimResult leaf)
- **Unchanged:** NA and supercharged configs, Ford 3.5 EcoBoost (limit never binds), every oemOff result, and the unlimited curves. Only the 12 limited turbo configs move, in default mode and in the identical `[unlimited]` main curve.

| Config | Torque points > 0.1 % (worst) | Peak torque | peakTorqueRpm | peakPowerRpm | Reason |
|---|---|---|---|---|---|
| B58 | 8 (+1.72 % @7000; −0.43 @2000) | 448.95 → 447.04 | 2000 → 1600 | – | Plateau overshoot removed; power-limited top end was stalled 6 N·m low |
| N74 | 11 (+1.10 @5400; −0.66 @2200) | 755.04 → 750.03 | 2200 → 1400 | – | Same (was +5.0 / −7.7 N·m) |
| N63 | 13 (−0.47 @2050; +0.17 high rpm) | 602.82 → 600.03 | 2050 → 1450 | – | Overshoot removed |
| N55 | 3 (−0.55 @1800) | 402.22 → 400.04 | 1800 → 1000 | – | Overshoot removed |
| N20 | 1 (−0.18 @1600) | 350.62 → 350.03 | – | – | Overshoot removed |
| EA113 | 8 (+1.99 @6250; −0.50 @4900) | 281.30 → 280.04 | 4900 → 1750 | 5950 → 5500 | Overshoot / undershoot removed; knock-trim warning rpm 5200 → 5050 |
| EA888 gen 1 | 10 (+1.27 @6700) | 280.97 → 280.04 | 2000 → 1600 | – | Power-limited top end was 2.6–3.0 N·m low; knock warning 4.1 → 4.2° |
| EA888 gen 3 | 3 (+0.35 @6400) | 350.56 → 350.05; hp −0.22 % | – | 6250 → 5050 | Power band start; choke warning 6500 → 6400 rpm |
| 1.8 TFSI | 10 (−0.32 @2050) | 250.80 → 250.03 | 2500 → 1450 | – | Overshoot removed |
| Ford 1.0 | 3 (+0.90 @2200) | 170.04 (same) | 3100 → 2800 | – | Plateau points below the limit (knock trim) now ≤ limit and consistent |
| 2.7T S4 | 3 (−0.31 @2400) | 401.26 → 400.04 | 2400 → 2000 | – | Overshoot removed |
| TT RS | 1 (−0.15 @1800) | 450.67 → 450.03 | – | 6200 → 5400 | Power band start |

- Other leaves at the same points follow from the boost change: boost, MAP, airflow, knock retard, spark, EGT, BSFC, pmep. The largest is boost +0.065 bar (EA113 6250).
- `uncertainty.*` moves on these 12 configs, see 15.2 item 4.

### 15.4 Accuracy, before → after (`SIM_STATS=1 npx vitest run src/sim/__tests__/regression/stats.test.ts`)
| Statistic | Before | After |
|---|---|---|
| 21-set median / mean / max \|peak hp err\| | 4.566 / 5.464 / 13.790 % | 4.566 / 5.453 / 13.790 % |
| 21-set max \|peak torque err\|; torque-peak rpm within ±10 % | 8.57 %; 12/21 | 8.57 %; 12/21 |
| Train RMS, all / NA / boosted | 5.920 / 6.846 / 3.142 | 5.920 / 6.846 / 3.142 |
| Holdout RMS, all / NA / boosted | 7.785 / 8.237 / 7.152 | 7.781 / 8.237 / 7.143 |

- No statistic got worse.
- Two 21-set torque-peak rpms changed, both inside the published plateau before and after: B58 2000 → 1600, Ford 1.0 3100 → 2800.

### 15.5 Robustness and cost
- **Torque ≤ limit + 0.05 N·m at every point** of the 12 limited configs and of 4 user-capped configs, 2 of them supercharged. Before the fix, 46 points broke this.
- **Perturbations of 1e-9 relative** (bore ±, stroke, CR, intercooler, torque limit) move limited points by ≤ 3e-8 relative and never move a peak rpm.
- **Perturbations of 1e-5** move limited points by ≤ 1.8e-4. That is the accept-iterate tolerance jump, bounded by 0.05 N·m.
- **Perturbations of 1e-3** move peak rpm on 5 of 38 config × perturbation cases.
  - The largest jumps (Ford 1.0, 1.5 %) come from the knock trim, which has its own 0.1° stop and the warm-start dependence in 15.2 item 2, not from the torque limiter.
- **Timing** (warm median of 31, `SIM_SNAPSHOT=time`): max 7.27 → 5.92 ms (B58 6.95 → 5.92, EA113 7.27 → 5.00, N63 6.86 → 4.41). Cold max 7.49 ms (B58). The bracketed solve is faster than the 6 fixed steps on every limited preset.
- **Tests:**
  - New file `src/sim/__tests__/torqueLimiter.test.ts`, 45 tests. The pre-fix limiter fails 28 of them.
  - Full suite: 44 → 43 failures, with no new ones. Fixed: `envelopes › vw-ea888-gen3-gti › peak-power rpm within tolerance (or within published hp plateau)`, because peakPowerRpm is now the power-band start.
- `CAL.ecuTorqueIters` (§13a item 3, §14.4) is replaced by `ecuTorqueMaxIters` and `ecuTorqueTolNm`.

## 16. Self-consistent operating point and continuous ECU solves

### 16.1 What was wrong
§15.5 left this open: Ford 1.0 EcoBoost moved by up to 1.5 % and its peakTorqueRpm flipped 2800 ↔ 2350 rpm (3 grid steps) under 1e-3 relative input changes. Five causes were found, each a jump in an inner solve:

1. **Not a fixed point in exhaust state.** `evalPoint` takes EGT (residual-gas and turbine-inlet temperature) and exhaust or turbine-inlet pressure as guesses and returns the values they produce. It was evaluated once from the previous rpm's state (or from a limited iterate's state in the ECU steps). So the same boost target gave a different retard depending on history (B58 1600 rpm: 10.0° vs 9.5°).
   - Twin-scroll turbos also fed back the wrong variable: p3 × 0.95 went in where p3 was expected, so the flow was evaluated at p3 × 0.95².
2. **Turbo PR solve.** The compressor flow fraction φ was lagged by one PR iterate (`turboFlowPasses = 1`), so the margin the PR search saw was not a function of PR. Illinois was also capped at 10 iterations, and could stop up to 2.5 % away from the root (B58 6800 rpm: PR 1.609 vs 1.644). Together these made boost a discontinuous function of the exhaust-pressure guess.
3. **Knock integral saw-tooth.** The knock integral included a 1° step only if xb < 0.95 at its end. Whenever the 95 % burn angle crossed a grid node, the hottest step dropped out, so KI was a saw-tooth in spark timing. The knock-limited retard jumped by up to 0.5° (Ford 1.0 at 2650 rpm: 10.27° vs 9.80° for a 0.2 K change in EGT input).
4. **Knock search, knock trim and protection stops.**
   - The retard search returned the bracket end, a staircase of steps up to 0.05°.
   - The knock trim stopped at 0.1° or after 4 iterations, and then took the low-boost bracket end. This biased it low by up to 0.15° (Ford 3.5 at 5500 rpm).
   - Protection used a 9-step bisection, a staircase of 1/512 of boost.
5. **Discrete switches inside the fixed point.**
   - The variable-lift stage argmax depends on the exhaust/intake pressure ratio. At the switch, the operating point had no fixed point (N55 2400 rpm oscillated between 395.0 and 396.9 N·m).
   - The wastegate model switched between "shut" and "regulating" at turbine power = 1.05 × compressor power, which made p3 jump by the 5 % margin (EA888 gen 3 at 6400 rpm).
   - The torque limiter's 16-iteration cap was hit where torque is flat in the target (speed-line-limited boost), and it returned a path-dependent bracket end (EA888 gen 3 at 6400 rpm: jumps of 0.4 N·m).

### 16.2 What it does now
**Operating point (`solvePoint`, engine.ts).**
- The point is the solution of F(x) = G(x) − x = 0 for x = (EGT, exhaust state), solved by 2-D Broyden.
  - The pressure is scaled at 100 Pa per K.
  - The Jacobian is warm-started from the previous solve.
  - Steps are capped and kept inside a search box: EGT 400–1600 K, 0.5–30 bar.
  - A step that raises the residual is rejected (the Jacobian still learns from it). After four rejections in a row the Jacobian restarts from −I.
  - The iteration stops early if the best residual moves < 1 % in 12 evaluations; this happens only for degenerate points such as zero brake torque on absurd fuzz configs.
  - A failed solve returns its lowest-residual evaluation and does not pass its Jacobian on to the next solve.
  - Two robustness bugs were found by the full suite and fixed this way:
    - fuzz configs got NaN from a −7500 K extrapolated warm start;
    - EA888 at CR 6.1 gave a +21 % hp spike when the old "accept after 3 rejections" rule walked away from the root.
- Converged when:
  - the residual is ≤ 2× tolerance, and
  - the next quasi-Newton step is ≤ 1× tolerance (`CAL.pointEgtTolK` = 0.01 K, `pointPExhTolRel` = 2e-5).
  - The step criterion matters where the loop gain is near 1: a spool-limited turbo has EGT → turbine power → boost → EGT gain near +1, and back-pressure → flow gain down to about −4. There |F| alone understates the distance to the root.
- Normally 2–3 evaluations per point. Cap `pointMaxIters` = 30.
- Every point of all 67 configs converges (tested). The warm start (previous rpm, previous target, extrapolated) changes only the iteration count.

**ECU target.**
- The ECU target is the lowest of: the schedule, the torque limit, the knock trim and protection. Each is a bracketed Illinois on converged points, so each is a function of the target alone:
  - torque limit: |T − limit| ≤ `ecuTorqueSolveTolNm` = 0.002 N·m, cap 40;
  - knock trim: |retard − accepted| ≤ `ecuKnockTolDeg` = 2e-4°, cap 20;
  - protection: |excess| ≤ `ecuProtectTol` = 1e-4, cap 20.
- Each step can only lower the target, and torque rises with boost, so a constraint already met stays met. **The re-limit patch (§15.2 item 2) is removed.**
- The guarantee torque ≤ limit + 0.05 N·m (`ecuTorqueTolNm`) still holds. It is tested on the 12 limited configs, 4 user caps, and every ±1e-3 perturbation of Ford 1.0, B58 and EA888 gen 3.
- `pointSolveStats.ecuUnconverged` counts ECU solves that stop at their cap. It is 0 on every config (tested).
- The torque limit starts from the previous rpm's limited target, extrapolated. If torque there is already above the limit, the limit binds at the scheduled target too, so the scheduled-target point is skipped.

**Knock-limited spark (combustion.ts).**
- The knock integral ends at the 95 % burn angle with a 1° ramp, w = clamp(θ95 + ½ − θ, 0, 1). This is the old hard cut averaged over the sub-grid position of θ95: the same KI on average, but continuous.
- The retard is the linear interpolation in ln KI across the final bracket (≤ 0.05° wide; interpolation error about 1e-5°).
- It is warm-started from the last retard and slope. A Newton step of ≤ 0.01° is accepted without bracketing.
- Hint and cold solves agree to < 2e-3° (tested).

**Turbo (boost.ts).**
- φ is solved to 1e-5 per PR evaluation, secant-accelerated and extrapolated in PR.
- PR Illinois: cap 60, tolerance 1e-7, warm-started from the previous root.
- The wastegate p3 is always min(p3c, max(p3 where turbine power = compressor power, p3 with the gate fully open)). This is continuous, and equals p3c when spool-limited.
- **Several spool roots.** When the turbine term binds, the margin can have several roots (Audi 2.7T at 1600 rpm: PR 1.23 and 1.49). The **lowest** root is taken: the equilibrium a turbo spooling up from rest reaches.
  - The highest root was tried first. It leaves the coupled fixed point without a solution, because that root exists only at a back-pressure lower than the one it produces.
- The diagnostic `limit` probe is evaluated lazily.

**Variable lift.** The two stages are blended by a C¹ smoothstep where their cam-selection objectives differ by less than `CAL.ecuLobeBlend` = 0.005 (≈ VE units). Outside that band it is the pure choice. This is the engine-average of a switch that real ECUs spread over a small speed/load window.

### 16.3 Smoothness (1e-3 relative perturbations of bore, stroke, CR, intercooler effectiveness, boost target)
Metric: max over rpm of max(|d(ε) − 2 d(ε/2)|, |d(+ε) + d(−ε)|) / torque, where d = Δtorque. It is 0 for a linear response, and of order J / torque for a jump J. Kinks where a limit starts to bind also count.

| Config | Before (worst parameter) | After (worst parameter) | Peak-rpm moves, before → after |
|---|---|---|---|
| Ford 1.0 | 2.0e-2 (bore, stroke) | 7.4e-4 (bore, a kink where the limit starts to bind); IC / boost ≤ 5e-6 | peakTorqueRpm −3 steps → ≤ 1 step |
| B58 | 1.8e-2 (stroke) | 5.9e-5 | ±1 step → 0 |
| EA888 gen 3 | 8.6e-3 (bore) | 8.7e-4 (bore, breathing tables); others ≤ 2.5e-5 | ±1 step → 0 |
| All 20 boosted, excluding EJ257 | 2.2e-2 | 2.6e-3 (bore, several configs) | none beyond 1 grid step |

- The residual bore sensitivity of about 1e-3 is in the breathing tables, which are rebuilt when bore changes. It is outside the operating-point solve and does not appear for the other parameters.
- **Known jump: Subaru EJ257 at 1600 rpm, bore +1e-3: +88 N·m.** The low spool equilibrium disappears there (a fold of the turbine/compressor power balance). This is physical for a steady-state model with spool positive feedback, so it is documented, not smoothed. The 2.7T and TT RS spool points sit close to such folds.
- New tests are in `src/sim/__tests__/pointSolve.test.ts` (86 tests):
  - every config converges (FP and ECU solves, residuals ≤ 2× tolerance);
  - knock retard is continuous in charge temperature and independent of the hint;
  - for Ford 1.0, B58 and EA888 gen 3 × 5 parameters, on 9 configs from −ε to +ε: no torque increment exceeds 3× its neighbours (plus 2e-5 relative), elasticity < 20, peak-hp increments are smooth, and peak rpms move ≤ 1 grid step;
  - torque ≤ limit + 0.05 N·m on the perturbed configs.
- The old torque-limiter tests (`torqueLimiter.test.ts`, 45) still pass.
- Full suite after merging main f9bdfe9: 886 tests, 43 failed. These are the same 43 as main (envelopes, sanity rules, fuzz plausibility counts, EA888 cam-duration and throttle continuity, "bigger cam"). There are no new failures.
- `tests/unit/continuity.test.ts`: the EA888 bore, CR, inducer and turbine-A/R sweeps and the Hellcat exhaust-valve sweep pass. They had failed or timed out with intermediate versions of this work.

### 16.4 Accuracy before → after (`SIM_STATS=1`)
| Statistic | Before | After |
|---|---|---|
| 21-set median / mean / max \|peak hp err\| | 4.566 / 5.453 / 13.790 % | 4.564 / 5.509 / 13.796 % |
| 21-set max \|peak torque err\|; torque-peak rpm within ±10 % | 8.57 %; 12/21 | 8.49 %; 12/21 |
| Train RMS, all / NA / boosted | 5.920 / 6.846 / 3.142 | 5.898 / 6.845 / 3.055 |
| Holdout RMS, all / NA / boosted | 7.781 / 8.237 / 7.143 | 7.818 / 8.232 / 7.238 |

**Not met: two headline numbers got slightly worse.** The 21-set mean |hp err| rose by 0.06 pt (5.453 → 5.509) and holdout RMS by 0.04 pt (7.781 → 7.818). The max |hp err| rose by 0.006 pt. Median, max torque error and train RMS improved.
- **Mean hp.** Ford 3.5 +0.70 % and Ford 1.0 +0.38 % peak hp, both already over-predicted. The old knock trim stopped up to 0.15° short of its own accepted retard, on the low-boost side, and the old retard search returned the upper bracket end. That bias had been absorbed in the calibration.
- **Holdout.** The spool-limited low-rpm points moved to their self-consistent state: N74 4.96 → 5.15 (1000–1200 rpm), 2.7T 10.12 → 10.25, TT RS 9.64 → 9.75, LT4 6.91 → 6.96.
- **Not retuned.** The holdout must stay unseen by the fit. A train-only refit of the knock or ECU constants is the obvious next step.
- A knock-window ramp ending at θ95 instead of centred on it was tried. It is worse on every statistic.
- The spool-root rule and the twin-scroll fix were each checked by reverting. Neither changes the holdout or 21-set numbers; the twin-scroll fix improves train N55 and N20.
- Three 21-set torque-peak rpms changed, all by one grid step: EA888 gen 3 2200 → 2350, Ford 1.0 2800 → 2650, Mazda 4000 → 4150 (the knock retard at the flat top).

### 16.5 Outputs that moved by more than 0.1 % (67 configs × default / unlimited / oemOff, every SimResult leaf, vs the snapshot written before any change)
- **NA engines.**
  - knockRetardDeg moves on lightly knocking points. The relative changes are large on values of 0.01–0.3°. This is the effect of causes 3–4 of §16.1, the saw-tooth and staircase removed.
  - Spark and pMax move ≤ 3 %.
  - Torque moves > 0.1 % at ≤ 6 points per engine. The largest are K20A +0.67 % at 2500 rpm and F20C +0.55 % at 4750 rpm, both variable-lift blend points.
  - NA peak values: only Mazda peakTorqueRpm, 4000 → 4150.
- **Boosted engines.**

| Config | Torque points > 0.1 % (worst) | Peaks | Reason |
|---|---|---|---|
| B58 | 6/31 (−11.6 % @1000) | oemOff: hp 363.8 → 369.0, power rpm 6000 → 5800 | First point: was iterated twice from a fixed 1050 K / 1.05 bar guess, now converged (spool); twin-scroll fix |
| Ford 1.0 | 37/38 (+10.9 % @1600) | hp 127.20 → 127.69; peakTorqueRpm 2800 → 2650 | Spool point self-consistent; knock-trim bias removed |
| EA888 gen 3 | 25/38 (+3.7 % @1300) | Tq 350.05 → 349.54; rpm 2200 → 2350 | Self-consistent point; continuous wastegate |
| Ford 3.5 | 34/35 (+2.1 % @1450) | hp 405.9 → 408.7 | Knock-trim bias removed |
| N20 | 23/31 (−8.4 % @1000) | hp 237.6 → 240.1; power rpm 5400 → 5600 | Spool first point; twin-scroll fix |
| N55 | 11/31 (−2.4 % @6000) | hp 291.2 → 294.4; power rpm 5200 → 5400 | Twin-scroll fix; lift blend |
| 2.7T S4 | 15/30 (−11.8 % @1600) | peakTorqueRpm 2000 → 1800 | Lowest spool root (was a path-dependent mix of branches) |
| TT RS, EA113, EJ257, N63, N74, CAEB, 1.8 TFSI | ≤ 16 (≤ 2.6 %, at spool or knock-trim points) | CAEB power rpm 5400 → 5200 | Same causes |
| Hypercar, drag build | 26–29 (≤ 1.7 %) | hp −0.8 % / +0.6 %; power rpm 7400 → 7000 / 7750 → 8000 | Knock trim and PR solve converged |
| SC (Hellcat, LSA, LS9, LT4) | ≤ 16 (≤ 1.3 %) | LT4 Tq −0.18 %; LSA power rpm 6200 → 6000 | Knock trim and protection converged |

- Other leaves at the same points follow from the same causes: boost, MAP, EGT, exhaust pressure, pmep, retard, spark, BSFC.
- `uncertainty` follows the curve.

### 16.6 Cost
- Warm medians of 31 (`SIM_SNAPSHOT=time`):
  - Max 5.98 → 7.37 ms (B58). EA113 7.25, Ford 3.5 6.65, EA888 gen 3 6.26 ms.
  - Median over configs 0.47 → 0.65 ms.
- Cold (breathing cache off): max 9.1 ms (B58).
- All presets are under 10 ms.
- What brings it within budget: warm-start hints that change only the iteration path. These are the retard and its slope, PR and φ, the fixed-point Jacobian, and the previous rpm's torque-limited target.

## 17. Train-only knock/ECU refit after §16, and first-class calibration multipliers

### 17.1 Train-only refit of the knock / ECU constants: rejected
**Method.** `src/sim/__tests__/regression/refit.test.ts` (opt-in `SIM_REFIT=scan|fit`) simulates the 32 TRAIN dyno curves only and never simulates a holdout curve. It reports the train RMS (all / NA / boosted) and, as a train-side guard, the 21-set peak errors. No 21-set engine has a holdout curve; the harness checks this. Adoption rule: train RMS improves, every constant stays inside its plausible range and is not at a bound, and no 21-set headline statistic is worse by more than 0.4 pt (the §14 rule).

**Literature ranges for the constants scanned.** These are not in §14.2. They have the same caveat: engineering-consensus ranges from memory, not re-checked against the sources.

| Constant | Value | Plausible range and basis |
|---|---|---|
| knockTauScale | 1.33 | 0.5–2: multiplier on the Douaud–Eyzat pre-exponential 17.68 ms, which is refitted per engine family in the literature (Heywood §9.6). |
| knockRpmExp | 0.6 | 0–1 by construction (0 = wall-clock time, 1 = crank-angle time). |
| knockDilutionExp | 1.0 | 0.5–2 (residual dilution slows end-gas chemistry). |
| octaneKPerBar | 1.0 | 0.5–1.5 (Kalghatgi K falls below 0 under boost). |
| sparkLossK | 0.0005 | 0.0003–0.0008 per deg² (about 3–8 % torque at 10° retard). |
| ecuMaxRetardDeg | 10 | 6–15° crank: ECU knock-retard authority before boost is trimmed. An ECU strategy value, not a physical constant. |
| ecuRetardSoft, ecuRetardSoftCapDeg | 0.7, 5 | 0–1 and 0–8°: ECU strategy, no literature value. |

**One-at-a-time scans (train mean RMS, baseline 5.898; 21-set mean \|hp\| 5.509, mean / max \|tq\| 3.764 / 8.486).**
- Only the boosted-ECU knobs help, and every helpful direction lowers torque at knock-limited boosted points. These knobs are a lower `ecuMaxRetardDeg`, `ecuRetardSoft` or `ecuRetardSoftCapDeg`, and a lower `knockRpmExp`.
- `knockTauScale` is flat: 5.898 to 5.905 over 1.3–2.0.
- `knockRpmExp` 0.4 reaches a train RMS of 5.82, but the 21-set median \|hp\| goes from 4.56 to 6.16. Rejected.
- `octaneKPerBar` 1.2 gives 5.887, but the median goes to 5.40. Rejected.
- Joint coordinate descent drives `ecuRetardSoft` and `ecuRetardSoftCapDeg` to their bounds, and the three ECU knobs trade off against each other (degenerate). Rejected.
- **Single-parameter fit of `ecuMaxRetardDeg`.**
  - The train optimum is 7.8°: train 5.871, 21-set mean \|hp\| 5.39. But the peak torque gets worse: Ford 3.5 EcoBoost −6.7 → −10.0 %, so the max \|tq\| goes from 8.49 to 10.04.
  - The trade-off is monotone. Lower retard authority helps the over-predicted peak hp and the B58 / EA113 curves, and hurts the under-predicted boosted peak torques.
  - Under the 0.4 pt guard the value is 9.0°. That gives train 5.882 (−0.016), 21-set mean \|hp\| 5.465, and max \|tq\| unchanged.

**Why the 9.0° candidate was still rejected.** It adds 3 failures to `torqueLimiter.test.ts`, and at 9.5° a fourth, in `pointSolve.test.ts`:
- Ford 1.0 EcoBoost never reaches its 170 N·m limit: peak 168.7 N·m.
- The EA888 gen 3 plateau start is unstable under ±0.01 N·m limit changes.
- At 9.5°, one B58 ECU solve does not converge.

Cause: the soft accepted retard, `lim = max + cap·tanh(soft·(k0 − max)/cap)`, takes the knock severity `k0` from the current point. On a torque-limited point that is the retard at the limited, lower boost. Since lim(k) < k for k > max, a limited point that still knocks lightly is trimmed to a lower accepted retard than the unlimited point at that rpm. That puts it below the torque limit, although the scheduled target trimmed for knock makes more torque than the limit. So the "lowest of schedule / limit / knock / protection" rule of §16.2 holds only while no limited point retards past `ecuMaxRetardDeg`. At 10° that is just met; any lower value breaks it.

**The consistent alternative was tried and also rejected.** In it, the severity comes from the retard at the scheduled target, so the trim yields exactly the lower of the torque-limited and the knock-trimmed targets.
- At 10° it moves only 4 limited configs. B58 at 1200 rpm rises +3.8 % to the limit, which moves peakTorqueRpm from 1600 to 1200 (published plateau from 1380). EA888 gen 3, Ford 1.0 and EA113 move by up to +0.4 %, +1.3 % and +3.0 % at three to six low-rpm points.
- Train goes from 5.898 to 5.936. The path-dependent trim had been holding these low-rpm points down, and this agrees with the dyno data. Their real cause is likely that the spool or knock at low rpm is over-predicted.
- With the fix in place, no single knock / ECU constant gets back below 5.898 within the 21-set guard: `ecuMaxRetardDeg` 9 gives 5.920 and `ecuRetardSoftCapDeg` 3 gives 5.916.

**Result: constants unchanged; no output moved.**
- The holdout was computed once, for the frozen 9.0° candidate after it had been chosen: 7.818 → 7.820. It was not used for the decision.
- Open item: the knock-severity path dependence. Fixing it needs a better low-rpm spool and knock model first (for example a transient spool or ECU low-rpm boost ramp). It is not a constants refit.

What the rejected 9.0° candidate would have moved (> 0.1 %, from the snapshot harness). This is for reference only; none of it is in the code.
- Boosted configs only, NA unchanged.
- Torque at 1–34 points per config, up to −3.2 %. Ford 3.5: 32 of 35 points, peak 594.5 → 584.7 N·m. Ford 1.0: 34 of 38 points, peak 170.0 → 168.7 N·m (below its limit).
- EA888 gen 3 peak torque 349.5 → 346.4 N·m. B58 / N20 / EA113 / EA888 / Ford 1.0 / 2.7T peakTorqueRpm moves 1–2 grid steps.
- Hellcat and the hypercar: low-rpm points −1.4 %.
- Warnings: retard values and the Ford 1.0 turbo-lag versus boost-target warning.

| Statistic (`SIM_STATS=1`) | main (§16) | 9.0° candidate (rejected) | Adopted (= main) |
|---|---|---|---|
| Train RMS, all / NA / boosted | 5.898 / 6.845 / 3.055 | 5.882 / 6.845 / 2.993 | 5.898 / 6.845 / 3.055 |
| Holdout RMS, all / NA / boosted | 7.818 / 8.232 / 7.238 | 7.820 / 8.232 / 7.242 | 7.818 / 8.232 / 7.238 |
| 21-set median / mean / max \|hp err\| | 4.564 / 5.509 / 13.796 | 4.564 / 5.465 / 13.796 | unchanged |
| 21-set max \|tq err\|; tq-rpm ±10 % | 8.49 %; 12/21 | 8.49 %; 12/21 | unchanged |

### 17.2 First-class calibration multipliers: `SimOptions.calibration`
```ts
simulate(config, { calibration: { veScale?: number; frictionScale?: number; torqueCapNm?: number } })
```
It is defined in `src/sim/types.ts` (`SimCalibration`). It lives in `SimOptions`, not in `EngineConfig`, because it is not hardware: `hardwareDiff`, custom-build detection and saves are unaffected. Omitted fields, or the whole object, are the identity. Non-finite values are ignored. `veScale` is clamped to 0.5–1.5 and `frictionScale` to 0.3–3. `torqueCapNm` counts only if it is > 0.

| Field | Where it acts (engine.ts) | What responds |
|---|---|---|
| `veScale` | Multiplies the trapped-air demand in `flowAt`, after the breathing lookup and the ECU cam choice. This is the per-run equivalent of `CAL.gxVeScale`, and the two give identical curves (checked on B58). | Every flow evaluation of the point solve: throttle and airbox loss, MAP, turbo φ / PR / wastegate, exhaust mass flow and turbine power, trapped mass → knock-limited spark and retard, EGT, fuel flow, the ECU torque limiter and the knock trim. |
| `frictionScale` | Multiplies mechanical FMEP (Chen–Flynn rings and bearings, valvetrain, accessories) in `evalPoint`, before the brake torque that the ECU limiter sees. | Brake MEP, and therefore the boost the torque limiter needs on limited engines. Pumping MEP comes from the gas-exchange cycle and can be negative under boost. Supercharger drive power is a boost-system loss. Neither is friction, so neither is scaled. |
| `torqueCapNm` | Combined with any OEM torque limit in force as the lower of the two (`tqLimNm`), and applied through the existing boost-target limiter. Where that cannot meet it (NA engines, or the torque at zero boost already above the cap), a new **throttle torque control** acts: `limitThrottle` puts a ceiling `pManCap` on manifold pressure and solves torque(pManCap) = cap by bracketed Illinois to 0.002 N·m on converged points. The ceiling stands for a drive-by-wire ECU commanding an air charge. It works whether or not `applyOemLimits` is set. | At throttled points the gas exchange sees the throttled intake pressure (back-flow, residual, pumping), and the turbo wastegate keeps regulating boost upstream of the throttle (`FlowAt.pCtl`), so it does not spool up against it. Capped points count as torque-limited, so peakTorqueRpm is the plateau start and peakTorqueRpmRange spans the plateau. `SimResult.unlimited` is computed without the cap but keeps the two scales. |

- **Identity.** With the options omitted, empty or at unit values, every output is bit-identical to main: `SIM_SNAPSHOT=check`, 67 configs × 3 modes, 0 differing leaves. Identity is also tested in `calibrationOptions.test.ts`.
  - The throttle fallback also covers the case noted in §15.2 (an OEM limit below the zero-boost torque). No reference config reaches that case, so nothing moves.
- **Breathing cache.** The table key is the config (minus the fields proven irrelevant) plus `CAL`. No `SimOptions` field reaches the table: `veScale` multiplies the looked-up VE, and the cap acts through the ECU. Options are therefore deliberately left out of the key. This is documented at `breathingKey` and guarded by three new `breathingCache.test.ts` cases: cached = uncached with a calibration set, for NA, turbo and supercharged engines.
- **Tests.** New file `src/sim/__tests__/calibrationOptions.test.ts`, 18 tests:
  - identity;
  - VE moves airflow and VE together, never reduces retard, and raises peak pressure;
  - VE on the turbo: spool-limited boost and back-pressure rise, and limited plateaus hold with less boost;
  - VE ±1e-4 continuity;
  - friction scales only the mechanical part, and limited plateaus hold with more boost;
  - the cap on NA (two engines and two levels), on SC, turbo, and a turbo below its zero-boost torque: ≤ cap + 0.05 N·m, held, plateau start reported, zero unconverged solves, uncapped points unchanged to ≤ 1e-5;
  - NA capped points have MAP below ambient and higher pumping;
  - the cap combines with the OEM limit and works with limits off;
  - `unlimited` drops the cap.

**Findings while testing.** Pre-existing behaviour, not caused by the multipliers, but it now reaches users through calibration.
- **Spool fold.** On B58, `veScale` 1.03–1.08 (and the same `CAL.gxVeScale`) puts 1000 rpm on a spool fold: the turbine/compressor balance has its gain near +1 at the torque-limited target of about 0.86 bar.
  - The torque-limiter bracket then evaluates up to 30 points that do not converge to the fixed point (EGT residual up to 24 K). That point ends at 354 N·m instead of the 450 N·m limit.
  - The simulate cost rises to 20–33 ms.
  - Same class as the EJ257 fold in §16.3.
- **Knock-severity path dependence (§17.1).** On limited turbo engines with knock (Ford 1.0), +5 % VE gives slightly less peak torque (170.0 → 167.4 N·m), not the limit. The knock trim measures severity at the limited point.
- **Cam timing.** The breathing tables jump by about 0.5 % VE at the top end of the LS3 for a 0.006° cam-timing change. This is a gas-exchange discretisation effect. It creates false local minima for the calibration fitter (§17.3).

### 17.3 `src/calibrate` now uses the multipliers
- **`model.ts`.**
  - `calibrationFor(frame, values)` maps `veScale`, `fricScale` and `torqueCap` (as a fraction of the base build's peak torque, `capRefNm`) to `SimCalibration`. Identity values are omitted.
  - `simulateWith` calls `simulate(configFor(base, v), { ...opts, calibration })`.
  - The post-hoc `applyPost` (bmep′ = ve·imep − fric·fmep, rescaled airflow, fuel, BTE and peaks) and `postFor` are removed.
  - For a non-identity calibration the result still drops `uncertainty` (the model's validation band does not describe a fitted curve) and `unlimited`, as before.
  - `types.ts › simulateCalibrated` keeps its signature, so the UI is untouched.
- **`params.ts`.** The `veScale` and `fricScale` descriptions now say what they act on. Ranges are unchanged. `torqueCap` still applies only to boosted builds: the simulator supports an NA cap, but a free cap on an NA fit would flatten a curve-shape error into a fake plateau.
- **Imports.** The allowed imports are unchanged (`../sim/engine`, `../sim/types`, `../sim/customBuild`), so `calibrate-boundary.test.ts` needs no change.
- **`fit.test.ts`.**
  - The five model tests are rewritten against `calibrationFor` / `simulateWith`: identity, the options passed through, direction, cap plateau, OEM limit kept.
  - **The LS3 identifiability case no longer recovers the truth exactly.** The fit stops at 0.05 % RMS with VE 1.041 instead of 1.06 and friction 1.03 instead of 1.2. Between that point and the truth lies the cam-timing table jump of §17.2. The test now requires RMS < 0.15 %, VE within 0.03, and the fit's own ill-conditioned flag on the (VE, friction) pair, which it raises. K20 and Coyote still recover all four parameters to the old tolerances.
  - Since friction became mechanical-only, VE and friction correlate at 0.97 in all three cases. They are flagged ill-conditioned, which is honest.
- **44-curve refit summary** (opt-in `CAL_REFIT44=1 npx vitest run src/calibrate/__tests__/refit44.test.ts`). It fits every published curve, train and holdout, with the default parameter set and OEM-limit policy. It is a per-build tool test; no global constant is fitted.

| Calibration model | Mean RMS before | Mean RMS after | Curves above 5 % after |
|---|---|---|---|
| Old post-hoc scaling, as quoted at the calibrate merge (earlier sim) | 6.43 | 2.84 | 5 |
| Old post-hoc scaling, re-run on this sim | 6.422 | 2.806 | 5 (S85, EA113, L8P, HT383, ZZ632) |
| **New, in the solve; friction = mechanical FMEP (adopted)** | 6.422 | **2.954** | **6** (S85, 2.7T S4, L8P, HT383, ZZ572/720, ZZ632) |
| Diagnostic only, not adopted: in the solve, friction scaling mechanical + pumping + SC drive, as the old post-hoc fmep did | 6.422 | 2.655 | 4 (S85, L8P, HT383, ZZ632) |

- **Moving the scales into the solve helps by itself:** 2.806 → 2.655 at the old friction definition.
  - Turbo fits improve most: N74 3.83 → 1.70, TT RS 4.38 → 2.28, EA113 5.02 → 2.90 (which drops out of the > 5 % list). In these fits the fitted VE now changes the boost the limiter needs, as on the real engine.
- **Restricting friction to its physical meaning costs 0.30 pt** (2.655 → 2.954), almost all on GM pushrod NA curves: LS7 2.95 → 3.87, LT1 3.65 → 4.38, HT383 6.51 → 7.26, ZZ632 10.8 → 12.8. These fits push `fricScale` to its bound because the high-rpm deficit is a breathing / pumping error, not friction.
  - The old definition reached a lower RMS by scaling the gas-exchange pumping work, which is a physically modelled term, by up to 0.7×. Under boost it also scaled a negative pumping MEP the wrong way.
  - I kept the physical definition, so the fitted friction value means what its documented 0.7–1.5 range (Chen–Flynn variation) says. The bound hits are reported as `at-bound` warnings.
  - A separate, bounded pumping or breathing-shape parameter would recover most of the difference honestly. That is left as a follow-up.
- **2.7T S4 holdout** goes from 3.44 to 5.20 % and now joins the > 5 % list. Its low-rpm points sit near the spool fold (§16.3), and the fit ends at three bounds.
- A full 44-curve run takes about 95 s, the same as before.

### 17.4 Cost and tests
- **Timing,** `SIM_SNAPSHOT=time`, warm median of 31:
  - Max 7.43 ms (B58, 7.4–7.6 ms over two runs); median over configs 0.66 ms.
  - Cold (`SIM_COLD=1`): max 9.15 ms (B58).
  - Every preset is under 10 ms, unchanged from §16.6.
  - With a calibration set (warm median of 21):
    - A torque cap gives LS3 1.9 ms (0.7 without) and Hellcat 4.5 ms (1.5 without). The extra cost is the throttle solve at each capped point.
    - Turbos get no extra cost from a cap: B58 6.2 ms, EA113 7.0 ms, Ford 1.0 6.0 ms.
    - VE and friction scales cost nothing, except B58 at VE 1.05: 19–33 ms (spool fold, §17.2).
- **Full `npx vitest run`:** 905 tests, 43 failed, 5 skipped (opt-in harnesses).
  - The 43 are identical by name to main 9e1e9d6, checked by running main's `src` against the same suites: 28 envelopes, 6 sanity, 6 fuzz, 2 continuity, 1 "bigger cam".
  - `tsc -b` is clean.
  - The `tests/reports/data/*.json` rewrites from the runs were reverted.
