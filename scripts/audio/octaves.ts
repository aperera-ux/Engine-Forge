/** Octave-band levels (dB re loudest band) for steady WOT renders: npx tsx scripts/audio/octaves.ts [cyl...] */
import { DEFAULT_CONFIG } from '../../src/sim/defaults';
import { paramsFor, renderScenario, steady } from '../../src/audio/offline';
import { bandPower } from '../../src/audio/analysis/analysis';
import type { EngineConfig } from '../../src/sim/types';
const fs = 48000;
const bands = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
const counts = process.argv.slice(2).map(Number).filter(Boolean);
console.log('eng   rpm   ' + bands.map((b) => String(b).padStart(6)).join(''));
for (const n of counts.length ? counts : [4, 6, 8]) {
  const cfg: EngineConfig = { ...structuredClone(DEFAULT_CONFIG), name: `I${n}`, layout: 'inline', cylinders: n };
  const p = paramsFor(cfg);
  for (const rpm of [3000, 7500]) {
    const r = renderScenario(p, cfg, steady(rpm, 1, 1.5), fs, process.env.EXO ? { exhaustOnly: true } : {});
    const x = r.left.map((v, i) => 0.5 * (v + r.right[i]));
    const lv = bands.map((b) => {
      let s = 0;
      for (let k = 0; k < 6; k++) s += bandPower(x, fs, fs / 4 + k * 8192, b / Math.SQRT2, b * Math.SQRT2, 8192);
      return 10 * Math.log10(s + 1e-30);
    });
    const mx = Math.max(...lv);
    // A-weighting at band centres (IEC 61672): rough perceived-loudness proxy.
    const aw = [-26.2, -16.1, -8.6, -3.2, 0, 1.2, 1.0, -1.1];
    const la = 10 * Math.log10(lv.reduce((a, v, i) => a + Math.pow(10, (v + aw[i]) / 10), 0));
    console.log(`I${n}`.padEnd(6) + `${rpm}`.padEnd(6) + lv.map((v) => (v - mx).toFixed(0).padStart(6)).join('') + '   dBA ' + la.toFixed(1));
  }
}
