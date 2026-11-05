/** Round-2 A/B clips (forced induction tip-in + pulls): npx tsx scripts/audio/ab-fi.ts <outDir> */
import { mkdirSync, writeFileSync } from 'node:fs';
import { testEngine, paramsFor, renderScenario, type Scenario } from '../../src/audio/offline';
import { encodeWav } from '../../src/audio/analysis/analysis';
import { DEFAULT_CONFIG } from '../../src/sim/defaults';
import { seedSupercharger, seedTurbo } from '../../src/ui/checks';
import type { EngineConfig } from '../../src/sim/types';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));
const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const tipin: Scenario = { id: 'tipin', durationS: 10, description: 'tip-in', at: (t) => {
  if (t < 1.5) return { rpm: 2500, load: 0.25 };
  if (t < 4.5) return { rpm: lerp(2500, 4500, (t - 1.5) / 3), load: 1 };
  if (t < 6.5) return { rpm: lerp(4500, 3500, ease((t - 4.5) / 2)), load: 0.05 };
  return { rpm: lerp(3500, 4800, (t - 6.5) / 3.5), load: 1 };
} };
const base: EngineConfig = structuredClone(DEFAULT_CONFIG);
const set: [string, EngineConfig][] = [
  ['tipin_I4_na', base],
  ['tipin_I4_turbo', { ...structuredClone(base), induction: 'turbo', turbo: seedTurbo(base, 1) }],
  ['tipin_I4_sc-centrifugal', { ...structuredClone(base), induction: 'supercharger', supercharger: seedSupercharger(base) }],
  ['tipin_I4_sc-roots', { ...structuredClone(base), induction: 'supercharger', supercharger: { ...seedSupercharger(base), type: 'roots' } }],
  ['tipin_b58_turbo', testEngine('b58').config],
  ['tipin_ej257_turbo', testEngine('ej257').config],
  ['tipin_hellcat_sc', testEngine('hellcat').config],
];
for (const [name, cfg] of set) {
  const r = renderScenario(paramsFor(cfg), cfg, tipin, 48000);
  writeFileSync(`${out}/${name}.wav`, encodeWav([r.left, r.right], 48000));
}
for (const id of ['b58', 'hellcat']) {
  const cfg = testEngine(id).config;
  const pull: Scenario = { id: 'pull', durationS: 16, description: '', at: (t, c) => {
    const t0 = 1.5, sweep = 8, lim = 1.2, fall = 3.5;
    if (t < t0) return { rpm: c.idleRpm, load: 0.1 };
    if (t < t0 + sweep) { const x = (t - t0) / sweep; const sh = Math.min(1, 0.15 * x + 0.85 * (1 - Math.pow(1 - x, 1.6))); return { rpm: lerp(c.idleRpm, c.redlineRpm, sh), load: lerp(0.1, 1, (t - t0) / 0.15) }; }
    if (t < t0 + sweep + lim) return { rpm: c.redlineRpm, load: 1 };
    return { rpm: lerp(c.redlineRpm, c.idleRpm * 1.15, ease((t - t0 - sweep - lim) / fall)), load: 0 };
  } };
  const r = renderScenario(paramsFor(cfg), cfg, pull, 48000);
  writeFileSync(`${out}/pull_${id}.wav`, encodeWav([r.left, r.right], 48000));
}
