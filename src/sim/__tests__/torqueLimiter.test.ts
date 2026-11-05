/**
 * ECU torque / power limiter (engine.ts › limitTorque) and the peak-rpm
 * definition on ECU-limited plateaus (PEAK_PLATEAU_BAND_NM). See
 * tests/reports/physics_audit.md §15.
 */
import { describe, expect, it } from 'vitest';
import { PEAK_PLATEAU_BAND_NM, simulate } from '../engine';
import { CAL } from '../model/constants';
import { PRESETS } from '../presets';
import { EXTENDED_REFERENCE_ENGINES } from '../validation/referenceEngines';
import type { EngineConfig, SimResult } from '../types';

const TOL = CAL.ecuTorqueTolNm;
const omega = (rpm: number) => (rpm * 2 * Math.PI) / 60;

const all: EngineConfig[] = [];
for (const c of [...PRESETS, ...EXTENDED_REFERENCE_ENGINES.map((e) => e.config)]) if (!all.some((x) => x.name === c.name)) all.push(c);
const limited = all.filter((c) => c.induction !== 'na' && ((c.ecu?.torqueLimitNm ?? 0) > 0 || (c.ecu?.powerLimitKw ?? 0) > 0));

/** Effective ECU torque limit at rpm (as engine.ts: min of torque limit and P/ω). */
function limitAt(c: EngineConfig, rpm: number): number {
  const tl = c.ecu?.torqueLimitNm ?? 0;
  const tp = (c.ecu?.powerLimitKw ?? 0) > 0 ? ((c.ecu!.powerLimitKw as number) * 1000) / omega(rpm) : 0;
  return tl > 0 && tp > 0 ? Math.min(tl, tp) : Math.max(tl, tp);
}

/** Configs whose limit actually binds (limits off, they exceed it somewhere). Ford 3.5 EcoBoost does not: its hardware tops out below 637 N·m. */
const binding = limited.filter((c) => simulate(c, { applyOemLimits: false }).curve.some((p) => p.torqueNm > limitAt(c, p.rpm) + TOL));

/** User caps well below the hardware, incl. a supercharged engine (bypass-valve path). */
const byName = (s: string) => all.find((c) => c.name.startsWith(s)) as EngineConfig;
const capped: EngineConfig[] = [
  { ...byName('BMW B58'), name: 'B58 user cap 380', ecu: { ...byName('BMW B58').ecu, torqueLimitNm: 380, limitSource: 'hardware' } },
  { ...byName('BMW N63'), name: 'N63 user cap 520 / 280 kW', ecu: { ...byName('BMW N63').ecu, torqueLimitNm: 520, powerLimitKw: 280, limitSource: 'hardware' } },
  ...all
    .filter((c) => c.induction === 'supercharger')
    .slice(0, 2)
    .map((c) => {
      const pk = simulate(c, { applyOemLimits: false }).peakTorqueNm;
      return { ...c, name: `${c.name} user cap`, ecu: { ...c.ecu, torqueLimitNm: Math.round(0.9 * pk), limitSource: 'hardware' as const } };
    }),
];

describe('ECU torque limiter', () => {
  it('there are torque-limited configs to test, and the user-capped set includes a supercharger', () => {
    expect(limited.length).toBeGreaterThanOrEqual(10);
    expect(capped.some((c) => c.induction === 'supercharger')).toBe(true);
  });

  it('the limit binds on nearly every limited reference config', () => {
    expect(binding.length).toBeGreaterThanOrEqual(limited.length - 1);
  });

  for (const c of [...limited, ...capped]) {
    it(`${c.name}: torque ≤ limit + ${TOL} N·m at every rpm, and the limit is met (within tol) where it binds`, () => {
      const r = simulate(c);
      let atLimit = 0;
      for (const p of r.curve) {
        const lim = limitAt(c, p.rpm);
        expect(p.torqueNm, `${p.rpm} rpm`).toBeLessThanOrEqual(lim + TOL + 1e-9);
        if (Math.abs(p.torqueNm - lim) <= TOL) atLimit++;
      }
      if (binding.includes(c) || capped.includes(c)) expect(atLimit, 'some points held at the limit').toBeGreaterThan(0);
    });
  }
});

