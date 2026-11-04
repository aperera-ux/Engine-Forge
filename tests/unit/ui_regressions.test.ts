/**
 * Issues reported from UI testing (lead, 03:5x), pinned as regression tests.
 * Expected to fail until fixed; see tests/reports/physics_audit.md §2.
 */
import { describe, expect, it } from 'vitest';
import { mutate, ref, REFERENCE_ENGINES, simulate, type EngineConfig } from './helpers';

const ttLs3 = (bar: number, red: number, fuel: EngineConfig['fuel'] = 'gas91'): EngineConfig =>
  mutate(ref('gm-ls3'), (c) => {
    c.fuel = fuel;
    c.induction = 'turbo';
    c.redlineRpm = red;
    c.lambda = 0.8;
    c.turbo = { targetBoostBar: bar, compressorInducerMm: 51, turbineAR: 0.82, intercoolerEffectiveness: 0.75, twinScroll: false, count: 2 };
  });

describe('UI-reported issues', () => {
  it('twin-turbo LS3, 8500 redline: power never collapses by > 40% in one rpm step, and never to 0 below 1.25× valve-float rpm', () => {
    const r = simulate(ttLs3(0.72, 8500));
    for (let i = 1; i < r.curve.length; i++) {
      const a = r.curve[i - 1];
      const b = r.curve[i];
      expect(b.powerKw, `${a.rpm}→${b.rpm} rpm`).toBeGreaterThanOrEqual(0.6 * a.powerKw);
      if (b.rpm < 1.25 * r.valveFloatRpm) expect(b.powerKw, `${b.rpm} rpm`).toBeGreaterThan(0);
    }
  });
  it('BSFC never spikes above 600 g/kWh wherever power > 10% of peak (no 3000 g/kWh clamp artefacts)', () => {
    for (const c of [ttLs3(0.72, 8500), ...REFERENCE_ENGINES.map((e) => e.config)]) {
      const r = simulate(c);
      for (const p of r.curve) if (p.powerKw > 0.1 * r.peakPowerKw) expect(p.bsfcGkWh, `${c.name} ${p.rpm}`).toBeLessThanOrEqual(600);
      // a point with ~0 power must not report a finite huge BSFC either
      for (const p of r.curve) expect(p.bsfcGkWh, `${c.name} ${p.rpm}`).toBeLessThan(2999);
    }
  });
  // Choke-capacity tests run on E85 so the knock-aware ECU boost trim (v3) cannot mask the compressor.
  it('twin 51 mm compressors on a 6.2 L at 0.72 bar (E85): no choke and target boost held to 6600 rpm (0.018·D² ≈ 94 lb/min vs ~72 needed)', () => {
    const r = simulate(ttLs3(0.72, 6600, 'e85'));
    expect(Math.max(...r.curve.map((p) => p.knockRetardDeg)), 'precondition: not knock-limited').toBeLessThanOrEqual(2);
    expect(r.warnings.map((w) => w.code)).not.toContain('compressor-choke');
    for (const p of r.curve.filter((d) => d.rpm >= 4500)) expect(p.boostBar, `${p.rpm}`).toBeGreaterThanOrEqual(0.72 * 0.95);
  });
  it('twin 51 mm at 1.0 bar on 6.2 L (E85): boost held ≥ 0.9 bar to 6600 (~85 lb/min needed of ~94 available)', () => {
    const r = simulate(ttLs3(1.0, 6600, 'e85'));
    expect(Math.max(...r.curve.map((p) => p.knockRetardDeg)), 'precondition: not knock-limited').toBeLessThanOrEqual(2);
    for (const p of r.curve.filter((d) => d.rpm >= 5000)) expect(p.boostBar, `${p.rpm}`).toBeGreaterThanOrEqual(0.9);
  });
  it('spark advance / knock retard are smooth rpm-to-rpm: |second difference| ≤ 1.5° away from spool onset (all references)', () => {
    const bad: string[] = [];
    for (const e of REFERENCE_ENGINES) {
      const c = simulate(e.config).curve;
      for (let i = 2; i < c.length; i++) {
        if (c[i].boostBar - c[i - 2].boostBar > 0.05) continue; // boost coming in: real curvature
        // the knock limit itself is a corner (retard = max(0, …)): skip points touching 0 retard
        if (Math.min(c[i].knockRetardDeg, c[i - 1].knockRetardDeg, c[i - 2].knockRetardDeg) <= 0) continue;
        const d2 = c[i].knockRetardDeg - 2 * c[i - 1].knockRetardDeg + c[i - 2].knockRetardDeg;
        if (Math.abs(d2) > 1.5) bad.push(`${e.id}@${c[i - 1].rpm}: Δ²=${d2.toFixed(2)}°`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('BSFC curve smooth: |second difference| ≤ 2% of local value away from spool onset (all references)', () => {
    const bad: string[] = [];
    for (const e of REFERENCE_ENGINES) {
      const c = simulate(e.config).curve;
      for (let i = 2; i < c.length; i++) {
        if (c[i].boostBar - c[i - 2].boostBar > 0.05) continue;
        if (c[i - 1].rpm < 1500) continue; // lugging region below 1500 rpm
        if (Math.min(c[i].knockRetardDeg, c[i - 1].knockRetardDeg, c[i - 2].knockRetardDeg) <= 0 && Math.max(c[i].knockRetardDeg, c[i - 1].knockRetardDeg, c[i - 2].knockRetardDeg) > 0) continue; // knock-limit corner
        const d2 = c[i].bsfcGkWh - 2 * c[i - 1].bsfcGkWh + c[i - 2].bsfcGkWh;
        if (Math.abs(d2) > 0.02 * c[i - 1].bsfcGkWh) bad.push(`${e.id}@${c[i - 1].rpm}: Δ²=${d2.toFixed(1)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
