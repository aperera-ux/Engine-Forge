/**
 * Measured properties of the engine-sound synth (no listening required).
 * Targets follow research/engine_acoustics.md §8.
 */
import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../sim/layout';
import { centroid, db, detectFundamental, hygiene, magSpectrum, orderLevels, toneLevel } from '../analysis/analysis';
import { TEST_ENGINES, paramsFor, renderScenario, scenario, steady, testEngine } from '../offline';
import { EngineSynth } from '../synth/EngineSynth';
import type { EngineConfig } from '../../sim/types';

const FS = 48000;
const mono = (l: Float32Array, r: Float32Array) => l.map((v, i) => 0.5 * (v + r[i]));

function exhaust(cfg: EngineConfig, rpm: number, load = 1, dur = 2) {
  const r = renderScenario(paramsFor(cfg), cfg, steady(rpm, load, dur), FS, { exhaustOnly: true });
  return { left: r.left, mono: mono(r.left, r.right) };
}

/** max(L1.5, L2.5) re the strongest of the per-bank (n/4) and engine (n/2) firing orders, dB. */
function halfOrderDb(x: Float32Array, rpm: number, n: number): number {
  const fo = n / 2;
  const refs = Number.isInteger(fo / 2) ? [fo / 2, fo] : [fo];
  const lv = orderLevels(x, FS, rpm, [1.5, 2.5, ...refs], 12000);
  return db(Math.max(lv[0], lv[1]), Math.max(...lv.slice(2)));
}

describe('params', () => {
  it('derives a consistent exhaust graph for every test engine', () => {
    for (const e of TEST_ENGINES) {
      const p = paramsFor(e.config);
      expect(p.cylinders.every((c) => c.pipe >= 0 && c.portNode >= 0)).toBe(true);
      expect(p.outlets.length).toBeGreaterThan(0);
      expect(p.evoDeg).toBeGreaterThan(90);
      expect(p.evoDeg).toBeLessThan(170);
      // Crossplane V8 with separate banks keeps two systems; flat-4 UEL merges.
      if (e.id === 'ls3') expect(p.outlets.length).toBe(2);
    }
  });
});

describe('fundamental tracks the firing frequency (rpm/60 · n/2) within 3 %', () => {
  // Research §8 #1: the strongest line is order n/2 (or its 2nd harmonic when a pipe
  // resonance lifts it) and its frequency equals rpm·n/120. For inline engines the
  // harmonic-sum pitch detector must also return the firing frequency itself.
  for (const id of ['k20a', 'b58', 'ecoboost-i3', 'f136', 'f140']) {
    it(id, () => {
      const cfg = testEngine(id).config;
      expect(computeLayout(cfg).evenFiring).toBe(true);
      for (const rpm of [2500, Math.round(cfg.redlineRpm * 0.8)]) {
        const r = renderScenario(paramsFor(cfg), cfg, steady(rpm, 1, 1.6), FS);
        const x = mono(r.left, r.right);
        const ff = (rpm / 120) * cfg.cylinders;
        const n = 1 << 16;
        const m = magSpectrum(x, 8000, n);
        let pk = 0;
        for (let i = Math.floor((0.4 * ff * n) / FS); i < Math.ceil((2.6 * ff * n) / FS); i++) if (m[i] > m[pk]) pk = i;
        const fPk = (pk * FS) / n;
        const err = Math.min(Math.abs(fPk - ff) / ff, Math.abs(fPk - 2 * ff) / (2 * ff));
        expect(err).toBeLessThan(0.03);
        // The firing order dominates any sub-order line.
        const [half, fire] = orderLevels(x, FS, rpm, [cfg.cylinders / 4, cfg.cylinders / 2], 8000);
        expect(fire).toBeGreaterThan(half);
        if (cfg.layout === 'inline') {
          const f0 = detectFundamental(x, FS, ff / 2.6, ff * 2.6, 8000, n);
          expect(Math.abs(f0 - ff) / ff).toBeLessThan(0.03);
        }
      }
    });
  }
});

