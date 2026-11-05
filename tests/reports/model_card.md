# Engine Forge model card (physics v4)

## What the model is
A 0-D cycle-resolved wide-open-throttle engine model. It evaluates one cylinder at each rpm and scales the result to the whole engine.

- **Breathing:** crank-angle integration of one cylinder from EVO to IVC. It has real valve lift profiles and compressible orifice flow. The intake runner and exhaust primary are acoustic delay lines, with shared-manifold pulse interference.
- **Combustion:** Wiebe burn duration, an indicated-efficiency correlation and a Douaud–Eyzat knock integral for spark retard.
- **Losses:** Chen–Flynn friction plus valvetrain and accessory terms. Pumping work comes from the gas-exchange cycle.
- **Forced induction:** compressor and turbine maps, wastegate, intercooler and supercharger.
- **ECU layer:** torque and power management (bracketed solve on the boost target, torque ≤ limit + 0.05 N·m; on a limited plateau the peak rpm is the plateau start, see `physics_audit.md` §15), knock-limited boost trim, EGT enrichment, and component protection that cuts boost above 1090 °C EGT or 220 bar peak cylinder pressure.
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
| Train, NA | 24 | 6.9% |
| Train, boosted | 8 | 3.1% |
| Holdout, all | 12 | 7.8% |
| Holdout, NA | 7 | 8.2% |
| Holdout, boosted | 5 | 7.1% |

- **Peaks, 21 reference engines:**
  - Median |hp error| 4.6%, mean 5.5%, max 13.8% (target: median ≤ 3%, max ≤ 8%, not met).
  - Torque-peak rpm within ±10% for 12 of 21 (target ≥ 85%, not met).
  - Holdout curve RMS 7.8% against a target of ≤ 5%, not met.
- **Holdout was scored once per round,** after the constants were frozen.
- **Worst holdout cases:**
  - ZZ632/1000 big block: 26% RMS, all geometry estimated.
  - Audi 2.7T S4: +30% peak hp.
  - N74: 39% over with limits off.
  - Boosted engines at the 10% level.

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
