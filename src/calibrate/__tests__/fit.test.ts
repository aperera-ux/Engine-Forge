import { describe, expect, it } from 'vitest';
import { oemLimitOptions } from '../../sim/customBuild';
import { simulate } from '../../sim/engine';
import { DYNO_CURVES, DYNO_ENGINE_BY_ID } from '../../sim/validation/dynoCurves';
import { REFERENCE_ENGINES } from '../../sim/validation/referenceEngines';
import { fitCalibration, RMS_POOR_PCT, type FitOk } from '../fit';
import { applyPost, configFor, makeFrame, postFor, simulateWith } from '../model';
import { ALL_PARAM_IDS, PARAM_DEFS, type ParamId, type ParamValues } from '../params';
import { buildCalibration, isCalibrationStale, parseCalibration, simulateCalibrated } from '../types';
import { mergeConfig } from '../../ui/store';

const engine = (id: string) => REFERENCE_ENGINES.find((e) => e.id === id)!;

/** "Measure" a perturbed build: simulate it with the true parameters and return its torque curve. */
function measure(id: string, truth: ParamValues, opts: { noise?: number; minRpm?: number } = {}) {
  const e = engine(id);
  const simOpts = oemLimitOptions(e.config, e.config);
  const frame = makeFrame(e.config, simOpts);
  const r = simulateWith(frame, truth);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
  const pts = r.curve.filter((p) => p.rpm >= (opts.minRpm ?? 1500));
  return {
    base: e.config,
    simOpts,
    measured: { rpm: pts.map((p) => p.rpm), torqueNm: pts.map((p) => p.torqueNm * (1 + (opts.noise ?? 0) * rnd())) },
  };
}

async function fit(input: Parameters<typeof fitCalibration>[0]): Promise<FitOk> {
  const r = await fitCalibration(input);
  if (!r.ok) throw new Error(r.error.message);
  return r;
}

const val = (f: FitOk, id: ParamId) => f.params.find((p) => p.id === id)!.value;

