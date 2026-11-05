/**
 * Shared helpers for the independent physics audit (tests/unit/*).
 * Read-only use of src/sim: nothing here mutates model state.
 */
import { simulate } from '../../src/sim/engine';
import type { DynoPoint, EngineConfig, SimResult } from '../../src/sim/types';
import { REFERENCE_ENGINES } from '../../src/sim/validation/referenceEngines';
import { FUELS } from '../../src/sim/model/constants';

export { simulate, REFERENCE_ENGINES, FUELS };
export type { DynoPoint, EngineConfig, SimResult };

export const ref = (id: string): EngineConfig => {
  const e = REFERENCE_ENGINES.find((r) => r.id === id);
  if (!e) throw new Error(`missing reference engine ${id}`);
  return clone(e.config);
};

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Deep-set a dotted path on a cloned config. */
export function withField(c: EngineConfig, path: string, value: unknown): EngineConfig {
  const out = clone(c) as unknown as Record<string, unknown>;
  const parts = path.split('.');
  let o = out;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] as Record<string, unknown>;
  o[parts[parts.length - 1]] = value;
  return out as unknown as EngineConfig;
}

export function getField(c: EngineConfig, path: string): unknown {
  let o: unknown = c;
  for (const p of path.split('.')) o = (o as Record<string, unknown>)[p];
  return o;
}

export const mutate = (c: EngineConfig, f: (x: EngineConfig) => void): EngineConfig => {
  const x = clone(c);
  f(x);
  return x;
};

/** Base engines covering the classes the task asks for. */
export const BASES = {
  naI4: 'honda-k20a-dc5',
  naPushrodV8: 'gm-ls3',
  turboI4: 'vw-ea888-gen3-gti',
  turboI6: 'toyota-2jz-gte-us',
  scV8: 'dodge-hellcat-62',
} as const;
export type BaseKey = keyof typeof BASES;
/**
 * Base engines for hardware sanity/continuity tests. The OEM torque limit
 * (EngineConfig.ecu.torqueLimitNm, physics v4) is removed: these rules test
 * hardware physics (boost, intercooler, cams, ...), which a torque-limited
 * factory ECU legitimately hides by design. See physics_audit.md §11.
 */
export const base = (k: BaseKey) => {
  const c = ref(BASES[k]);
  if (c.ecu) delete c.ecu.torqueLimitNm;
  return c;
};

/** Value interpolated at rpm on the curve. */
export function at(r: SimResult, rpm: number, key: keyof DynoPoint = 'torqueNm'): number {
  const c = r.curve;
  if (rpm <= c[0].rpm) return c[0][key] as number;
  for (let i = 1; i < c.length; i++) {
    if (c[i].rpm >= rpm) {
      const a = c[i - 1];
      const b = c[i];
      const t = (rpm - a.rpm) / (b.rpm - a.rpm);
      return (a[key] as number) * (1 - t) + (b[key] as number) * t;
    }
  }
  return c[c.length - 1][key] as number;
}

export const max = (r: SimResult, key: keyof DynoPoint) => Math.max(...r.curve.map((p) => p[key] as number));
export const min = (r: SimResult, key: keyof DynoPoint) => Math.min(...r.curve.map((p) => p[key] as number));
/** Value of `key` at the peak-power point. */
export const atPeakPower = (r: SimResult, key: keyof DynoPoint) =>
  (r.curve.find((p) => p.rpm === r.peakPowerRpm) as DynoPoint)[key] as number;
export const atPeakTorque = (r: SimResult, key: keyof DynoPoint) =>
  (r.curve.find((p) => p.rpm === r.peakTorqueRpm) as DynoPoint)[key] as number;

/** Area under the torque curve between rpm limits (trapezoidal, N·m·rpm). */
export function torqueArea(r: SimResult, lo: number, hi: number): number {
  let s = 0;
  for (let rpm = lo; rpm < hi; rpm += 50) s += 0.5 * (at(r, rpm) + at(r, rpm + 50)) * 50;
  return s;
}

/** Rpm where boost first reaches frac × target. */
export function spoolRpm(r: SimResult, target: number, frac = 0.95): number {
  const p = r.curve.find((d) => d.boostBar >= target * frac);
  return p ? p.rpm : Infinity;
}

export const pct = (a: number, b: number) => (100 * (a - b)) / b;
export const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

/** Results are dumped here by tests so the report can quote numbers. */
export const AUDIT_DIR = new URL('../reports/data/', import.meta.url);

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Collects measured numbers per test file so the audit report can quote them. */
export function recorder(name: string) {
  const data: Record<string, unknown> = {};
  return {
    rec(key: string, value: unknown) {
      data[key] = value;
    },
    flush() {
      const dir = fileURLToPath(AUDIT_DIR);
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}${name}.json`, JSON.stringify(data, null, 1));
    },
  };
}

/** Rounds numbers in a record for compact JSON. */
export const r3 = (x: number) => Math.round(x * 1000) / 1000;
