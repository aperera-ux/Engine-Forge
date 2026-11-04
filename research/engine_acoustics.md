# Engine acoustics reference (for the audio / synth agent)

This is a numeric reference for building a physically based synthesizer in `src/audio/`. It uses no recorded samples.
Symbols: `n` is the cylinder count, `N` is crank rpm, `θ` is crank angle in degrees, `c` is speed of sound,
`a` is pipe radius, `L` is pipe length and `fs` is the sample rate. "Order k" means k events per crank revolution, so
f = k·N/60. Engine-cycle frequency = N/120 (order 0.5).

Tags: **[src]** means the value is backed by the reference at the end of the line or in §9. **[rule]** means an industry
or engineering rule of thumb. **[calc]** means I derived it in this document; the script is described in §2.6.

Inputs available from the sim (`src/sim/types.ts`): `DynoPoint.imepBar`, `mapBar`, `boostBar`, `egtC`,
`exhaustPressureBar?`, `airFlowKgS` and `knockRetardDeg` per rpm. Config gives `exhaust` ('log'|'shorty'|'long-tube'|'tuned-equal'),
`headerPrimaryMm` (length), `headerDiameterMm`, `boreMm`, `induction`, the turbo and supercharger blocks, `itb`, `intakeRunnerMm` and
`valvetrain`. `computeLayout()` gives per-cylinder `firingPhaseDeg` (TDC compression, in [0,720)), `bank` and `row`.

---

## 0. TL;DR synth architecture (recommended)

```
 per cylinder i (n of them)                     per bank b (1 for inline, 2 for V/flat)
 ┌──────────────────────────┐   primary WG     ┌──────────┐  collector WG  ┌───────┐  ┌────────┐  tailpipe WG  ┌────────────┐
 │ blowdown pulse gen       │──(L_p, r_valve)──►│ N-port   │──(L_c)────────►│ cat / │─►│ muffler│──(L_t)──────►│ open-end   │─► d/dt ─► pan(b)
 │ trigger θ=φ_i+EVO        │◄────────────────  │ junction │◄───────────────│ LPF   │  │ (exp.  │◄─────────────│ refl. filt │    (monopole)
 │ amp ∝ (p_EVO − p_exh)    │                   └──────────┘                └───────┘  │ chamber│              └────────────┘
 └──────────────────────────┘        optional X/H crossover between bank collectors ─┘ └────────┘
 + intake: per-cyl suction pulse at IVO → runner WG (L_r) → plenum (Helmholtz 2-pole) → filter/airbox → mouth  (§4)
 + turbo/SC tonal + broadband (§5), mechanical transients (§6), listener/room (§7)
```

1. **Excitation.** Fire one pulse per cylinder at `θ_EVO,i = firingPhaseDeg_i + EVO`. EVO is about 130–150° after firing TDC, i.e. 30–50° BBDC.
   Take the cam value if the sim exposes one; otherwise use 140°. Integrate crank phase from rpm at audio rate. Never retrigger from wall-clock.
2. **Pulse shape.** Use an asymmetric attack and decay shape (§1.2) whose width is set mostly in crank degrees. Amplitude follows `p_EVO` (§1.1).
3. **Primaries.** Use one bidirectional delay line (digital waveguide) per cylinder, or per pair of cylinders that share a pipe.
   Length = `headerPrimaryMm`, with c from EGT (§1.3). The valve end reflects with r ≈ +0.9 (closed valve is a rigid end). The collector end is a
   scattering junction (§1.5).
4. **Collector and tailpipe.** Use one waveguide per bank, then a cat (1-pole lowpass at about 2–4 kHz plus about −3 dB), a muffler (§1.6) and a
   tailpipe ending in an open-end reflection filter (§1.4). Output the *transmitted* volume velocity and differentiate it. Far-field
   p ∝ ρ/(4πr)·dQ/dt, a monopole, so it is a +6 dB/oct tilt.
5. **Keep banks separate until the listener** (§2.3). Summing two crossplane banks into one mono line before any bank-specific
   filtering cancels most of the half-orders (§2.3). Pan or delay the banks independently, give them slightly different pipe lengths
   (1–3 %), and add per-cylinder amplitude interaction so the burble survives a mono fold-down.
6. **Noise.** Modulate band-limited noise (1–6 kHz) with the pulse envelope to get "flow" or turbulence. The level ∝ mass flow·|Δp|. Add
   cycle-to-cycle variation: pulse amplitude σ ≈ 3–6 % at WOT and 10–20 % at idle, plus timing jitter of about ±0.5–1.5° (§3.5).

This is the same topology as Baldan et al. 2015 (cylinders feeding intake and exhaust waveguides), Farnell's *Designing
Sound* "warped waveguide engine" (Practical 22), and Doerfler & Wyse 2026 (pulse train, then two bank resonators, then a shared resonator).
§1.7 summarizes these sources.

---

## 1. Exhaust pulse physics

### 1.1 Blowdown amplitude vs load
- **Mechanism.** At EVO the cylinder holds burned gas at `p_EVO`, while the port sits near 1 bar for NA, or at the turbine-inlet pressure for turbo. Gas flow through the
  valve is choked while p_cyl/p_port > ((γ+1)/2)^(γ/(γ−1)), which is **1.85** for γ = 1.35. That choked phase carries the "blowdown pulse",
  which holds about 50–60 % of the exhaust mass. The piston then displaces the rest at much lower Δp. **[src: Heywood ch. 6; Blair ch. 2]**
- **Typical p_EVO (bar abs) [src Heywood ch. 6 cylinder-pressure diagrams; rule for mapping]:**

  | Condition | MAP | p_EVO | Notes |
  |---|---|---|---|
  | Overrun / DFCO (no combustion) | 0.2–0.3 | 0.3–0.6 | Below exhaust pressure, so a *suction* pulse with inverted polarity: hollow, quiet |
  | Overrun, fuelled (closed throttle) | 0.2–0.3 | 1.0–1.5 | Tiny positive pulse |
  | Idle (NA) | 0.3–0.45 | 1.2–1.8 | |
  | Light cruise | 0.5–0.7 | 1.8–2.8 | |
  | WOT NA | ~1.0 | 3.5–5.5 | Higher with late EVO and high CR |
  | WOT turbo/SC, 1 bar boost | ~2.0 | 6–10 | Turbine-inlet back-pressure is 1.5–2.5 bar, so ΔP is smaller than p_EVO suggests |
- **Mapping from the sim (rule):** `p_EVO ≈ 0.6 + 0.30·IMEP_gross[bar]` bar abs. This gives idle IMEP 2.5 → 1.35, NA WOT 14 → 4.8 and turbo 25 → 8.1.
  With no IMEP available, use `p_EVO ≈ 4.5·MAP`.
- **Pulse amplitude driver.** Use `ΔP = max(p_EVO − p_exh, −0.5)`, where p_exh = 1.0 bar for NA, or `exhaustPressureBar` (turbine inlet).
  - **Peak pressure in the primary.** Near the port, the primary peak (gauge) ≈ 0.15–0.3·ΔP, which is about 0.3–1.0 bar at NA WOT and 0.05–0.15 bar at idle. Turbo manifolds see 1–2 bar pulses, but the turbine
    eats most of the energy (§5.6). **[rule, consistent with Blair 1999 measured port traces]**
  - **Map amplitude in dB, not linear.** Acoustic level grows sub-linearly because of the nonlinear choked flow. Use `A_pulse ∝ ΔP^0.8`,
    which makes idle → WOT about +15 to +20 dB at the tailpipe. That matches the drive-by and stationary data in §3.2.
- **Turbo.** The turbine is a large acoustic resistance and absorbs about 6–12 dB of exhaust pulse energy across the audio band.
  Turbo engines are quieter and "flatter", with suppressed odd/half orders. See §5.6.

### 1.2 Pulse shape and time scales
- **Shape.** Measured port and primary pressure traces show a fast rise to the peak 15–40 °CA after EVO, then a decay of roughly
  exponential form. The blowdown is mostly finished 45–70 °CA after EVO at mid speed. Low-speed production engines show it lasting
  up to about 100 °CA, e.g. about 100 °CA at 1200 rpm on a production V6. A smaller displacement-phase "hump" follows, then a
  negative (sub-atmospheric) excursion if the system is tuned. **[src: Blair 1999; patent traces showing the peak soon after EVO; eng-tips thread]**
- **Time scales.** 1 °CA = 1/(6N) s. At 800 rpm 1° = 208 µs, at 3000 rpm 55.6 µs, at 6000 rpm 27.8 µs, at 9000 rpm 18.5 µs.
  A 50° blowdown therefore lasts 10.4 ms at idle and 1.4 ms at 6000 rpm.
- **Speed dependence.** Blowdown is partly a fixed-*time* process, since mass leaves through a sonic orifice. As rpm rises it therefore occupies
  more crank angle. Recommended model:
  `θ_rise ≈ 12° + 10°·(N/N_red)`, `θ_decay(τ) ≈ 20° + 25°·(N/N_red)`, with a floor of `t_rise ≥ 0.25 ms` **[rule]**.
