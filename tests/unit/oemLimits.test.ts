/**
 * OEM limits are explicit, tagged, removable (physics v4, see physics_audit.md §12).
 */
import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/sim/engine';
import { hardwareDiff, isCustomBuild, oemLimitOptions, shouldApplyOemLimits } from '../../src/sim/customBuild';
import { EXTENDED_REFERENCE_ENGINES, REFERENCE_ENGINES } from '../../src/sim/validation/referenceEngines';
import type { EngineConfig } from '../../src/sim/types';

const ALL = [...REFERENCE_ENGINES, ...EXTENDED_REFERENCE_ENGINES];
const n55 = ALL.find((e) => e.id === 'bmw-n55-535i')!.config;
const clone = (c: EngineConfig): EngineConfig => JSON.parse(JSON.stringify(c));

describe('limitSource tagging', () => {
  it('every ECU limit on a reference engine is tagged published-rating; NA engines carry none', () => {
    for (const e of ALL) {
      const ecu = e.config.ecu;
      if (e.config.induction === 'na') {
        expect(ecu?.torqueLimitNm, e.id).toBeUndefined();
        expect(ecu?.powerLimitKw, e.id).toBeUndefined();
      } else if (ecu && (ecu.torqueLimitNm || ecu.powerLimitKw)) {
        expect(ecu.limitSource, e.id).toBe('published-rating');
      }
    }
  });
  it('the tag survives into SimResult.oemLimits', () => {
    const r = simulate(n55);
    expect(r.oemLimits.present).toBe(true);
    expect(r.oemLimits.applied).toBe(true);
    expect(r.oemLimits.source).toBe('published-rating');
    expect(r.oemLimits.torqueLimitNm).toBeGreaterThan(0);
  });
});

describe('applyOemLimits', () => {
  it('default is true (identical to explicit true)', () => {
    expect(simulate(n55).peakTorqueNm).toBe(simulate(n55, { applyOemLimits: true }).peakTorqueNm);
  });
  it('false ignores torque/power limits: more torque and power, flat plateau gone', () => {
    const on = simulate(n55);
    const off = simulate(n55, { applyOemLimits: false });
    expect(off.oemLimits.applied).toBe(false);
    expect(off.oemLimits.present).toBe(true);
    expect(off.peakTorqueNm).toBeGreaterThan(on.peakTorqueNm * 1.02);
    expect(off.peakHp).toBeGreaterThanOrEqual(on.peakHp);
  });
  it('false keeps knock control and EGT protection on', () => {
    const off = simulate(n55, { applyOemLimits: false });
    for (const p of off.curve) {
      expect(p.knockRetardDeg, `${p.rpm}`).toBeLessThanOrEqual(15.5);
      expect(Number.isFinite(p.egtC)).toBe(true);
      expect(p.lambda ?? n55.lambda).toBeLessThanOrEqual(n55.lambda + 1e-9 + 0.3);
    }
    // never above the hardware boost target
    expect(Math.max(...off.curve.map((p) => p.boostBar))).toBeLessThanOrEqual(n55.turbo.targetBoostBar + 0.02);
  });
  it('is a no-op for engines without limits (NA and unlimited turbo)', () => {
    const na = ALL.find((e) => e.config.induction === 'na')!.config;
    expect(simulate(na, { applyOemLimits: false }).curve).toEqual(simulate(na).curve);
    const nolim = clone(n55);
    delete nolim.ecu;
    expect(simulate(nolim, { applyOemLimits: false }).curve).toEqual(simulate(nolim).curve);
    expect(simulate(nolim).oemLimits.present).toBe(false);
  });
});

describe('unlimited curve exposure', () => {
  it('absent unless asked for (keeps the perf budget)', () => {
    expect(simulate(n55).unlimited).toBeUndefined();
  });
  it('includeUnlimited returns exactly the applyOemLimits:false curve', () => {
    const r = simulate(n55, { includeUnlimited: true });
    expect(r.unlimited).toEqual(simulate(n55, { applyOemLimits: false }).curve);
    expect(r.unlimited!.length).toBe(r.curve.length);
  });
  it('is the same curve when no limit is present', () => {
    const na = ALL.find((e) => e.config.induction === 'na')!.config;
    const r = simulate(na, { includeUnlimited: true });
    expect(r.unlimited).toBe(r.curve);
  });
  it('limited + unlimited stays within a 4x single-solve budget', () => {
    simulate(n55);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) simulate(n55);
    const t1 = performance.now();
    for (let i = 0; i < 5; i++) simulate(n55, { includeUnlimited: true });
    const t2 = performance.now();
    expect(t2 - t1).toBeLessThan(4 * (t1 - t0) + 20);
  });
});

describe('custom build', () => {
  it('the unmodified preset is not custom; renaming / ECU / idle do not make it custom', () => {
    expect(isCustomBuild(n55, n55)).toBe(false);
    const c = clone(n55);
    c.name = 'My N55';
    c.idleRpm += 100;
    c.ecu = { ...c.ecu, torqueLimitNm: 999 };
    expect(isCustomBuild(c, n55)).toBe(false);
  });
  it('any hardware field makes it custom, and hardwareDiff names it', () => {
    const cases: [string, (c: EngineConfig) => void][] = [
      ['boreMm', (c) => (c.boreMm += 1)],
      ['strokeMm', (c) => (c.strokeMm += 1)],
      ['compressionRatio', (c) => (c.compressionRatio += 0.5)],
      ['cam.intakeDurationDeg', (c) => (c.cam.intakeDurationDeg += 4)],
      ['turbo.targetBoostBar', (c) => (c.turbo.targetBoostBar += 0.1)],
      ['turbo.compressorInducerMm', (c) => (c.turbo.compressorInducerMm += 2)],
      ['fuel', (c) => (c.fuel = 'e85')],
      ['redlineRpm', (c) => (c.redlineRpm += 200)],
    ];
    for (const [path, mutate] of cases) {
      const c = clone(n55);
      mutate(c);
      expect(isCustomBuild(c, n55), path).toBe(true);
      expect(hardwareDiff(c, n55), path).toContain(path);
    }
  });
  it('no base preset means custom', () => {
    expect(isCustomBuild(n55)).toBe(true);
  });
  it('published-rating limits apply to the stock preset only', () => {
    expect(shouldApplyOemLimits(n55, n55)).toBe(true);
    const c = clone(n55);
    c.turbo.targetBoostBar += 0.2;
    expect(shouldApplyOemLimits(c, n55)).toBe(false);
    expect(oemLimitOptions(c, n55)).toEqual({ applyOemLimits: false });
    expect(oemLimitOptions(n55, n55)).toEqual({ applyOemLimits: true });
  });
  it('a user-sourced limit applies even on a custom build; no limit => nothing to apply', () => {
    const c = clone(n55);
    c.boreMm += 1;
    c.ecu = { torqueLimitNm: 380, limitSource: 'hardware' };
    expect(shouldApplyOemLimits(c, n55)).toBe(true);
    delete c.ecu;
    expect(shouldApplyOemLimits(c, n55)).toBe(false);
  });
  it('custom build via the helper is predicted from hardware: more torque than the capped stock', () => {
    const c = clone(n55);
    c.turbo.targetBoostBar += 0.05;
    const custom = simulate(c, oemLimitOptions(c, n55));
    expect(custom.oemLimits.applied).toBe(false);
    expect(custom.peakTorqueNm).toBeGreaterThan(simulate(n55).peakTorqueNm * 1.02);
  });
});
