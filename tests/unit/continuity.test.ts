/**
 * Independent audit, task 4: continuity / UX realism. Each numeric slider is swept across
 * its UI range (src/ui/ConfigPanel.tsx) in 1%-of-range steps on several base engines.
 * - Jump: |Δ peak hp| > 5% for one 1% step. Allowed only at a physically real threshold
 *   (valve float crossing into the rev range). Each jump is re-sampled at 0.1% steps to tell a
 *   true discontinuity from a merely steep slope.
 * - Reversal: the number of direction changes (0.5% hysteresis) in peak hp beyond what the
 *   physics allows (monotone params: 0; single-optimum params: 1).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { base, getField, r3, recorder, simulate, withField, type BaseKey, type EngineConfig, type SimResult } from './helpers';

const R = recorder('continuity');
afterAll(() => R.flush());

interface Param {
  path: string;
  lo: number | ((c: EngineConfig) => number);
  hi: number | ((c: EngineConfig) => number);
  /** max allowed direction changes of peak hp over the sweep */
  turns: number;
  /** 'up' = must be non-decreasing (within 1%) */
  dir?: 'up';
  only?: ('na' | 'turbo' | 'supercharger')[];
}

const PARAMS: Param[] = [
  { path: 'boreMm', lo: 50, hi: 130, turns: 1 },
  { path: 'strokeMm', lo: 40, hi: 130, turns: 1 },
  { path: 'rodLengthMm', lo: (c) => c.strokeMm * 1.3, hi: (c) => c.strokeMm * 2.4, turns: 1 },
  { path: 'compressionRatio', lo: 6, hi: 16, turns: 1 },
  { path: 'intakeValveMm', lo: 20, hi: 65, turns: 1 },
  { path: 'exhaustValveMm', lo: 18, hi: 55, turns: 1 },
  { path: 'cam.intakeDurationDeg', lo: 180, hi: 320, turns: 1 },
  { path: 'cam.exhaustDurationDeg', lo: 180, hi: 320, turns: 1 },
  { path: 'cam.intakeLiftMm', lo: 6, hi: 20, turns: 1 },
  { path: 'cam.exhaustLiftMm', lo: 6, hi: 20, turns: 1 },
  { path: 'cam.lobeSeparationDeg', lo: 100, hi: 122, turns: 1 },
  { path: 'cam.intakeCenterlineDeg', lo: 95, hi: 125, turns: 1 },
  { path: 'intakeRunnerMm', lo: 80, hi: 800, turns: 1 },
  { path: 'throttleMm', lo: 30, hi: 140, turns: 0, dir: 'up' },
  { path: 'headerPrimaryMm', lo: 150, hi: 1400, turns: 1 },
  { path: 'headerDiameterMm', lo: 25, hi: 70, turns: 1 },
  { path: 'lambda', lo: 0.7, hi: 1.05, turns: 1 },
  // Raising the rev limiter only adds rpm points: peak hp can never fall.
  { path: 'redlineRpm', lo: 3000, hi: 20000, turns: 0, dir: 'up' },
  { path: 'idleRpm', lo: 400, hi: 2000, turns: 0 },
  { path: 'vAngleDeg', lo: 15, hi: 135, turns: 0 },
  { path: 'turbo.targetBoostBar', lo: 0.2, hi: 3, turns: 0, dir: 'up', only: ['turbo'] },
  { path: 'turbo.compressorInducerMm', lo: 30, hi: 90, turns: 1, only: ['turbo'] },
  { path: 'turbo.turbineAR', lo: 0.4, hi: 1.4, turns: 1, only: ['turbo'] },
  { path: 'turbo.intercoolerEffectiveness', lo: 0, hi: 0.95, turns: 0, dir: 'up', only: ['turbo'] },
  { path: 'supercharger.targetBoostBar', lo: 0.1, hi: 2, turns: 0, dir: 'up', only: ['supercharger'] },
  { path: 'supercharger.intercoolerEffectiveness', lo: 0, hi: 0.95, turns: 0, dir: 'up', only: ['supercharger'] },
];

const BASE_KEYS: BaseKey[] = ['naI4', 'naPushrodV8', 'turboI4', 'scV8'];
const STEPS = 100;

function countTurns(ys: number[], hyst = 0.005): number {
  let turns = 0;
  let dir = 0;
  let ext = ys[0];
  for (const y of ys.slice(1)) {
    if (dir >= 0 && y > ext) ext = y;
    else if (dir <= 0 && y < ext) ext = y;
    if (dir >= 0 && y < ext * (1 - hyst)) {
      if (dir === 1) turns++;
      dir = -1;
      ext = y;
    } else if (dir <= 0 && y > ext * (1 + hyst)) {
      if (dir === -1) turns++;
      dir = 1;
      ext = y;
    }
  }
  return turns;
}

