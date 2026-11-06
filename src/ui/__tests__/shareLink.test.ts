import { describe, expect, it } from 'vitest';
import { PRESETS } from '../../sim/presets';
import { configFor, isCalibrationStale, buildCalibration, type FitOk, type Calibration } from '../../calibrate';
import { mergeConfig } from '../store';
import {
  MAX_CAL_CHARS,
  MAX_LINK_POINTS,
  b64urlDecode,
  b64urlEncode,
  calibrationNote,
  configToHash,
  decodeCalibration,
  downsampleCurve,
  encodeCalibration,
  parseHash,
  parseStoredCalibration,
} from '../shareLink';

const base = mergeConfig(PRESETS[0]);
const fit = { values: { veScale: 0.93, fricScale: 1.12, camShiftDeg: 3.5 }, capRefNm: 480.55, rmsBeforePct: 9.31, rmsAfterPct: 2.04, verdict: 'good', params: [{ id: 'camShiftDeg', atBound: true }] } as unknown as FitOk;

function makeCal(measuredN: number, b = base, name = 'my_dyno.csv'): Calibration {
  const rpm = Array.from({ length: measuredN }, (_, i) => 1000 + (i * 6000) / Math.max(1, measuredN - 1));
  const torqueNm = rpm.map((r) => 300 + 80 * Math.sin(r / 1500));
  return buildCalibration({ fit, base: b, applyOemLimits: false, sourceName: name, basis: 'crank', drivetrainLossPct: 15, standard: 'sae-j1349', measured: { rpm, torqueNm } });
}

