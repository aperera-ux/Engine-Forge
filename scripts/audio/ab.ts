/** Render A/B clips (inline cylinder ladder + four pulls): npx tsx scripts/audio/ab.ts <outDir> */
import { mkdirSync, writeFileSync } from 'node:fs';
import { testEngine, paramsFor, renderScenario, scenario, steady } from '../../src/audio/offline';
import { encodeWav } from '../../src/audio/analysis/analysis';
import { DEFAULT_CONFIG } from '../../src/sim/defaults';
import type { EngineConfig } from '../../src/sim/types';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const FS = 48000;
// Inline cylinder-count ladder: same 500 cc cylinders, 3000 then 7500 rpm WOT (2 s each, back to back).
for (const n of [3, 4, 5, 6, 8]) {
  const cfg: EngineConfig = { ...structuredClone(DEFAULT_CONFIG), name: `I${n}`, layout: 'inline', cylinders: n };
  const p = paramsFor(cfg);
  const a = renderScenario(p, cfg, steady(3000, 1, 2), FS), b = renderScenario(p, cfg, steady(7500, 1, 2), FS);
  const cat = (x: Float32Array, y: Float32Array) => { const z = new Float32Array(x.length + y.length); z.set(x); z.set(y, x.length); return z; };
  writeFileSync(`${out}/ladder_I${n}_3000-then-7500.wav`, encodeWav([cat(a.left, b.left), cat(a.right, b.right)], FS));
}
for (const id of ['k20a', 'b58', 'f140', 'ls3']) {
  const cfg = testEngine(id).config;
  const r = renderScenario(paramsFor(cfg), cfg, scenario('pull'), FS);
  writeFileSync(`${out}/${id}_pull.wav`, encodeWav([r.left, r.right], FS));
}
