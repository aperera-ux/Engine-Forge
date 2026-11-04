# Engine physics and empirics reference (for the physics agent)

These are numbers to calibrate `simulate()` against. All pressures are bar absolute
unless they say "gauge". Temperatures are K unless marked °C. Sp is mean piston
speed, Sp = 2·S·N/60 (m/s).

Sources: Heywood, *Internal Combustion Engine Fundamentals* (1st ed. 1988; 2nd ed. 2018),
which I cite as "H" plus a chapter. Also C.F. Taylor, *The Internal-Combustion Engine
in Theory and Practice* vol. 1 (Mach index); Engelman, "Design of a tuned intake
manifold", ASME 53-A-20 (1953); Blair, *Design and Simulation of Four-Stroke Engines*
(SAE 1999); Patton, Nitschke & Heywood, SAE 890836 (friction); Chen & Flynn, SAE 650733;
Garrett/BorgWarner compressor maps; SAE J1349 (rating conditions). Values marked
**[rule]** are industry rules of thumb, not textbook results. Every reference engine
in `src/sim/validation/referenceEngines.ts` back-calculates to inside the ranges below.

---

## 0. Rating conditions and unit conversions
- SAE J1349 conditions: 25 °C, 99 kPa dry-air pressure (100 kPa total). ρ_air = 1.16 kg/m³ dry. **Use ρ_amb = 1.17 kg/m³, T_amb = 298 K, p_amb = 1.0 bar.**
- 1 hp = 745.7 W; 1 PS (DIN/CV) = 735.5 W (PS × 0.9863 = hp); 1 lb-ft = 1.35582 N·m.
- BMEP (bar) = 4π·T(N·m) / V_d(m³) / 1e5 for a 4-stroke engine. P(kW) = T·N/9549.
- Published peak-torque BMEP: economy NA 11.5–13; performance NA 13–15.2; best production NA about 15 (458 Italia 15.1); turbo street 17–23; Hellcat (SC) 18.

## 1. The core air-to-torque chain (recommended structure)
```
m_air/cycle  = VE · ρ_ref · V_d                 ρ_ref = ρ at intake-manifold p,T (NA: ambient)
IMEP_gross   = VE · ρ_ref · (LHV / AFR_st) · η_ig · f_λ · f_spark
BMEP         = IMEP_gross − PMEP − FMEP
```
- LHV/AFR_st is the fuel energy per kg of air at stoichiometric. It is nearly the same for every fuel: gasoline 2.95–3.0 MJ/kg_air, E85 2.98, methanol 3.08. Alternative fuels make more power through charge cooling and knock resistance, not through more energy per kg of air.
- f_λ, the rich-mixture power factor per unit air (H ch. 5/11): f = 1.00 at λ 1.0, 1.04 at λ 0.90, a peak of 1.05–1.06 at λ 0.85–0.88, 1.04 at λ 0.80 and 1.02 at λ 0.75. For λ < 1 a simple fit is `f = 1 + 0.45(1−λ) − 1.6(1−λ)^2`, which gives 1.04 at λ 0.88, 1.05 at 0.85 and 1.04 at 0.78. Max-power λ: gasoline 0.85–0.90, E85 0.78–0.82, methanol 0.65–0.75.
- Back-check on the K20A at 7000 rpm, with VE 1.08, η_ig 0.40, f_λ 1.04 and ρ 1.17: IMEP = 1.08·1.17·2.97e6·0.40·1.04 = 15.6 bar. Subtracting FMEP 2.2 and PMEP 0.35 gives BMEP 13.0, which matches the published 206 N·m.

## 2. Volumetric efficiency (VE)