const all: Record<string, unknown>[] = [];

for (const bk of BASE_KEYS) {
  const b0 = base(bk);
  describe(`continuity sweeps on ${bk} (${b0.name})`, () => {
    for (const p of PARAMS) {
      if (p.only && !p.only.includes(b0.induction)) continue;
      if (p.path === 'vAngleDeg' && b0.layout !== 'v') continue;
      it(`${p.path}: no discontinuity / >5% peak-hp jump per 1% change; ≤ ${p.turns} reversal(s)${p.dir ? '; non-decreasing' : ''}`, () => {
        const lo = typeof p.lo === 'function' ? p.lo(b0) : p.lo;
        const hi = typeof p.hi === 'function' ? p.hi(b0) : p.hi;
        const xs = Array.from({ length: STEPS + 1 }, (_, i) => lo + ((hi - lo) * i) / STEPS);
        const mk = (x: number) => {
          let c = withField(b0, p.path, x);
          if (p.path === 'redlineRpm') c = withField(c, 'idleRpm', Math.min(c.idleRpm, x - 600));
          return c;
        };
        const rs: SimResult[] = xs.map((x) => simulate(mk(x)));
        const hp = rs.map((r) => r.peakHp);
        const jumps: Record<string, unknown>[] = [];
        for (let i = 1; i < rs.length; i++) {
          const d = (hp[i] - hp[i - 1]) / Math.max(1, hp[i - 1]);
          if (Math.abs(d) <= 0.02) continue;
          // A "1% parameter change" is 1% of the parameter's value: scale the 5% allowance by
          // the relative size of this step (a 1%-of-range step can be a 5% change of the value).
          const relDx = Math.abs(xs[i] - xs[i - 1]) / Math.max(1e-9, Math.abs(xs[i - 1]) || Math.abs(hi - lo));
          const allowed = 0.05 * Math.max(1, relDx / 0.01);
          // re-sample at 0.1% of range: a true discontinuity does not shrink with the step
          const fine = Array.from({ length: 11 }, (_, k) => simulate(mk(xs[i - 1] + ((xs[i] - xs[i - 1]) * k) / 10)).peakHp);
          const fineMax = Math.max(...fine.slice(1).map((y, k) => Math.abs(y - fine[k]) / Math.max(1, fine[k])));
          const discontinuous = fineMax > 0.6 * Math.abs(d);
          if (Math.abs(d) <= allowed && !discontinuous) continue;
          // threshold: valve float crossing into / out of the rev range
          const floatCross = (rs[i - 1].valveFloatRpm < rs[i - 1].config.redlineRpm) !== (rs[i].valveFloatRpm < rs[i].config.redlineRpm);
          jumps.push({ from: r3(xs[i - 1]), to: r3(xs[i]), hpFrom: r3(hp[i - 1]), hpTo: r3(hp[i]), pct: r3(100 * d), allowedPct: r3(100 * allowed), finePct: r3(100 * fineMax), discontinuous, floatCross });
        }
        const turns = countTurns(hp);
        let dropsUp = 0;
        if (p.dir === 'up') for (let i = 1; i < hp.length; i++) if (hp[i] < Math.max(...hp.slice(0, i)) * 0.99) dropsUp++;
        // Peak-torque rpm readout jitter (UX): how many 1%-steps move it by more than 15%.
        const tqRpmJumps = rs.slice(1).filter((r, i) => Math.abs(r.peakTorqueRpm - rs[i].peakTorqueRpm) > 0.15 * rs[i].peakTorqueRpm).length;
        const row = {
          base: bk, param: p.path, lo: r3(lo), hi: r3(hi), hpMin: r3(Math.min(...hp)), hpMax: r3(Math.max(...hp)),
          atMax: r3(xs[hp.indexOf(Math.max(...hp))]), turns, allowedTurns: p.turns, dropsUp, tqRpmJumps,
          jumps,
          sample: xs.filter((_, i) => i % 10 === 0).map((x, k) => [r3(x), r3(hp[k * 10])]),
        };
        all.push(row);
        const realJumps = jumps.filter((j) => !j.floatCross);
        expect(realJumps, JSON.stringify(realJumps).slice(0, 400)).toEqual([]);
        expect(turns, `hp sequence ${JSON.stringify(row.sample)}`).toBeLessThanOrEqual(p.turns);
        if (p.dir === 'up') expect(dropsUp, `hp sequence ${JSON.stringify(row.sample)}`).toBe(0);
      });
    }
  });
}

afterAll(() => R.rec('sweeps', all));
