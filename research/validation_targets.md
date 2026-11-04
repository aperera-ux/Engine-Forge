# Validation targets

The data lives in `src/sim/validation/referenceEngines.ts` (`REFERENCE_ENGINES`). Each entry has a full
`EngineConfig`, the published figures, a source, `estimatedFields` (fields I had to estimate) and
`ratingConfidence`. Torque-plateau engines carry `torqueRpmRange`/`hpRpmRange`, and their `torqueRpm`/`hpRpm`
is the plateau midpoint. The BMEP, hp/L and Sp columns below are derived from the published figures.

## 1. Reference engines

| id | Engine | Layout | L | Induction | Fuel | hp @ rpm | N·m @ rpm (plateau) | Redline | hp/L | BMEP@Tpk bar | Sp@red m/s | Mass kg | Conf. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| honda-k20a-dc5 | Honda K20A — Integra/Civic Type R | I4 | 2.00 | NA | gas93 | 217 @ 8000 | 206 @ 7000 | 8400 | 109 | 13.0 | 24.1 | 140 | medium |
| honda-f20c-ap1 | Honda F20C — S2000 (AP1, US) | I4 | 2.00 | NA | gas91 | 240 @ 8300 | 207 @ 7500 | 9000 | 120 | 13.0 | 25.2 | 147 | high |
| toyota-4age-20v-blacktop | Toyota 4A-GE 20V "Black Top" — AE111 | I4 | 1.59 | NA | gas93 | 163 @ 7800 | 162 @ 5600 | 8000 | 103 | 12.8 | 20.5 | 125 | medium |
| toyota-2jz-gte-us | Toyota 2JZ-GTE — Supra Turbo (US) | I6 | 3.00 | turbo 2x 0.75 bar | gas91 | 320 @ 5600 | 427 @ 4000 | 6800 | 107 | 17.9 | 19.5 | 230 | high |
| gm-ls3 | GM LS3 6.2 — Corvette C6 | V8 | 6.16 | NA | gas91 | 430 @ 5900 | 575 @ 4600 | 6600 | 70 | 11.7 | 20.2 | 190 | high |
| gm-ls7 | GM LS7 7.0 — Corvette Z06 (C6) | V8 | 7.01 | NA | gas91 | 505 @ 6300 | 637 @ 4800 | 7000 | 72 | 11.4 | 23.7 | 207 | high |
| ford-coyote-gen3 | Ford Coyote 5.0 Gen 3 — Mustang GT (2018) | V8 | 5.04 | NA | gas93 | 460 @ 7000 | 569 @ 4600 | 7500 | 91 | 14.2 | 23.2 | 200 | high |
| bmw-s54-e46m3 | BMW S54 3.2 — E46 M3 (US) | I6 | 3.25 | NA | gas91 | 333 @ 7900 | 355 @ 4900 | 8000 | 103 | 13.7 | 24.3 | 217 | high |
| bmw-b58-340i | BMW B58 3.0T — 340i (F30) | I6 | 3.00 | turbo 1x 1 bar | gas91 | 320 @ 6000 (5500–6500) | 447 @ 3190 (1380–5000) | 7000 | 107 | 18.7 | 22.1 | 175 | low |
| vw-ea888-gen3-gti | VW EA888 Gen 3 2.0 TSI — Golf GTI Mk7 (Performance) | I4 | 1.98 | turbo 1x 1.1 bar | gas91 | 220 @ 5450 (4700–6200) | 350 @ 3050 (1500–4600) | 6500 | 111 | 22.2 | 20.1 | 140 | medium |
| ford-10-ecoboost | Ford 1.0 EcoBoost I3 — Fiesta (US) | I3 | 1.00 | turbo 1x 1 bar | gas87 | 123 @ 6000 | 170 @ 2950 (1400–4500) | 6500 | 123 | 21.4 | 17.8 | 97 | high |
| ford-35-ecoboost-gen2 | Ford 3.5 EcoBoost Gen 2 — F-150 (2017) | V6 | 3.50 | turbo 2x 1 bar | gas87 | 375 @ 5000 | 637 @ 3500 | 6000 | 107 | 22.9 | 17.3 | 205 | medium |
| toyota-1gr-fe | Toyota 1GR-FE 4.0 V6 — 4Runner (dual VVT-i) | V6 | 3.96 | NA | gas87 | 270 @ 5600 | 377 @ 4400 | 6000 | 68 | 12.0 | 19.0 | 166 | high |
| subaru-ej257-sti | Subaru EJ257 2.5T — WRX STI (US) | F4 | 2.46 | turbo 1x 1 bar | gas91 | 305 @ 6000 | 393 @ 4000 | 6700 | 124 | 20.1 | 17.6 | 160 | high |
| porsche-9a1-40-gt3 | Porsche 9A1 4.0 flat-6 — 911 GT3 (991.2) | F6 | 4.00 | NA | gas93 | 500 @ 8250 | 460 @ 6000 | 9000 | 125 | 14.5 | 24.4 | – | high |
| ferrari-f136-458 | Ferrari F136 4.5 flat-plane V8 — 458 Italia | V8 flat-plane | 4.50 | NA | gas93 | 562 @ 9000 | 540 @ 6000 | 9000 | 125 | 15.1 | 24.3 | – | high |
| audi-52-v10-r8plus | Audi/Lamborghini 5.2 FSI V10 — R8 V10 plus (2017) | V10 | 5.20 | NA | gas91 | 602 @ 8250 | 560 @ 6500 | 8700 | 116 | 13.5 | 26.9 | – | high |
| ferrari-f140fc-f12 | Ferrari F140FC 6.3 V12 — F12berlinetta | V12 | 6.26 | NA | gas93 | 730 @ 8250 | 690 @ 6000 | 8700 | 117 | 13.8 | 21.8 | 225 | high |
| dodge-hellcat-62 | Dodge SRT Hellcat 6.2 supercharged Hemi — Challenger | V8 | 6.17 | SC twin-screw 0.8 bar | gas91 | 707 @ 6000 | 881 @ 4800 | 6200 | 115 | 18.0 | 18.8 | 260 | high |
| mazda-skyactiv-g25 | Mazda Skyactiv-G 2.5 — Mazda6 (US) | I4 | 2.49 | NA | gas87 | 184 @ 5700 | 251 @ 3250 | 6500 | 74 | 12.7 | 21.7 | 115 | high |
| chevy-350-zz4 | Chevrolet 350 ZZ4 crate small-block | V8 | 5.73 | NA | gas93 | 355 @ 5250 | 549 @ 3500 | 5500 | 62 | 12.0 | 16.2 | 240 | medium |

