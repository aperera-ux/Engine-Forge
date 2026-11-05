# Vehicle mode: reference cars, sources and validation notes

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