describe('ECU torque limiter: insensitive to tiny input perturbations', () => {
  const EPS = 1e-9;
  const perturb: [string, (c: EngineConfig) => EngineConfig][] = [
    ['bore +1e-9', (c) => ({ ...c, boreMm: c.boreMm * (1 + EPS) })],
    ['bore −1e-9', (c) => ({ ...c, boreMm: c.boreMm * (1 - EPS) })],
    ['bore +1e-8', (c) => ({ ...c, boreMm: c.boreMm * (1 + 10 * EPS) })],
    ['stroke +1e-9', (c) => ({ ...c, strokeMm: c.strokeMm * (1 + EPS) })],
    ['CR +1e-9', (c) => ({ ...c, compressionRatio: c.compressionRatio * (1 + EPS) })],
    ['intercooler +1e-9', (c) => ({ ...c, turbo: { ...c.turbo, intercoolerEffectiveness: c.turbo.intercoolerEffectiveness * (1 - EPS) } })],
    ['torque limit +1e-9', (c) => ({ ...c, ecu: { ...c.ecu, torqueLimitNm: c.ecu?.torqueLimitNm ? c.ecu.torqueLimitNm * (1 + EPS) : undefined } })],
  ];
  for (const c of binding) {
    it(`${c.name}: limited points move ≤ 1e-6 relative; peak rpms unchanged`, () => {
      const r0 = simulate(c);
      const lim = r0.curve.map((p) => Math.abs(p.torqueNm - limitAt(c, p.rpm)) <= TOL);
      expect(lim.some(Boolean)).toBe(true);
      for (const [label, f] of perturb) {
        const r1 = simulate(f(c));
        r0.curve.forEach((p, i) => {
          if (!lim[i]) return;
          const rel = Math.abs(r1.curve[i].torqueNm - p.torqueNm) / p.torqueNm;
          // The pre-fix secant amplified 1-ulp changes to ~5e-4 here.
          expect(rel, `${label} @${p.rpm} rpm: ${p.torqueNm} → ${r1.curve[i].torqueNm}`).toBeLessThanOrEqual(1e-6);
        });
        expect(r1.peakTorqueRpm, label).toBe(r0.peakTorqueRpm);
        expect(r1.peakPowerRpm, label).toBe(r0.peakPowerRpm);
      }
    });
  }
});

describe('peak rpm on an ECU-limited plateau', () => {
  const check = (c: EngineConfig, r: SimResult) => {
    const [lo, hi] = r.peakTorqueRpmRange as [number, number];
    expect(r.peakTorqueRpm).toBe(lo);
    expect(hi).toBeGreaterThanOrEqual(lo);
    // peakTorqueRpm is the LOWEST rpm within the band of the peak…
    const first = r.curve.find((p) => p.torqueNm >= r.peakTorqueNm - PEAK_PLATEAU_BAND_NM)!;
    expect(r.peakTorqueRpm, c.name).toBe(first.rpm);
    // …so the UI marker (peakTorqueRpm, peakTorqueNm) sits on the curve.
    expect(r.peakTorqueNm - first.torqueNm).toBeLessThanOrEqual(PEAK_PLATEAU_BAND_NM);
    const pp = r.curve.find((p) => p.rpm === r.peakPowerRpm)!;
    expect((r.peakPowerKw - pp.powerKw) * 1000).toBeLessThanOrEqual(PEAK_PLATEAU_BAND_NM * omega(pp.rpm) + 1e-9);
    expect(r.peakPowerRpm).toBe((r.peakPowerRpmRange as [number, number])[0]);
  };

  for (const c of binding) {
    it(`${c.name}: peakTorqueRpm = plateau start; stable when the limit moves by ±0.01 N·m`, () => {
      const r = simulate(c);
      check(c, r);
      const tl = c.ecu?.torqueLimitNm;
      if (!tl || r.peakTorqueNm < tl - TOL) return; // peak not on the torque limit (power-limited / knock-limited)
      expect(r.peakTorqueRpmRange![1]).toBeGreaterThan(r.peakTorqueRpm); // a real plateau, not a single point
      for (const d of [-0.01, 0.01]) {
        const r1 = simulate({ ...c, ecu: { ...c.ecu, torqueLimitNm: tl + d } });
        expect(r1.peakTorqueRpm, `limit ${tl + d}`).toBe(r.peakTorqueRpm);
      }
    });
  }

  it('NA engines (no ECU limit): peakTorqueRpm / peakPowerRpm are the plain argmax, range collapses to it', () => {
    for (const c of all.filter((x) => x.induction === 'na')) {
      const r = simulate(c);
      const tq = r.curve.reduce((a, b) => (b.torqueNm > a.torqueNm ? b : a));
      const pk = r.curve.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
      expect(r.peakTorqueRpm, c.name).toBe(tq.rpm);
      expect(r.peakPowerRpm, c.name).toBe(pk.rpm);
      expect(r.peakTorqueRpmRange).toEqual([tq.rpm, tq.rpm]);
    }
  });

  it('limits off: boosted engines fall back to the argmax', () => {
    for (const c of limited) {
      const r = simulate(c, { applyOemLimits: false });
      expect(r.peakTorqueRpm, c.name).toBe(r.curve.reduce((a, b) => (b.torqueNm > a.torqueNm ? b : a)).rpm);
    }
  });
});