describe('firing-order signatures', () => {
  it('crossplane V8 per-bank signal has strong half orders; flat-plane does not', () => {
    const ls3 = testEngine('ls3').config;
    const f136 = testEngine('f136').config;
    for (const rpm of [2500, 4500]) {
      const cp = exhaust(ls3, rpm);
      const fp = exhaust(f136, rpm);
      const cpBank = halfOrderDb(cp.left, rpm, 8);
      const fpBank = halfOrderDb(fp.left, rpm, 8);
      const cpMono = halfOrderDb(cp.mono, rpm, 8);
      const fpMono = halfOrderDb(fp.mono, rpm, 8);
      // §8 #2: per-bank half orders near the firing order (we accept ≥ −8 dB).
      expect(cpBank).toBeGreaterThan(-8);
      // §8 #4: flat-plane half orders < −20 dB.
      expect(fpBank).toBeLessThan(-20);
      expect(cpBank - fpBank).toBeGreaterThan(20);
      // §8 #3 mono fold-down: crossplane half orders survive (> −25 dB), flat-plane stays clean.
      expect(cpMono).toBeGreaterThan(-25);
      expect(fpMono).toBeLessThan(-15);
      expect(cpMono - fpMono).toBeGreaterThan(8);
    }
  });

  it('boxer with unequal-length headers rumbles (odd orders grow with rpm, absent with equal-length)', () => {
    const uel = testEngine('ej257').config;
    const el: EngineConfig = { ...structuredClone(uel), exhaust: 'tuned-equal' };
    const odd = (cfg: EngineConfig, rpm: number) => {
      const x = exhaust(cfg, rpm).mono;
      const [o1, o3, o2] = orderLevels(x, FS, rpm, [1, 3, 2], 12000);
      return db(Math.max(o1, o3), o2);
    };
    const lo = odd(uel, 2500);
    const hi = odd(uel, 5000);
    const hiEl = odd(el, 5000);
    expect(hi).toBeGreaterThan(lo + 3);
    expect(hi).toBeGreaterThan(-25);
    expect(hi - hiEl).toBeGreaterThan(10);
  });
});

describe('spectral centroid rises with rpm and load', () => {
  for (const id of ['k20a', 'ls3', 'f136', 'b58']) {
    it(id, () => {
      const cfg = testEngine(id).config;
      const p = paramsFor(cfg);
      const c = (rpm: number, load: number) => {
        const r = renderScenario(p, cfg, steady(rpm, load, 1.2), FS);
        return centroid(mono(r.left, r.right), FS, 9600, 32768);
      };
      const rpms = [cfg.idleRpm, Math.round(cfg.redlineRpm * 0.45), Math.round(cfg.redlineRpm * 0.85)];
      const wot = rpms.map((r, i) => c(r, i === 0 ? 0.1 : 1));
      expect(wot[1]).toBeGreaterThan(wot[0]);
      expect(wot[2]).toBeGreaterThan(wot[1]);
      expect(c(rpms[1], 1)).toBeGreaterThan(c(rpms[1], 0.3) * 1.05);
    });
  }
});

describe('forced induction', () => {
  it('turbo whine energy rises with boost', () => {
    const cfg = testEngine('b58').config;
    const p = paramsFor(cfg);
    const run = (boost: number) => {
      const s = new EngineSynth(FS, { room: false });
      s.setEngine(p);
      s.setState({ rpm: 4000, load: 1, boostBar: boost });
      s.settle();
      const L = new Float32Array(FS * 3);
      const R = new Float32Array(FS * 3);
      for (let i = 0; i < L.length; i += 128) s.process(L.subarray(i, i + 128), R.subarray(i, i + 128));
      // Compressor shaft order (k = 1) — the audible whistle region.
      const f = s.stats.shaftRpm / 60;
      return { f, lvl: toneLevel(L, FS, f, FS * 2, FS), boost: s.stats.boostBar };
    };
    const lo = run(0.3);
    const hi = run(1.2);
    expect(hi.f).toBeGreaterThan(lo.f * 1.3);
    expect(hi.boost).toBeGreaterThan(lo.boost);
    expect(db(hi.lvl, lo.lvl)).toBeGreaterThan(6);
  });

  it('blow-off valve fires on lift-off from boost', () => {
    const cfg = testEngine('ej257').config;
    const r = renderScenario(paramsFor(cfg), cfg, scenario('overrun'), FS);
    expect(r.stats.bov).toBeGreaterThanOrEqual(1);
    // NA engine: no BOV.
    const na = testEngine('k20a').config;
    expect(renderScenario(paramsFor(na), na, scenario('overrun'), FS).stats.bov).toBe(0);
  });
});

describe('hygiene and performance', () => {
  it('all engines: no NaN, no clipping, no DC on a full WOT pull', () => {
    for (const e of TEST_ENGINES) {
      const r = renderScenario(paramsFor(e.config), e.config, scenario('pull'), FS);
      for (const ch of [r.left, r.right]) {
        const h = hygiene(ch);
        expect(h.nan, e.id).toBe(0);
        expect(h.clipped, e.id).toBe(0);
        expect(Math.abs(h.dc), e.id).toBeLessThan(1e-3);
        expect(h.peak, e.id).toBeGreaterThan(0.05);
      }
    }
  }, 120000);

  it('V12 offline core runs > 5× faster than real time', () => {
    const cfg = testEngine('f140').config;
    const r = renderScenario(paramsFor(cfg), cfg, steady(7500, 1, 4), FS);
    const factor = 4000 / r.cpuMs;
    expect(factor).toBeGreaterThan(5);
  });
});
