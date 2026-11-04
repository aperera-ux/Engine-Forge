/**
 * Offline renderer: same DSP core as the live AudioWorklet.
 *
 *   npx tsx scripts/audio/render.ts [engineId|all] [scenarioId|all] [--png] [--out dir]
 *
 * Writes tests/audio/out/<engine>_<scenario>.wav (16-bit stereo 48 kHz), an
 * optional spectrogram PNG (log-frequency, with the expected firing frequency
 * overlaid as a dotted white line) and <engine>_<scenario>.json (rpm/load
 * track + synth stats) for analyze.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS, TEST_ENGINES, paramsFor, renderScenario, scenario } from '../../src/audio/offline';
import { encodeWav, magSpectrum } from '../../src/audio/analysis/analysis';
import { colormap, encodePng } from './png';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : 'tests/audio/out';
const pos = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
const engineSel = pos[0] ?? 'all';
const scenSel = pos[1] ?? 'all';
const fs = 48000;
mkdirSync(outDir, { recursive: true });

export function spectrogramPng(x: Float32Array, fs: number, rpmTrack: Float32Array, cyl: number, path: string) {
  const W = 900;
  const H = 360;
  const n = 4096;
  const fMin = 20;
  const fMax = 12000;
  const hop = Math.max(1, Math.floor((x.length - n) / W));
  const rgb = new Uint8Array(W * H * 3);
  const cols: Float64Array[] = [];
  let mx = -1e9;
  for (let c = 0; c < W; c++) {
    const m = magSpectrum(x, c * hop, n);
    const col = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      const f = fMin * Math.pow(fMax / fMin, 1 - y / (H - 1));
      const b = (f * n) / fs;
      const i = Math.floor(b);
      const v = m[i] + (m[i + 1] - m[i]) * (b - i);
      col[y] = 20 * Math.log10(v + 1e-12);
      if (col[y] > mx) mx = col[y];
    }
    cols.push(col);
  }
  for (let c = 0; c < W; c++)
    for (let y = 0; y < H; y++) {
      const [r, g, b] = colormap((cols[c][y] - (mx - 80)) / 80);
      const o = (y * W + c) * 3;
      rgb[o] = r;
      rgb[o + 1] = g;
      rgb[o + 2] = b;
    }
  // Overlay expected firing frequency (dotted).
  const blk = 128;
  for (let c = 0; c < W; c += 3) {
    const rpm = rpmTrack[Math.min(rpmTrack.length - 1, Math.floor((c * hop + n / 2) / blk))];
    const f = (rpm / 120) * cyl;
    const y = Math.round((1 - Math.log(f / fMin) / Math.log(fMax / fMin)) * (H - 1));
    if (y >= 0 && y < H) {
      const o = (y * W + c) * 3;
      rgb[o] = rgb[o + 1] = rgb[o + 2] = 255;
    }
  }
  // Frequency gridlines at 100 Hz, 1 kHz, 10 kHz.
  for (const f of [100, 1000, 10000]) {
    const y = Math.round((1 - Math.log(f / fMin) / Math.log(fMax / fMin)) * (H - 1));
    for (let c = 0; c < W; c += 8) {
      const o = (y * W + c) * 3;
      rgb[o] = 80;
      rgb[o + 1] = 200;
      rgb[o + 2] = 255;
    }
  }
  writeFileSync(path, encodePng(W, H, rgb));
}

const engines = engineSel === 'all' ? TEST_ENGINES : TEST_ENGINES.filter((e) => e.id === engineSel);
const scens = scenSel === 'all' ? SCENARIOS : [scenario(scenSel)];
for (const e of engines) {
  const params = paramsFor(e.config);
  for (const sc of scens) {
    const r = renderScenario(params, e.config, sc, fs);
    const base = join(outDir, `${e.id}_${sc.id}`);
    writeFileSync(`${base}.wav`, encodeWav([r.left, r.right], fs));
    writeFileSync(
      `${base}.json`,
      JSON.stringify({
        engine: e.id,
        label: e.label,
        scenario: sc.id,
        description: sc.description,
        fs,
        cylinders: e.config.cylinders,
        idleRpm: e.config.idleRpm,
        redlineRpm: e.config.redlineRpm,
        block: 128,
        rpm: Array.from(r.rpmTrack, (v) => Math.round(v)),
        load: Array.from(r.loadTrack, (v) => Math.round(v * 1000) / 1000),
        stats: r.stats,
        realtimeFactor: (sc.durationS * 1000) / r.cpuMs,
      }),
    );
    if (flag('--png')) {
      const mono = new Float32Array(r.left.length);
      for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (r.left[i] + r.right[i]);
      spectrogramPng(mono, fs, r.rpmTrack, e.config.cylinders, `${base}.png`);
    }
    console.log(
      `${base}.wav  peak ${r.stats.peak.toFixed(3)}  pops ${r.stats.pops}  cut ${r.stats.cutCycles}/${r.stats.cycles}  ${((sc.durationS * 1000) / r.cpuMs).toFixed(1)}× realtime`,
    );
  }
}
