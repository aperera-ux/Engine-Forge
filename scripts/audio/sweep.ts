/**
 * Cylinder-count sweep diagnostic: same per-cylinder design, inline 3..8,
 * steady WOT at several rpm. Prints level, centroid, HF share, firing-harmonic
 * tilt and "non-firing-order" content (cylinder-to-cylinder nuance).
 *   npx tsx scripts/audio/sweep.ts [--wav dir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../../src/sim/defaults';
import { paramsFor, renderScenario, steady } from '../../src/audio/offline';
import { bandPower, centroid, db, encodeWav, orderLevels, rms } from '../../src/audio/analysis/analysis';
import type { EngineConfig } from '../../src/sim/types';

const args = process.argv.slice(2);
const wi = args.indexOf('--wav');
const wavDir = wi >= 0 ? args[wi + 1] : null;
if (wavDir) mkdirSync(wavDir, { recursive: true });
const fs = 48000;
const counts = [3, 4, 5, 6, 8];
const rpms = [2500, 5000, 7500];
console.log('cyl  rpm   rmsDb  centHz  HF>2k%  h1..h6 (dB re h1)            nonFiring dB');
for (const n of counts) {
  const cfg: EngineConfig = { ...structuredClone(DEFAULT_CONFIG), name: `I${n}`, layout: 'inline', cylinders: n };
  const p = paramsFor(cfg);
  for (const rpm of rpms) {
    const r = renderScenario(p, cfg, steady(rpm, 1, 2), fs);
    const x = r.left.map((v, i) => 0.5 * (v + r.right[i]));
    const st = fs / 2;
    const len = x.length - st;
    let cent = 0, hf = 0;
    const fr = 8;
    for (let k = 0; k < fr; k++) {
      const s = st + Math.floor((k * (len - 8192)) / fr);
      cent += centroid(x, fs, s, 8192) / fr;
      hf += bandPower(x, fs, s, 2000, 20000) / Math.max(1e-30, bandPower(x, fs, s, 20, 20000)) / fr;
    }
    const fo = n / 2;
    const harm = orderLevels(x, fs, rpm, [1, 2, 3, 4, 5, 6].map((h) => h * fo), st, len);
    const h = harm.map((a) => db(a, harm[0]).toFixed(0).padStart(4)).join('');
    // non-firing orders: half orders 0.5..fo*3 not multiple of fo
    const nf: number[] = [];
    for (let o = 0.5; o <= fo * 3; o += 0.5) if (Math.abs(o / fo - Math.round(o / fo)) > 1e-6) nf.push(o);
    const nfl = orderLevels(x, fs, rpm, nf, st, len);
    const nfMax = Math.max(...nfl.map((a) => db(a, harm[0])));
    console.log(`pre ${r.stats.preLimPeak.toFixed(2)} ` + `I${n}`.padEnd(5) + `${rpm}`.padEnd(6) + db(rms(x, st, len)).toFixed(1).padStart(6) + cent.toFixed(0).padStart(8) + (hf * 100).toFixed(1).padStart(8) + '   ' + h + '     ' + nfMax.toFixed(1));
    if (wavDir) writeFileSync(`${wavDir}/I${n}_${rpm}.wav`, encodeWav([r.left, r.right], fs));
  }
}
