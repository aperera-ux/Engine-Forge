/**
 * Analysis of rendered engine sound.
 *
 *   npx tsx scripts/audio/analyze.ts            # WAVs in tests/audio/out + steady-state order analysis
 *
 * Per WAV (with its .json rpm/load track): hygiene (NaN / clipping / DC),
 * crest factor (idle vs high-rpm WOT), spectral centroid vs time, fundamental
 * tracking vs firing frequency (even-fire engines).
 * Steady-state (rendered here with the same core, exhaust only): engine-order
 * levels, half-order ratio per bank and in mono fold-down, UEL odd orders.
 * Writes tests/audio/out/analysis.json and prints a summary.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_ENGINES, paramsFor, renderScenario, steady, testEngine } from '../../src/audio/offline';
import { centroid, crestDb, db, decodeWav, detectFundamental, hygiene, magSpectrum, orderLevels, rms, bandPower } from '../../src/audio/analysis/analysis';
import { computeLayout } from '../../src/sim/layout';

const dir = 'tests/audio/out';
const out: Record<string, unknown> = {};

interface Meta {
  engine: string;
  scenario: string;
  fs: number;
  cylinders: number;
  idleRpm: number;
  redlineRpm: number;
  block: number;
  rpm: number[];
  load: number[];
  realtimeFactor: number;
}

function wavReport(file: string) {
  const meta = JSON.parse(readFileSync(file.replace(/\.wav$/, '.json'), 'utf8')) as Meta;
  const { fs, channels } = decodeWav(readFileSync(file));
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * (channels[0][i] + channels[1][i]);
  const hL = hygiene(channels[0]);
  const hR = hygiene(channels[1]);
  const rpmAt = (s: number) => meta.rpm[Math.min(meta.rpm.length - 1, Math.floor(s / meta.block))];
  const loadAt = (s: number) => meta.load[Math.min(meta.load.length - 1, Math.floor(s / meta.block))];
  // Centroid over time (0.25 s hop).
  const cent: { t: number; rpm: number; load: number; hz: number; dbfs: number }[] = [];
  for (let s = 0; s + 4096 < n; s += Math.floor(fs / 4)) cent.push({ t: s / fs, rpm: rpmAt(s + 2048), load: loadAt(s + 2048), hz: centroid(mono, fs, s), dbfs: db(rms(mono, s, 4096)) });
  // Fundamental tracking where rpm is steady-ish over an 8192 window.
  const lay = computeLayout(testEngine(meta.engine).config);
  const track: { t: number; rpm: number; ffire: number; f0: number; errPct: number }[] = [];
  if (lay.evenFiring) {
    const N = 8192;
    for (let s = 0; s + N < n; s += N) {
      const r0 = rpmAt(s);
      const r1 = rpmAt(s + N);
      if (Math.abs(r1 - r0) / r0 > 0.03 || loadAt(s) < 0.5 || r1 >= meta.redlineRpm - 50) continue; // skip limiter (fuel-cut chop)
      const rpm = 0.5 * (r0 + r1);
      const ff = (rpm / 120) * meta.cylinders;
      // §8 #1: dominant line must be order n/2 (or its 2nd harmonic). Inline: harmonic-sum pitch.
      let f0: number;
      if (lay.cylinders.every((c) => c.bank === 0)) f0 = detectFundamental(mono, fs, ff / 2.6, ff * 2.6, s, N);
      else {
        const m = magSpectrum(mono, s, N);
        let pk = 0;
        for (let i = Math.floor((0.4 * ff * N) / fs); i < Math.ceil((2.6 * ff * N) / fs); i++) if (m[i] > m[pk]) pk = i;
        f0 = (pk * fs) / N;
        if (Math.abs(f0 - 2 * ff) < Math.abs(f0 - ff)) f0 /= 2;
      }
      track.push({ t: s / fs, rpm, ffire: ff, f0, errPct: (100 * (f0 - ff)) / ff });
    }
  }
  // Crest factor: idle (first 1 s) and the highest-rpm WOT second.
  const idleCrest = crestDb(mono, Math.floor(0.2 * fs), fs);
  let hiStart = 0;
  let hiRpm = 0;
  for (let s = 0; s + fs < n; s += fs / 4) if (loadAt(s) > 0.9 && rpmAt(s) > hiRpm) ((hiRpm = rpmAt(s)), (hiStart = s));
  const wotCrest = hiRpm > 0 ? crestDb(mono, hiStart, Math.floor(fs * 0.5)) : null;
  return {
    file,
    hygiene: { nan: hL.nan + hR.nan, clipped: hL.clipped + hR.clipped, dc: Math.max(Math.abs(hL.dc), Math.abs(hR.dc)), peak: Math.max(hL.peak, hR.peak) },
    idleCrestDb: idleCrest,
    wotCrestDb: wotCrest,
    centroid: cent,
    fundamental: track,
    maxTrackErrPct: track.length ? Math.max(...track.map((x) => Math.abs(x.errPct))) : null,
    realtimeFactor: meta.realtimeFactor,
  };
}

/** Half-order ratio: max(L1.5, L2.5) re firing order (dB). */
export function halfOrderRatioDb(x: Float32Array, fs: number, rpm: number, firingOrder: number): number {
  // Reference: strongest of the per-bank firing order (n/4 on V/flat) and the engine firing order n/2.
  const refs = Number.isInteger(firingOrder / 2) ? [firingOrder / 2, firingOrder] : [firingOrder];
  const lv = orderLevels(x, fs, rpm, [1.5, 2.5, ...refs], Math.floor(fs * 0.25));
  return db(Math.max(lv[0], lv[1]), Math.max(...lv.slice(2)));
}