describe('share link: calibration round trip', () => {
  it('legacy cfg-only links open uncalibrated and unchanged', () => {
    const hash = `#cfg=${b64urlEncode(JSON.stringify(base))}`;
    const h = parseHash(hash, mergeConfig)!;
    expect(h.cal).toBeNull();
    expect(h.config.name).toBe(base.name);
    expect(h.config.boreMm).toBe(base.boreMm);
  });
  it('configToHash without a calibration is the old format', () => {
    expect(configToHash(base)).toBe(`#cfg=${b64urlEncode(JSON.stringify(base))}`);
  });
  it('round-trips values, summary and the downsampled curve', () => {
    const cal = makeCal(120);
    const h = parseHash(configToHash(cal.fittedConfig, cal), mergeConfig)!;
    const d = h.cal!.calibration;
    expect(d.values.veScale).toBeCloseTo(0.93, 4);
    expect(d.values.fricScale).toBeCloseTo(1.12, 4);
    expect(d.values.camShiftDeg).toBeCloseTo(3.5, 4);
    expect(d.sourceName).toBe('my_dyno.csv');
    expect(d.rmsBeforePct).toBeCloseTo(9.31, 2);
    expect(d.rmsAfterPct).toBeCloseTo(2.04, 2);
    expect(d.verdict).toBe('good');
    expect(d.applyOemLimits).toBe(false);
    expect(d.atBound).toEqual(['camShiftDeg']);
    expect(d.capRefNm).toBeCloseTo(480.6, 1);
    expect(d.baseConfig.name).toBe(base.name);
    // fitted config is re-derived, so an unedited link is not stale
    expect(isCalibrationStale(h.config, d)).toBe(false);
    expect(d.measured.rpm.length).toBe(MAX_LINK_POINTS);
    expect(d.measured.rpm[0]).toBe(1000);
    expect(d.measured.rpm.at(-1)).toBe(7000);
    expect(h.cal!.note).toContain('downsampled to 40 of 120');
  });
  it('a small curve is carried whole, with no note', () => {
    const cal = makeCal(12);
    const d = decodeCalibration(encodeCalibration(cal), mergeConfig)!;
    expect(d.calibration.measured.rpm).toHaveLength(12);
    expect(d.note).toBeNull();
  });
  it('full-precision fitted values: an unedited link is never reported stale', () => {
    const cal = buildCalibration({ fit: { ...fit, values: { runnerScale: 1.0834729183, camShiftDeg: 3.14159265, boostScale: 1.0213456 } } as unknown as FitOk, base, applyOemLimits: true, sourceName: 'x', basis: 'crank', drivetrainLossPct: 15, standard: 'sae-j1349', measured: { rpm: [1000, 2000], torqueNm: [1, 2] } });
    const h = parseHash(configToHash(cal.fittedConfig, cal), mergeConfig)!;
    expect(isCalibrationStale(h.config, h.cal!.calibration)).toBe(false);
  });
  it('an edited build opens stale', () => {
    const cal = makeCal(20);
    const edited = { ...cal.fittedConfig, compressionRatio: cal.fittedConfig.compressionRatio + 1 };
    const h = parseHash(configToHash(edited, cal), mergeConfig)!;
    expect(isCalibrationStale(h.config, h.cal!.calibration)).toBe(true);
  });
  it('a non-preset base config is carried in full', () => {
    const custom = { ...base, name: 'Garage special', boreMm: base.boreMm + 1 };
    const cal = makeCal(20, custom);
    const d = decodeCalibration(encodeCalibration(cal), mergeConfig)!.calibration;
    expect(d.baseConfig.name).toBe('Garage special');
    expect(d.baseConfig.boreMm).toBeCloseTo(custom.boreMm, 6);
    expect(d.fittedConfig.intakeRunnerMm).toBeCloseTo(configFor(custom, cal.values).intakeRunnerMm, 6);
  });
  it('payload stays small', () => {
    const s = encodeCalibration(makeCal(5000));
    expect(s.length).toBeLessThanOrEqual(MAX_CAL_CHARS);
    expect(decodeCalibration(s, mergeConfig)!.calibration.measured.rpm.length).toBeLessThanOrEqual(MAX_LINK_POINTS);
  });
  it('without a measured curve it opens calibrated, no overlay, with a note', () => {
    const cal = makeCal(20);
    cal.measured = { rpm: [], torqueNm: [] };
    const d = decodeCalibration(encodeCalibration(cal), mergeConfig)!;
    expect(d.calibration.measured.rpm).toHaveLength(0);
    expect(d.calibration.values.veScale).toBeCloseTo(0.93, 4);
    expect(d.note).toMatch(/did not include the measured curve/);
    // and such a calibration survives storage / garage parsing
    const stored = parseStoredCalibration(JSON.parse(JSON.stringify(d.calibration)), mergeConfig);
    expect(stored?.measured.rpm).toHaveLength(0);
    expect(stored?.values.fricScale).toBeCloseTo(1.12, 4);
  });
  it('garbage cal payloads degrade to uncalibrated, never throw', () => {
    for (const bad of ['!!!', b64urlEncode('{}'), b64urlEncode('{"v":1,"val":{},"b":"no such preset"}'), b64urlEncode('not json')]) {
      expect(decodeCalibration(bad, mergeConfig)).toBeNull();
    }
    const h = parseHash(`${configToHash(base)}&cal=zzzz`, mergeConfig)!;
    expect(h.cal).toBeNull();
    expect(h.config.name).toBe(base.name);
  });
  it('out-of-range values are clamped', () => {
    const cal = makeCal(10);
    const p = JSON.parse(b64urlDecode(encodeCalibration(cal)));
    p.val.veScale = 9;
    const d = decodeCalibration(b64urlEncode(JSON.stringify(p)), mergeConfig)!;
    expect(d.calibration.values.veScale).toBe(1.15);
  });
  it('downsampleCurve keeps ends and caps points', () => {
    const d = downsampleCurve({ rpm: Array.from({ length: 500 }, (_, i) => i * 10), torqueNm: Array.from({ length: 500 }, () => 123.456) }, 40);
    expect(d.rpm).toHaveLength(40);
    expect(d.rpm[0]).toBe(0);
    expect(d.rpm[39]).toBe(4990);
    expect(d.torqueNm[0]).toBe(123.5);
  });
  it('build-sheet note is consistent with the stale state', () => {
    const cal = makeCal(10);
    expect(calibrationNote(cal, false)).toBe('fitted to my_dyno.csv, RMS torque error 9.3 % to 2.0 %');
    expect(calibrationNote(cal, true)).toContain('build edited since the fit');
  });
});
