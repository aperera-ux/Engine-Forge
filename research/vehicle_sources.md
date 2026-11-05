# Vehicle mode: reference cars, sources and validation notes

# ROUND 3: primary-source attempt (2026-11-05)

## What was and was not obtained

Approved route: `curl` with a normal browser User-Agent (no personal data in headers), >= 2 s between requests, raw HTML kept outside the repo.
Outcome, stated plainly:

- caranddriver.com and motortrend.com served a JavaScript "Client Challenge" page (about 3 kB, no content) after the first few requests;
  Wayback Machine first returned a "suspected abusive bot traffic" block, later HTTP 429 when rate was too high for it. I did NOT try to defeat any
  of these (no headless browser, no URL guessing for hidden files; an attempt to guess further C/D spec-PDF URLs was refused by the permission layer and abandoned).
- What worked: Wayback copies of two C/D road-test pages, which link the printed C/D spec/test sheet as a PDF on a public asset host.
  Those sheets (manufacturer specs plus C/D instrumented results in one page) are the only NEW primary data in this round.
- No OEM press-kit pages (ratios, Cd) were retrieved for any car.

Primary-sourced cars (C/D sheet, accessed 2026-11-05; URLs are stored in `sources` in `referenceCars.ts`):

| car | values now primary | notes |
|---|---|---|
| Z06 2006 | 0-60 3.6, 1/4 11.7 @ 125, curb 3147 lb, F/R 50.9/49.1, Cd 0.34 x 22.3 ft2 = 7.6 ft2, gear ratios 2.66/1.78/1.30/1.00/0.74/0.50, final 3.42, tyres F 275/35ZR18 R 325/30ZR19, top 198 (mfr claim, drag limited) | 12 values |
| CTS-V 2009 | 0-60 4.3, 1/4 12.6 @ 116 (was 117), curb 4292 lb (was 4227), F/R 53.4/46.6, wheelbase 113.4 in, Cd 0.36 x 24.6 ft2 = 8.9 ft2, ratios 2.66/1.78/1.30/1.00/0.80/0.63, final 3.73, tyres 255/40ZR19 F, 285/35ZR19 R, top 191 (mfr claim), 60-130 about 11.9 s from the printed time chart, redline 6200 | 12 values |

Corrections this exposed (each earlier value was "recalled" or copied): Z06 ratios were wrong in all gears (2.97/2.07/1.43/1.0/0.71/0.57 -> C/D 2.66/1.78/1.30/1.00/0.74/0.50),
Z06 Cd*A 0.53 -> 0.706 m2, CTS-V ratios 5th/6th (0.74/0.50 were the Z06 values) -> 0.80/0.63, CTS-V Cd*A 0.79 -> 0.83 m2. Still estimated on both: CG height only.
The other 14 cars are unchanged: still recalled, estimated or secondary (see per-car `sources` / `recalled` / `estimated`). Z06 and CTS-V are both TRAIN cars.
CTS-V 5-60 street start 4.6 s and the 4.6 s Edmunds figure are different quantities from the 0-60 4.3 s.

## Split and protocol

Split unchanged (9 train / 4 fresh holdout / 3 seen); no holdout or seen reference value was touched. No AWD car was added: no sourced AWD data could be
obtained, so AWD (STI, secondary data, seen only) remains effectively unvalidated.
Refit on TRAIN only (published curves, eta capped at the physical 0.92): grid optimum mu 1.35, spin 0.17 (loss 0.07955) versus the current mu 1.30, spin 0.14
(loss 0.07999), a 0.5 % loss change: judged noise, globals NOT changed. The unconstrained eta again ran to 0.95 (outside the physical range).

## Round-3 errors, median |error| %, before (round 2 data) -> after (primary data for Z06 and CTS-V, same globals)

