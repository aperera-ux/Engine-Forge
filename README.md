# Engine Forge

Interactive engine design studio. Configure an engine (layout, bore/stroke, cams,
valves, induction, exhaust, fuel, materials), watch a live procedural 3D render
of it, and read a physically modelled dyno sheet that is calibrated against 21 real
production engines.

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
- **Keys**: `D` dyno pull · `Space` run/pause · `S` snapshot · `1/2/3` view mode.
- **Snapshot** saves up to 3 builds and overlays them on the dyno chart with Δhp/Δtorque.
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
- No OEM ECU torque management, so some factory turbo torque plateaus are less flat than published.
- Estimated inputs (cam timing at 0.050", runner/header geometry, turbo hardware) for many
  reference engines are documented in `estimatedFields`.
