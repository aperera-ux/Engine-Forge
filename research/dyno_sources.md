# Dyno / full-load curve sources (Engine Forge validation)

Curves live in `src/sim/validation/dynoCurves.ts`, engines in `referenceEngines.ts`
(EXTENDED set for engines outside the 21-engine peak-calibration set). Report:
`npx vitest run src/sim/__tests__/dynoCurves.test.ts`.
All curves are CRANK/ENGINE basis (OEM declared curves or crate-engine dyno charts). No wheel-dyno data was used,
so no drivetrain-loss conversion was applied. hp is always derived as Nm*rpm/7121 (mechanical hp).

## Sources used

| Source | Engines | Method | Notes |
|---|---|---|---|
| Chevrolet Performance 2017 catalog (carid.com PDF) DYNO CHART pages | LS7, LSA, LS9, LS376/480, ZZ6, 502 HO (round 1); LS376/525, ZZ572/620, ZZ427/480 (round 2) | vector path vertices read with pdfplumber, axes from vector gridlines, tick values read from rendered page | hp and torque traces cross-checked against each other (hp = tq*rpm/5252); charts whose traces disagree by >4 % mean were rejected (HT383 6 %, 454 HO 8.5 %, LSX454R 3.4 % borderline, SP350/385 and others not tried) |
| Chevrolet Performance LS3 sheet P/N 19540155 (crateenginedepot.com PDF) | LS3 | same, but the x axis is categorical (labels 800..6400 unevenly spaced in rpm, equally spaced on the page); mapped piecewise-linearly and verified against hp*5252/tq | 2017 catalog LSX376-B8 page reuses a different/mismatched chart (peaks 437 vs 476 hp) -> not used |
| BMW Technical Training (archive.org BMWTechnicalTrainingDocuments) | B58, N55, N20, N63, N62, N74, S85, S65 | raster, traced by colour at 4x (round 1) | declared (idealised) ECE full-load curves |
| Audi/VW Self Study Programmes (vaglinks.com/Docs/SSP) | 4.2 FSI RS4 (377), 2.5 TFSI (451), EA113 (821503), then 2.0 TFSI CAEB (922903), 1.8 TFSI BYT (384), 2.7T S4 (198), 5.2 V10 BXA (923603) | vector path vertices where the chart is vector, axes calibrated from label positions / gridlines | all are declared piecewise-linear curves, not measured dyno traces |

## Searched, found nothing usable (do not repeat)

* Web search for full curves of Coyote (Ford Performance crate pages give only peak numbers), SkyActiv-G 2.5 (owner's manual/peak figures only), EJ257 STI (peak figures + modified-car chassis dyno), K20A, F20C, 4A-GE, 2JZ-GTE: no OEM/engine-dyno curve found.
* Wikimedia Commons: no engine torque/power SVG for any of K20A/F20C/2JZ/4A-GE/EJ257/RB26/SR20 (only Chrysler A831 turbine and electric-motor files).
* Mercedes-AMG M178 / Porsche / Ferrari press kits: web search returned only peak figures (Wikipedia, paultan, MBUSA release).
* Self Study Programmes whose chart is a RASTER image and were not traced yet: 822703 / 388 (4.2 V8 FSI "BAR"), 823603 and 924603 (3.2/3.6 VR6/V6 FSI), 279 (2.0 FSI, no chart data in text), 255 (2.0/3.0 5V).
* SSP 267 6.0 W12 (AZC) was digitised (vector) but NOT added: the simulator has no W layout (inline|v|flat only), so a 'v' config would misrepresent it.
* BMW training PDFs S55, S63TU, S62, B46, N63TU2, M54, N52, N26: no full-load diagram found by text search (charts, if any, are raster without caption text). N73B60 (ST047 "1 N73 Engine", p.5 "Power and Torque Output N73B60 / M73B54") has a raster chart, not yet traced.