function steadyOrders() {
  const res: Record<string, unknown> = {};
  for (const e of TEST_ENGINES) {
    const p = paramsFor(e.config);
    const fo = e.config.cylinders / 2;
    const rows: unknown[] = [];
    for (const rpm of [2500, 5000]) {
      if (rpm > e.config.redlineRpm) continue;
      const r = renderScenario(p, e.config, steady(rpm, 1, 2.5), 48000, { exhaustOnly: true });
      const mono = new Float32Array(r.left.length);
      for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (r.left[i] + r.right[i]);
      const orders = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6];
      const lv = (x: Float32Array) => orderLevels(x, 48000, rpm, orders, 12000).map((a) => +db(a).toFixed(1));
      rows.push({
        rpm,
        left: Object.fromEntries(orders.map((o, i) => [o, lv(r.left)[i]])),
        mono: Object.fromEntries(orders.map((o, i) => [o, lv(mono)[i]])),
        halfOrderLeftDb: +halfOrderRatioDb(r.left, 48000, rpm, fo).toFixed(1),
        halfOrderMonoDb: +halfOrderRatioDb(mono, 48000, rpm, fo).toFixed(1),
      });
    }
    res[e.id] = rows;
  }
  return res;
}

function loadAndBoost() {
  const res: Record<string, unknown> = {};
  for (const e of TEST_ENGINES) {
    const p = paramsFor(e.config);
    const rpm = Math.round(e.config.redlineRpm * 0.55);
    const lo = renderScenario(p, e.config, steady(rpm, 0.3, 2));
    const hi = renderScenario(p, e.config, steady(rpm, 1, 2));
    const idle = renderScenario(p, e.config, steady(e.config.idleRpm, 0.1, 2));
    const top = renderScenario(p, e.config, steady(Math.round(e.config.redlineRpm * 0.75), 1, 2));
    const s = 24000;
    res[e.id] = {
      rpm,
      centroidPartHz: Math.round(centroid(lo.left, 48000, s, 16384)),
      centroidWotHz: Math.round(centroid(hi.left, 48000, s, 16384)),
      centroidIdleHz: Math.round(centroid(idle.left, 48000, s, 16384)),
      wotVsPartDb: +(db(rms(hi.left, s)) - db(rms(lo.left, s))).toFixed(1),
      idleToThreeQuarterDb: +(db(rms(top.left, s)) - db(rms(idle.left, s))).toFixed(1),
      idleDbfs: +db(rms(idle.left, s)).toFixed(1),
      wotTopDbfs: +db(rms(top.left, s)).toFixed(1),
      boostWot: +hi.stats.boostBar.toFixed(2),
      whineBandWotVsPartDb:
        e.config.induction === 'na' ? null : +(10 * Math.log10(bandPower(hi.left, 48000, s, 1000, 9000) / bandPower(lo.left, 48000, s, 1000, 9000))).toFixed(1),
    };
  }
  return res;
}

const onlySteady = process.argv.includes('--steady');
const wavs = onlySteady ? [] : readdirSync(dir).filter((f) => f.endsWith('.wav'));
const reports = wavs.map((f) => wavReport(join(dir, f)));
out.wav = reports;
out.steadyOrders = steadyOrders();
out.loadAndBoost = loadAndBoost();
writeFileSync(join(dir, 'analysis.json'), JSON.stringify(out, null, 1));

console.log('file                              nan clip  dc        peak   crestIdle crestWOT  maxF0err%  rt×');
for (const r of reports)
  console.log(
    `${r.file.padEnd(34)}${String(r.hygiene.nan).padStart(3)} ${String(r.hygiene.clipped).padStart(4)}  ${r.hygiene.dc.toExponential(1).padEnd(9)} ${r.hygiene.peak.toFixed(3)}  ${r.idleCrestDb.toFixed(1).padStart(6)}   ${r.wotCrestDb?.toFixed(1).padStart(6) ?? '   -  '}   ${r.maxTrackErrPct?.toFixed(2).padStart(6) ?? '   -  '}   ${r.realtimeFactor.toFixed(1)}`,
  );
console.log('\nSteady WOT exhaust-only orders (dB): half-order ratio max(L1.5,L2.5)/L(n/2), per bank (left) and mono');
for (const [id, rows] of Object.entries(out.steadyOrders as Record<string, { rpm: number; halfOrderLeftDb: number; halfOrderMonoDb: number; left: Record<string, number> }[]>))
  for (const r of rows) console.log(`${id.padEnd(12)} ${r.rpm}  left ${r.halfOrderLeftDb.toFixed(1).padStart(6)}  mono ${r.halfOrderMonoDb.toFixed(1).padStart(6)}   L(0.5,1,1.5,2,2.5,3,4)=${[0.5, 1, 1.5, 2, 2.5, 3, 4].map((o) => r.left[o]).join(' ')}`);
console.log('\nLoad / level / boost');
for (const [id, r] of Object.entries(out.loadAndBoost as Record<string, Record<string, unknown>>)) console.log(id.padEnd(12), JSON.stringify(r));