- **Pulse function** (the same family as Doerfler & Wyse 2026, Eq. 4). It works on local phase ψ = θ − θ_EVO in degrees:
  `P(ψ) = A·(1 − e^{−ψ/θ_rise})·e^{−ψ/θ_decay}` for ψ ≥ 0. Add an optional negative tail `−0.2A·e^{−(ψ−ψ_peak2)²/…}` at about 90–150° for tuned
  long-tube headers. Inject this as **volume velocity / pressure into the valve end of the primary waveguide**.
- **Spectral consequence.** A pulse of width w (seconds) has a spectral roll-off corner near 1/(πw). At idle (w ≈ 10 ms) the content
  above about 50–100 Hz falls off fast, which gives a dull, thumpy sound. At 6000 rpm (w ≈ 1.5 ms) the content reaches about 200–400 Hz before
  the roll-off, and pipe resonances fill in above it.
- **Doppler-like "pitch bend".** Hot fast gas makes each pulse's onset sharper, with a downward chirp. Doerfler & Wyse model this with
  phase bending `ϕ̃ = 2π(ϕ/2π)^ν`, ν ∈ (0,1]. It is optional.

### 1.3 Speed of sound in exhaust
`c = sqrt(γ R T)`, with R ≈ 288 J/kg·K for burned stoichiometric gas, γ ≈ 1.33–1.36 hot and 1.38 cool. **[src Heywood ch. 4; Blair]**

| Location / T | T (K) | c (m/s) |
|---|---|---|
| Port at NA WOT (EGT 850–950 °C) | 1120–1220 | 655–685 |
| Primary average, WOT | 1000–1100 | 620–650 |
| Primary, idle (EGT 350–500 °C) | 620–770 | 490–545 |
| Collector / downpipe | 850–1000 | 570–620 |
| After cat and muffler, tailpipe | 500–750 | 440–535 |
| Cold start | 300–350 | 345–375 |

Compute `T_primary ≈ egtC + 273 − 80`, then taper by about −100 to −150 K per metre of pipe downstream. Re-tune the delay lengths slowly, with a time constant
of about 1–3 s for gas temperature and about 30–120 s for wall warm-up. A "cold start" drone is therefore lower in pitch.

### 1.4 Pipe resonances, end corrections, reflections
- **End conditions.** The primary is **closed–open**. It is closed at the valve while the valve is shut, which is about 70 % of the cycle, and open into the
  collector. Quarter-wave modes: `f_m = (2m − 1)·c / (4·L′)`. Collector-to-muffler or tailpipe segments between big area changes are
  **open–open**. Half-wave modes: `f_m = m·c / (2·L′)`. **[src: Kinsler et al., *Fundamentals of Acoustics*]**
- **End correction.** Each open end adds `ΔL = 0.61·a` (unflanged, Levine & Schwinger 1948) or `0.82–0.85·a` (flanged, or a pipe
  ending in a large chamber). `L′ = L + ΣΔL`.
- **Open-end reflection coefficient.** `R(ω) ≈ −|R|`, with `|R| ≈ 1 − 0.5(ka)²` for ka < 0.5, and ka = ωa/c. Above ka ≈ 1.8 (unflanged)
  the pipe radiates almost everything. Implement it as `−(1−g)` times a 1-pole lowpass. Typical corners: 50 mm pipe at c = 500 gives ka = 1 at 3.2 kHz,
  so the lowpass corner is about 1.5–3 kHz. **[src: Levine & Schwinger 1948]**
- **Area-change junction (plane wave)** going from area S₁ into S₂: pressure reflection `R = (S₁ − S₂)/(S₁ + S₂)` and transmission `T = 1 + R`.
  **N-pipe junction** (collector): for a wave arriving from pipe j, `R_j = (2S_j/ΣS) − 1` and `T_{j→k} = 2S_j/ΣS` (pressure; Kirchhoff
  volume-velocity conservation). That is the standard scattering junction in waveguide models. **[src: J.O. Smith, *Physical Audio Signal Processing*, "Scattering junctions"]**
  - Example 4-1: four primaries of area S plus a collector of 2.5 S give ΣS = 6.5 S. Each primary sees R = 2/6.5 − 1 = −0.69, and each
    other port receives T = 0.31.
- **Valve-end reflection.** Use r ≈ +0.85 to +0.95 while the valve is closed. While it is open the valve end is partly absorbing, about +0.3 to 0, into the cylinder volume.
- **Losses** (viscothermal, wall friction, heat): attenuation `α ≈ 3×10⁻⁵·√f / a` Np/m for room-temperature air (Kinsler), about
  2–3× that in hot rough exhaust pipe, plus large flow losses at bends and junctions. **Practical:** per round trip, gain 0.85–0.95 at DC to 300 Hz
  falling to 0.5–0.7 at 4 kHz. Implement it as a 1-pole lowpass inside each waveguide loop, with the pole at 0.2–0.5 and the corner at 3–8 kHz, plus a broadband gain of 0.97–0.99 per metre.
- **Typical resonance numbers [calc]:**

  | Element | L | c | Mode formula | f₁ | Next modes |
  |---|---|---|---|---|---|
  | Long-tube primary | 0.80 m (Ø 44 mm) | 630 | c/4L′ | 193 Hz | 579, 965 |
  | Shorty primary | 0.30 m | 630 | c/4L′ | 510 Hz | 1530 |
  | Log manifold runner | ~0.10 m | 650 | c/4L′ | ~1.6 kHz | (log acts as a small volume) |
  | Collector→cat | 0.6 m | 600 | c/2L′ | 500 Hz | |
  | Full system, open tailpipe | 3.5 m | 480 | c/2L′ | 69 Hz | 137, 206 |
  | Straight-through tailpipe 2.5" | 1.2 m | 470 | c/2L′ | 190 Hz | |

  The 60–140 Hz full-system modes cause **cruise drone** when the firing order lands on them, e.g. a V8 at 1800 rpm puts order 4 at 120 Hz.
- **Waveguide implementation.**
  - **Lengths.** Delay in samples per direction is `D = fs·L/c`. At 48 kHz a 0.8 m primary at 630 m/s is 61 samples, and a 3.5 m system at 480 m/s is 350 samples.
  - **Fractional delay.** Use 3rd-order Lagrange or a Thiran allpass, so that temperature changes modulate smoothly with no zipper noise.
  - **Waves.** The pulse is non-linear (a finite-amplitude shock), but a linear waveguide is fine for synthesis. Optionally add a mild amplitude-dependent
    speed `c_eff = c·(1 + 0.6·p′/p₀)`, applied to the delay of large pulses only, which steepens the pulse fronts. It is cheap and gives an "edge" at WOT.

### 1.5 Collector types and how they shape sound

| Exhaust type (config) | Topology to build | Sonic effect | Synth knobs |
|---|---|---|---|
| `log` | Very short runners (0.05–0.15 m) into a common log, a small volume of 0.3–1 L/bank, then a single outlet | No tuned primaries, and pulses overlap. Sound is muddy and less "ripping", with strong low orders and dull highs | Primary L 0.1 m; log as a 2-pole Helmholtz/lowpass at 300–800 Hz; R ≈ −0.3 |
| `shorty` | 0.25–0.4 m primaries, 4-1 | Brighter than a log; quarter-wave at about 0.5 kHz | |
| `long-tube` | 0.7–1.0 m primaries, 4-1 per bank | Strong primary resonance at 150–250 Hz, an aggressive mid "rasp" at 1–3 kHz from sharp pulses, and the loudest result | |
| `tuned-equal` | Equal-length 4-2-1 (I4) or 180° "bundle of snakes" headers (V8) | Most even pulse arrival; clean, pure tone; the scream | Equal L; for V8 flat-plane / 180° headers, route the merged even train to both pipes |

- **4-2-1** (I4, FO 1-3-4-2). Pair cylinders 360° apart (1&4, 2&3) into secondaries of 0.4–0.6 m, then merge. Each secondary carries an even
  360° train, order 1 plus harmonics, which gives a secondary resonance at c/4L ≈ 260–400 Hz. This favours mid-range torque and a deeper note than 4-1.
- **V8 crossplane, separate bank exhausts (dual, no crossover).** Each bank carries an uneven 90/180/270/180 train, which produces the strong half-orders of §2.3. This is the
  classic US muscle-car burble.
- **H-pipe (balance tube).** It sits about 0.3–0.6 m after the collectors. Model it as a third waveguide joining the two bank lines with junctions.
  It leaks about 15–30 % of the pulse energy to the other bank, i.e. a mixing factor m ≈ 0.15–0.3. Half-orders drop about 3–8 dB and the tone gets deeper
  and smoother.
- **X-pipe.** The pipes merge at an angle, so m ≈ 0.3–0.5. Half-orders drop about 8–20 dB, at m = 0.5 they cancel (§2.3 calc), and the sound becomes a raspier, higher "exotic" tone dominated
  by order 4. (Aftermarket folklore agrees: "H-pipe = deep muscle, X-pipe = raspy/higher".)