### 2.1 Typical peak VE (ambient-referenced, NA, at the tuned peak)
| Engine class | Peak VE | Examples |
|---|---|---|
| Old 2v carbureted / log manifold | 0.78–0.88 | 1970s–80s smog V8s |
| Modern 2v pushrod (LS/Hemi) | 0.92–1.00 | LS3 ≈ 0.95, LS7 ≈ 0.97 |
| Modern 4v DOHC economy (long runners) | 0.92–1.00 | 1GR-FE, Skyactiv-G |
| 4v DOHC high-performance street (VVT, tuned exhaust) | 1.02–1.12 | K20A, S54, Coyote, GT3, 458 |
| Pro race NA (NASCAR 2v, F1 4v) | 1.10–1.30 | F1 V10 ≈ 1.2–1.3 |

### 2.2 Shape of VE(N)
Treat VE(N) as a product of factors (H ch. 6, Fig. 6-9):
1. **Cam/IVC base curve.** This is a broad peak centred on N_cam. Late IVC moves N_cam up, because inertia ramming fills the cylinder at high rpm but charge is pushed back at low rpm. IVC (deg ABDC) = ICL + dur_050/2 − 180 + about 25–30° (the 0.050" duration is roughly 25–30° shorter on each side than the seat-to-seat duration). **[rule]** For a 2v pushrod V8 the peak-torque rpm comes out roughly as follows: 200° @0.050 → 3500–4200; 210° → 4200–4800; 220° → 4800–5300; 235° → 5500–6000; 250° → 6200–6800. That is about +450 rpm per +10° duration. For 4v engines and smaller cylinders, scale the shift with Sp instead of rpm (N ∝ 1/stroke).
2. **Valve flow limit (Taylor's Mach index).** See 2.3. VE falls steeply once Z is above about 0.5–0.6.
3. **Intake runner tuning.** Adds a ±3–8% bump at N_tuned (2.4).
4. **Exhaust tuning and scavenging.** Adds a bump of up to +5% near the tuned rpm, and only when there is real overlap (2.5).
5. **Overlap / reversion at low rpm.** Overlap at 0.050" = (dur_int + dur_exh)/2 − 2·LSA. The values are negative for street cams, for example LS3 (204+211)/2 − 234 = −26°. Each +10° of 0.050" overlap costs about 2–4% VE below 2500 rpm and gives a rougher idle. Under boost with a turbine back-pressure ratio above 1, overlap lets exhaust flow back into the cylinder, so turbo cams use wide LSA (114–120).
6. **VVT.** Cam phasing tracks the optimum ICL. Model it as broadening: the band where VE ≥ 95% of peak gets about 25–35% wider, and the low-rpm VE gains +4–8%. **Variable lift (VTEC/Valvetronic/AVS):** blend two cams (mild lobe below the switch point at about 0.6·redline, wild lobe above it) and take max(VE_low, VE_high).
7. **Throttle restriction.** Δp = ṁ² / (2ρ (C_d A_t)²) with C_d ≈ 0.8 at WOT. Size the throttle so the loss stays under 1–2% at peak power. **[rule]** A_throttle ≈ 0.4–0.6 × the total intake-valve area keeps the loss at about 1%.

### 2.3 Taylor inlet Mach index (H §6.2.2, Fig. 6-21)
```
Z = (B / D_v)^2 · Sp / (C_i · a) / n_iv         (per intake valve count n_iv)
  = (A_piston / (n_iv · A_valve)) · Sp / (C_i · a)
```
- a = speed of sound at inlet ≈ 345 m/s at 298 K. C_i = mean inlet-valve flow coefficient over the event, based on valve-head area: 0.30–0.38 for 2v, 0.33–0.40 for good 4v. C_i rises with lift/diameter up to L/D ≈ 0.25–0.30, then flattens. **Use C_i = 0.35·min(1, (L/D)/0.28)^0.5.**
- Results: VE is roughly flat for Z < 0.5. Above Z ≈ 0.55–0.6 it falls steeply, and at Z = 1.0 it is about 30–40% below peak. **Suggested penalty** (fits H Fig. 6-21): `f_Z = Z<=0.5 ? 1 : 1 − 0.9·(Z−0.5)^1.5` (0.97 @0.6, 0.85 @0.8, 0.67 @1.0).
- Worked checks at peak power: K20A at 8000 rpm, Sp 22.9, 2×35 mm gives Z ≈ 0.57. LS3 at 5900 rpm, 55 mm, C_i 0.33 gives Z ≈ 0.56. F20C at 8300 gives Z ≈ 0.60. Production engines reach peak power at Z ≈ 0.55–0.62, which makes Z the most useful predictor of the power-peak rpm.
- 5-valve heads (4A-GE: 3 intake valves) have more curtain area but lower C_i. Treat them as n_iv = 3 with C_i × 0.92.

### 2.4 Intake runner tuning
**Helmholtz / Engelman form** (H §7.6, Engelman 1953):
```
f_H = (a / 2π) · sqrt( A_r / (L_eff · V_eff) ),  V_eff = (V_d/2)·(r_c+1)/(r_c−1)
N_tuned ≈ 60 · f_H / K,  K ≈ 2.0–2.3 (empirical; start at 2.15 and calibrate)
```
- L_eff is the runner length plus the port, about 100–140 mm on top of `intakeRunnerMm`, plus 0.3·D_runner for the end correction. A_r is the runner cross-section, typically 0.85–1.0 × the total intake-valve head area for 4v and about 0.9× for 2v.
- Scaling law: N_tuned ∝ a·sqrt(A/(L·V_d)). Halving L raises N_tuned by 41%. Doubling the cylinder volume lowers it by 29%. Hot intake air (higher a) raises N_tuned slightly.
- Wave-action view (Blair, Vizard **[rule]**): a quarter-wave runner (valve to open plenum) tunes when the round trip 2L/a equals about 80–100° of crank rotation at N_tuned, which gives `N ≈ a·θ_w/(12·L_eff)` with θ_w ≈ 90°. Use it only as a cross-check.
- The bump is +4–8% VE over a band about ±20% of N_tuned. Below the bump there is a dip of −2–4% from the out-of-phase harmonic. ITBs with short runners (S54, 4A-GE, F1) put the bump at high rpm. Long runners (Skyactiv, 1GR, truck engines) put it at 3000–4500 rpm.
- Under boost, tuning still works but the effect is diluted. Multiply the bump by about 0.5 for turbo and positive-displacement supercharged engines, whose runners are often short and set by packaging.

### 2.5 Exhaust primaries
- **[rule]** Tuned primary length (Smith/Vizard): `L_prim(in) = 850·ED/N − 3`, where ED = 180 + EVO°BBDC (seat timing ≈ 0.050" EVO + 25°). For EVO 70° BBDC at 6500 rpm this gives about 755 mm. Equivalently, N_tuned ∝ 1/L_prim.
- **[rule]** Primary inner diameter: `ID(in) = 2.1·sqrt(cc_cyl / ((L_prim_in + 3)·25))`. Undersized pipes lose power at the top; oversized pipes lose torque below the peak.
- VE multiplier vs a long-tube 4-into-1 reference, at and above the torque peak:

| Exhaust type | Factor |
|---|---|
| log / integrated manifold | 0.93–0.96 (NA); about 1.0 for turbo, where it helps spool |
| shorty | 0.97–0.99 |
| long-tube | 1.00, plus a +3–5% bump near N_tuned when overlap > −10° |
| tuned-equal (4-2-1, equal length) | 1.00, plus a +4–6% bump; also +2–3% low-rpm help for 4-2-1 |

- Flat-plane V8s and inline engines with 4-2-1 headers scavenge well because pulses within each bank are evenly spaced. Crossplane V8s with simple manifolds don't (uneven bank pulses), so apply about −2% unless the headers are an "H"/180° design.

## 3. Indicated efficiency vs compression ratio
The ideal Otto efficiency (1 − r^(1−γ)) overstates real engines by about 1.5×, so don't use it. Use fuel-air cycle values (H ch. 5, Fig. 5-9) and real-engine factors:

| CR | Fuel-air cycle η, φ=1 | Real gross indicated η_ig at MBT, stoich |
|---|---|---|
| 8 | 0.43 | 0.35 |
| 9 | 0.445 | 0.365 |
| 10 | 0.46 | 0.38 |
| 11 | 0.475 | 0.39 |
| 12 | 0.49 | 0.40 |
| 13 | 0.50 | 0.41 |
| 14 | 0.51 | 0.415 |
| 15+ | 0.52 | 0.42 (gains flatten: heat loss and crevices) |

- Fit: `η_fa ≈ 1 − r^−0.27`. Then `η_ig ≈ 0.82·η_fa`. The 0.82 factor breaks down as heat transfer ≈ 0.90, finite burn ≈ 0.95 and incomplete combustion/crevice ≈ 0.97. Use 0.80 for 2v open-chamber/large-bore and 0.84 for fast-burn 4v pent-roof with DI.
- Per unit fuel, η falls when rich (φ = 1/λ > 1). The f_λ factor in §1 already folds this in on a per-air basis.
- Big-bore engines lose a little less heat per unit volume. The effect is small (±1%), so it can be ignored.

## 4. Combustion phasing, MBT and knock
- **MBT spark** (deg BTDC) at WOT: fast-burn 4v pent-roof 18–28° (mid-rpm), 2v pushrod 28–36°, 2v Hemi with twin plugs 22–28°. Advance rises roughly with rpm (+3–5° from 2000 to 6000) and falls with boost (−2 to −4° per bar). MBT puts 50% mass burned at 8–10° ATDC.
- **Torque loss when retarded from MBT** (H §15.3; the loss is quadratic near MBT): `loss ≈ 0.0006·Δθ²`, which gives 1.5% at 5°, 6% at 10° and 13.5% at 15°. Each degree of retard raises EGT by about 15–25 °C.
- **Knock model: an "effective CR" margin approach [rule, tuned to the reference set].** Boost is folded into an effective CR. The exponent n_b ≈ 0.4 is much weaker than isentropic, because the knock limit tracks end-gas autoignition rather than geometric compression. Calibrate n_b within 0.35–0.5.
  ```
  CR_eff  = CR · (MAP_abs / 1.0)^0.4
  CR_lim  = 11.0                                   base: 91 AKI, PFI, 4v pent-roof, 86 mm bore,
                                                   40 °C charge, λ 0.88, 4000 rpm
            + 0.45·(AKI − 91)                       87 → −1.8, 93 → +0.9, 100 → +4.05
            + fuel bonus: E85 +3.5, methanol +5.0 (in place of the AKI term)
            + 1.5  if DI (charge cooling + shorter end-gas residence)
            − 0.05·(bore_mm − 86)                    104 mm → −0.9
            − 0.03·(T_charge_°C − 40)                each +10 °C ≈ −0.3
            + 2.5·(0.88 − λ)                         λ 0.78 → +0.25
            + 0.3  for tuned-equal / long-tube exhaust (lower residuals)
            − 0.3  modern 2v (LS / twin-plug Hemi);  − 0.8 old 2v open/wedge chamber
            + clamp(0.4·log2(N/4000), −0.6, +0.6)  less time for autoignition at high rpm
  knockRetard = clamp((CR_eff − CR_lim) · 3.5 °/CR-unit, 0, 20)
  ```
  On their certified fuel, these constants put K20A, F20C, Coyote, 2JZ-GTE and EA888 at 0–1° retard. LS3 lands at about 3°, the GT3 4.0 and F12 at about 2–3°, EJ257 at about 3°, and the Hellcat at about 6–7° at peak torque. Skyactiv-G (CR 13 on 87) gets about 6–8° at 3000 rpm WOT, which is real behaviour: it is torque-limited at low rpm on regular. If calibrated power runs low on the high-CR engines, raise the base 11.0 rather than the DI bonus.
- **Octane mapping** (AKI = (RON+MON)/2): gas87 ≈ 91–92 RON; gas91 ≈ 95–96 RON; gas93 ≈ 98 RON (Euro/JDM premium 98–100 RON ≈ 93–95 AKI); race100 ≈ 100 AKI / 104 RON; E85 ≈ 100–105 AKI equivalent plus big charge cooling, so add CR_lim +3.5 over 91 in total; methanol ≈ 99 AKI plus enormous charge cooling, so add CR_lim +5.
- **[rule]** Boost tolerance on 91–93 pump fuel with a good intercooler at CR 9.5–10: about 1.0–1.5 bar on modern DI 4v; at CR 8.2–8.5 PFI, about 1.0–1.2 bar. On E85, the same engines tolerate +60–80% more boost.

## 5. Friction (FMEP) and pumping (PMEP)
**Chen–Flynn form** (Chen & Flynn SAE 650733; used in GT-Power/Ricardo WAVE):
```
FMEP [bar] = C + A·P_max[bar] + B·Sp + Q·Sp²
Recommended SI starting set (mechanical + SAE-net accessories, excl. pumping):
  C = 0.35 bar,  A = 0.005,  B = 0.060 bar/(m/s),  Q = 0.0012 bar/(m/s)^2
→ Sp 10 m/s, Pmax 70 → 1.4 bar ; Sp 20, Pmax 85 → 2.45 bar ; Sp 25, Pmax 90 → 3.0 bar
```
Published coefficient sets vary a lot from engine to engine, so treat these as calibration starting points, not universal constants. As a sanity check, Heywood's Barnes-Moss fit for 1970s SI engines (H eq. 13.15) is `fmep(bar) = 0.97 + 0.15(N/1000) + 0.05(N/1000)²`. That fit includes WOT pumping and gives 3.7 bar at 6000 rpm. Modern engines run about 30–40% lower.

| Adjustments (add to FMEP) | bar |
|---|---|
| Pushrod with roller lifters (vs DOHC roller finger follower baseline) | −0.05 to +0.05 (fewer valves, more mass) |
| DOHC direct-acting bucket | +0.05–0.10 |
| Flat-tappet cam (old pushrod) | +0.10–0.20 |
| Dry sump (high rpm, less windage) | −0.10 to −0.30 above 6000 rpm |
| Accessories in SAE net (water pump, oil pump, alternator) | already in C; about 0.2–0.35 of it |
| DI high-pressure pump | +0.03–0.05 |
| Big bore with low tension rings (race) | −0.1 to −0.2 |

- Typical total FMEP at peak power: economy I4 at 5500–6000 rpm 1.8–2.2; K20/F20C at 8000–9000 2.6–3.2; LS3 at 5900 1.8–2.1; F1 V10 at 18000 about 4–5.
- **Pumping (PMEP) at WOT.** NA: PMEP = p_exh,mean − p_int,mean ≈ 0.10–0.25 bar at low rpm and 0.3–0.6 bar at peak power. Log manifold and restrictive mufflers sit at the high end, long-tube headers with free exhaust at the low end. Turbo: PMEP ≈ p3 − p2 (turbine inlet minus boost). Well-matched modern turbos run p3/p2 ≈ 1.0–1.3 at peak power, so PMEP ≈ 0–0.6 bar. Small-housing (low A/R) turbos at high rpm run p3/p2 1.5–2.2, so PMEP 1–2.5 bar, and the extra residual gas adds knock. Part load: PMEP ≈ p_amb − MAP + 0.1.

## 6. Turbocharging
```
PR      = (p_amb + boost + Δp_IC) / (p_amb − Δp_filter)      Δp_IC 0.05–0.20 bar, Δp_filter 0.02–0.05
T2      = T1 · [1 + (PR^0.2857 − 1)/η_c]
T_chg   = T2 − ε_IC·(T2 − T_amb)                            ε_IC from config (0 = none)
P_comp  = ṁ·cp·T1·(PR^0.2857 − 1)/η_c                      cp = 1005 J/kg·K
```
- **η_c:** peak island 0.72–0.80 on modern wheels and 0.65–0.72 on older/OEM wheels. Near surge or choke it drops to 0.55–0.65. **Use η_c = 0.74 in-island and taper it to 0.60 as ṁ approaches the choke flow.** Worked example: PR 2.0 at 0.72 gives T2 = 389 K (116 °C). With ε 0.75 that becomes T_chg = 321 K (48 °C).
- **Intercooler effectiveness:** front-mount air-to-air 0.70–0.85; top-mount 0.55–0.65 (heat soak); air-to-water in the plenum (B58, Hellcat) 0.70–0.85.
- **Compressor flow capacity [rule, Garrett/BorgWarner maps]:** choke flow (lb/min) ≈ 0.017–0.020 × D_inducer(mm)². Examples: 47 mm ≈ 40 lb/min, 55 mm ≈ 52, 67 mm ≈ 85. 1 lb/min = 0.00756 kg/s. Gasoline engines make about 9.5–10.5 hp per lb/min (≈ 1.3 kW per g/s).
- **Spool / full-boost rpm.** Model boost(N) = target × smoothstep over [N_onset, N_full].
  - N_full scales with compressor size relative to engine flow and with turbine A/R. **[rule]** On a 2–3 L engine: +100–150 rpm per mm of inducer, +250 rpm per +0.1 A/R, −10–15% for twin-scroll, and −20–30% per turbo for twins on a V engine (each turbo sees half the flow).
  - Published plateaus to target: modern small-turbo DI 1.4–2.0 L full torque by 1400–1800 rpm; B58 1380; 3.5 EcoBoost about 2500 (Gen 2 470 lb-ft at 3500); EJ257 VF48 3500–4000; 2JZ-GTE sequential, second turbo online 3500–4000; 67 mm drag turbo on a 2.0, 5000–6000.
  - Suggested formula, fitted to the anchors above:
    `N_full ≈ 1500 · (x/800)^0.5 · (AR/0.45)^0.8 · ((1+boost_bar)/2.1)^0.8 · (twinScroll ? 0.88 : 1)`, where `x = D_inducer² / (V_L / count)` in mm²/L. Clamp to 1200–7000 and put N_onset ≈ 0.55·N_full. Results: EA888 1500, B58 1300, 1.0 EcoBoost 1490, 3.5 EcoBoost 1860 (published plateau starts at 2500 for the peak value), drag 2.0 at 2.5 bar ≈ 5350.
    EJ257 is an outlier: the formula gives about 1950 against a real ≈ 3600. Its old journal-bearing VF-series turbo has a large turbine wheel, and the model has no turbine-size input. Accept the miss or add a "turbo generation" factor. 2JZ-GTE is sequential: model it as a small single turbo (half the flow) up to ~3800 rpm and both turbos above that, or accept a late single-turbo approximation.
- **Back pressure:** p3 ≈ p2 · (1.0 + 0.6·(1 − AR/1.0) · (ṁ/ṁ_choke)^2) as a simple start. It raises PMEP and residuals and lowers the knock limit.
- **Turbine/turbo efficiency:** η_t 0.65–0.75 and η_mech 0.95–0.98, so overall η_TC is 0.45–0.60.
- **Boost control:** once at target, the wastegate holds boost. Factory tunes often taper boost by 10–25% toward redline (EA888, EJ257), which is why turbo power plateaus.

## 7. Supercharging
| Type | Adiabatic η_c | Boost vs rpm | Notes |
|---|---|---|---|
| Roots (older Eaton M-series) | 0.50–0.60 | ≈ flat from low rpm | Hot discharge |
| Roots TVS (4-lobe twisted) | 0.60–0.70 peak | ≈ flat | |
| Twin-screw (Whipple, IHI on Hellcat, Lysholm) | 0.65–0.75 | ≈ flat, slight rise | Internal compression |
| Centrifugal (Vortech, ProCharger, Paxton) | 0.70–0.78 | ∝ N² (boost = target·(N/N_red)²) | Little boost at low rpm |
- Positive-displacement boost(N) ≈ target·min(1, 0.6 + 0.4·N/(0.5·N_red)) for a slight low-rpm rise. A good model is boost reaching about 90% of target by 2500 rpm.
- Drive power = P_comp / η_drive (P_comp already includes 1/η_c), with η_drive ≈ 0.92–0.95 for the belt and gears. At peak this is 10–15% of the gross crank power: the Hellcat blower absorbs about 80–100 hp at 707 hp net.
- Charge temperature is calculated the same way as for the turbo, with η_c from the table.

## 8. BSFC, thermal efficiency and EGT
- `BSFC [g/kWh] = 3.6e6 / (η_b · LHV[kJ/kg])`. For gasoline, η_b 0.36 → 232; 0.33 → 253; 0.30 → 279; 0.27 → 310.
- **Best-point BSFC** (part load, about 2000–3000 rpm, 60–80% load): modern DI gasoline 225–240 g/kWh (Toyota Dynamic Force record ≈ 205–210, i.e. η 0.40–0.41); older PFI 245–270.
- **WOT BSFC:** NA at λ 0.88: 260–300. Turbo at λ 0.78–0.82: 290–360, with the rich mixture and knock retard pushing it up. Supercharged: 300–380 (drive loss). Classic 2v carbureted V8 at WOT: 290–320 (≈ 0.47–0.52 lb/hp·h).
- **E85 BSFC** ≈ gasoline × 1.40–1.45 (lower LHV); **methanol** ≈ × 2.1–2.3.
- **EGT (exhaust port / pre-turbine):** NA WOT λ 0.88: 800–900 °C. Stoich WOT: 900–950. Turbo pre-turbine limits: 950 °C (cast iron/Ni-resist, older) and 980–1050 °C (modern Euro, steel/Inconel housings). Rich enrichment (λ 0.75–0.80) exists mainly to hold these limits. E85 runs 50–100 °C cooler, methanol 150–250 °C cooler. Each degree of spark retard adds 15–25 °C. Mid-load cruise: 550–700 °C.
- **Peak cylinder pressure:** NA gasoline 60–90 bar; turbo street 90–130 bar (modern DI turbo designs up to about 120–140); race turbo 150–200. Rough model: P_max ≈ IMEP·(6.0–7.0) for NA at MBT. Retard lowers it.

## 9. Mechanical limits
- **Mean piston speed at redline:** economy 15–19 m/s; production performance 20–24 (LS3 20.2, K20A 24.1, S54 24.3, GT3 24.4); top production 25–27 (F20C 25.2, Audi V10 26.9); NASCAR Cup ≈ 25–26; F1 2.4 V8 at 18–19 krpm ≈ 25; F1 V10 peak ≈ 26–27. **Suggested warnings:** info > 22, warn > 25, critical > 27.
- **Peak piston acceleration** (at TDC): `a = r·ω²·(1 + r/l)`.
  - K20A at 8400: 43,600 m/s² (≈ 4400 g). F20C at 9000: 46,800. LS3 at 6600: 28,800. F1 V8: ≈ 90,000 (≈ 9000 g).
  - **Suggested limits:** cast/hypereutectic pistons with cast rods ~35–40 km/s²; forged pistons and forged steel rods ~50–55 km/s²; billet/titanium race parts ~70–90 km/s².
  - Rod stress scales as (reciprocating mass)·a, so big bores are the limiting case.
- **Valve float rpm** (valve spring force vs. valvetrain mass × cam-imposed acceleration; valve acceleration ∝ L·(N/θ_dur)²):

| Valvetrain | Typical float / safe limit |
|---|---|
| Pushrod, hydraulic flat tappet, iron | 5500–6000 |
| Pushrod, hydraulic roller, production (LS3, Hemi) | 6500–7000 |
| Pushrod with Ti intake valves (LS7) | 7000–7200 |
| Pushrod solid roller race (NASCAR) | 9000–10000 |
| SOHC rocker | 6500–7500 |
| DOHC bucket, production | 7000–8000 |
| DOHC roller finger / short rocker, high-performance (K20, F20C, S54, GT3) | 8500–9500 |
| Pneumatic valve springs (F1) | 18000–20000 |

  Scale from the class base as `N_float ≈ N_base · (D_ref/D_v)^0.75 · sqrt(L_ref/L) · (dur/dur_ref)`, using refs of 35 mm, 11 mm and 230° for DOHC or 51 mm, 13 mm and 210° for pushrod. Small, light valves and long gentle lobes rev higher.

## 10. Engine mass (dry, with standard accessories)
- **Regression that fits the reference set to within about ±12%:**
  ```
  mass_kg ≈ (70 + 20·V_L) · k_vt · k_block + induction
  k_vt   : pushrod 1.00, sohc 1.06, dohc 1.12
  k_block: aluminum 1.00, iron 1.30 (iron block with aluminum heads; the factor covers the heavier block)
  induction: turbo +18 kg per turbo + 10 kg intercooler/piping; supercharger +35 kg (PD) / +20 kg (centrifugal)
  ```
- Checks: K20A ≈ 126 (published about 130–140); LS3 194 (190); 1GR 168 (166); Coyote 190 (≈ 200); 2JZ-GTE ≈ 245 (230); SBC iron 239 (≈ 240); F12 V12 ≈ 228 (≈ 225).

## 11. Fuel properties
| Fuel | AFR_st | LHV MJ/kg | Heat of vaporization kJ/kg | AKI (≈RON) | Max-power λ | Ideal charge cooling at max-power λ* |
|---|---|---|---|---|---|---|
| Gasoline E0 (race100 similar) | 14.7 | 43.4 | 350 | 87–93 (91–98) | 0.85–0.88 | ≈ 25 K |
| Pump gasoline E10 (gas87/91/93) | 14.1 | 41.9 | 380 | as labelled | 0.85–0.88 | ≈ 28 K |
| E85 (real blends E70–E85) | 9.8 | 29.2 | 840 | ≈ 100–105 equivalent (RON ≈ 108) | 0.78–0.82 | ≈ 95 K |
| Methanol | 6.46 | 19.9 | 1100 | ≈ 99 (RON 109, MON 89) | 0.65–0.75 | ≈ 230 K |

\*ΔT_ideal = HoV · (1/(AFR_st·λ)) / cp_air, assuming all of the fuel evaporates in the air. Only part of that cooling actually lowers the trapped-charge temperature. **Use about 0.35 for PFI (much of it evaporates on the port walls) and about 0.75 for DI.** The density gain is ΔT/T. Gasoline DI gains about 2–3% VE, E85 PFI about 4–6% and methanol about 8–12%, and each lowers the knock limit's effective charge temperature by the same ΔT.
- Fuel density: gasoline 0.74, E85 0.78, methanol 0.79 kg/L.

## 12. Default numeric constants (summary)
```
rho_amb 1.17 kg/m3 ; T_amb 298 K ; p_amb 1.0 bar ; a_inlet 345 m/s ; cp 1005 ; gamma_c 1.4
eta_ig = 0.82 * (1 - CR^-0.27)           (0.80 2v open chamber, 0.84 fast-burn DI)
f_lambda(λ<1) = 1 + 0.45(1-λ) - 1.6(1-λ)^2
Taylor Z limit 0.55–0.6 ; C_i 0.35 ; penalty 1 - 0.9*(Z-0.5)^1.5
Engelman K 2.15 ; L_eff = runner + 120 mm
Chen-Flynn C 0.35, A 0.005, B 0.060, Q 0.0012   (bar, bar, bar/(m/s), bar/(m/s)^2)
PMEP_NA WOT 0.1–0.6 bar ; turbo p3/p2 1.0–1.3 well matched
eta_c turbo 0.74 (0.60 near choke) ; roots 0.55 ; TVS 0.65 ; twin-screw 0.70 ; centrifugal 0.74
spark loss 0.0006*dRetard^2 ; knock: CR_eff = CR*MAP^0.4, CR_lim base 11.0 @91 AKI, 3.5 deg per CR unit over
BSFC best 225–240 ; WOT NA 260–300 ; WOT turbo 290–360 g/kWh
Sp warn 25 / crit 27 m/s ; piston accel 40/55/80 km/s2 (cast/forged/race)
```
