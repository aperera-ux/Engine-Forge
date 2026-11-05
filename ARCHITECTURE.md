# Engine Forge — architecture & ownership

Interactive engine builder: configure an engine, see a live procedural 3D render
and physically grounded dyno results.

Stack: Vite + React 19 + TypeScript, three.js via @react-three/fiber + drei +
@react-three/postprocessing, zustand for state, recharts for charts, vitest for tests.

## Module boundaries (each owned by one agent — do not edit others' files)

| Path | Owner | Purpose |
|---|---|---|
| `src/sim/types.ts` | lead (additive changes only, by anyone, announce in log) | EngineConfig / SimResult contract |
| `src/sim/layout.ts` | lead | crank phasing, firing order, slider-crank kinematics |
| `src/sim/defaults.ts` | lead | DEFAULT_CONFIG |
| `src/sim/**` (rest) | physics agent | `simulate(config): SimResult` in `engine.ts` + submodels |
| `src/sim/presets.ts` | research agent | real-engine presets as EngineConfig |
| `src/sim/validation/**` | research agent (data), test agent (tests) | reference engines w/ published figures |
| `research/**` | research agent | formulas, sources, notes |
| `src/render/**` | render agent | `<EngineScene />` procedural animated 3D engine |
| `src/ui/**`, `src/App.tsx`, `src/main.tsx`, `src/index.css`, `index.html` | UI agent | app shell, controls, charts, store |
| `src/calibrate/**` | calibrate agent | dyno-file import (`parse.ts`), bounded parameter set (`params.ts`), calibrated model (`model.ts`), Nelder-Mead fitter (`fit.ts`), Web Worker client; calls `simulate()` through its public API only (enforced by `tests/unit/calibrate-boundary.test.ts`) |
| `src/ui/vehicle/**` | UI agent (Vehicle mode) | car designer, KPIs, charts, optimiser UI; sims run in `vehicle.worker.ts` via `client.ts` (main-thread fallback), calling `src/vehicle` public API only |
| `tests/**`, `src/**/__tests__` | test agent (+ module owners for their unit tests) | validation and e2e |

## Integration points
- Store (`src/ui/store.ts`, UI agent): holds `config: EngineConfig`, `rpm` (live
  animation/throttle rpm), `result: SimResult` (recomputed via `simulate`).
- Renderer exports `EngineScene` from `src/render/index.ts` with props
  `{ config: EngineConfig; rpm: number; running: boolean; viewMode: 'solid' | 'cutaway' | 'xray'; load?: number }`.
- Sim exports `simulate` from `src/sim/engine.ts`. Must be fast (< 15 ms per call)
  because the UI calls it on every slider change.

## Progress logs
Each agent appends timestamped status lines to `agent-logs/<agent>.log`.
