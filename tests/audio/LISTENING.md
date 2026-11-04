# Engine Forge sound: listening guide

All files are in `tests/audio/out/`. They are 48 kHz 16-bit stereo, synthesized from physics with no samples, and rendered by the same DSP core that runs in the app. The perspective is the exhaust exit, about 1–2 m behind the car: bank A is on the left and bank B on the right. A small room adds early reflections. Each WAV has a matching `.png` spectrogram (log frequency 20 Hz–12 kHz; the dotted white line is the expected firing frequency) and a `.json` file with the rpm/load track.

Use headphones or decent speakers, because laptop speakers lose everything below about 150 Hz, which includes most V8 burble.

## Scenarios (the same for every engine)

| suffix | what happens |
|---|---|
| `_idle` | 10 s of warm idle |
| `_pull` | 1.5 s idle, then a WOT pull to redline (~8 s), then 1.2 s on the rev limiter, then lift-off and coast down to idle on a closed throttle |
| `_cruise` | 8 s of part throttle at ~35 % of redline and ~30 % load, with gentle variation |
| `_overrun` | 1.5 s WOT at 75 % of redline, then lift-off and coast to idle (DFCO, pops/crackle; BOV on turbo engines) |

Regenerate: `npx tsx scripts/audio/render.ts all all --png`, then analyse: `npx tsx scripts/audio/analyze.ts`.

## Engines and what to listen for

| file prefix | engine | should sound like | listen for |
|---|---|---|---|
| `k20a` | Honda K20A I4, NA, 4-2-1 header, 8400 rpm | buzzy, rising to a hard VTEC-style shriek | a clean order-2 buzz; no wobble between pulses; brightness grows strongly near the top |
| `ls3` | GM LS3 crossplane V8, dual exhaust | American V8 burble/"potato" at idle and low rpm, deep and uneven; a smooth roar up high | **the uneven rhythm should be audible in each ear separately** (left = bank A, right = bank B); it should stay lumpy when summed to mono |
| `f136` | Ferrari F136 flat-plane V8, 9000 rpm | two I4s: no burble, smooth and increasingly screaming | compare directly with `ls3`: the same cylinder count without the lumpiness |
| `f140` | Ferrari F140 V12, 8700 rpm | very smooth and high, "tearing silk" | there should be no roughness at all; check whether it gets too thin or too buzzy at the top |
| `ej257` | Subaru EJ257 flat-4 turbo, unequal-length headers | the Subaru "rumble": an off-beat throb on top of order 2 that grows with rpm, muted by the turbo, plus spool whistle and a BOV "pssh" on lift-off | rumble at mid rpm; whistle rising after tip-in; the pssh in `_overrun` and at the end of `_pull` |
| `b58` | BMW B58 I6 turbo | silky, smooth and muted, with turbo whoosh on top | it should be the smoothest of the turbo engines; whistle and whoosh should be present but not dominant |
| `hellcat` | Dodge Hellcat supercharged crossplane V8 | V8 burble plus a supercharger whine that rises with rpm | whine pitch should track rpm exactly (it is belt-driven), unlike the turbo whistle, which lags |
| `ecoboost-i3` | Ford 1.0 EcoBoost I3 turbo | thrummy "half a V6" with an off-beat feel, small turbo | the 1.5-order thrum; turbo noise level |
| `vtwin` | 45° V-twin, Harley-style, 5600 rpm | "potato-potato" lope, with no single dominant pitch | the uneven 405°/315° beat at idle |

## Things that are synthesized (check that each is believable)

- **Rev limiter:** a fuel/spark-cut chop at about 10 Hz while held at redline. Aggressive builds (F136, F140) occasionally pop.
- **Overrun:** after lift-off the tone goes hollow and quiet (fuel cut). In the first 1–3 s there are crackles and pops, more on aggressive or rich builds.
- **Idle:** slight cycle-to-cycle unevenness. Big-overlap cams lope; try a big cam in the app to hear it.
- **Mechanical:** a faint valvetrain tick (louder and clattery on pushrod engines such as `ls3` and `hellcat`), a faint chain whine, and occasional knock "ping" only where the sim reports knock retard.

## Most useful feedback

1. Crossplane vs flat-plane (`ls3_pull`, `f136_pull`): does the LS3 sound like a V8 burble, and does the F136 sound like a Ferrari?
2. Overall timbre: is it too "synthy" or buzzy, too noisy or hissy at WOT, too dull or boomy at idle? Name the file and the timestamp.
3. Loudness balance: idle vs WOT, and engine vs engine. (V8/V12 idles are deliberately much quieter than their WOT pulls.)
4. Turbo/SC level: is the whistle, whoosh, BOV or supercharger whine too loud, too quiet, or the wrong pitch?
5. Events: are the limiter, pops and BOV convincing or cartoonish?