| curves | set | 0-60 | 1/4 ET | trap | top speed |
|---|---|---|---|---|---|
| published | train (9) | 7.9 -> 7.9 | 1.8 -> 1.8 | 0.8 -> 0.8 | 2.9 -> 2.0 |
| published | fresh holdout (4) | 2.6 -> 2.6 | 1.0 -> 1.0 | 1.3 -> 1.3 | 0.6 -> 0.6 |
| published | seen (3) | 4.3 -> 4.3 | 1.0 -> 1.0 | 1.1 -> 1.1 | - |
| simulated | train (9) | 8.9 -> 8.4 | 1.5 -> 1.5 | 1.1 -> 1.1 | 2.9 -> 2.9 |
| simulated | fresh holdout (4) | 5.7 -> 5.7 | 2.7 -> 2.7 | 2.2 -> 2.2 | 1.9 -> 1.9 |
| simulated | seen (3) | 7.5 -> 7.5 | 2.1 -> 2.1 | 1.4 -> 1.4 | - |

Per car (published): Z06 0-60 -0.4 -> +2.0 %, top +6.3 -> -1.4 %; CTS-V 0-60 -11.3 -> -9.3 %, ET -4.6 -> -3.8 %, top -3.0 -> -1.5 %. Using the correct ratios and Cd*A,
the top-speed agreement for these two is now a real check rather than luck. The UI (`VALIDATION` in `VehicleSide.tsx`) uses the worse of train and holdout with simulated curves:
0-60 8.4 %, ET 2.7 %, trap 2.2 %, top 2.9 %, worst-car 0-60 18.8 % (S2000, sim).

---

# ROUND 2 (supersedes the Results/Split sections below where they conflict)

## Data provenance: what could and could not be sourced

Primary sources were NOT reachable from this sandbox: WebFetch refuses caranddriver.com, motortrend.com and web.archive.org;
edmunds.com and fastestlaps.com return 403; automobile-catalog.com returns 402; the search tool refuses a caranddriver.com
domain filter. (The Bash shell could reach some of those hosts, but that would bypass the tool restriction, so it was not done.)
Readable: Wikipedia, motorweek.org (no GTI figures), edmunds forum snippets via search, 0-60specs.com via search snippets.
Consequence: the 7 new cars carry values that are (a) read from a page in this session, (b) typed from memory of OEM/magazine data
("recalled"), or (c) engineering estimates. Per-car lists are in `referenceCars.ts` (`sources`, `recalled`, `estimated`).
**Do not quote any measured value externally until it is re-checked against the primary sheet.** Specifically, `recalled`
measured results (Charger Hellcat, 458, Mazda6, GTI Mk5, GT3) may be off by several percent.

Values actually supported by a URL read this session:

| value | URL |
|---|---|
| 8HP45/8HP70 gear ratios (340i, Hellcat family) | https://en.wikipedia.org/wiki/ZF_8HP_transmission |
| 458 curb 1,565 kg (cites C/D), wheelbase 2,650 mm, 7 ratios 3.08-0.69, final 5.14 (uncited there), >325 km/h | https://en.wikipedia.org/wiki/Ferrari_458 |
| Mk7 GTI top speed 246-250 km/h (governed) | https://en.wikipedia.org/wiki/Volkswagen_Golf_Mk7 |
| Mk7 GTI DSG + Performance Pack 0-60 = 6.1 s (Edmunds, via search snippet only) | https://forums.edmunds.com/discussion/comment/5046297 |
| 340i 0-60 4.7-5.1 s, 1/4 13.3-13.6 s @ 104-106 mph, 3,740 lb (aggregator of 3 tests) | https://www.0-60specs.com/bmw/340i-0-60-times |
| engine ratings (Mazda6 184 hp, 9A1 500 hp, Hellcat 707 hp, 458 562 hp) | `src/sim/validation/referenceEngines.ts` source fields (OEM press kits as cited there) |

Round-1 cars keep the secondary URLs listed in the table further below.
Not sourced at all (estimated or recalled): every CG height, Cd*A, weight distribution; Mk7/Mk5 DQ250 ratios and final drive; Mazda6 ratios,
final drive and results; GT3 PDK ratios/final drive/results; Hellcat final drive, mass, results; 458 magazine results.
Also: the engine curves for peak-scaled cars keep the simulator shape.

## Cars (16) and split