- **Single exhaust (Y-merge).** Same as m = 0.5, but the acoustic merge lies before most of the system, so the result is mostly even-firing order 4.
- **Flat-plane V8 / I4 / boxer equal-length.** Banks are already even. Crossovers change little except the overall resonances.
- **Twin-turbo V (hot-V or one turbo per bank).** Each turbine absorbs its bank's pulses (§5.6).

### 1.6 Mufflers, cats, resonators
- **Expansion chamber** (area ratio m = S_chamber/S_pipe, length L_ch):
  `TL = 10·log10[1 + ¼(m − 1/m)²·sin²(k·L_ch)]`. With m = 9, peak TL ≈ 13 dB. TL drops to 0 at `f = n·c/(2L_ch)`. **[src: Munjal, *Acoustics of Ducts and Mufflers*; Kinsler]**
- **Implementation.** Use a junction into a short waveguide of length L_ch and back, which gives exactly the expression above. A cheaper option is a comb/notch.
- **Absorptive "glasspack" / straight-through.** High-frequency loss above 500–1000 Hz: about 5–15 dB at 2 kHz. Implement it as a 1-pole LPF, or a shelf of −6 to −15 dB above 1 kHz.
- **Chambered / turbo muffler (reactive).** Broad −15 to −25 dB attenuation over 100–1000 Hz, with resonant peaks.
- **Catalytic converter.** About −2 to −5 dB, mostly above 1 kHz. It also smears sharp fronts, so treat it as a lowpass at 2–4 kHz.
- **Quarter-wave side branch / Helmholtz resonator** (OEM drone killers). Notch at `c/4L_b`, tuned to the cruise drone (60–120 Hz) **[src: Munjal]**.

### 1.7 Prior physically based engine-sound synthesizers (architectures)
- **Baldan, Lachambre, Delle Monache, Boussard (2015)**, "Physically informed car engine sound synthesis for virtual and augmented
  environments", IEEE SIVE (DOI 10.1109/SIVE.2015.7361287). This is a procedural model and Max/MSP external used in GeneCars and SkAT Studio.
  - **Components.** Each cylinder is a 4-stroke excitation. The intake, exhaust and engine-block "resonators" are waveguides / delay lines with
    scattering, plus a muffler and outlet radiation.
  - **Controls.** Physically meaningful parameters: cylinders, firing order, rpm, load and pipe lengths.
  - **What I could not confirm.** I could not get the PDF (HTTP 403), so its exact numeric parameters are unconfirmed.
- **Farnell, *Designing Sound* (MIT Press 2010), Practical 22 "Car engines"**, as ported to SuperCollider (sccode 1-4RH).
  - **Engine and "four-stroke" generator.** A crank phasor at `speed × 30 Hz` drives four taps of a shared delay buffer at 5/10/15/20 ms. Each tap is
    phase-offset by 0, 0.25, 0.5 and 0.75, passed through `cos(2πx)`, and shaped by `1/(x²+1)`. Jitter comes from 20 Hz lowpassed noise.
  - **Exhaust and transmission.** A parabolic pulse branch feeds a **four-delay feedback ring ("warped waveguide")**. Its lengths are 8, 12, 20 and 28 ms × an fm factor,
    with the fm factor modulated by engine speed (×0.67) so the delays shorten as speed rises. Feedback is 0.35. The overtone taps sit at 20/30/45 ms.
  - **Output.** It is high-passed at 200 Hz and mixed with the cylinders.
  - **Lesson for us.** Warping the waveguide delays with rpm, which stands in for temperature and speed, adds life to the sound. Jitter softens harshness at high rpm.
- **AngeTheGreat engine-sim (2022, open source).** A full rigid-body plus 0-D/1-D gas-dynamics engine simulation.
  - **Pipeline.** Ange describes the audio as the exhaust-port mass-flow / pressure signal taken from the simulation and sent to an audio
    thread. There it is **convolved with an impulse response**, the exhaust "reverb/resonance", and has **white noise added for turbulence**.
  - **What drives the realism.** It comes from the simulated pulse train, uneven firing and the exhaust runner-length offsets, rather than from an acoustic pipe
    network. Each engine script gives per-cylinder exhaust runner lengths (`primary_tube_length`) and an `impulse_response` WAV.
- **Jagla, Maillard, Martin (2012)**, ICASSP and JASA 132(5):3098: "harmonic synchronous overlap-and-add" (HSOLA/PSOLA).
  - **Method.** Sample-based: it extracts one-engine-cycle grains from a run-up recording and overlap-adds them pitch-synchronously.
  - **Use for us.** It is not a physical model. Its useful lesson is that **one engine cycle (720°) is the natural "period"**, because engine sound is harmonic in
    orders of N/120, not N/60.
- **Doerfler & Wyse (2026)**, arXiv 2603.09391, "Pulse-Train-Resonator" (differentiable).
  - **Pulse train.** Per cylinder: `P_i = E_i·c_i·Σ_k a_k sin(kϕ̃_i)` with envelope `E = (1−e^{−αϕ})e^{−βϕ}`, harmonic decay
    `a_k ∝ e^{−0.5kλ}`, per-cylinder timing offsets of ±40° and gains c_i.
  - **Resonators.** **Two bank resonators** (Karplus-Strong style: delay L, 2-tap loss filter, |k| < 1) feed **one shared final
    resonator**, which stands for the manifold and then the common pipe.
  - **Noise and gating.** An ERB-spaced noise bank is gated by throttle `g = max(torque, 0.02)^0.7` and by DFCO `g = max(−torque, 0.02)`.
  - **Performance.** It beat a harmonic-plus-noise baseline by about 21 % on harmonic loss.
  - **Validation of our plan.** This is close to our recommended topology.

---

## 2. Firing-order signatures

### 2.1 Basic frequencies
- **Firing frequency (4-stroke):** `f_fire = (N/60)·(n/2)`, which is order n/2. **Cycle frequency** `f_cyc = N/120` (order 0.5). The exhaust
  of a single bank of m cylinders on its own pipe has its fundamental at order m/2 *only if* its firing is even. Otherwise
  energy appears at every multiple of 0.5 order.

| Engine | Order | Idle (rpm → Hz) | 3000 rpm | Redline (rpm → Hz) |
|---|---|---|---|---|
| I3 | 1.5 | 850 → 21 | 75 | 6500 → 163 |
| I4 / flat-4 | 2 | 800 → 27 | 100 | 7000 → 233; 9000 (S2000) → 300 |
| I5 | 2.5 | 800 → 33 | 125 | 6800 → 283 |
| I6 / V6 / flat-6 | 3 | 700 → 35 | 150 | 7500 → 375; 9000 (GT3) → 450 |
| V8 | 4 | 650 → 43 | 200 | 6500 → 433; 9000 (flat-plane) → 600 |
| V10 | 5 | 800 → 67 | 250 | 8700 (LFA ~9000) → 750; F1 19 000 → 1583 |
| V12 | 6 | 700 → 70 | 300 | 9250 (Valkyrie 11 100) → 925 (1110) |
| V-twin | 1 (+0.5 sidebands) | 900 → 15 | 50 | — |

### 2.2 Even-fire engines: harmonic structure [calc, impulse-train model §2.6]
For even firing, the merged pulse train contains **only multiples of order n/2**:
- **I4:** orders 2, 4, 6…
- **I5:** 2.5, 5, 7.5…
- **I6:** 3, 6…
- **V12:** 6, 12…

The real spectrum is these lines times the pulse spectrum (§1.2) times the pipe transfer function. Small cylinder-to-cylinder differences (±3–8 % amplitude, ±1–3° timing) create weak "in-between" orders 20–35 dB below the firing order. **Synthesize these differences.** Without them every engine sounds like a buzzer.