Confidence levels:
- **high:** SAE J1349 certified, or consistent with independent dynos.
- **medium:** a manufacturer figure that may be mildly conservative, or a crate-engine dyno rating.
- **low:** known to be under-rated. The B58 in the 340i is the clear case: chassis dynos suggest about 360–370 crank hp.

### Suggested tolerances (on the certified fuel and config)
| Metric | high | medium | low |
|---|---|---|---|
| Peak hp | ±8% | ±10% | −5% / +20% |
| Peak torque | ±8% | ±10% | −5% / +20% |
| Peak-power rpm | ±8% (or ±500 rpm) | ±10% | ±12% |
| Peak-torque rpm, NA | ±15% (or ±700 rpm); torque curves are flat, so the peak rpm is poorly defined | ±20% | ±25% |
| Peak-torque rpm, turbo | Simulated torque must be ≥ 95% of peak across the published plateau `torqueRpmRange` | | |
| Mass (when given) | ±15% | ±20% | ±25% |

Aggregate goals:
- Mean absolute error on peak hp across all high/medium engines: ≤ 5%.
- No single engine outside ±12%.

## 2. Qualitative sanity rules a realistic model must satisfy
Each rule can be tested by perturbing one field of a reference config, with everything else held fixed.

### Induction and boost
1. **More boost means more power**, monotonically, until knock retard, compressor choke (η_c collapse) or the EGT limit stops it. Going from 0.5 to 1.0 bar on a turbo engine should add 25–40% peak power. On 93 pump fuel, a 2.0 at CR 9.5 should show rising knock retard beyond about 1.5 bar. On E85, that same engine should go well beyond 2 bar.
2. **A bigger compressor inducer or turbine A/R moves full-boost rpm up and peak power up** at high boost. A smaller one gives earlier spool and more low-rpm torque, but a power ceiling and higher back pressure at high rpm.
3. **Twin-scroll gives earlier spool** (about 10–15% lower full-boost rpm) and about the same peak.
4. **A better intercooler raises power and lowers knock retard.** Taking effectiveness from 0 to 0.75 at 1 bar should be worth roughly +8–15% power and −60 to −90 °C of charge temperature. *(Revised after audit: was −30 to −50 °C. That band is inconsistent with ε = 0.75 at 1 bar. A compressor at η 0.65–0.75 delivers T₂ ≈ 110–135 °C at 25 °C ambient, so ΔT = −ε·(T₂ − T_amb) ≈ −65…−85 K.)*
5. **Positive-displacement superchargers give near-flat boost and strong low-rpm torque. Centrifugal boost rises roughly as rpm².** At equal boost at redline, centrifugal makes less mid-range torque. Supercharger drive loss grows with boost: about 10–15% of gross power.
6. **An NA engine at sea-level ambient has MAP ≤ 1.0 bar**, with tuning peaks shown as VE only. It never reports positive boost.