| id | layout / transmission | split |
|---|---|---|
| corvette-z06-2006 | RWD / 6MT | train |
| corvette-zr1-2009 | RWD / 6MT | train |
| cadillac-ctsv-2009 | RWD / 6MT | train |
| bmw-m3-e92-2008 | RWD / 6MT | train |
| honda-s2000-2003 | RWD / 6MT | train |
| ford-mustang-gt-2018 | RWD / 6MT | train |
| vw-gti-mk7-dsg-2015 | FWD / 6 DCT | train |
| dodge-charger-hellcat-2015 | RWD / 8 AT | train |
| ferrari-458-italia-2010 | RWD / 7 DCT | train |
| mazda6-25-2014 | FWD / 6 AT | HOLDOUT (fresh) |
| vw-gti-mk5-dsg-2006 | FWD / 6 DCT | HOLDOUT (fresh) |
| bmw-340i-2016 | RWD / 8 AT | HOLDOUT (fresh) |
| porsche-911-gt3-991-2018 | RWD / 7 DCT | HOLDOUT (fresh) |
| chevrolet-camaro-ss-2010 | RWD / 6MT | seen (old holdout) |
| toyota-supra-tt-1993 | RWD / 6MT | seen (old holdout) |
| subaru-wrx-sti-2008 | AWD / 6MT | seen (old holdout) |

