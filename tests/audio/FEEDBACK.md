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
