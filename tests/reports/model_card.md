# Engine Forge model card (physics v4)

## What the model is
A 0-D cycle-resolved wide-open-throttle engine model. It evaluates one cylinder at each rpm and scales the result to the whole engine.

- **Breathing:** crank-angle integration of one cylinder from EVO to IVC. It has real valve lift profiles and compressible orifice flow. The intake runner and exhaust primary are acoustic delay lines, with shared-manifold pulse interference.
- **Combustion:** Wiebe burn duration, an indicated-efficiency correlation and a Douaud–Eyzat knock integral for spark retard.
- **Losses:** Chen–Flynn friction plus valvetrain and accessory terms. Pumping work comes from the gas-exchange cycle.
- **Forced induction:** compressor and turbine maps, wastegate, intercooler, turbocharger bearing friction, and supercharger. At low rpm the turbo's spool equilibrium is chosen on the coupled engine–turbo system: it is the lowest root of the gate-shut turbine/compressor balance, which is where a turbo spooling up from rest stops (§18.1).
- **Operating point:** every rpm point is a converged fixed point in exhaust state (EGT and exhaust or turbine-inlet pressure), solved by 2-D Broyden. Results do not depend on the previous rpm or on the solver path beyond about 1e-5 relative (`physics_audit.md` §16).
- **ECU layer:** the boost target is the lowest of four, each solved on converged points:
  - the schedule;
  - torque and power management: a bracketed solve on the target, torque ≤ limit + 0.05 N·m; on a limited plateau the peak rpm is the plateau start (§15);
  - a knock-limited boost trim, continuous in its inputs, whose knock severity is measured at the scheduled target, so a torque limit only clips the curve (§18.2);
  - component protection, which cuts boost above 1090 °C EGT or 220 bar peak cylinder pressure.

  EGT enrichment is applied as well.
- **Output:** a dyno curve plus `SimResult.uncertainty`, a ±% band per point.

## What is an input and what is a prediction
- **Inputs (hardware):** geometry, cams, valves, runners, headers, turbo sizing, CR, fuel, λ.
- **Inputs (OEM calibration):** `ecu.torqueLimitNm` and `ecu.powerLimitKw`, copied from the published rating for stock boosted presets. They are tagged `limitSource: 'published-rating'`.
  - With them applied, the stock peak torque and power agree with the published figures by construction.
  - They are removable: `simulate(cfg, { applyOemLimits: false })`.
  - They do not apply to custom builds (`customBuild.ts`).
- **Predictions:**
  - **NA engines:** the entire curve.
  - **Boosted engines with limits:** plateau start and end, the shape between the torque limit and the power limit, and the top-end power fall-off.
  - **Everything with limits off.**
- **Hardware-only score for boosted engines** (limits off, mean |error|):

| Set | n | Peak torque | Peak hp | Curve torque RMS |
|---|---|---|---|---|
| Train | 10 | 11.8% | 11.1% | 12.0% |
| Holdout | 3 | 20.0% | 17.8% | 16.2% |

  - Read these as an upper bound, not an error. The reference curves are ECU-limited, so they cannot validate unlimited capability.
  - Tuner stage-1 gains on these engines are typically 10–20% torque, which is comparable.
- **`intakeSystem`:** NA ratings are measured with a production intake (default 'stock', with airbox loss). Chevrolet Performance crate-engine dyno charts use 'open'.

## Validation (dyno-curve torque RMS; mean per group)
| Group | n | RMS |
|---|---|---|
| Train, all | 32 | 5.9% |
| Train, NA | 24 | 6.8% |
| Train, boosted | 8 | 3.1% |
| Holdout, all | 12 | 7.8% (7.79) |
| Holdout, NA | 7 | 8.2% |
| Holdout, boosted | 5 | 7.2% (7.18) |

- **Peaks, 21 reference engines:**
  - Median |hp error| 4.6%, mean 5.5%, max 13.8% (target: median ≤ 3%, max ≤ 8%, not met).
  - §18.2 changes, after the knock-path fix, turbo bearing loss and the `ecuRetardSoftCapDeg` 5 → 3.5 refit:
    - train RMS went from 5.898 to **5.916**, which is worse. The consistent knock rule itself costs 0.037 pt, and the refit is held at 3.5 by the knock sanity rules.
    - holdout RMS went from 7.818 to 7.792.
    - 21-set mean |hp| went from 5.509 to 5.500.
  - Earlier history: the §16 self-consistency work moved the mean from 5.45 to 5.51% and holdout RMS from 7.78 to 7.82%, with no retune. A §17.1 refit was rejected:
    - Lowering `ecuMaxRetardDeg` to 9° improves train RMS by only 0.016 pt.
    - It also breaks the torque-limiter invariants, through a knock-severity path dependence that is now documented.
  - Torque-peak rpm within ±10% for 12 of 21 (target ≥ 85%, not met).
  - Holdout curve RMS 7.8% against a target of ≤ 5%, not met.
- **Holdout was scored once per round,** after the constants were frozen.
- **Worst holdout cases:**
  - ZZ632/1000 big block: 26% RMS, all geometry estimated.
  - Audi 2.7T S4: +30% peak hp.
  - N74: 39% over with limits off.
  - Boosted engines at the 10% level.