| Engine | Character | Spectral reason / synth note |
|---|---|---|
| **I6 "silk"** | Smooth, creamy, turbine-like | Even 120° pulses. 6 into 1 (or 3-into-1 ×2 pairs with 240° per bank in the BMW split manifold) gives order 3 with little sub-harmonic energy. Primary balance means little structural noise. The harmonic series is dense, smooth and fairly rich in orders 3, 6, 9 and 12. Use very low cycle-to-cycle variation. |
| **I5 warble** | Audi/Volvo "warble" | Order 2.5 places the firing frequency at a half-integer of the crank frequency, so the 1st-order mechanical noise from crank and rotating imbalance sits *between* exhaust harmonics. Rocking-couple vibration at order 1 also exists. The 144° interval plus a 5-1 collector with unequal runners gives cylinder-specific amplitudes, so **visible energy at orders 0.5, 1, 1.5, 2** around the 2.5 line produces the warble. Use per-cylinder gains with ±10 % spread. |
| **I4** | Buzzy, "thrashy" | Order 2 plus strong 2nd-order *mechanical* vibration (secondary imbalance) → add order-4 structure noise. With 4-2-1 there is a minor order-1 component from pairing. |
| **I3** | Thrummy, "half a V6" | Order 1.5 plus a strong 1st-order rocking couple; "off-beat" feel. |
| **V12** | Smooth, high, "tearing silk" | Even 60°. Each bank is an I6 (even 120°), so it stays smooth even with two separate exhausts. Order 6 has very little below it. The high pulse rate means the "rip" lands at 500–1000+ Hz near redline. |
| **V10 (even, 72°, e.g. LFA/Carrera GT/F1)** | Shrieking | Each bank is an even I5 (144°), so per-bank energy appears at 2.5, 5… Merged it is order 5. Odd-fire 90° V10s with common pins (e.g. Lamborghini Gallardo 5.0, 2003–08, 54°/90° intervals; the 5.2 FSI changed to even fire) have merged orders 2.5: 0.38, 5: 0.71, 7.5: 0.92 [calc], which gives a gruffer, "V5+V5" sound. Handle odd fire generically from the layout intervals. |
| **V6 60° even (or 90° with split pins)** | Smooth, slightly gruff | Each bank is an even I3 (240°), so orders 1.5, 3, 4.5… sit in each bank. With separate bank exhausts, order 1.5 is strong per bank. |
| **V6 90° odd-fire (Buick 231 pre-1978, 90/150)** | Lumpy, uneven idle | Merged train shows orders 1.5 (0.38 rel.), 3 (0.71), 4.5 (0.92) [calc]. `computeLayout` generic V6 gives even 120°; odd-fire only appears if the lead adds special phases. |

**Note on `layout.ts`:** V6/V10/V12 use the generic construction, which gives even firing with bank B lagging bank A by 720/n. That matches 60° V6s,
72° V10s and 60° V12s (or split-pin designs). Crossplane V8, V-twin and boxer use explicit phases.

### 2.3 Crossplane vs flat-plane V8 (the most important case) [calc]
- **Crossplane FO in `layout.ts`:** 1-5-4-2-6-3-7-8, with cylinders 1–4 on bank A and 5–8 on bank B. The merged train is even at 90°.
  - **Per-bank intervals** are **180, 90, 180, 270** on bank A and **270, 180, 90, 180** on bank B. Their sum is 720.
  - **Per-bank order magnitudes**, from an impulse-train model normalized so that the firing order = 1:

    | Order | 0.5 | 1.5 | 2.5 | 3.5 | 4 | 4.5 | 5.5 | 6.5 | 7.5 | 8 |
    |---|---|---|---|---|---|---|---|---|---|---|
    | Bank A or B alone | 0.27 | **0.65** | **0.65** | 0.27 | 1.00 | 0.27 | 0.65 | 0.65 | 0.27 | 1.00 |
    | Banks summed (mono) | 0 | 0 | 0 | 0 | 1.00 | 0 | 0 | 0 | 0 | 1.00 |
    | X-pipe mix m = 0.15 | 0.19 | 0.46 | 0.46 | 0.19 | 1 | … | | | | |
    | X-pipe mix m = 0.3 | 0.11 | 0.26 | 0.26 | 0.11 | 1 | … | | | | |
    | m = 0.5 (single exhaust, perfect merge) | 0 | 0 | 0 | 0 | 1 | | | | | 1 |

    Orders 1 to 3 (integer) and 2 are zero per bank.
  - **The burble is the strong 1.5 and 2.5 orders** (−4 dB re order 4), plus order 0.5, which is the once-per-cycle amplitude
    modulation you hear as "potato" lope at idle (650 rpm → 5.4 Hz cycle rate).
  - **⚠ The two banks' half-order components are in antiphase.** A naive mono sum of identical bank chains cancels them, so
    the result sounds like a flat-plane. Real cars keep the burble because:
    - the two tailpipes sit at different distances and angles from the listener (§7);
    - each bank's pipe transfer function differs;
    - **gas-dynamic interaction within a bank**: a cylinder that exhausts only 90° after its bank-mate pushes into a
      collector still pressurized by that pulse, so its pulse is weaker and broader. Use a rule: scale pulse amplitude by
      `1 − 0.25·exp(−Δθ_prev_same_bank/60°)`, which gives about 0.82 after 90° and about 0.95 after 180°;
    - loads and timing differ cylinder to cylinder.

    Build all four. Then crossplane stays burbly in mono, especially with separate bank exhausts.
- **Flat-plane FO** 1-5-3-7-4-8-2-6. Each bank is an even I4 at 180° intervals, so per-bank orders are 2, 4, 6. There are **no half-orders**. It sounds like two
  I4s, with the high-rpm scream of Ferrari, McLaren, the GT350 Voodoo and the Corvette C8 Z06. Flat-plane engines rev higher, so the firing frequency reaches 500–600 Hz.
- **Crossplane with 180° headers** ("bundle of snakes", GT40 and racing) pairs cylinders across banks so that each 4-1 collector sees even
  180° spacing. The burble disappears and it sounds like a flat-plane but deeper. Use this for `exhaust: 'tuned-equal'` on a crossplane V8.

### 2.4 V-twin, boxer and other uneven cases [calc]
- **V-twin, shared pin (Harley 45°).** Intervals are 405/315°, which gives "potato-potato".
  - **Merged orders (rel):** 0.5: 0.20, 1: 0.92, 1.5: 0.56, 2: 0.71, 2.5: 0.83, 3: 0.38, 3.5: 0.98…
  - **Character.** A dense half-order series with *no* dominant firing line. The idle cycle rate (N/120) at 900 rpm is 7.5 Hz, and that is the beat you hear.
- **90° V-twin (Ducati) and 270° parallel twin.** Intervals are 450/270°. Orders 0.5: 0.38, 1: 0.71, 1.5: 0.92, 2: **0**, 2.5: 0.92, 4: 1.0.
- **Boxer-4 (Subaru EJ).** The *firing* is even at 180°, but **each bank fires at 180/540°**, so a per-bank train shows orders
  0.5/1.5/2.5 at 0.71.
  - **Equal-length (EL) headers** merge all four evenly, so the result is pure order 2 and smooth.
  - **Unequal-length (UEL) headers** (the EJ20/EJ25 rumble) add a roughly *fixed time offset* per cylinder, about 0.5–1.5 ms,
    so the arrival offset in degrees grows with rpm.
    - **Model:** an extra delay τ_i of 0.6–1.0 ms on cylinders 2 and 4.
    - **With τ = 0.9 ms:** at 2500 rpm the intervals become 194/166°, with order 1: 0.12, order 3: 0.35 and order 5: 0.56. At 5000 rpm they become 207/153°, with order 1: 0.23 and order 3: 0.65.
    - **Result:** the rumble grows with rpm and odd integer orders appear. Implement it simply as different primary waveguide lengths: 0.3–0.6 m longer
      on two cylinders, which gives 0.5–1.0 ms at c ≈ 600.
- **Flat-6 (Porsche).** Each bank is an I3 at 240°, so per bank you get orders 1.5, 3, 4.5. Porsche uses separate banks up to the mufflers, so a mild
  "1.5-order" raspy growl rides on order 3.
- **Generic rule for the synth.** Compute each bank's (or each collector's) arrival times from `firingPhaseDeg` plus `θ_EVO` plus the per-pipe
  delay. Never hard-code a signature. It falls out of the timing.