16 cars: 9 train, 4 fresh holdout, 3 seen. FWD x3, DCT x4, conventional automatic x3 (Hellcat, Mazda6, 340i), AWD x1 (STI, seen only).
Not added: Acura RSX Type-S (the simulator's K20A is the JDM Type R 217 hp engine, not the US 200 hp), 535i (data too uncertain).

Split protocol. The fresh holdout and the `seen` relabelling were committed (commit "FRESH holdout declared ... before any validation run")
before any error was computed for any new car. `seen` cars are never fitted. Fitting touched only the 9 train cars with published curves.
Holdout printed once, after the fit was frozen. No parameter was changed after seeing the holdout.
Caveat: the holdout reference values are partly recalled (see above), so the holdout agreement says the model is consistent with those
numbers, not that it is validated to that accuracy.

## Slip model (src/vehicle/tire.ts, accelerate.ts)

Pacejka-like longitudinal curve Fx = mu Fz sin(C atan(B kappa)), E = 0, B = 11.7, C = 1.65 (peak at kappa = 0.12; a priori shape, not fitted).
Per step: total traction capacity with longitudinal weight transfer and driven-axle normal load as before (`tractionCap`, per axle for
FWD/RWD/AWD). Demand below the peak -> tyre on the rising branch, slip from the inverse curve (rpm = wheel rpm x (1 + kappa), so slip
lifts engine rpm). Demand above the peak -> wheels spin up, settle at `spinSlipRatio` on the falling branch (force = D(kappa) x peak) and
recover only when demand falls below that sliding force (hysteresis). Launch: clutch/converter holds `launchRpm`, torque ramped,
converter stall multiplication (default 1.8 for automatics, a priori, not per-car; the Hellcat uses 1.9, estimated). Not modelled: tyre
relaxation length, engine-inertia dynamics during clutch slip, load-dependent mu (switch exists, fit chose 0), aero lift.
Fitted on train (grid): mu(max-performance) 1.30 (was 1.36 with a hard cap x 0.9), spinSlipRatio 0.14 (fit sees almost no wheelspin loss:
D(0.14) = 0.99), eta_RWD 0.92 (the unconstrained fit ran to 0.95 at the grid edge; capped at the physical limit).

## Round-2 results (signed bias in table, medians are median |error|)

Published curves, rollout on. Train n = 9 (ET/trap n = 8-9; GTI Mk7 has 0-60 only):

| set | n | 0-60 | 1/4 ET | trap | top speed (drag-limited cars) |
|---|---|---|---|---|---|
| train | 9 | 7.9 % | 1.8 % | 0.8 % | 2.9 % (n=7) |
| FRESH holdout | 4 | 2.6 % | 1.0 % | 1.3 % | 0.6 % (n=2) |
| seen (old holdout) | 3 | 4.3 % | 1.0 % | 1.1 % | - |

Simulated curves (engine-model error included): train 8.9 / 1.5 / 1.1 %; fresh holdout 5.7 / 2.7 / 2.2 % (top 1.9 %); seen 7.5 / 2.1 / 1.4 %.

Per-car 0-60 error (published): Z06 -0.4, ZR1 +4.3, CTS-V -11.3, M3 +3.9, S2000 +17.5, Mustang -7.9, GTI Mk7 -9.1, Hellcat +12.6, 458 -0.4 (train);
Mazda6 -1.3, GTI Mk5 +0.9, 340i -3.8, GT3 +8.4 (holdout); Camaro -12.2, Supra -4.3, STI -3.1 (seen). Targets: ET <= 5 % met everywhere (worst
S2000 +4.0 %); trap <= 3 % met except ZR1 (+3.1 %); 0-60 <= 5 % NOT met on train (7.9 %) - met on the 4-car holdout (2.6 %) but n = 4 against
partly recalled references. 0-60 outliers are all either ones where the reference is suspect (S2000 quick-outlier, CTS-V C/D vs Edmunds 4.3 vs 4.6 s,
Edmunds-only GTI) or launch-technique cars (Hellcat launch control, S2000 clutch dump); the model has no per-car launch tuning by design.
Round-1 (6 train cars) 0-60 median was 7.7 %; not directly comparable (train set changed), ET/trap errors are essentially unchanged.

## Top speed validation

Two kinds: ELECTRONICALLY LIMITED (published value is a governor; the model must report limitedBy 'limiter' and the free speed must exceed it) and
DRAG-LIMITED (published value is power/gear limited; compared by % error). Model output with the governor removed is shown in parentheses.

| car | published | kind | model (free) | result |
|---|---|---|---|---|
| M3 E9x | 155 | limiter | 155 (184) | ok |
| Mustang GT | 155 | limiter | 155 (176) | ok |
| GTI Mk7 | 155 | limiter | 149 (149, power) | MISS: model is power-limited 4 % below the governor; Cd*A estimate (0.70) or the peak-scaled curve is too pessimistic, not tuned |
| Z06 | 198 | drag | 210 (power) | +6.3 % (Cd*A estimate 0.53; C/D quotes 198 as the factory rating) |
| ZR1 | 205 | drag | 211 | +2.9 % |
| CTS-V | 191 | drag | 185 (redline) | -3.0 %, model is gear-limited at redline |
| Hellcat | 204 | drag | 198 | -2.9 % |
| 458 | 202 | drag | 206 (redline) | +2.0 % |
| GTI Mk5 (holdout) | 145 | drag | 145 | -0.3 % |
| GT3 (holdout) | 198 | drag | 196 | -0.8 % |

Published top speeds are manufacturer claims (recalled, except Mk7 and 458 via Wikipedia); not independent measurements. Drag-limited median
error 2.9 % train. All Cd*A values are estimates, so agreement is partly luck.

## Gearing optimiser

With the slip model the final-drive optimum sits inside the +-range for 15 of 18 (train car x objective) cases
(`src/vehicle/__tests__/optimizerInterior.test.ts`; edge cases: ZR1, GTI Mk7 quarter-mile at 0.70x; S2000 quarter-mile at 1.40x).
Caveat: gains of 8-10 % on 0-60 for taller gearing (Z06 x0.76) are plausible mechanically (fewer shifts, 60 mph in 2nd) but the model's launch is
a clutch held at `launchRpm`, not an engine-inertia model, and tall first gears are not penalised for stall/bogging, so treat optimiser output as indicative.

---

## ROUND 1 (historical; the 'holdout' there is now 'seen')

Code: `src/vehicle/`. Data: `src/vehicle/validation/referenceCars.ts`. Reproduce the tables with
`HOLDOUT=1 npx vitest run src/vehicle/__tests__/validationReport.test.ts --silent=false`
(train rows only without `HOLDOUT=1`). Re-fit the global parameters with
`FIT=1 npx vitest run src/vehicle/__tests__/fit.test.ts --silent=false` (train cars, published curves only).

## Read this first: how reliable are the reference numbers?

The primary Car and Driver / Motor Trend / Edmunds test pages could NOT be fetched in this session
(web search returned snippets and secondary reposts only). Measured 0-60 / quarter-mile / trap values were taken
from secondary pages that quote the magazines (forums, aggregators, blog reposts). Gear ratios, final drives, CG
heights, Cd and frontal areas for most cars are RECALLED from published spec sheets or ESTIMATED and are not
re-verified against primary documents. Every one is tagged in `estimated` / `refConfidence`. Before the numbers are
quoted outside the team, each row should be re-checked against the primary test page. Magazine-to-magazine spread
for the same car is typically 5-10 % on 0-60 (see Camaro, CTS-V, STI notes), which is on the order of the 5 % target,
so 0-60 in particular cannot be validated much tighter than that with this reference set.

Rollout: every reference below is a US magazine/Edmunds test with 1-ft rollout deducted (Car and Driver and Edmunds
state this; for the 1993 C/D Supra test it is assumed). The model runs those cars with `rollout: true`. Trap speed is
compared with the model's instantaneous speed at the line (VBOX/GPS style); the 66-ft average is also output.

## Cars

| id | split | measured (0-60 / 1/4 ET @ trap) | source (as retrieved) | confidence |
|---|---|---|---|---|
| corvette-z06-2006 | train | 3.6 / 11.7 @ 125 | C/D Oct 2005, via corvetteblogger.com/2005/09/01/car-driver-z06-road-test/ and forum quotes; curb 3,132 lb (a listing also shows 3,147) | medium |
| corvette-zr1-2009 | train | 3.4 / 11.5 @ 128.3 | C/D instrumented test, corvetteblogger.com/2008/10/09/Car-and-Drivers-Corvette-ZR1-Instrumented-Test-Results/; curb 3,324 lb is a Popular Science figure, not C/D | medium |
| cadillac-ctsv-2009 | train | 4.3 / 12.6 @ 117 | C/D via fastestlaps.com/models/cadillac-cts-v (weight 4,227 lb; another review 4,315). Edmunds manual: 4.6 / 12.5 @ 115.3 | medium |
| bmw-m3-e92-2008 | train | 4.1 / 12.6 @ 113 | C/D short take (sedan) via autospies.com; MotorWeek 4.3 / 12.7 @ 112; mass is the BMW US coupe curb weight, not measured | low |
| honda-s2000-2003 | train | 5.4 / 14.1 / no trap | C/D 2003 via 0-60specs / s2ki quote; other C/D years 5.8-6.8 s (2000-01), so the reference itself is a quick outlier | low |
| ford-mustang-gt-2018 | train | 4.3 / 12.6 @ 115 | C/D via mustang6g.com forum quote (tested weight 3,878 lb; Ford lists 3,705 lb); MT 4.4 / 12.6 | low |
| chevrolet-camaro-ss-2010 | HOLDOUT | 5.1 / 13.1 @ 110.4 | Edmunds full test, manual, traction control off (camaroz28.com repost). C/D quote 4.8 / 13.0 @ 111, MotorWeek 5.0 / 13.3 @ 109 | low |
| toyota-supra-tt-1993 | HOLDOUT | 4.6 / 13.1 @ 109 | C/D Mar 1993 via 0-60specs/supramania citation; curb 3,417 lb (another listing 3,450) | medium |
| subaru-wrx-sti-2008 | HOLDOUT | 5.1 / 13.6 @ 102 | C/D full test via s2ki forum; MT 4.8 / 13.4 @ 100.5; MotorWeek 5.6 / 14.1 @ 100; curb 3,351 lb (Edmunds table) | low |

Cars the task suggested but NOT included, because no trustworthy primary-sourced measured numbers and/or gear ratios were
recoverable: E60 M5 (7-speed SMG ratios not reliably known), RS4 B7, 911 GT3, Civic Type R, Golf GTI (Mk5/Mk7), Hellcat,
E46 M3, Camaro SS LT1, C7 Corvette. The set is therefore 9 cars (6 train, 3 holdout = 33 %), below the 10-15 asked.
All 9 are RWD except one AWD (STI); there is no FWD or automatic/DCT car, so those code paths are NOT validated.

Split: fixed in the source file before any vehicle-model error was computed: holdout = Camaro SS 2010, Supra 1993,
STI 2008. Disclosure: the very first diagnostic run (before any parameter was fitted) printed all 9 rows including the
holdout, and a later run after the fit also showed them. Tuning decisions after that used train rows only
(the report test now hides holdout rows unless `HOLDOUT=1`), but the holdout was not blind in the strict sense.

Engines: published curve = digitised crank-basis dyno curve from `DYNO_CURVES` where one exists (LS7, LS9, LSA, LS3,
S65); otherwise ("peak-scaled": S2000 F20C, Mustang Coyote, Supra 2JZ-GTE, STI EJ257) the simulated curve rescaled so that
its torque peak and power peak match the published ratings (`scaleCurveToPeaks`). Peak-scaled rows therefore still carry the
engine model's curve shape. The LSA/LS9 curves are Chevrolet Performance crate-engine curves (same ratings as the cars).

## Global parameters (`src/vehicle/globals.ts`)

Fitted on the 6 TRAIN cars with published curves (grid search, loss = sum of squared relative errors of 0-60, ET and trap):

| parameter | value | note |
|---|---|---|
| peak mu, max-performance tyre class | 1.36 | other classes keep fixed ratios (0.82 / 0.91 / 1.14) |
| launch traction utilisation | 0.90 | effective launch mu 1.22 |
| etaRWD (crank to contact patch) | 0.92 | at the top of the physical range; see limitations |
| etaFWD / etaAWD | 0.94 / 0.87 | priors (RWD +0.02 / -0.05), not validated |
| tyre load sensitivity | 0 | mechanism implemented; a 4-point sweep did not improve the fit, left off |

A-priori (not fitted): crr = 0.011 + 0.0035 (v/27.8)^2, driver 80 kg, shift time manual/DCT/auto 0.30/0.08/0.25 s, clutch ramp
0.2/0.1/0 s, launch rpm = lowest rpm with 90 % of peak torque (clamped 35-65 % of the limiter), engine inertia 0.05 + 0.04 L kg m^2
(+15 % driveline), 20 kg per wheel assembly at 0.75 r gyration, air 20 C / 101.3 kPa (1.204 kg/m^3), tyre rolling radius = 0.97 x unloaded.

## Results (rollout on, errors = model - measured, signed)

Published curves:

| car | split | 0-60 err | 1/4 ET err | trap err |
|---|---|---|---|---|
| Z06 | train | +5.6 % | -0.3 % | +1.2 % |
| ZR1 | train | +9.1 % | -1.3 % | +4.1 % |
| CTS-V | train | -8.8 % | -4.5 % | +2.5 % |
| M3 E9x | train | +3.6 % | +0.5 % | -1.2 % |
| S2000 (peak-scaled) | train | +15.5 % | +3.2 % | n/a |
| Mustang GT (peak-scaled) | train | -6.6 % | -2.0 % | +1.7 % |
| Camaro SS | holdout | -15.1 % | -4.0 % | +3.4 % |
| Supra (peak-scaled) | holdout | -3.4 % | -0.7 % | -0.8 % |
| STI (peak-scaled) | holdout | -4.0 % | -1.4 % | -0.2 % |

Median |error|: train (n=6) 0-60 7.7 %, ET 1.6 %, trap 1.7 %; holdout (n=3) 0-60 4.0 %, ET 1.4 %, trap 0.8 %; all 9: 6.6 % / 1.4 % / 1.5 %.

Simulated curves (engine-model error included): train 0-60 7.8 %, ET 2.1 %, trap 2.8 %; holdout 6.9 % / 2.6 % / 2.5 %; all 9: 6.9 % / 2.1 % / 2.7 %.

Targets (published curves): ET <= 5 % MET (train and holdout); trap <= 3 % MET; 0-60 <= 5 % NOT MET on train (7.7 %), met on the 3-car
holdout (4.0 %, but n=3 and driven by one -15 % car). 0-60 is dominated by launch behaviour (clutch drop, wheelspin) and by the
5-10 % inter-magazine scatter; the model has no per-car launch tuning by design.
