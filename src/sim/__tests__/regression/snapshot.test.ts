/**
 * Regression + timing harness for simulate() (opt-in; skipped in normal runs).
 *
 *   SIM_SNAPSHOT=write npx vitest run src/sim/__tests__/regression   → writes baseline.json
 *   SIM_SNAPSHOT=check npx vitest run src/sim/__tests__/regression   → compares against it
 *   SIM_SNAPSHOT=time  npx vitest run src/sim/__tests__/regression   → timings only
 *
 * Snapshots the full SimResult (minus the echoed config) of every preset and
 * reference engine in three modes: default, includeUnlimited, applyOemLimits=false.
 * check fails if any numeric leaf deviates by more than TOL (relative, with a
 * tiny absolute floor for values that are ~0) or any non-numeric leaf differs.
 * SIM_TIMES=<file> also writes per-config median timings (JSON).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { simulate } from '../../engine';
import { PRESETS } from '../../presets';
import { EXTENDED_REFERENCE_ENGINES } from '../../validation/referenceEngines';
import type { EngineConfig, SimOptions } from '../../types';

const MODE = process.env.SIM_SNAPSHOT;
const FILE = process.env.SIM_BASELINE ?? path.join(__dirname, 'baseline.json');
const TOL = 1e-3; // 0.1 %
const ABS_FLOOR = 1e-9;

const configs: EngineConfig[] = [];
for (const c of [...PRESETS, ...EXTENDED_REFERENCE_ENGINES.map((e) => e.config)])
  if (!configs.some((x) => x.name === c.name)) configs.push(c);
const MODES: [string, SimOptions][] = [
  ['default', {}],
  ['unlimited', { includeUnlimited: true }],
  ['oemOff', { applyOemLimits: false }],
];

function snap(c: EngineConfig, o: SimOptions): unknown {
  const r = simulate(c, o) as unknown as Record<string, unknown>;
  const { config: _c, ...rest } = r;
  return JSON.parse(JSON.stringify(rest));
}

interface Dev { key: string; rel: number; a: unknown; b: unknown }
function compare(a: unknown, b: unknown, key: string, out: Dev[]): void {
  if (typeof a === 'number' && typeof b === 'number') {
    const rel = Math.abs(a - b) / Math.max(Math.abs(b), ABS_FLOOR);
    if (a !== b) out.push({ key, rel: Math.abs(a - b) <= ABS_FLOOR ? 0 : rel, a, b });
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    for (const k of new Set([...ka, ...kb])) compare((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${key}.${k}`, out);
    return;
  }
  if (a !== b) out.push({ key, rel: Infinity, a, b });
}

function median(c: EngineConfig, o: SimOptions, n: number): number {
  for (let i = 0; i < 3; i++) simulate(c, o);
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    simulate(c, o);
    t.push(performance.now() - t0);
  }
  t.sort((x, y) => x - y);
  return t[Math.floor(n / 2)];
}

describe.runIf(!!MODE)('simulate regression snapshot', () => {
  it(`mode ${MODE}`, () => {
    if (MODE === 'write' || MODE === 'check') {
      const cur: Record<string, unknown> = {};
      for (const c of configs) for (const [m, o] of MODES) cur[`${c.name} [${m}]`] = snap(c, o);
      if (MODE === 'write') {
        fs.writeFileSync(FILE, JSON.stringify(cur));
        console.log(`wrote ${Object.keys(cur).length} snapshots to ${FILE}`);
      } else {
        const base = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, unknown>;
        const devs: Dev[] = [];
        compare(cur, base, '', devs);
        devs.sort((x, y) => y.rel - x.rel);
        const byField = new Map<string, number>();
        for (const d of devs) {
          const f = d.key.replace(/^\.[^.]*\]/, '').replace(/\.\d+/g, '[]');
          byField.set(f, Math.max(byField.get(f) ?? 0, d.rel));
        }
        console.log(`leaves differing: ${devs.length}; max rel dev ${devs.length ? (100 * devs[0].rel).toExponential(3) : 0} %`);
        for (const d of devs.slice(0, 15)) console.log(`  ${(100 * d.rel).toExponential(3)} %  ${d.key}  ${d.a} vs ${d.b}`);
        for (const [f, v] of [...byField].sort((x, y) => y[1] - x[1]).slice(0, 20)) console.log(`  field ${f}: ${(100 * v).toExponential(3)} %`);
        expect(devs.filter((d) => d.rel > TOL).length).toBe(0);
      }
    }
    if (MODE === 'time' || process.env.SIM_TIMES) {
      const n = Number(process.env.SIM_N ?? 15);
      const times: Record<string, number> = {};
      for (const c of configs) {
        times[c.name] = median(c, {}, n);
        console.log(`${times[c.name].toFixed(2).padStart(7)} ms  ${c.induction.padEnd(12)} ${c.name}`);
      }
      const v = Object.values(times).sort((x, y) => x - y);
      console.log(`max ${v[v.length - 1].toFixed(2)} ms, median ${v[Math.floor(v.length / 2)].toFixed(2)} ms over ${v.length} configs`);
      if (process.env.SIM_TIMES) fs.writeFileSync(process.env.SIM_TIMES, JSON.stringify(times, null, 1));
    }
  });
});