### 2.5 Idle lope from cams
Big overlap (`lobeSeparationDeg` < 110°, duration > 240° @0.05") gives exhaust reversion and cycle-to-cycle combustion variability at idle.
COV(IMEP) rises from 2–3 % on a stock cam to 10–20 % on a big cam. Synth: raise per-cycle amplitude σ to 15–30 % and add occasional misfires
(1–3 % of cycles), which causes the "chop" even on even-fire engines. **[rule; Heywood ch. 9 on cyclic variability]**

### 2.6 Reproducing the order tables
The order magnitudes are `|Σ_j exp(−i·2π·k·θ_j/720)|/m` for impulses at arrival angles θ_j, with k = 1…16 meaning order k/2. The script
lives in the session scratchpad and does not ship. It is trivial to re-implement as a unit test (§8).

---

## 3. Typical spectra and levels

### 3.1 Where the energy is (exhaust outlet, ~0.5–1 m)
- **Main band:** the firing order and its 2nd–6th harmonics carry most energy, plus the pipe resonances. For muffled road cars the A-weighted
  energy peaks at about **80–500 Hz** under load. Broadband flow noise fills 500 Hz–5 kHz and rises with mass flow. **[rule; consistent with ISO 5130 analyses]**
- **Idle:** the fundamental is 25–70 Hz, which is heavily A-weighted down (−30 to −45 dB at 30 Hz). The perceived sound comes from harmonics at 100–400 Hz
  and the per-pulse "thud".
  - **Centroid:** spectral centroid (unweighted) ≈ 150–400 Hz for a muffled V8 and 200–600 Hz for an I4.
- **High-rpm WOT:** firing 200–900 Hz, harmonics to 3–5 kHz, plus a strong 1–4 kHz rasp from sharp pulse fronts and turbulence.
  - **Centroid:** ≈ 800–2500 Hz for a performance NA engine.
  - **Log-centroid rule:** `centroid ≈ 4–8 × f_fire` under load, and 3–5 × at light load.

### 3.2 Levels (dB(A))
| Measurement | Typical | Source |
|---|---|---|
| EU pass-by limit (Reg. 540/2014, ISO 362, 7.5 m, accelerating) | 68–74 dB(A), varies by class/phase | **[src: EU 540/2014]** |
| Stationary exhaust test (ISO 5130, 0.5 m, 45°, at ¾ rated rpm) | Economy 70–85; sports 90–100; loud aftermarket 100–110 | **[src: ISO 5130 method; type-approval data]** |
| Track-day static limits (0.5 m, 45°, ¾ rpm) | 98–105 dB(A) typical limit | **[rule: UK circuit limits]** |
| Straight-piped V8 / race car at 0.5 m | 110–130 dB(A) | **[rule]** |
| Cabin: idle / 100 km/h cruise / WOT acceleration | 40–50 / 62–70 / 70–85 dB(A) | **[rule; NVH literature]** |
| Engine bay, 1 m, WOT | 90–105 dB(A) | **[rule]** |

- **Rpm scaling at constant load.** Exhaust orifice noise rises about **+15 to +20 dB per decade of rpm** at WOT (orifice noise ∝ roughly
  (flow velocity)^4–6). Rule: `L(N) ≈ L_ref + 17·log10(N/N_ref)`.
- **Load scaling at constant rpm.** WOT vs light load is about **+8 to +15 dB**. Closed-throttle overrun vs WOT is about **−15 to −25 dB** in the orders.
  The broadband share rises, with the spectrum tilting about −3 to −6 dB/oct darker in the orders but with relatively more hiss.
- **Implementation.** If the pulse-amplitude law of §1.1 (`A ∝ ΔP^0.8`) and the noise law below are both used, levels come out roughly right. Normalize the
  master so that a redline-WOT V8 peaks at about −3 dBFS.

### 3.3 Load and spectral tilt
- **WOT.** Sharper and larger pulses give more high-harmonic content (+3 to +6 dB at 1–4 kHz relative to the fundamental vs part load).
  Strong flow noise.
- **Part load.** Smaller pulses with relatively more low orders give a "mellow" sound.
- **Overrun (closed throttle, fuelled or DFCO).** Orders are quiet, there is intake hiss through the nearly closed throttle (§4), and exhaust gas is cooler, so c drops by
  5–10 % over 1–2 s and resonances drift down. With DFCO the pulses invert (suction) at a few % of WOT amplitude. The overrun sound is mostly
  mechanical plus whoosh.
- **Throttle tip-in transient.** Pulse amplitude rises over 1–3 cycles. There is no overshoot in NA; in turbo, boost lags 0.3–2 s (§5).

### 3.4 Overrun crackle / pops / bangs
- **Cause.** Unburnt fuel and air ignite in the hot exhaust: retarded spark on overrun, rich tip-out, or misfire. **[src: general; rule]**
- **Synth model:**
  - **Event probability.** Each EVO on overrun has crackle probability `p = p0·hot·rich`. Use p0 ≈ 0.02–0.08 for a stock engine and 0.15–0.4 for a "pops & bangs" tune,
    for 1–4 s after lift-off, decaying as the exhaust cools.
  - **Event shape.** A short broadband explosion: 0.5–3 ms attack, 5–30 ms decay. Spectrum 150 Hz–8 kHz. Peak 10–25 dB above the overrun background,
    which is roughly at or above the WOT pulse level for big bangs.
  - **Injection point.** Inject it into the *collector/tailpipe* waveguide, not the primary, so it rings the tailpipe modes.
  - **Variation.** Randomize amplitude by ±6 dB and delay by 0–20 ms after the EVO.
  - **Clusters.** "Crackle" means trains of small events; "bang" means a single large event. Use 70 % small and 30 % large.

### 3.5 Rev limiter
- **Fuel cut** (most road cars). Injection stops for some cylinders or all of them until rpm drops 100–300 rpm. Heard as level dropouts and a "bouncing" at
  about 5–15 Hz: on/off chop with **no** bangs.
  - **Hard cut:** all cylinders.
  - **Soft cut:** a rotating pattern of individual cylinders. It sounds rougher and adds sub-orders, but stays quiet.
- **Spark cut** (motorsport, tuned cars, "2-step" / launch control). Fuel is still injected but not ignited, so raw mixture reaches the hot exhaust
  and detonates. You get **loud bangs and "brap-brap"**, at the same 5–15 Hz chop with crackle probability near 0.5–1 per cut cycle.
  - **Synth:** set the limiter state from rpm ≥ redline with hysteresis of 150–250 rpm. Gate per-cylinder firing (fuel cut → amplitude 0 / suction pulse; spark cut →
    pulse replaced by afterfire event, p = 0.6).

### 3.6 Cycle-to-cycle variability (makes it sound real)
- **Gaussian per pulse.** Amplitude σ: 3–5 % at WOT, 8–15 % at idle, and 15–30 % for a big cam at idle. Timing jitter σ: 0.3–1° at WOT and 1–2° at idle.
- **Per-cylinder static offsets.** Amplitude ±3–8 %, timing ±1–2°.
- **Rpm wobble at idle.** ±10–30 rpm at 0.5–2 Hz, from the idle controller.
- **Source.** COV(IMEP) of 2–5 % for production engines **[src: Heywood ch. 9]**.

### 3.7 EVO and IVO from `CamConfig` (to place the pulses)
Cam durations are usually quoted @0.050" lift. Seat-to-seat ("advertised") duration is roughly @0.050" + 40–55°. **[rule]**
- **Exhaust centerline** (deg before overlap TDC): `ECL = 2·LSA − ICL`.
- **EVO** (deg after firing TDC): `θ_EVO = (360 − ECL) − dur_adv/2`. For example, LSA 112, ICL 108 and dur_adv 270 give ECL = 116 and θ_EVO = 244 − 135 = **109°** (71° BBDC).
  The acoustically effective opening, i.e. the pulse start, is about 10–20° later than seat opening, so use `θ_pulse ≈ θ_EVO + 15°`.
- **IVO** (deg after firing TDC): `θ_IVO = 360 + ICL − dur_adv,int/2`. This is the intake event in §4. It occurs before overlap TDC.

---

## 4. Intake sound

- **Source.** Each cylinder draws a suction pulse from the start of the intake stroke to about BDC. Pressure in the runner near the valve swings ±0.1–0.4 bar at NA
  WOT. The intake carries the same order content as the exhaust but with inverted polarity. The throttle sits between the runners and the air inlet. **Transmission to
  atmosphere scales roughly with throttle open area.** At part load the intake orders are 10–25 dB quieter than at WOT, and **throttle hiss** appears.
  **[rule; Heywood ch. 7, Engelman 1953]**
- **Speed of sound** at 300–330 K gives c = 347–364 m/s, or about 340–380 m/s with boost and the intercooler outlet.
- **Runner quarter-wave:** the runner is closed at the valve and open into the plenum or to atmosphere, so `f = c/(4·(L + 0.6a))`. (`intakeRunnerMm` 250 mm, Ø 45 → 335 Hz; 400 mm → 212 Hz.)
  This is the "honk" formant of the induction sound.
- **Plenum and inlet Helmholtz:** `f_H = (c/2π)·sqrt(A/(V·L_eff))`, with A = inlet/throttle area and L_eff = L_neck + 1.7a.
  - Example: a 4 L plenum with a Ø70 mm throttle body and 0.25 m inlet tube gives about **97 Hz**.
  - The airbox is a second Helmholtz stage. A typical 6–10 L airbox with a Ø70–80 snorkel of 0.2–0.4 m is about **40–90 Hz**. It boosts the low orders and acts as a 2-pole
    lowpass above that, roughly −12 dB/oct above 300–500 Hz.
  - Model it as a resonant 2-pole bandpass/lowpass at f_H with Q ≈ 2–5. **[src: Kinsler; Engelman 1953]**
- **Throttle hiss.** At part load the throttle flow is choked whenever MAP/p_amb < 0.53. This gives broadband noise at 1–8 kHz, with level ∝ mass
  flow and peaking at mid-opening. It is the main "intake" sound at cruise and the "sucking" sound on tip-in. Model it as bandpassed noise with gain ∝
  `airFlowKgS·(1 − MAP)`.
- **ITB (`itb: true`).** Each runner has its own throttle and velocity stack open to atmosphere: short (0.15–0.3 m) runners and no plenum.
  - **Effects:** loud direct intake pulses, a strong runner-resonance honk at 300–600 Hz, and a "hollow howl". It is very strong at WOT and close to
    the exhaust level when heard in the engine bay. Examples: BMW S14/S54, Porsche GT3 RS, and carbureted race engines.
  - **Synth:** one runner waveguide per cylinder (closed at the valve, open at the stack), radiating directly. Set the per-cylinder gain from throttle angle.
- **Airbox vs open cone filter.** A cone filter removes the Helmholtz lowpass, adding +6 to +10 dB at 1–5 kHz of hiss plus brighter honk. An OEM airbox with resonators
  is quiet and boomy. An OEM "sound symposer" or induction-sound pipe deliberately pipes 100–400 Hz intake orders into the cabin.
- **Turbo engines.** Induction pulses are largely blocked by the compressor. What you hear is compressor noise (§5) plus throttle and BOV sounds.
- **Relative level.** At the rear, outdoors, intake is 10–20 dB below exhaust. In the engine bay and cabin of an NA car, intake is about −3 to +3 dB relative to exhaust.

---

## 5. Forced induction sounds

### 5.1 Turbo shaft speed model
- **Tip speed from pressure ratio:**
  - Use the isentropic head with a work coefficient: `Δh_s = cp·T1·(PR^0.286 − 1) = ψη·U²`, with ψη ≈ 0.45–0.5.
    This gives `U = sqrt(1005·T1·(PR^0.286 − 1)/0.47)`. PR = 2.0 gives U ≈ 373 m/s; PR = 2.5 gives 445 m/s.
  - Exducer diameter D2 ≈ `compressorInducerMm / 0.73` (trim 50–56).
  - Shaft rpm = `U/(π·D2)·60`. For a 44 mm inducer (D2 ≈ 60 mm) at PR 2 that is about **119 000 rpm**, in line with Garrett GT28 maps (about 120–140k at PR 2).
    **[calc; rule from compressor maps]**
- **Typical ranges:**
  - Small turbos (D2 40–50 mm) run up to 220–280k rpm. Mid-size (55–65 mm) runs up to 160–200k. Large (75–90 mm) runs up to 100–140k.
  - Idle and off-boost: 10–40k rpm.
- **Spool dynamics.** Shaft speed is a first-order lag toward its target, with a time constant τ ≈ 0.3–0.6 s for small or twin-scroll units and 0.8–2 s for large single
  turbos. That makes the classic rising whistle sweep after tip-in, lagging the rpm.
  - With `TurboConfig.count = 2`, use a smaller τ.
  - On lift-off, use a slower decay: τ ≈ 1–3 s with a BOV, and shorter during surge.

### 5.2 Turbo noise components
| Component | Frequency | Audible character | Level / gating |
|---|---|---|---|
| **Synchronous (1× shaft) and low shaft orders** (imbalance, "buzz-saw" multiple pure tones when inducer tip Mach > 1) | shaft_rpm/60 × k, e.g. 120k → 2 kHz, plus 4, 6 kHz… | The "turbo whistle" or "spool" you actually hear in the cabin | Small; grows with U². Buzz-saw appears only above about 85 % max speed. |
| **Blade-pass frequency** | shaft_rpm/60 × Z. Z = full blades (6–7) at the inlet, or full + splitter (12–14) at the outlet | Piercing whistle during spool, at 40–80k rpm → 4–16 kHz. At full speed it is often > 15–20 kHz, which is inaudible or filtered | Inlet-radiated; louder with open cone filter (+10 dB) |
| **"Whoosh"** (flow separation near surge, low flow / high PR) | Broadband **1–4 kHz** (some studies report 4–12 kHz, but that band is likely tip-clearance noise) | Rushing air at high boost and part flow | ∝ PR and mass flow; strongest near the surge line **[src: Sharma, Broatch, García et al., UPV]** |
| **Tip-clearance noise (TCN)** | Broadband, below BPF, about 5–12 kHz | Hiss | Small |

### 5.3 Lift-off: blow-off valve vs surge
- **Atmospheric BOV / dump valve ("pssh").** It opens when the throttle closes with boost above about 0.3 bar. The vented air is choked, giving a broadband noise burst.
  - **Spectrum:** peak 2–8 kHz, highpassed at about 500 Hz.
  - **Envelope:** attack 5–20 ms, exponential decay with τ ≈ 0.15–0.4 s (total about 0.3–1 s), scaled by the boost at lift-off.
  - **Character:** add a mild downward spectral sweep of about −30 % over the burst. Aftermarket "flutter" BOVs add a 30–60 Hz AM.
  - **Recirculating / bypass valve (OEM):** a quiet, muffled whoosh at −15 to −20 dB re an atmospheric BOV.
- **Compressor surge flutter ("stu-tu-tu", no BOV).** Flow reverses periodically as pressure in the charge pipe and plenum oscillates. This is
  deep surge at the Helmholtz frequency of the compressor plus charge volume.
  - **Timing:** chatter pulse rate ≈ **8–25 Hz**, lasting 0.3–1.5 s, decaying with boost.
  - **Pulse:** each pulse is a short broadband burst of 5–15 ms with a 1–4 kHz center, synchronized to a slight dip in turbo whistle pitch.
  - **Synth:** noise bursts at f_surge ≈ 12 Hz ±30 % with randomized spacing, amplitude ∝ residual boost. **[rule]**
- **Wastegate.**
  - **External wastegate with an open "screamer pipe":** a separate open exhaust outlet that carries unmuffled pulses with a large flow fraction at boost. It is a very loud, raspy
    screaming sound. Model it as a second short tailpipe (0.3–0.5 m) fed by `(boost/target)·0.3` of the pre-turbine pulse.
  - **Internal wastegate flap rattle:** at light load and idle, small metallic clicks of 2–6 kHz with short decay, synchronized to exhaust pulses at a 5–20 % probability. It is optional.

### 5.4 Superchargers
| Type | Tone frequency | Drive ratio | Character |
|---|---|---|---|
| **Roots** (Eaton TVS: 2 rotors × 4 lobes, twisted 160°; old GMC 6-71: 2 × 3 lobes, straight) | Pocket/lobe-pass `f = rotor_rpm/60 × lobes × 2`. TVS at 6000 crank × 2.4 = 14 400 rpm → **1.92 kHz** (8/rev). Harmonics at 2×, 3× | Crank→rotor 1.8–2.8 (TVS rotors are rated about 18 000 rpm max for the R1740 **[src: Eaton catalog]**); old 6-71 "overdrive" 1.0–1.5 | Classic whine. TVS 4-lobe is softer than 3-lobe. Rotor timing-gear mesh (56 → 101 teeth on Eaton ZR1, moved to ultrasonic **[src: Corvette Action Center, Eaton]**). Add pocket pulsation (lobe-pass AM) under boost and gear whine at teeth × rotor rpm |
| **Twin-screw** (Lysholm/Whipple: male 3–4 lobes, female 5–6) | `f = male_rpm/60 × male_lobes`. Male rotor up to about 18–22k rpm, giving about 1–1.5 kHz plus strong harmonics to 4–6 kHz | Crank→male 2.5–4 (belt × internal gear) | Harsher whine-scream. Internal compression gives sharp discharge pulsation and a richer harmonic series than Roots |
| **Centrifugal** (ProCharger, Vortech, Paxton) | Impeller 40–65k rpm. BPF (Z ≈ 8–12) ≈ 6–12 kHz. Internal step-up gear mesh ≈ 5–15 kHz | Pulley 2–3× crank × internal step-up 3.5–4.5× → **8–14× crank** | High whistle/whine. Boost ∝ rpm², so the whistle swells strongly near redline. Straight-cut internal gears add gear whine. Pair it with a BOV (§5.3) |
- **Sim inputs.** Use `SuperchargerConfig.referenceRpm` and `targetBoostBar` to size the ratio. Rule for Roots and screw: `rotor_rpm = N·ratio`, with ratio picked so
  the rotor is at about 90 % of its max speed (16–18k rpm) at redline.
- **Level.** In the engine bay under boost, supercharger whine is −6 to −15 dB re exhaust; in the cabin it is about −10 to −20 dB.
  - **Load dependence:** it grows with boost: at idle −20 dB, at WOT +10–15 dB. With the bypass valve open (part load) whine drops 10–15 dB.

### 5.5 Turbo and SC whine synthesis
- **Oscillators.** Generate sinusoids at k·f_shaft and Z·f_shaft. Add slow random FM of ±0.3 % and AM at the exhaust firing frequency of about 5–15 %, because turbine speed ripples with the
  pulses.
- **Noise.** Mix with the broadband layers described above.
- **Anti-aliasing.** Use band-limited sinusoids and drop anything above 0.45·fs.

### 5.6 Turbine effect on exhaust sound
- **Damping.** The turbine damps exhaust pulses by about 6–12 dB overall and more above 1 kHz. A twin-scroll turbine keeps bank and pair pulses separate, so slightly more pulse
  character survives.
- **Synth:** after the collector, apply a gain of `−(6 + 4·boost_bar)` dB, capped at −14, plus a lowpass at 1.5–3 kHz, then add flow noise ∝ mass flow. A turbo V8 still
  burbles but is muted. This is why "turbo cars sound flat".

---

## 6. Mechanical noise

| Source | Event rate | Spectrum / shape | Relative level (engine-bay perspective) | Notes |
|---|---|---|---|---|
| **Valve seating / lash tick** | Each valve closes once per cycle, so `n·valvesPerCylinder` events per 720°, grouped by cam lobe | Damped sinusoids at 2–8 kHz (head/cover modes), decay 0.5–2 ms, random ±20 % amplitude | **Pushrod with solid lifters:** loud "sewing machine" at −10 to −18 dB re exhaust at idle. **Hydraulic pushrod:** −20 to −30 dB. **DOHC shim-bucket:** −18 to −25 dB, a lighter, higher tick. **DOHC hydraulic:** −30 dB | Level grows ∝ N^1.5–2. Valve float above `valveFloatRpm` makes it erratic and loud |
| **DI injector tick** (`directInjection: true`) | 1 per cylinder per cycle (with multiple injections, 2–3) | Sharp clicks at 3–10 kHz, ≈ 0.5 ms | Very prominent at idle in modern DI engines: −10 to −20 dB re exhaust in the bay | Plus a high-pressure fuel pump tick: the cam-driven pump fires 3–4 lobes per cam rev, so orders 1.5–2 |
| **Timing chain / gear drive** | Mesh order = crank-sprocket teeth (chain 18–24, belt 20–30; straight-cut gear trains 30–60 teeth) | Tonal whine at mesh order × N/60 (e.g. 21 × 6000/60 = 2.1 kHz), plus sidebands at order 0.5 | Chain −25 to −35 dB. **Race straight-cut gear drive:** −10 to −20 dB, a distinct whine (Cosworth DFV, NASCAR, old Porsche 911 cam chains rattle) | |
| **Piston slap** | Near TDC firing (5–20° ATDC) and after the other TDCs | Broadband thud at 0.5–3 kHz, 2–5 ms | Cold engine −15 dB; warm −30 dB. Forged pistons (larger clearance) have a louder cold slap | Decays with warm-up |
| **Combustion noise** (structure-borne) | Each firing | Broadband 0.5–3 kHz, ∝ dp/dθ max (`peakCylinderPressureBar`) | −15 to −25 dB in the bay | "Clatter" of DI engines and diesels |
| **Knock "ping"** | Only when knock occurs: onset 10–25° ATDC firing | Damped sinusoid at `f = α_mn·c/(π·B)`, with α₁₁ = 1.841 (1st circumferential), α₂₁ = 3.054, α₀₁ = 3.832, and end-gas/burned c ≈ 900–1050 m/s (2200–2800 K). Bore 86 mm → 6.1–7.2 kHz; 103 mm (LS3) → 5.1–6.0 kHz; 81 mm → 6.5–7.6 kHz. Decay τ ≈ 0.5–2 ms | Light knock is audible in the cabin as a metallic "ping" at −15 to −25 dB re exhaust; heavy knock at −5 dB | **[src: Draper 1938 formula; SAE 2018-01-1666 reports about 6 kHz 1st circumferential mode in modern engines]**. Trigger probability ∝ the knock margin the sim reports (e.g. `knockRetardDeg` > 0 → p = 0.02–0.1 per firing on the knock-limited cylinders) |
| **Starter** | Cranking at 150–300 rpm crank | Ring-gear mesh at `N_crank × ring_teeth/60`, with ring 120–160 teeth → 300–700 Hz. Motor whine at 2–6 kHz (armature 8–18k rpm in gear-reduction starters). **Compression pulses make cranking rpm oscillate ±20–40 % at the firing frequency** ("rur-rur-rur", e.g. a V8 at 200 rpm → 13 Hz) | Loud: −5 to −10 dB re idle exhaust in the bay | Start sequence: 0.6–1.5 s of cranking, then first fires (often uneven), rpm overshoot to 1.3–1.8× idle within 0.4–0.8 s, then settling over 1–3 s (cold fast-idle 1.2–1.5× idle) |
| **Fuel pump** (optional) | Electric in-tank pump, continuous; priming for 2 s at key-on | Faint hum at 100–300 Hz plus a whine at 2–5 kHz | −40 dB; cabin only | |
| **Accessories** (alternator, belt, fan) | Alternator about 2.5–3× crank, whine at the slot pass of 36 × that | 1–8 kHz faint | −35 dB | Optional |

---

## 7. Listener, space and mixing

### 7.1 Perspectives (relative levels in dB, exhaust at WOT = 0 dB)
| Component | Rear / exhaust exit (1–3 m) | Engine bay (hood open, 1 m) | Cabin (driver) |
|---|---|---|---|
| Exhaust orders + pulses | 0 | −6 to −12 (via underbody and structure) | −25 to −35 broadband, after the transmission-loss filter below; an engine-order "boom" peak is retained |
| Exhaust flow noise | −10 to −15 | −20 | −40 |
| Intake (NA) | −10 to −20 | 0 to +3 | −20 to −30 (−10 with a sound symposer) |
| Turbo whistle / whoosh | −20 to −30 | −6 to −12 | −20 to −30 |
| BOV (atmospheric) | −10 | 0 | −15 |
| SC whine | −15 to −25 | −6 to −15 | −15 to −25 |
| Mechanical (valvetrain, chain, injectors) | −25 to −35 | −10 to −20 | −35 to −45 |

- **Cabin transmission filter (mass law).** Transmission loss rises about +6 dB/oct: TL ≈ 25 dB at 100 Hz, 35 dB at 500 Hz and 45 dB at 2 kHz. Implement it as a 2-pole lowpass at
  250–500 Hz, plus a **cabin boom** peak (Q 3–6) at the first longitudinal cavity mode `c/(2·L_cabin)` ≈ 343/(2·2.5) ≈ **60–90 Hz**.
  Also add structure-borne engine-order vibration at the firing order and order 2 (strong for I4). **[rule; NVH literature]**
- **Engine bay.** Make the block "ring" through a short bank of modal resonators at 0.8–3 kHz.

### 7.2 Distance and environment
- **Spreading:** −6 dB per distance doubling (point source).
- **Air absorption** (ISO 9613-1, 20 °C, 70 % RH): about 5 dB/km at 1 kHz, 22 dB/km at 4 kHz and 76 dB/km at 8 kHz. Only matters beyond about 20 m.
  Implement it as a 1-pole lowpass with fc ≈ 20 kHz·(10 m/d).
- **Ground reflection** (the most important outdoor cue): add an image source with path difference
  `Δ = sqrt(d² + (h_s + h_r)²) − sqrt(d² + (h_s − h_r)²)` and reflection +0.9 for asphalt or +0.5 to +0.7 for grass with a lowpass.
  - Example: tailpipe height 0.3 m, ear 1.5 m, d = 7.5 m → Δ = 0.117 m (0.34 ms), so the first comb notch is at about **1.47 kHz**.
- **Rooms** (garage / dyno cell / tunnel):
  - **Recipe.** Use a ConvolverNode with a **synthesized IR**: stereo-decorrelated white noise × `exp(−6.91·t/RT60)`, lowpassed so it gets darker with time
    (fc decays from 8 kHz to 2 kHz over RT60), with 4–8 discrete early reflections at 3–30 ms (gains −3 to −10 dB).
  - **RT60:** garage 0.8–1.5 s; dyno cell 0.3–0.6 s with absorption; tunnel 2–4 s; open air with no tail, just the ground reflection.
  - **Mix:** wet/dry −10 to −6 dB in a garage.
- **Pass-by (optional).** Doppler factor `c/(c − v_r)`. At 30 m/s it shifts ±9 %, so implement it as a variable delay line driven by distance.

### 7.3 Stereo placement
- **Rear view, dual exhaust:** bank A pan −0.5, bank B +0.5 (equal-power), plus 0–0.4 ms inter-channel delay from the tailpipe spacing of about 1–1.4 m.
  This is what preserves the crossplane half-orders (§2.3).
- **Engine bay:** the V banks pan ±0.3; intake is centre; turbo is at its side (±0.4); valvetrain is wide (±0.6), with decorrelated per-bank events.
- **Cabin:** mostly mono. The exhaust sits slightly behind, so delay it about 3 ms; intake and mechanical are in front.
- **Mono safety.** Check the mono fold-down with the §8 metric: half-order loss of less than 6 dB when going from stereo to mono.

### 7.4 Implementation notes (Web Audio)
- **Engine model:** run it in an **AudioWorklet** at 48 kHz with a 128-sample block. Integrate crank phase at audio rate from the smoothed rpm.
  Control rate (rpm, load and boost from the sim) is ≥ 60 Hz with one-pole smoothing of 20–50 ms.
- **Aliasing.** Pulses are sharp at high rpm. Either generate them band-limited (sum of harmonics up to 0.45·fs, as in Doerfler & Wyse, or minBLEP-style
  onsets), or oversample 2× inside the pulse and waveguide section.
- **DC.** The exhaust has net mean flow, so differentiating the outlet volume velocity (§0 step 4) removes it. Still add a DC blocker at 10–20 Hz on the master.
- **Gain and CPU.** Put a soft-clip limiter at the end. Budget: 8 primaries + 2 collectors + 2 tailpipes × fractional delay lines ≈ < 2 % of one core.

---

## 8. Validation metrics (measurable from rendered WAVs)

Render steady-state clips of 3–5 s at fixed rpm and load, plus a 10 s 1000 → redline WOT sweep. Use order tracking: resample to the crank-angle domain
with 720 samples per cycle (or ≥ 4 samples per order of interest), then FFT over ≥ 8 cycles so that the order resolution is ≤ 0.125.

| # | Metric | Expected value | Basis |
|---|---|---|---|
| 1 | Dominant order (even-fire, exhaust only, WOT) | Strongest component at order n/2 or its 2nd harmonic (pipe resonance can lift the 2nd). The frequency of order n/2 must equal `N·n/120` within ±0.5 % | [calc §2.1] |
| 2 | Crossplane V8 dual exhaust (no crossover), per-bank channel | L(1.5) and L(2.5) at **−2 to −8 dB** re L(4) (impulse model −3.7 dB; pulse and pipe shaping modify). L(0.5) at −8 to −15 dB | [calc §2.3] |
| 3 | Crossplane V8 mono fold-down | Half-orders (1.5 / 2.5) still at −8 to −18 dB re order 4 (they survive through bank asymmetry and pulse interaction). **If < −25 dB, the interaction model is missing** | [calc + rule] |
| 4 | Flat-plane V8, I4, I6, V12 | Half-orders and in-between orders < −20 dB re firing order (small values come only from cylinder spread) | [calc §2.2] |
| 5 | X-pipe vs dual (crossplane) | Half-orders drop 8–20 dB with an X-pipe and 3–8 dB with an H-pipe | [calc m-sweep §2.3] |
| 6 | V-twin 45° | Comb at every 0.5 order with no single dominant line; order 0.5 present at about −10 to −15 dB re the max | [calc §2.4] |
| 7 | Subaru UEL boxer | Odd integer orders (1, 3, 5) rise with rpm: about −15 dB at 2500 rpm to about −5 dB at 5000 rpm re order 2. Not present with EL headers | [calc §2.4] |
| 8 | Spectral centroid (unweighted, exhaust perspective) | Idle 150–600 Hz. WOT mid-rpm 500–1500 Hz. WOT redline 800–2500 Hz. Must increase monotonically with rpm in a WOT sweep and must be 10–40 % higher at WOT than at 30 % load, same rpm | [rule §3.1] |
| 9 | Level dynamics (A-weighted, exhaust perspective) | Idle → ¾-redline free-rev: +15 to +25 dB(A) (ISO 5130 idle ≈ 70–80, ¾ rpm ≈ 90–100 for sporty cars). WOT vs 30 % load at the same rpm: +8 to +15 dB. Overrun vs WOT: −15 to −25 dB in orders | [src ISO 5130 data; rule §3.2] |
| 10 | Crest factor (peak/RMS) | Idle 12–20 dB (impulsive). High-rpm WOT 8–12 dB (denser, noise-like). Pure sine is 3 dB; Gaussian noise about 11–13 dB. Turbo engines 1–3 dB lower than NA at the same point | [rule] |
| 11 | Roughness (Zwicker/Aures model, e.g. MoSQITo `roughness_dw`) | Sporty NA (crossplane V8 / I5 / V-twin at 1500–3500 rpm): 0.3–1.5 asper. Smooth I6 / V12: < 0.3 asper. The maximum sensitivity is at 70 Hz modulation, i.e. half-order spacing → crossplane at N/120 = 12–30 Hz cycle rate with order spacing. The perceived "sportiness" correlates with half-order content and roughness | [rule; psychoacoustics, Zwicker & Fastl] |
| 12 | Harmonic-to-noise | Orders vs broadband residual: idle 15–25 dB; WOT 5–15 dB (more flow noise) | [rule] |
| 13 | Pulse timing | Cross-correlating the envelope with expected EVO times (`firingPhaseDeg` + θ_EVO + L/c) should give a lag that matches within ±3 °CA | [calc] |
| 14 | Pipe modes | With noise excitation, tailpipe modes appear at `m·c/(2L′)` within ±5 % and primaries at odd multiples of `c/(4L′)` | [src Kinsler] |
| 15 | Turbo whistle | Tonal peak at `shaft_rpm·k/60`. Rises with a lag τ after tip-in. Disappears (−20 dB) within 1–3 s of lift-off | [calc §5.1] |
| 16 | Roots whine | Peak at `rotor_rpm × 8/60` (TVS) within ±1 %, e.g. 1.92 kHz at 6000 crank with ratio 2.4 | [calc §5.4] |
| 17 | Knock ping | Damped tone at `1.841·c/(π·B)` ±10 % (e.g. 86 mm → 6–7 kHz) | [src Draper; SAE 2018-01-1666] |
| 18 | Hygiene | No clipping; DC < 1e-3; no NaN/denormals (add a 1e-20 offset in feedback loops); click-free rpm sweeps (no step > −40 dBFS in the HF residual); real-time factor < 0.1 | — |

**Unit-test idea.** Port the impulse-train order calculation (§2.6) into a vitest that calls `computeLayout()`. Assert per-bank half-order magnitude
> 0.6 at orders 1.5 and 2.5 for crossplane, and 0 for flat-plane. This checks layout and synth assumptions together.

---

## 9. Sources
- Heywood, J.B., *Internal Combustion Engine Fundamentals*, 2nd ed., McGraw-Hill 2018. Ch. 4 (gas properties), 6 (gas exchange, blowdown), 7 (intake), 9 (cyclic variability, knock).
- Blair, G.P., *Design and Simulation of Four-Stroke Engines*, SAE 1999. Pressure-wave and port pressure traces.
- Kinsler, Frey, Coppens & Sanders, *Fundamentals of Acoustics*, 4th ed. Pipe modes, Helmholtz resonator, viscothermal loss.
- Levine, H. & Schwinger, J., "On the radiation of sound from an unflanged circular pipe", Phys. Rev. 73 (1948). End correction 0.6133a and |R|(ka).
- Munjal, M.L., *Acoustics of Ducts and Mufflers*, 2nd ed., Wiley 2014. Expansion-chamber TL, side branches.
- Smith, J.O., *Physical Audio Signal Processing* (CCRMA online book). Digital waveguides and scattering junctions.
- Baldan, Lachambre, Delle Monache, Boussard, "Physically informed car engine sound synthesis for virtual and augmented environments", IEEE SIVE 2015, DOI 10.1109/SIVE.2015.7361287.
- Farnell, A., *Designing Sound*, MIT Press 2010, Practical 22 "Car engines": https://mitp-content-server.mit.edu/books/content/sectbyfn/books_pres_0/8375/designing_sound.zip/practical22.html. SuperCollider port: https://sccode.org/1-4RH.
- Doerfler, R. & Wyse, L., "Physics-Informed Neural Engine Sound Modeling with Differentiable Pulse-Train Synthesis", arXiv 2603.09391 (2026): https://arxiv.org/abs/2603.09391.
- Jagla, Maillard, Martin, "Sample-based engine noise synthesis using an enhanced pitch-synchronous overlap-and-add method", JASA 132(5):3098 (2012): https://hal.archives-ouvertes.fr/hal-00730614.
- AngeTheGreat engine-sim (2022), with the author's description of the pulse → convolution IR + noise pipeline: https://www.thedrive.com/news/new-3d-engine-sim-can-synthesize-super-realistic-exhaust-sounds-in-real-time. Source on GitHub: ange-yaghi/engine-sim.
- Sharma, Broatch, García-Tíscar et al., "Acoustic characteristics of a ported shroud turbocompressor…", UPV: https://riunet.upv.es/bitstream/10251/149928/1/ (whoosh 1–4 kHz vs TCN).
- SAE 2013-01-1880, "Computational Aero-Acoustics Simulation of Compressor Whoosh Noise in Automotive Turbochargers".
- Eaton TVS R1740 catalog (max operating speed 18 000 rpm): https://www.eaton.com/mx/en-us/catalog/engine-solutions/tvs-r1740.html. ZR1 blower gear 56 → 101 teeth and 4-lobe noise: https://www.corvetteactioncenter.com/specs/c6/2009/zr1/ruthless_pursuit3.html.
- Draper, C.S., "Pressure waves accompanying detonation in the internal combustion engine", J. Aero. Sci. 5 (1938). SAE 2018-01-1666, "Distribution of Knock Frequencies in Modern Engines Compared to Historical Data".
- ISO 5130 (stationary exhaust noise), ISO 362 (pass-by), EU Reg. 540/2014 (vehicle sound limits), ISO 9613-1 (air absorption).
- Zwicker & Fastl, *Psychoacoustics: Facts and Models*. Roughness and its 70 Hz modulation peak.
- Blowdown timing (peak soon after EVO; 45–100 °CA duration): USPTO split-exhaust patents (e.g. US10393041), eng-tips thread 24870. Treat as indicative only.