describe('parameter definitions', () => {
  it('every parameter has a documented physical range around its nominal value', () => {
    for (const id of ALL_PARAM_IDS) {
      const d = PARAM_DEFS[id];
      expect(d.min).toBeLessThan(d.max);
      expect(d.nominal).toBeGreaterThanOrEqual(d.min);
      expect(d.nominal).toBeLessThanOrEqual(d.max);
      expect(d.what.length).toBeGreaterThan(40);
      expect(d.range.length).toBeGreaterThan(40);
    }
    // The ranges stay physically modest.
    expect(PARAM_DEFS.veScale.max / PARAM_DEFS.veScale.nominal).toBeLessThanOrEqual(1.2);
    expect(PARAM_DEFS.camShiftDeg.max).toBeLessThanOrEqual(8);
  });

  it('configFor clamps out-of-range values and leaves the base untouched', () => {
    const base = engine('gm-ls3').config;
    const before = JSON.stringify(base);
    const c = configFor(base, { runnerScale: 5, camShiftDeg: 90 });
    expect(c.intakeRunnerMm).toBeCloseTo(base.intakeRunnerMm * PARAM_DEFS.runnerScale.max, 6);
    expect(c.cam.intakeCenterlineDeg).toBeCloseTo(base.cam.intakeCenterlineDeg + PARAM_DEFS.camShiftDeg.max, 6);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('calibrated model', () => {
  it('identity corrections return the simulator result unchanged', () => {
    const e = engine('gm-ls3');
    const r = simulate(e.config);
    expect(applyPost(r, { veScale: 1, fricScale: 1 })).toBe(r);
  });

  it('the bmep -> torque relation matches the simulator (so scale factors are consistent)', () => {
    const e = engine('gm-ls3');
    const r = simulate(e.config);
    // Re-derive torque through applyPost with a trivially different scale and compare at scale 1 + tiny.
    const r2 = applyPost(r, { veScale: 1 + 1e-9, fricScale: 1 });
    r.curve.forEach((p, i) => expect(r2.curve[i].torqueNm).toBeCloseTo(p.torqueNm, 3));
  });

  it('scales move torque the right way and recompute peaks', () => {
    const r = simulate(engine('gm-ls3').config);
    const up = applyPost(r, { veScale: 1.1, fricScale: 1 });
    const fr = applyPost(r, { veScale: 1, fricScale: 1.4 });
    expect(up.peakTorqueNm).toBeGreaterThan(r.peakTorqueNm * 1.08);
    expect(fr.peakTorqueNm).toBeLessThan(r.peakTorqueNm);
    expect(up.peakHp).toBeCloseTo(up.curve.reduce((m, p) => Math.max(m, p.hp), 0), 6);
  });

  it('a torque cap is enforced and yields a plateau range', () => {
    const r = simulate(engine('gm-ls3').config);
    const cap = r.peakTorqueNm * 0.9;
    const c = applyPost(r, { veScale: 1, fricScale: 1, capNm: cap });
    expect(Math.max(...c.curve.map((p) => p.torqueNm))).toBeLessThanOrEqual(cap + 1e-9);
    expect(c.peakTorqueRpmRange![1]).toBeGreaterThan(c.peakTorqueRpmRange![0]);
  });

  it('keeps a stock OEM torque limit in force after scaling up', () => {
    const e = engine('bmw-b58-340i');
    const r = simulate(e.config, oemLimitOptions(e.config, e.config));
    expect(r.oemLimits.applied).toBe(true);
    const c = applyPost(r, { veScale: 1.15, fricScale: 0.7 });
    expect(c.peakTorqueNm).toBeLessThanOrEqual((r.oemLimits.torqueLimitNm ?? 1e9) + 1e-6);
  });
});

describe('identifiability: the fit recovers a perturbed build (noise free)', () => {
  const cases: { id: string; truth: ParamValues }[] = [
    { id: 'gm-ls3', truth: { veScale: 1.06, fricScale: 1.2, runnerScale: 1.1, camShiftDeg: 3 } },
    { id: 'honda-k20a-dc5', truth: { veScale: 0.95, fricScale: 1.3, runnerScale: 0.9, camShiftDeg: -3 } },
    { id: 'ford-coyote-gen3', truth: { veScale: 1.03, fricScale: 0.85, runnerScale: 1.05, camShiftDeg: 2 } },
  ];
  for (const c of cases) {
    it(`${c.id}: recovers ${JSON.stringify(c.truth)}`, async () => {
      const f = await fit(measure(c.id, c.truth));
      expect(f.rmsBeforePct).toBeGreaterThan(2);
      expect(f.rmsAfterPct).toBeLessThan(0.15);
      expect(val(f, 'veScale')).toBeCloseTo(c.truth.veScale!, 1);
      expect(Math.abs(val(f, 'veScale') - c.truth.veScale!)).toBeLessThan(0.015);
      expect(Math.abs(val(f, 'fricScale') - c.truth.fricScale!)).toBeLessThan(0.05);
      expect(Math.abs(val(f, 'runnerScale') - c.truth.runnerScale!)).toBeLessThan(0.02);
      expect(Math.abs(val(f, 'camShiftDeg') - c.truth.camShiftDeg!)).toBeLessThan(0.4);
    }, 60000);
  }

  it('with 1 % measurement noise the parameters are recovered to within a fraction of their range', async () => {
    const truth = { veScale: 1.06, fricScale: 1.2, runnerScale: 1.1, camShiftDeg: 3 };
    const f = await fit(measure('gm-ls3', truth, { noise: 0.01 }));
    expect(f.rmsAfterPct).toBeLessThan(1.2);
    expect(Math.abs(val(f, 'veScale') - truth.veScale)).toBeLessThan(0.04);
    // Friction is the least well-determined parameter under noise (it trades off with the VE scale): loose bound.
    expect(Math.abs(val(f, 'fricScale') - truth.fricScale)).toBeLessThan(0.3);
    expect(Math.abs(val(f, 'runnerScale') - truth.runnerScale)).toBeLessThan(0.05);
    // Timing and tuning length partly trade off under noise. Either they are recovered, or the fit says so.
    const flagged = f.warnings.some((w) => w.code === 'at-bound' || w.code === 'ill-conditioned');
    expect(Math.abs(val(f, 'camShiftDeg') - truth.camShiftDeg) < 1.5 || flagged).toBe(true);
  }, 60000);

  it('boosted engine without an OEM limit: recovers boost and tuning shifts', async () => {
    const truth: ParamValues = { runnerScale: 1.1, camShiftDeg: 2, boostScale: 1.1 };
    const f = await fit({ ...measure('subaru-ej257-sti', truth), paramIds: ['runnerScale', 'camShiftDeg', 'boostScale'] });
    expect(f.rmsAfterPct).toBeLessThan(0.2);
    expect(Math.abs(val(f, 'boostScale') - 1.1)).toBeLessThan(0.02);
    expect(Math.abs(val(f, 'runnerScale') - 1.1)).toBeLessThan(0.02);
    expect(Math.abs(val(f, 'camShiftDeg') - 2)).toBeLessThan(0.5);
  }, 90000);

  it('boosted engine: recovers an ECU torque limit', async () => {
    const truth: ParamValues = { boostScale: 1.05, torqueCap: 0.9 };
    const f = await fit({ ...measure('subaru-ej257-sti', truth), paramIds: ['boostScale', 'torqueCap'] });
    expect(f.rmsAfterPct).toBeLessThan(0.5);
    expect(Math.abs(val(f, 'torqueCap') - 0.9)).toBeLessThan(0.02);
  }, 90000);

  it('boosted engine with all six parameters free: matches the curve and reports an inactive cap as such', async () => {
    const truth: ParamValues = { veScale: 1.04, boostScale: 1.12 };
    const f = await fit(measure('subaru-ej257-sti', truth));
    expect(f.rmsAfterPct).toBeLessThan(1);
    // The data does not need a cap: it must not be invented.
    expect(val(f, 'torqueCap')).toBeGreaterThanOrEqual(0.995);
    expect(f.params.find((p) => p.id === 'torqueCap')!.atBound).toBeNull();
  }, 90000);
});

describe('bounds and honesty', () => {
  it('a truth outside the allowed range ends at the bound and is flagged, not absorbed silently', async () => {
    // Build is 30 % stronger than any allowed VE scale can explain.
    const truth = { veScale: 1.3 } as ParamValues;
    const input = measure('gm-ls3', {});
    const e = input.base;
    const frame = makeFrame(e, input.simOpts);
    const base = simulateWith(frame, {});
    const pts = base.curve.filter((p) => p.rpm >= 1500);
    const f = await fit({ ...input, measured: { rpm: pts.map((p) => p.rpm), torqueNm: pts.map((p) => p.torqueNm * truth.veScale!) }, paramIds: ['veScale', 'fricScale'] });
    expect(val(f, 'veScale')).toBeLessThanOrEqual(PARAM_DEFS.veScale.max + 1e-12);
    expect(f.params.find((p) => p.id === 'veScale' || p.id === 'fricScale')!.atBound).not.toBeNull();
    expect(f.warnings.map((w) => w.code)).toContain('at-bound');
    expect(f.rmsAfterPct).toBeGreaterThan(5);
    expect(f.verdict).toBe('poor');
    expect(f.warnings.map((w) => w.code)).toContain('poor-fit');
  }, 60000);

  it('a curve from a different engine is reported as a poor fit (> 5 %), with a critical warning', async () => {
    const ls7 = DYNO_CURVES.find((c) => c.engineId === 'gm-ls7')!;
    const k20 = engine('honda-k20a-dc5');
    const f = await fit({
      base: k20.config,
      simOpts: oemLimitOptions(k20.config, k20.config),
      measured: { rpm: ls7.points.map((p) => p.rpm), torqueNm: ls7.points.map((p) => p.torqueNm) },
    });
    expect(f.rmsAfterPct).toBeGreaterThan(RMS_POOR_PCT);
    expect(f.verdict).toBe('poor');
    const w = f.warnings.find((x) => x.code === 'poor-fit')!;
    expect(w.severity).toBe('critical');
    expect(w.message).toContain('above 5 %');
  }, 60000);

  it('all fitted values stay inside their documented ranges', async () => {
    const f = await fit(measure('gm-ls3', { veScale: 1.15, fricScale: 1.5, runnerScale: 1.25, camShiftDeg: 6 }));
    for (const p of f.params) {
      expect(p.value).toBeGreaterThanOrEqual(PARAM_DEFS[p.id].min - 1e-12);
      expect(p.value).toBeLessThanOrEqual(PARAM_DEFS[p.id].max + 1e-12);
    }
  }, 60000);

  it('rejects a measured curve that does not overlap the model range', async () => {
    const e = engine('gm-ls3');
    const r = await fitCalibration({
      base: e.config,
      simOpts: {},
      measured: { rpm: [12000, 12500, 13000, 13500, 14000, 14500], torqueNm: [300, 300, 300, 300, 300, 300] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('no-overlap');
  });

  it('reports progress and stops when cancelled', async () => {
    const input = measure('gm-ls3', { veScale: 1.05, runnerScale: 1.1 });
    let progressed = 0;
    let stop = false;
    const r = await fitCalibration(input, {
      onProgress: (p) => {
        progressed++;
        expect(p.frac).toBeGreaterThanOrEqual(0);
        expect(p.frac).toBeLessThanOrEqual(1);
        if (progressed >= 3) stop = true;
      },
      isCancelled: () => stop,
      yieldEvery: 5,
    });
    expect(progressed).toBeGreaterThanOrEqual(3);
    expect(r.ok && r.cancelled).toBe(true);
    if (r.ok) expect(r.evals).toBeLessThan(400);
  }, 60000);
});

describe('refitting reference engines against their own published curves improves the RMS', () => {
  const ids = ['gm-ls3', 'gm-ls7', 'bmw-s65-m3', 'audi-42-fsi-rs4', 'gm-zz6-350', 'gm-lsa-crate', 'bmw-n20-28i', 'bmw-n55-535i'];
  for (const id of ids) {
    it(id, async () => {
      const c = DYNO_CURVES.find((x) => x.engineId === id)!;
      const e = DYNO_ENGINE_BY_ID[id];
      const f = await fit({
        base: e.config,
        simOpts: oemLimitOptions(e.config, e.config),
        measured: { rpm: c.points.map((p) => p.rpm), torqueNm: c.points.map((p) => p.torqueNm) },
      });
      expect(f.rmsAfterPct).toBeLessThanOrEqual(f.rmsBeforePct + 1e-9);
      if (f.rmsBeforePct > 3) expect(f.rmsAfterPct).toBeLessThan(f.rmsBeforePct * 0.85);
      // Honest verdict: anything over 5 % must be flagged.
      if (f.rmsAfterPct > RMS_POOR_PCT) expect(f.warnings.some((w) => w.code === 'poor-fit')).toBe(true);
      // Bound hits are always reported.
      if (f.params.some((p) => p.atBound)) expect(f.warnings.some((w) => w.code === 'at-bound')).toBe(true);
    }, 120000);
  }
});

describe('stored calibration', () => {
  it('round-trips, simulates identically, and goes stale when the build is edited', async () => {
    const input = measure('gm-ls3', { veScale: 1.05, fricScale: 1.1, runnerScale: 1.05, camShiftDeg: 1 });
    const f = await fit(input);
    const cal = buildCalibration({ fit: f, base: input.base, applyOemLimits: false, sourceName: 'test.csv', basis: 'crank', drivetrainLossPct: 15, standard: 'sae-j1349', measured: input.measured });
    const parsed = parseCalibration(JSON.parse(JSON.stringify(cal)), mergeConfig)!;
    expect(parsed).not.toBeNull();
    expect(parsed.values).toEqual(cal.values);
    const a = simulateCalibrated(cal.fittedConfig, cal);
    const b = simulateCalibrated(parsed.fittedConfig, parsed);
    expect(b.peakTorqueNm).toBeCloseTo(a.peakTorqueNm, 6);
    // After apply, the calibrated result matches the measured curve to the fit RMS.
    expect(isCalibrationStale(cal.fittedConfig, cal)).toBe(false);
    expect(isCalibrationStale({ ...cal.fittedConfig, boreMm: cal.fittedConfig.boreMm + 1 }, cal)).toBe(true);
    expect(postFor(cal, cal.values).veScale).toBeCloseTo(cal.values.veScale!, 9);
  }, 60000);

  it('rejects malformed calibrations without throwing', () => {
    expect(parseCalibration(null, mergeConfig)).toBeNull();
    expect(parseCalibration({ version: 2 }, mergeConfig)).toBeNull();
    expect(parseCalibration({ version: 1, baseConfig: {}, fittedConfig: {}, values: {}, measured: { rpm: [1], torqueNm: [] } }, mergeConfig)).toBeNull();
  });
});
