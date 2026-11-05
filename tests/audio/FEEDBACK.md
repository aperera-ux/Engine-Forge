# Listening feedback log

Each entry: what the user heard → diagnosis (measured) → change.

## Round 1 — "too much buzziness at high revs and cylinder count"

> Going from 4-6-8-10 cylinders in an inline setting just makes the buzzing louder,
> it doesn't account for actual nuance in cylinder difference.

**Measured** (`scripts/audio/octaves.ts`, `sweep.ts`, `levelsweep.ts`; same 500 cc cylinder, inline 3–8, WOT):

- A flat 2–8 kHz plateau at −15…−20 dB re the loudest band for every cylinder count (real
  tailpipe spectra fall ≈10 dB/oct there). The cause was the tailpipe jet-noise layer: white noise
  band-passed 650 Hz–5.2 kHz and amplitude-gated by the *squared instantaneous* pulse. That is a
  pulse-synchronous rasp at the firing rate, so more cylinders meant a denser and higher buzz.
  Spectral centroid was 2–3.3 kHz.
- The muffler was an area-ratio-2 pipe with almost no high-frequency loss.
- Inline 6/8 long-tube and shorty headers all went into one collector. Real ones are split
  (front/rear 3-into-1 → 2-into-1, 4-2-1).
- Network transmission per pulse fell steadily with primaries and pipes (I3 −12 dB … I8 −19 dB,
  V12 −22 dB). With a gain law that also penalised displacement and cylinder count, levels
  across engines were set by accidents of pipe topology.
- With the hiss gone, valvetrain and intake ticks made idle *brighter* than WOT (exposed, not new).
- Soft-clipping happened after the DC blocker, so asymmetric pulses created DC.

**Changed:**

- Jet noise: broadband with a Strouhal-style peak (HP 180 Hz, LP 1.5 kHz at −12 dB/oct). It
  follows the mean exit flow (8 ms), with only 30 % pulse-synchronous modulation.
- Muffler: an expansion chamber (area ratio ≈4 stock, ≈2 straight-through, 0.38 m) with packing
  loss that rises with frequency (per-pass corner ≈1.1 kHz stock, ≈2.3 kHz sport). Larger area
  ratios were tried; they gave deep TL notches and ±5 dB level swings with rpm.
- Inline 6/8 long-tube and shorty headers are now split into two evenly firing branches.
- Gain: a network-transmission probe (0.5 ms pulse, turbine treated as open) normalises 60 % of
  the topology difference against a 2.0 L I4. Displacement term +0.6 dB per doubling. Turbo
  engines stay ≈5–6 dB quieter because the turbine still absorbs pulses.
- Engine-bay layer (mechanical + intake) low-passed at 2.2 kHz: it is heard around and through
  the body from the exhaust side.
- DC blocker moved after the limiter and soft clip.

**Result:** centroid 0.7–1.9 kHz. 2/4/8 kHz bands ≈ −25/−35/−45 dB. Inline ladder I3→I8 levels
are flat to +1.5 dBA (was −2 dBA). In-between orders stay inside the research §8 #4 band.

A/B clips: `tests/audio/ab/{before,after}/` (inline ladder 3000→7500 rpm, K20A/B58/F140/LS3 pulls).

Note: the app supports inline 1–6 and 8 (no inline 10). The user's "10" was probably a V10, or
the top of the slider.

## Round 2 — "turbo doesn't smother the engine; turbo and supercharger sound alike"

> When you attach a turbo the turbo noise doesn't "smother" the engine noise behind it the way
> an actual turbo works; its volume is disproportionately high compared to the engine. The
> "spool up" and "wind up" noises from the turbo and supercharger are very similar: a
> supercharger should whine, while a turbo spools up and then releases pressure.

**Measured** (new `tipin` scenario: cruise 2500 rpm → WOT → lift → re-tip; per-layer solo
controls `mixExhaust` / `mixWg`; A-weighted, relative to exhaust):

- Turbine damping of the exhaust was ≈3 dB. The research target is 6–12 dB (§5.6).
- Spool had no rpm dependence. Exhaust energy was airflow ÷ WOT airflow *at the same rpm* (≈1 at
  any WOT), so turbos spooled in ≈0.5 s even from idle. τ was 0.2 s; the target is 0.3–0.6 s
  small and 0.8–2 s large.
- The whistle term scaled with the *gap to target shaft speed*. It was loudest the instant the
  throttle opened, a step like a supercharger's, not a sweep.
- The wastegate never opened under WOT, so the hiss and bypass logic were dead.
- Levels: the turbo whistle was a pure ~11 kHz tone. Supercharger whines were −2…−7 dBA
  (twin-screw) and −10 dBA (Roots) re exhaust; the target is −15…−25. The 4-cylinder default
  supercharger is centrifugal, the type closest to a turbo.

**Changed:**

- Spool: absolute exhaust energy (airflow ÷ peak airflow over the curve). τ stretches below
  the energy at which the curve first reaches boost. Base τ 0.25–2.5 s from inducer size, A/R,
  twin-scroll and twin turbos.
- Wastegate: opens with surplus energy once boost is at target.
- Turbine damping: −(7 + 4·boost) dB, capped at 14 (−1.5 dB for twin-scroll), plus the
  existing >1.8 kHz low-pass. Wastegate bypass passes ≤30 % of the flow.
- Whistle: driven by actual shaft *acceleration* (swells while spooling) plus a faint
  U²-scaled steady tone. Whoosh tied to pressure ratio and spooling. Wastegate hiss lowered
  ≈12 dB. Atmospheric BOV −4.4 dB.
- Supercharger whine levels: twin-screw −9.4 dB, Roots −2.8 dB, centrifugal −1.9 dB. The pitch
  stays locked to crank rpm, with no lag and no blow-off.

**Result** (dBA re exhaust):

| | Spooling | Steady boost | Lift-off |
|---|---|---|---|
| Turbo whistle | −14…−21 | −22…−33 | BOV "pssh", then the whistle spins down over ≈1–2 s |
| Supercharger whine | — | Roots / twin-screw −12…−17; centrifugal −21…−25 (rises toward redline) | — |

The turbo exhaust is 5–12 dB quieter than the same engine NA. Tests are in
`src/audio/__tests__/induction.test.ts`.

A/B clips: `tests/audio/ab/round2/{before,after}/`. "before" is main, without round 1.