## Per-build calibration (`SimOptions.calibration`, §17.2–17.3)
- `simulate(cfg, { calibration: { veScale, frictionScale, torqueCapNm } })` applies three multipliers inside every operating-point solve, not to the result:
  - `veScale` acts on the trapped air, so airflow, boost, knock and EGT respond;
  - `frictionScale` acts on mechanical FMEP before the ECU torque limiter (pumping and supercharger drive are not scaled);
  - `torqueCapNm` is an ECU torque limit, enforced through the boost target and, on NA engines or at zero boost, by throttle (MAP) control.
- Omitted means identity, and the outputs are bit-identical.
- The dyno-file calibration tool (`src/calibrate`) uses these instead of its former post-hoc scaling of IMEP and FMEP.
- **Fit quality, 44 reference curves:** mean RMS 6.42 → 2.95 %, with 6 curves still above 5 %. The old post-hoc version reached 6.42 → 2.81 % with 5 above 5 %, partly by scaling the modelled pumping work. Moving the scales into the solve alone gives 2.66 %.
- **Known issues in calibrated fits:**
  - Pushrod NA fits often hit the friction bound: their deficit is breathing, not friction.
  - A turbo spool fold can make B58 fits at VE ≈ 1.05 slow and jumpy.
  - A cam-timing table discontinuity can leave the fitter in a neighbouring minimum. The fit reports these cases as ill-conditioned or at a bound.

## Calibrated constants and plausibility
All tuned scalars sit inside literature ranges: valve Cd 0.65–0.81, port-reflection ≤ 0.95, friction A 0.27 against 0.4 for the 1960s, and the like. The full table with sensitivities is in `physics_audit.md` §14.2.
- **Dominant:** valve curtain Cd, the throat Cds, `gxEvoTempFactor`, `intakeWallTempK`, and the `gxVeScale` that is fixed at 1.0 (a ±10% change adds 4.5–4.8 pt to the train RMS).
- **Edge values:**
  - `intakeReflect` 0.94 compensates for missing plenum coupling between cylinders.
  - `fC` 0.04, at the low end of the friction range, reflects modern low-friction hardware.
  - `valveSeriesExp` 4 is the valve-flow knee shape.

## Known limitations
- **GM pushrod crate engines** are 5–10% low across the board (cam-swap gain is under-predicted: +9% against +22% published). Rating basis (net or gross) and head porting are not modelled.
- **High-revving NA** (F20C, GT3): peak rpm and power too high or low, and torque-peak rpm placement is poor (12 of 21).
- **Cam-duration sensitivity:** low-rpm torque is too insensitive to duration.
- **Taylor valve-choking** for undersized valves is too weak.
- **ITB top-end gain** is not reproduced.
- **ECU-limited turbo engines:** the plateau end and the peak-power rpm depend on the estimated turbo hardware.
- **Turbo spool folds:** the turbine/compressor balance can have two equilibria at low rpm. The model takes the lower one, the equilibrium reached when spooling up from rest, and it is computed on the coupled system once per rpm (§18.1). Every point converges, and any point that does not is listed in `SimResult.solverUnconverged` with a warning. Where the low equilibrium vanishes (a fold), the curve still jumps, because the jump is physical for a steady-state model. Examples: EJ257 at 1600 rpm under +0.1 % bore; B58 at 1000 rpm near `veScale` 1.085 (380 → 410 N·m); the drag build between 3750 and 4000 rpm.
- **Low-rpm boosted torque** is still too high where the engine is knock-limited (EA113 at 1250–1500 rpm: +14 to +18 %; B58 at 1250 rpm: +6 %). The spool transition is too abrupt on N63 (−12 % / +11.5 % at 1250 / 1500 rpm). The §17 path-dependent knock trim used to hide part of this; §18.2 exposes it.
- **Variable lift** is two-stage, blended over a narrow band of the ECU objective at the switch.
- **Boundary configs:** fuzz fails for absurd combinations (BMEP above 30 bar, EGT at the model's 1227 °C clamp, adjacent-point jumps on NA).
- **Mass model:** ±15% fails on three engines.
- **Cylinder counts and layouts** outside the reference set are not validated.

## Validated envelope (where the uncertainty band is trustworthy)
- **Trust:**
  - NA, 4-valve, stock-like cams, production intake, 85–125 hp/L, redline ≤ 9000 rpm.
  - Boosted gasoline engines with a published plateau, at stock hardware.
  - Pump-gas or E85 boost up to about 1.5 bar.
  - Band: ±7% at the torque peak, widening away from it.
- **Weaker:**
  - GM pushrod crate engines (bias −5 to −10%).
  - Anything with all-estimated geometry, as the ZZ632 holdout (26%) shows.
  - Custom builds: the hardware-only scores above apply (≥ 11% peak error on the reference set).
- **Outside:** boost above about 2 bar, CR above 14, absurd cam/valve combinations, and rpm above the valve-float speed (the float loss is a coarse shape).