### Breathing, cams and tuning
7. **A longer intake runner moves peak torque to lower rpm**, and a shorter one moves it higher (roughly N_tuned ∝ 1/√L). The effect is bounded, with peak torque moving about ±10% between 200 and 400 mm.
8. **More cam duration moves the torque and power peaks to higher rpm.** It also reduces low-rpm torque and raises peak power, as long as valve area and rpm limits allow. Adding 20° @0.050 on a 2v pushrod V8 should move the power peak by about +800–1000 rpm and cut 2000-rpm torque by 5–10%.
9. **More overlap (a narrower LSA)** helps high-rpm VE with tuned headers. It hurts low-rpm VE and hurts more under turbo back pressure.
10. **Bigger valves (lower Taylor Z) raise the rpm of peak power.** Undersized valves flatten the power curve early: power peaks where Z ≈ 0.55–0.6.
11. **VVT broadens the torque curve.** Area under the curve rises by 3–8% while the peak changes little. **Variable lift** raises both low-rpm torque and top-end power compared with either fixed cam.
12. **Exhaust ranking** (VE at peak power, NA): tuned-equal ≈ long-tube > shorty > log. On turbo engines the ordering mostly collapses, and a log manifold helps spool.
13. **ITBs plus short runners** make the top end stronger. A restrictive throttle (equivalent diameter below about 0.4 × √(total intake valve area)) cuts peak power.

### Combustion and fuel
14. **Higher CR raises efficiency and power**, by about 2–3% torque per +1 CR (fuel-air cycle). The gain lasts until the knock limit. Beyond it, retard grows and net torque falls. On 87 AKI fuel, an NA PFI engine at CR 13 must show substantial knock retard.
15. **Higher octane never reduces power.** It only helps when the engine is knock-limited: an LS3 at CR 10.7 sees almost no change from 91 to 93.
16. **E85 gives more power than gasoline** at the same config when knock-limited. NA at MBT it gives about +3–5%, from charge cooling. BSFC rises by about 40%. Methanol gives a larger gain again, at about 2.2× BSFC.
17. **DI lowers knock retard** compared with PFI at the same CR and fuel, and gives +1–3% VE.
18. **Lambda:** peak torque on gasoline occurs at λ 0.85–0.90. Leaner than 1.0 loses power. Richer than about 0.75 loses power and raises BSFC. Richer mixtures lower EGT.
19. **Bigger bore at fixed CR and fuel gives more knock retard.**
20. **Higher charge temperature means less density and more knock**, roughly −1% power per +3 °C on knock-limited turbo engines.

### Mechanical
21. **Mean piston speed:** info above 22 m/s, warn above 27, critical above 30. *(Revised after audit, lead arbitration: was warn > 25 / critical > 27. Stock production engines reach ~27 m/s, e.g. F20C 25.2 and Audi 5.2 V10 26.9.)* Longer stroke at fixed rpm means a higher Sp, so reliability falls.
22. **Peak piston acceleration** = rω²(1 + r/l). A longer rod lowers it slightly. Cast parts must warn above about 40 km/s².
23. **Raising redline above the valve-float rpm** must not add power beyond the float point. Power falls, and a 'valve-float' warning appears.
24. **FMEP rises with rpm**, roughly quadratically in Sp. Mechanical efficiency is 0.80–0.90 at peak torque and 0.72–0.85 at peak power, down to about 0.70 at 9000+ rpm.
25. **Heavier materials (an iron block) mean more engine mass.** More cylinders at the same displacement means more mass, a higher rev ceiling and less piston speed at a given rpm.

### Output plausibility envelopes (on the certified fuel)
| Class | Specific output (hp/L) | BMEP at peak torque (bar) | BSFC at peak power (g/kWh) |
|---|---|---|---|
| NA 2v pushrod, modern | 60–80 | 11–13 | 270–310 |
| NA economy 4v | 60–80 | 11.5–13 | 260–290 |
| NA performance street 4v | 90–125 | 12.5–15.2 | 270–300 |
| Turbo street (≤ 1.3 bar) | 100–170 | 17–24 | 290–360 |
| Supercharged street V8 | 100–125 | 16–19 | 300–380 |
| Race / drag hypothetical | 150–400+ | up to about 30 (pump), 40+ (E85/methanol) | – |

- NA street output above about 130 hp/L, or NA BMEP above about 15.5 bar (16 for an all-out race NA), points to a bug.
- BTE: no gasoline engine should beat 0.42 brake. WOT efficiency is typically 0.28–0.34.
- EGT at WOT should fall in 750–1000 °C for gasoline. Lean or retarded calibrations raise it, rich ones lower it.

## 3. Known data-quality caveats
- Cam timing at 0.050", runner/header geometry and turbo hardware were **estimated** for most DOHC engines, because manufacturers don't publish them. Only the GM pushrod engines (LS3, LS7, ZZ4) have published 0.050" cam specs.
- Valve diameters and rod lengths for the B58, Coyote and several exotics come from aftermarket replacement-part listings or are estimated (see `estimatedFields`).
- Torque/power plateaus: turbo engines are boost-limited by the ECU, so the torque "peak" is a plateau. Validate against the plateau, not a single point.
- JDM ratings (K20A, 4A-GE) are on 100 RON fuel, mapped to `gas93`. Small-displacement JDM engines were not covered by the 276 PS agreement, but they may still be slightly optimistic.
- The ZZ4 is a crate-engine dyno rating (with headers, no accessories/mufflers). It sits closer to gross than to in-car SAE net.
- 3.5 EcoBoost: the fuel is listed as regular 87 (Ford truck practice). The premium-fuel output is somewhat higher.
