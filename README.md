# Engine Forge

I'm a business major, not a mechanical engineer, so heads up: AI wrote almost all
of this code. My job was steering. I set the goals, decided what to build next, split
the work across parallel Claude Code agents, reviewed what came back, and called it
when the physics stopped improving. You get a 3D engine builder, dyno curves checked
against 44 real dyno runs (about 8% error on engines the model never saw), synthesized
engine sound, and a 0-60 / quarter-mile estimator. Go break it.

**▶ Live demo: https://aperera-ux.github.io/Engine-Forge/** (desktop browser; turn on the speaker icon for sound)

## At a glance

- **What it is:** a 3D engine builder with a physics-based dyno model, a vehicle acceleration model, and engine sound synthesized from the real firing order (no audio samples).
- **How it was built:** in six days (Nov 4–9, 2026) by Alexander Perera, a Boston University business student, directing parallel [Claude Code](https://claude.com/claude-code) agents. Each agent owned one area (physics, vehicle, UI) in its own git worktree, and every change was merged back through tests. The 139 commits in this repo are that history.
- **How it is checked:** 955 automated tests. Physics constants are tuned only on a training set of dyno curves, and a separate holdout set is scored once per round after the constants are frozen.
- **How accurate it is:** median peak-horsepower error is 4.6% across 21 production engines, and holdout dyno-curve error is 7.8%. **Both miss their targets** (3% and 5%), and the gaps are listed in [`tests/reports/known_gaps.md`](tests/reports/known_gaps.md). Development stopped when holdout error stopped improving for four rounds, rather than tuning the model to fit the test set. Importing your own dyno curve brings the fit to about 3%.
- **Further reading:** [`tests/reports/model_card.md`](tests/reports/model_card.md) (model card) and [`tests/reports/physics_audit.md`](tests/reports/physics_audit.md) (audit log).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + calibration + validation suites
npm run build      # production build in dist/
```

## Using it

- **Preset** (header): 21 real engines (K20A, LS3, 2JZ-GTE, B58, F136, F12 V12, Hellcat …)
  plus hypothetical builds. Start from one and modify it.
- **Configuration panel** (left): Block · Heads · Intake · Exhaust · Tune · Build tabs.
  Every change re-runs the simulation instantly.
- **Viewport**: drag to orbit, scroll to zoom, hover a cylinder to inspect it.
  Solid / Cutaway / X-ray views.
- **Keys**: `D` dyno pull · `Space` run/pause · `S` snapshot · `⌘S` save to garage · `1/2/3` view mode.
- **Garage** saves up to 3 custom engines in this browser: load, overwrite, rename, clear (`⌘S` / `Ctrl+S` quick-save).
- **Snapshot** keeps up to 3 dyno curves (this session) and overlays them on the dyno chart with Δhp/Δtorque.
- **Calibrate** tab: import a measured dyno curve (CSV / TSV / paste; rpm + torque and/or power, Nm or lb-ft, kW / hp / PS, header optional, decimal commas, wheel data with a drivetrain-loss input, SAE J1349 / DIN note). A bounded fit of a few uncertain parameters (VE scale, friction scale, intake tuning length, cam timing, boost target, ECU torque limit) runs in a Web Worker and reports RMS before / after, which parameters hit their bounds, and an ill-conditioning warning. A fit still above 5 % RMS is labelled poor. Apply / Revert; the calibration is saved with Garage builds. Samples are in `public/samples/`. Details: `src/calibrate/`.
- **Share** link encodes the full config in the URL. **Build sheet** copies a text spec.
- Sound (speaker icon) synthesizes exhaust pulses from the real firing order.

## How the numbers are computed

`src/sim/engine.ts` runs a 0-D quasi-steady model at every rpm from 1000 rpm to redline:

| Stage | Model |
|---|---|
| Breathing | Base VE × Taylor inlet-Mach-index choking × cam filling (IVC timing, overlap/reversion, VVT phasing, variable lift) × Helmholtz runner tuning × header scavenging × residuals; compressible throttle flow |
| Boost | Turbo: compressor flow/efficiency map with choke, surge and wheel-speed limits, turbine power balance, wastegate, back-pressure. Superchargers: roots/twin-screw/centrifugal with drive losses. Intercooler effectiveness and pressure drop |
| Combustion | Fuel-air-cycle indicated efficiency, Wiebe burn for peak pressure, Douaud–Eyzat knock integral → knock-limited spark advance (octane, CR, MAP, charge temp, bore, DI, alcohol cooling), lambda effects, EGT energy balance |
| Friction | Chen–Flynn FMEP + pumping + valvetrain + accessory/supercharger drive |
| Mechanical | Slider-crank piston speed/accel, valve float, rotating-assembly inertia and cylinder-pressure limits by material, mass estimate |
| Balance | 1st/2nd-order forces and couples summed from the actual crank geometry |

Calibration: global constants only (no per-engine fudging). See
`src/sim/__tests__/calibration.test.ts` for the predicted-vs-published table and
`research/` for sources, constants and sanity rules.

## Project layout

```
src/sim/       physics model, layout/kinematics, presets, reference engines
src/render/    procedural three.js engine (react-three-fiber)
src/ui/        app shell, controls, charts, store, audio
research/      sourced physics reference + validation targets
tests/unit/    independent validation: sanity rules, envelopes, fuzz, continuity
tests/e2e-ui/  Playwright UI scripts and screenshots
```

## Limitations

- Steady-state (wide-open throttle) only: no transient turbo lag or part-throttle maps.
- OEM ECU torque limits come from published ratings, not real ECU maps, so hardware-only turbo predictions carry roughly 11–20% error.
- Accuracy targets are not met (see "At a glance" above and `tests/reports/known_gaps.md`). Vehicle mode is illustrative: much of its reference data is unsourced.
- Estimated inputs (cam timing at 0.050", runner/header geometry, turbo hardware) for many
  reference engines are documented in `estimatedFields`.
