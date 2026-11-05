/** Level vs rpm raggedness at WOT: npx tsx scripts/audio/levelsweep.ts */
import { DEFAULT_CONFIG } from '../../src/sim/defaults';
import { paramsFor, renderScenario, steady } from '../../src/audio/offline';
import { db, rms } from '../../src/audio/analysis/analysis';
import type { EngineConfig } from '../../src/sim/types';
const fs = 48000;
for (const n of [3, 4, 5, 6, 8]) {
  const cfg: EngineConfig = { ...structuredClone(DEFAULT_CONFIG), name: `I${n}`, layout: 'inline', cylinders: n };
  const p = paramsFor(cfg);
  const lv: number[] = [];
  for (let rpm = 2000; rpm <= 8000; rpm += 300) {
    const r = renderScenario(p, cfg, steady(rpm, 1, 0.3), fs, {}, 0.25);
    lv.push(db(rms(r.left)));
  }
  // detrend (linear) and report spread
  const m = lv.length, xs = lv.map((_, i) => i);
  const xm = (m - 1) / 2, ym = lv.reduce((a, b) => a + b) / m;
  const sl = xs.reduce((a, x, i) => a + (x - xm) * (lv[i] - ym), 0) / xs.reduce((a, x) => a + (x - xm) ** 2, 0);
  const res = lv.map((y, i) => y - (ym + sl * (i - xm)));
  const sd = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / m);
  console.log(`I${n} mean ${ym.toFixed(1)}  slope/1000rpm ${(sl / 0.3).toFixed(1)}  sd ${sd.toFixed(1)}  range ${(Math.max(...res) - Math.min(...res)).toFixed(1)}  ` + lv.map((v) => v.toFixed(0)).join(' '));
}
